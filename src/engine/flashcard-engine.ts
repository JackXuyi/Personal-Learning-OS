/**
 * Flashcard Engine（自测卡引擎）—— 全部纯函数，无 React / 无 storage / 无 AI。
 *
 * 职责（docs/learn-flashcard-design-2026-09.md §4.3.3）：
 *   ① 派生（要点 → 卡）与**稳定 id**；② 四档评分 → 新调度状态；
 *   ③ 到期判定与出队顺序；④ 孤儿状态清理；⑤ 计数。
 *
 * 两条不变量：
 * - **只读 `Chapter`，不写任何东西**（卡面不落库，决策 D4-A）；
 * - **不触碰 `LearnerState` / `mastery`**（决策 D1-A / D6-A）—— 本文件不 import
 *   `learner-model.ts` 的掌握度函数，只复用其导出的 `nextReviewInDays`（1/2/4/7）。
 */
import type { CardState, CardStateMap, Chapter, DerivedCard, KeyPointRef, SelfRating } from "../domain";
import { FLASHCARD_SESSION_CAP } from "../domain";
import { hashId } from "../lib/hash";
import { nextReviewInDays } from "./learner-model";

const MS_PER_DAY = 86_400_000;

/**
 * 此处原有的一份私有 `hashId` 已抽到 `src/lib/hash.ts`（F9 学习者记忆是「第四处」
 * 调用，触发 `domain/annotation.ts` 预留的抽取约定）。
 *
 * **输入拼接格式未变**（`chapterId` + `"\u0000"` + `point`）→ `card_*` id 不变，
 * 既有卡片调度状态不会成孤儿（方案 R7）。
 */

/**
 * 卡片稳定 id = `card_` + djb2(`chapterId` + `\u0000` + `point`)。
 *
 * **内容派生**（见 `domain/flashcard.ts` 的说明）：要点文本变了 = 新卡，旧的成孤儿；
 * 绝不用章内 `index` 参与 —— 否则 F7-a 章节合并/重排后调度状态会串到别的要点上。
 */
export function cardIdOf(chapterId: string, point: string): string {
  return `card_${hashId(`${chapterId}\u0000${point}`)}`;
}

/** 归一化要点文本（去首尾空白；非字符串视为空）。 */
function normalizePoint(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * 取「能成卡的原文出处」——**成卡的唯一判据**（决策 D2-b-A）。
 *
 * 三个必要条件（任一不满足 = 该要点不成卡，**不猜也不降级**）：
 * ① `keyPointRefs` 里有 `point` 文本**完全一致**的条目（绝不按 index 硬配 ——
 *    重跑要点后顺序会变）；② `quote` 非空（定位失败时写入空串）；③ 区间有效
 *    （`end > start` 且 `start >= 0`，与 `quote` 交叉校验脏数据）。
 */
function cardRefOf(chapter: Chapter, point: string): KeyPointRef | undefined {
  const ref = (chapter.keyPointRefs ?? []).find((r) => normalizePoint(r?.point) === point);
  if (!ref) return undefined;
  const quote = typeof ref.quote === "string" ? ref.quote.trim() : "";
  if (!quote) return undefined;
  if (!(ref.end > ref.start) || ref.start < 0) return undefined;
  return ref;
}

/** 派生一章的可自测卡（仅有原文出处的要点成卡；同章内按 id 去重）。 */
export function deriveChapterCards(chapter: Chapter, documentId: string): DerivedCard[] {
  const out: DerivedCard[] = [];
  const seen = new Set<string>();
  chapter.keyPoints.forEach((raw, index) => {
    const point = normalizePoint(raw);
    if (!point) return; // 空要点不成卡
    const ref = cardRefOf(chapter, point);
    if (!ref) return; // 无原文出处 → 不成卡（D2-b-A）
    const id = cardIdOf(chapter.id, point);
    if (seen.has(id)) return; // 文本完全相同的重复要点 → 同一张卡
    seen.add(id);
    out.push({
      id,
      chapterId: chapter.id,
      documentId,
      index,
      point,
      quote: String(ref.quote).trim(),
      start: ref.start,
      end: ref.end,
    });
  });
  return out;
}

/** 派生整个资料（跨章）：章 `order` 升序 → 章内 `index`（数组顺序即出队顺序的基准）。 */
export function deriveDocumentCards(chapters: Chapter[], documentId: string): DerivedCard[] {
  return [...chapters]
    .sort((a, b) => a.order - b.order)
    .flatMap((c) => deriveChapterCards(c, documentId));
}

/**
 * 有要点但**无原文出处**的条数 —— 供 UI 诚实提示「M 条要点中 N 条暂无原文出处，未成卡」。
 * 按条计（重复文本各算一条），与派生结果解耦，避免「去重」影响提示数字。
 */
export function uncardedPointCount(chapters: Chapter[]): number {
  return chapters.reduce(
    (n, c) =>
      n +
      c.keyPoints
        .map((p) => normalizePoint(p))
        .filter((p) => p.length > 0)
        .filter((p) => cardRefOf(c, p) === undefined).length,
    0,
  );
}

/**
 * 四档评分 → 新状态（纯函数；复用既有 1/2/4/7 天启发式）。
 *
 * **不返回也不触碰 `LearnerState`** —— 卡片评分不移动掌握度（D1-A / D6-A）。
 */
export function applyCardRating(
  state: CardStateMap,
  card: DerivedCard,
  rating: SelfRating,
  now: number,
): CardStateMap {
  const prev = state[card.id];
  const next: CardState = {
    cardId: card.id,
    chapterId: card.chapterId,
    documentId: card.documentId,
    nextReviewAt: now + nextReviewInDays(rating) * MS_PER_DAY,
    lastReviewedAt: now,
    reps: (prev?.reps ?? 0) + 1,
    lastRating: rating,
    lapses: (prev?.lapses ?? 0) + (rating === "forget" ? 1 : 0),
  };
  return { ...state, [card.id]: next };
}

/** 到期判定：**已学过**且 `nextReviewAt <= now`。新卡（无状态）不算到期，单独计 `fresh`。 */
export function isCardDue(state: CardState | undefined, now: number): boolean {
  return state?.nextReviewAt !== undefined && state.nextReviewAt <= now;
}

/**
 * 出队顺序：① 到期卡（`nextReviewAt` 升序，最该复习的先出；并列按章 → 章内序）
 * ② 新卡（**保持入参顺序** = 调用方的章序 → 章内序）
 * 截断到 `FLASHCARD_SESSION_CAP`。
 */
export function dueQueue(cards: DerivedCard[], state: CardStateMap, now: number): DerivedCard[] {
  const position = new Map(cards.map((c, i) => [c.id, i]));
  const tie = (a: DerivedCard, b: DerivedCard) =>
    a.chapterId.localeCompare(b.chapterId) || a.index - b.index;
  const due = cards
    .filter((c) => isCardDue(state[c.id], now))
    .sort((a, b) => state[a.id]!.nextReviewAt! - state[b.id]!.nextReviewAt! || tie(a, b));
  const fresh = cards
    .filter((c) => state[c.id] === undefined)
    .sort((a, b) => position.get(a.id)! - position.get(b.id)!);
  return [...due, ...fresh].slice(0, FLASHCARD_SESSION_CAP);
}

/**
 * 丢弃孤儿状态（对应要点已不存在 / 文本已变 / 章已删）。
 *
 * **无变化时返回原引用** —— 调用方据此判断「要不要写库」（未评分路径零写入的前提）。
 */
export function pruneCardStates(cards: DerivedCard[], state: CardStateMap): CardStateMap {
  const alive = new Set(cards.map((c) => c.id));
  const keys = Object.keys(state);
  const kept = keys.filter((id) => alive.has(id));
  if (kept.length === keys.length) return state;
  return Object.fromEntries(kept.map((id) => [id, state[id]]));
}

/** 计数：`{ total, due, fresh }`（due = 已到期，fresh = 从未评过）。 */
export function cardStats(
  cards: DerivedCard[],
  state: CardStateMap,
  now: number,
): { total: number; due: number; fresh: number } {
  let due = 0;
  let fresh = 0;
  for (const c of cards) {
    if (state[c.id] === undefined) fresh++;
    else if (isCardDue(state[c.id], now)) due++;
  }
  return { total: cards.length, due, fresh };
}

/**
 * 最近一次到期时间（全未到期时给 UI 显示「下次 9/21」）。
 * 无任何已学过的卡时返回 undefined。
 */
export function nextDueAt(cards: DerivedCard[], state: CardStateMap): number | undefined {
  let min: number | undefined;
  for (const c of cards) {
    const at = state[c.id]?.nextReviewAt;
    if (at === undefined) continue;
    if (min === undefined || at < min) min = at;
  }
  return min;
}
