/**
 * 复述编排（restatement-service）—— 长度校验 → 取 doc/chapter → **无 AI 阻断
 * （D6-B，先于任何写入）** → 落库文本 → 调 AI → **双目标锚定** → 本地算覆盖率
 * → 回填 feedback；另有 `scheduleRestatementReview`（显式调度写回）。
 *
 * 设计（docs/learn-feynman-restatement-design-2026-09.md §4.2 / §8.9）：
 * - **零伪造引用**：`covered` / `missed` / `errors[].evidence` 的引文必须能在
 *   本章正文定位，`errors[].quote` 必须能在用户复述原文定位；锚不上即丢弃该条。
 * - **不信 AI 偏移量**：`ai/restatement.ts` 只产 `quotes`，`start/end` 一律由本层
 *   `locateQuote` 反查（照抄章内提问的分工）。
 * - **不碰掌握度**：mastery 唯一写方仍是卷面（`applyPaperResult`）。本层的"闭环"
 *   落在**证据流**（`EvidenceKind="restatement"`，delta=0）与**显式复习调度**
 *   （`applyKeyPointRating`）两环（决策 D3-A）。
 * - **D6-B 阻断门**：`provider.isConfigured() === false` 时**在落库之前**返回
 *   `no-ai` + `record === undefined` + `saveRestatement` 零调用（防御性早退，
 *   即使 UI 被绕过也不会留下半成品记录）。
 * - **错误只产分类**（`RestatementErrorKind`），文案由 UI 走 i18n 映射。
 *
 * 本模块是纯 TS（无 React / 无 i18n / 无 store 状态订阅）→ 可被
 * `node --experimental-strip-types` 直跑单测。
 */
import type {
  LearnerState,
  Restatement,
  RestatementErrorKind,
  RestatementFeedback,
  RestatementMisread,
  RestatementPoint,
  RestatementResult,
  SelfRating,
} from "../../domain";
import { RESTATEMENT_LIMITS, newId } from "../../domain";
import type { StorageAdapter } from "../../storage";
import type { AIProvider } from "../../ai/types";
import { AiProviderError } from "../../ai/types";
import { PIPELINE_LIMITS } from "../../ai/pipeline-core";
import type { RestatementDraft } from "../../ai/restatement";
import { extractRestatementFeedback } from "../../ai/restatement";
import { applyKeyPointRating } from "../../engine";
import { storage } from "../../stores/useLoopStore";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { locateQuote } from "./evidence-anchor";

/** 复述长度下限 / 上限（UI 与服务层共用同一常量，避免两处口径漂移）。 */
export const MIN_RESTATEMENT_CHARS = RESTATEMENT_LIMITS.minChars;
export const MAX_RESTATEMENT_CHARS = RESTATEMENT_LIMITS.maxChars;

export interface CheckRestatementInput {
  documentId: string;
  chapterId: string;
  text: string;
  /** 注入用（单测传 mock）。 */
  storage?: StorageAdapter;
  provider?: AIProvider;
  now?: number;
}

export async function checkRestatement(input: CheckRestatementInput): Promise<RestatementResult> {
  const store = input.storage ?? storage;
  const text = input.text.trim();
  const now = input.now ?? Date.now();

  // ⓪ 文本非法：不落库、不调用（UI 已在提交前拦截，service 侧同样拒绝）
  if (text.length < MIN_RESTATEMENT_CHARS) {
    return { status: "error", errorKind: "too-short", at: now };
  }
  if (text.length > MAX_RESTATEMENT_CHARS) {
    return { status: "error", errorKind: "too-long", at: now };
  }

  // ① 取资料与章（对照基准正文 + 章标题/要点）
  const doc = await store.getDocument(input.documentId);
  const chapter = (await store.listChapters(input.documentId)).find(
    (c) => c.id === input.chapterId,
  );
  if (!doc || !chapter) return { status: "error", errorKind: "generic", at: now };
  if (!doc.textPreview) return { status: "no-body", at: now };

  // ② D6-B 阻断门：**必须先判就绪、再落库** —— 无 AI 时零写入
  const provider = input.provider ?? buildActiveProvider();
  if (!provider.isConfigured()) return { status: "no-ai", at: now }; // ⚠️ 不返回 record

  // ③ 已确认就绪 → 先落文本（后续 AI 调用失败也不丢用户产出）
  const record: Restatement = {
    id: newId("rst"),
    documentId: doc.id,
    chapterId: chapter.id,
    text,
    createdAt: now,
  };
  await store.saveRestatement(record);

  try {
    const body = doc.textPreview.slice(chapter.contentRef.start, chapter.contentRef.end);
    const truncated = body.length > PIPELINE_LIMITS.restatementBodyChars;
    const profile = await store.getProfile();
    const draft = await extractRestatementFeedback(provider, {
      chapterTitle: chapter.title,
      documentTitle: doc.title,
      keyPoints: chapter.keyPoints,
      body,
      restatement: text,
      ...(profile ? { learner: profile } : {}),
    });
    const anchored = anchorRestatement(draft, body, text);
    const coverage = coverageOf(anchored);
    const feedback: RestatementFeedback = {
      at: Date.now(),
      covered: anchored.covered,
      missed: anchored.missed,
      errors: anchored.errors,
      ...(draft.advice ? { advice: draft.advice } : {}),
      ...(coverage !== undefined ? { coverage } : {}),
      truncated,
    };
    const saved: Restatement = { ...record, feedback };
    await store.saveRestatement(saved); // 回填反馈快照（同 id upsert）

    // 一条都没锚上 → partial（诚实警示，不产伪覆盖率）
    if (anchored.covered.length + anchored.missed.length === 0) {
      return { status: "partial", record: saved, at: now };
    }
    return { status: "ok", record: saved, rating: ratingForCoverage(coverage), at: now };
  } catch (err) {
    // 文本已落库（仅缺 feedback）：返回 record，UI 据此在「往次复述」中可见并可重试。
    return { status: "error", errorKind: classifyRestatementError(err), record, at: now };
  }
}

/**
 * 双目标锚定（纯函数，可直跑单测）—— 三条不变式：
 *   1. 锚不上的条目**一律丢弃**（零伪造引用，绝不产出"近似位置"）；
 *   2. `covered` / `missed` / `errors[].evidence` → 锚回**章正文**（章内相对偏移）；
 *      `errors[].quote` → 锚回**用户复述原文**（复述文本内偏移）；
 *   3. 偏移一律由 `locateQuote` 反查（档1精确 / 档2折叠空白），绝不信模型自报。
 */
export function anchorRestatement(
  draft: RestatementDraft,
  body: string,
  restatementText: string,
): { covered: RestatementPoint[]; missed: RestatementPoint[]; errors: RestatementMisread[] } {
  const anchorPoints = (items: readonly { point: string; quote: string }[]): RestatementPoint[] => {
    const out: RestatementPoint[] = [];
    for (const it of items) {
      const point = it.point?.trim() ?? "";
      const quote = it.quote?.trim() ?? "";
      // point / quote 任一为空即丢该条（与 parse 侧同口径，TC-EDGE-06）。
      if (!point || !quote) continue;
      const hit = locateQuote(body, quote);
      if (!hit) continue; // 不变式 1
      out.push({ point, quote, start: hit.start, end: hit.end });
    }
    return out;
  };

  const covered = anchorPoints(draft.covered);
  const missed = anchorPoints(draft.missed);

  const errors: RestatementMisread[] = [];
  for (const it of draft.errors) {
    const quote = it.quote?.trim() ?? "";
    const evidence = it.evidence?.trim() ?? "";
    if (!quote || !evidence) continue;
    const quoteHit = locateQuote(restatementText, quote);
    if (!quoteHit) continue; // errors.quote 锚不上复述文本 → 丢弃
    const evidenceHit = locateQuote(body, evidence);
    if (!evidenceHit) continue; // 无原文依据的更正不可展示 → 丢弃
    errors.push({
      quote,
      start: quoteHit.start,
      end: quoteHit.end,
      correction: it.correction,
      evidence: { quote: evidence, start: evidenceHit.start, end: evidenceHit.end },
    });
  }

  return { covered, missed, errors };
}

/**
 * 要点覆盖率（纯函数）：`covered / (covered + missed)`。
 * 分母为 0（一条都没锚上）→ `undefined` —— UI 不展示伪覆盖率（决策 D4-A）。
 */
export function coverageOf(a: {
  covered: readonly unknown[];
  missed: readonly unknown[];
}): number | undefined {
  const total = a.covered.length + a.missed.length;
  if (total === 0) return undefined;
  return a.covered.length / total;
}

/** 覆盖率 → 复习档位阈值（含等号；与 MASTERY_FLOOR/THRESHOLD 同源口径）。 */
export const RESTATEMENT_COVERAGE_RATING = { good: 0.8, hard: 0.5 } as const;

/**
 * 覆盖率 → 复习档位（纯函数，确定性、可复算）。
 *
 * `undefined`（无覆盖率，正常路径不会走到）→ `forget`：宁可把复习安排得更近，
 * 也不在"无法核对"时给出过于乐观的间隔。
 */
export function ratingForCoverage(coverage: number | undefined): SelfRating {
  if (coverage === undefined) return "forget";
  if (coverage >= RESTATEMENT_COVERAGE_RATING.good) return "good";
  if (coverage >= RESTATEMENT_COVERAGE_RATING.hard) return "hard";
  return "forget";
}

/**
 * 显式调度写回（UC-10 / 决策 D3-A）：读 state → `applyKeyPointRating` →
 * `saveLearnerState` → `appendEvidence({kind:"restatement",…,delta:0})`。
 *
 * **不写 mastery / attempts / correctCount**（`applyKeyPointRating` 的既定语义）。
 * 证据落库失败不阻塞主流程（与 `ChapterReaderPage.markReviewed` 同款处理）。
 */
export async function scheduleRestatementReview(input: {
  chapterId: string;
  rating: SelfRating;
  sourceId?: string;
  storage?: StorageAdapter;
  now?: number;
}): Promise<{ learnerState: LearnerState }> {
  const store = input.storage ?? storage;
  const now = input.now ?? Date.now();
  const state = await store.getLearnerState();
  const next = applyKeyPointRating(state, input.chapterId, input.rating, now);
  await store.saveLearnerState(next);
  try {
    await store.appendEvidence({
      at: now,
      kind: "restatement",
      subjectId: input.chapterId,
      verdict: input.rating,
      delta: 0,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    });
  } catch {
    /* 证据落库失败不阻塞复习主流程（掌握度与调度已完成）。 */
  }
  return { learnerState: next };
}

/** 只读包装（避免 UI 直接摸 storage）：某章复述列表（createdAt 降序）。 */
export async function listChapterRestatements(
  chapterId: string,
  store: StorageAdapter = storage,
): Promise<Restatement[]> {
  return store.listRestatements(chapterId);
}

/** 删除一条复述（不影响掌握度 / 章状态 / 试卷）。 */
export async function removeRestatement(
  id: string,
  store: StorageAdapter = storage,
): Promise<void> {
  await store.deleteRestatement(id);
}

/**
 * 异常 → 稳定的原因分类（不把异常栈丢给用户；文案由 UI 走 i18n）。
 *
 * 照抄 `chapter-qa-service.classifyQaError`：
 * - `not-configured` → 阻断门通过后模型失效（竞态）；
 * - `request-failed` → 主要是模型输出不可解析（`chatJson` / `extractJson`）→ `parse`；
 * - 其它（storage / 读取链路）→ `fetch`。
 */
function classifyRestatementError(err: unknown): RestatementErrorKind {
  if (err instanceof AiProviderError) {
    if (err.code === "not-configured") return "not-configured";
    if (err.code === "request-failed") return "parse";
    return "generic";
  }
  return "fetch";
}
