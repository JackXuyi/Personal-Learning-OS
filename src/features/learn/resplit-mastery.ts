/**
 * 重新切分的掌握度同源迁移（纯函数，docs/library-module-design-2026-09.md §4.3.2）。
 *
 * 切分会更换 chapter.id，而 learnerState.byUnit 以 chapterId 为键——
 * 直接重切会丢失全部学习历史。本模块按「章正文区间重叠比」做同源匹配，
 * 把旧键的掌握度迁移到新键：合并（2 旧 → 1 新）、拆分（1 旧 → 2 新）、
 * 结构大改（无匹配）三种情形都有明确语义。
 */
import type {
  Chapter,
  ChapterRange,
  CognitiveLevel,
  LearnerState,
  UnitMastery,
} from "../../domain";

/** 新章 ← 旧章的匹配结果（一个旧章最多归属一个新章）。 */
export interface ChapterMatch {
  newId: string;
  oldIds: string[];
  /** 该新章与归属旧章的最大区间重叠比（0..1）。 */
  ratio: number;
}

/** 匹配阈值：区间重叠比 ≥ 该值才算同源（防误继承）。 */
export const RESPLIT_MATCH_THRESHOLD = 0.6;

/** Bloom 认知层级由低到高（合并时取最高层级）。 */
const COGNITIVE_ORDER: CognitiveLevel[] = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
];

/** misconceptions 并集去重的上限（与引擎侧保持一致，防无限膨胀）。 */
const MISCONCEPTIONS_CAP = 8;

/**
 * 重叠比 = |交集| / min(|旧区间|, |新区间|)。
 * 用 min 而非并集：合并（2 旧 → 1 新）与包含关系都记 1.0，
 * 拆分（1 旧 → 2 新）时各得 <1 的部分，符合「章被切开」的直觉。
 */
export function overlapRatio(a: ChapterRange, b: ChapterRange): number {
  const lenA = a.end - a.start;
  const lenB = b.end - b.start;
  if (lenA <= 0 || lenB <= 0) return 0;
  const inter = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  if (inter <= 0) return 0;
  return inter / Math.min(lenA, lenB);
}

/** 贪心匹配：每个旧章选重叠比最高且 ≥ 阈值的新章；低于阈值则丢弃（掌握度不迁移）。 */
export function matchResplit(
  oldChapters: readonly Chapter[],
  newChapters: readonly Chapter[],
): ChapterMatch[] {
  const buckets = new Map<string, { oldIds: string[]; ratio: number }>();
  for (const old of oldChapters) {
    let best: { id: string; ratio: number } | undefined;
    for (const next of newChapters) {
      const r = overlapRatio(old.contentRef, next.contentRef);
      if (r >= RESPLIT_MATCH_THRESHOLD && (!best || r > best.ratio)) {
        best = { id: next.id, ratio: r };
      }
    }
    if (!best) continue; // 未达阈值 → 掌握度丢弃
    const bucket = buckets.get(best.id) ?? { oldIds: [], ratio: 0 };
    bucket.oldIds.push(old.id);
    bucket.ratio = Math.max(bucket.ratio, best.ratio);
    buckets.set(best.id, bucket);
  }
  return [...buckets].map(([newId, b]) => ({ newId, oldIds: b.oldIds, ratio: b.ratio }));
}

/**
 * 把旧键的掌握度迁移到新键。
 * 合并规则（同一新章由多个旧章贡献时）：
 *  - mastery / confidence / applicationAbility / interviewAbility → 取最大值（保留最强证据）
 *  - attempts / correctCount → 求和（历史作答不丢）
 *  - lastReviewedAt / lastAssessmentAt / nextReviewAt → 取最大值（最近一次为准）
 *  - cognitiveLevel → 取最高层级；misconceptions → 并集去重（上限 8 条）
 * 未被任何新章继承的旧键 → 删除（避免脏键堆积）。
 */
export function remapLearnerStateOnResplit(
  state: LearnerState,
  matches: readonly ChapterMatch[],
): { state: LearnerState; carried: number; dropped: number } {
  const byUnit: Record<string, UnitMastery> = {};
  const claimed = new Set<string>();
  let carried = 0;
  for (const m of matches) {
    const olds = m.oldIds.map((id) => state.byUnit[id]).filter((u): u is UnitMastery => Boolean(u));
    if (olds.length === 0) continue;
    byUnit[m.newId] = mergeUnits(olds);
    m.oldIds.forEach((id) => claimed.add(id));
    carried += 1;
  }
  const dropped = Object.keys(state.byUnit).filter((id) => !claimed.has(id)).length;
  return { state: { byUnit }, carried, dropped };
}

/** 多个旧章掌握度 → 一个新章（max 分数 / sum 计数 / max 时间 / 并集误解）。 */
function mergeUnits(units: UnitMastery[]): UnitMastery {
  const first = units[0];
  const maxNum = (pick: (u: UnitMastery) => number) =>
    Math.max(...units.map(pick));
  const maxTime = (pick: (u: UnitMastery) => number | undefined) => {
    const values = units.map(pick).filter((v): v is number => v !== undefined);
    return values.length > 0 ? Math.max(...values) : undefined;
  };
  const misconceptions = [
    ...new Set(units.flatMap((u) => u.misconceptions)),
  ].slice(0, MISCONCEPTIONS_CAP);
  const cognitive = units
    .map((u) => u.cognitiveLevel)
    .reduce((hi, cur) =>
      COGNITIVE_ORDER.indexOf(cur) > COGNITIVE_ORDER.indexOf(hi) ? cur : hi,
    );
  return {
    mastery: maxNum((u) => u.mastery),
    confidence: maxNum((u) => u.confidence),
    attempts: units.reduce((n, u) => n + u.attempts, 0),
    correctCount: units.reduce((n, u) => n + u.correctCount, 0),
    cognitiveLevel: cognitive,
    misconceptions,
    lastReviewedAt: maxTime((u) => u.lastReviewedAt) ?? first.lastReviewedAt,
    lastAssessmentAt: maxTime((u) => u.lastAssessmentAt),
    nextReviewAt: maxTime((u) => u.nextReviewAt),
    applicationAbility: maxNum((u) => u.applicationAbility),
    interviewAbility: maxNum((u) => u.interviewAbility),
  };
}
