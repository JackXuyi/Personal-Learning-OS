/**
 * 自测卡编排（flashcard-service）—— 派生 / 统计 / 评分 / 撤销 / 重置。
 *
 * 设计（docs/learn-flashcard-design-2026-09.md §4.3.5 / §8.8）：
 * - **零 AI**：本模块不 import `src/ai/*`，不触发任何模型调用。
 * - **卡面不落库**（D4-A）：`DerivedCard` 每次现场派生；持久化的只有 `CardState`。
 * - **不碰掌握度**（D1-A / D6-A）：评分只写 `CardState` + 一条 `kind="card"`、
 *   `delta=0` 的证据；**绝不经过 `useLoopStore.submitAnswer`**（那里的 `applyRating`
 *   会移动 mastery）。本模块不 import `applyRating` / `saveLearnerState`。
 * - **未评分路径零写入**：`peekCardStats` 纯只读；`collectCards` 的**唯一**写点是
 *   孤儿清理（`pruned > 0` 时才写）。
 * - **孤儿清理必须限定 scope**：只清理本次 scope（章 / 资料）内的孤儿状态 ——
 *   否则打开 A 章的卡片会话会把 B 章的进度当孤儿删掉（方案 §8.8 伪代码的修正，
 *   见 §13.3）。
 * - 服务层**只产计数与分类**，文案由 UI 走 `useI18n` 映射。
 *
 * 本模块是纯 TS（无 React / 无 i18n）→ 可被 `node --experimental-strip-types` 直跑单测。
 */
import type { CardState, CardStateMap, Chapter, DerivedCard, SelfRating } from "../../domain";
import type { StorageAdapter } from "../../storage";
import {
  applyCardRating,
  cardStats,
  deriveChapterCards,
  deriveDocumentCards,
  dueQueue,
  nextDueAt,
  nextReviewInDays,
  pruneCardStates,
  uncardedPointCount,
} from "../../engine";
import { storage } from "../../stores/useLoopStore";

/** 卡片组范围：章级（阅读页入口）或资料级（跨章）。 */
export interface CardScope {
  documentId: string;
  chapterId?: string;
}

/** 入口按钮用的只读计数（`peekCardStats`；**零写入**）。 */
export interface CardStats {
  total: number;
  due: number;
  fresh: number;
  /** 有要点但无原文出处、未成卡的条数（UI 诚实提示）。 */
  uncarded: number;
  /** 全未到期时给出最近一次到期时间，供 UI 显示「下次 9/21」。 */
  nextDueAt?: number;
}

export interface CardCollection extends CardStats {
  cards: DerivedCard[];
  /** 本次会话队列（到期优先 → 新卡，截断到 `FLASHCARD_SESSION_CAP`）。 */
  queue: DerivedCard[];
  /** scope 内目前有效的调度状态（撤销需要"评分前状态"）。 */
  state: CardStateMap;
  /** 本次清理掉的孤儿状态数（> 0 才有写入）。 */
  pruned: number;
  /** scope 指定的章不存在 / 不属于该资料（UI 走「章不存在」空态，不伪造卡片）。 */
  scopeMissing: boolean;
}

export interface RatedCard {
  cardId: string;
  rating: SelfRating;
  nextReviewInDays: number;
  nextReviewAt: number;
}

/** 取 scope 内的章（章级 = 单章；资料级 = 全部）。 */
async function scopedChapters(scope: CardScope, store: StorageAdapter): Promise<Chapter[]> {
  const chapters = await store.listChapters(scope.documentId);
  return scope.chapterId ? chapters.filter((c) => c.id === scope.chapterId) : chapters;
}

function cardsOf(scope: CardScope, chapters: Chapter[]): DerivedCard[] {
  return scope.chapterId
    ? chapters.flatMap((c) => deriveChapterCards(c, scope.documentId))
    : deriveDocumentCards(chapters, scope.documentId);
}

/**
 * 收集卡片组（**未评分路径上的唯一写操作 = 孤儿清理**，且仅在确有孤儿时执行）。
 *
 * 卡面派生（`Chapter`）与调度状态（`plos.flashcards`）在此汇合，返回可直接驱动
 * 会话的 `queue` / `state` / 计数 —— 组件不需要也不应再直连 storage。
 */
export async function collectCards(
  scope: CardScope,
  now: number,
  store: StorageAdapter = storage,
): Promise<CardCollection> {
  const chapters = await scopedChapters(scope, store);
  const cards = cardsOf(scope, chapters);
  const before = await store.listCardStates();

  // 只对 scope 内的章做孤儿判定（跨章状态一律原样保留）
  const scopeChapterIds = new Set(chapters.map((c) => c.id));
  const scopedState: CardStateMap = {};
  for (const [id, st] of Object.entries(before)) {
    if (scopeChapterIds.has(st.chapterId)) scopedState[id] = st;
  }
  const prunedScoped = pruneCardStates(cards, scopedState);
  const prunedIds = Object.keys(scopedState).filter((id) => !(id in prunedScoped));

  let state = before;
  if (prunedIds.length > 0) {
    state = { ...before };
    for (const id of prunedIds) delete state[id];
    await store.deleteCardStates(prunedIds);
  }

  const stats = cardStats(cards, state, now);
  return {
    cards,
    ...stats,
    queue: dueQueue(cards, state, now),
    state,
    uncarded: uncardedPointCount(chapters),
    pruned: prunedIds.length,
    nextDueAt: nextDueAt(cards, state),
    scopeMissing: scope.chapterId !== undefined && chapters.length === 0,
  };
}

/** 只读统计（入口按钮显示计数用；**不写任何东西**）。 */
export async function peekCardStats(
  scope: CardScope,
  now: number,
  store: StorageAdapter = storage,
): Promise<CardStats> {
  const chapters = await scopedChapters(scope, store);
  const cards = cardsOf(scope, chapters);
  const state = await store.listCardStates();
  return {
    ...cardStats(cards, state, now),
    uncarded: uncardedPointCount(chapters),
    nextDueAt: nextDueAt(cards, state),
  };
}

/** 读取单卡的当前状态（撤销需要"评分前状态"；首次评分前为 undefined）。 */
export async function readCardState(
  cardId: string,
  store: StorageAdapter = storage,
): Promise<CardState | undefined> {
  const state = await store.listCardStates();
  return state[cardId];
}

/**
 * 评一张卡：`applyCardRating` → `saveCardState` → 一条 `kind="card"` 证据。
 *
 * 证据写入失败**不阻断**复习主流程（先例 `ChapterReaderPage.tsx` 的 markReviewed）；
 * 卡状态已落库，因此返回结果始终反映真实调度。
 */
export async function rateCard(
  card: DerivedCard,
  rating: SelfRating,
  now: number,
  store: StorageAdapter = storage,
): Promise<RatedCard> {
  const state = await store.listCardStates();
  const next = applyCardRating(state, card, rating, now);
  const saved = next[card.id];
  await store.saveCardState(saved);
  try {
    await store.appendEvidence({
      at: now,
      kind: "card",
      subjectId: card.chapterId,
      verdict: rating,
      delta: 0,
      sourceId: card.id,
    });
  } catch {
    // 证据落库失败不阻塞复习主流程（既有先例）
  }
  return {
    cardId: card.id,
    rating,
    nextReviewInDays: nextReviewInDays(rating),
    nextReviewAt: saved.nextReviewAt ?? now,
  };
}

/**
 * 撤销一次评分：回写评分前的状态；**首次评分**（无前状态）则删除该条。
 *
 * 与既有复习会话一致：**不回滚已写入的 evidence 行**（`StorageAdapter` 无删除
 * evidence 的 API）—— 本方案不引入新的不对称，也不顺手改既有语义（D6-A）。
 */
export async function revertCard(
  cardId: string,
  prev: CardState | undefined,
  store: StorageAdapter = storage,
): Promise<void> {
  if (prev) await store.saveCardState(prev);
  else await store.deleteCardStates([cardId]);
}

/** 清空指定卡的进度（用户主动重置）。空数组 = 无操作。 */
export async function resetCards(
  cardIds: string[],
  store: StorageAdapter = storage,
): Promise<void> {
  if (cardIds.length === 0) return;
  await store.deleteCardStates(cardIds);
}
