/**
 * Capability Engine（目标级能力评测引擎）—— **全部纯函数**：零 React / 零 storage /
 * 零 AI，可被 `node --experimental-strip-types` 直跑单测。
 *
 * 职责（docs/goal-capability-assessment-design-2026-09.md §8.4）：
 *   ① 权重归一；② 逐能力项聚合；③ 达标判定；④ 覆盖缺口；⑤ 加权总分；
 *   ⑥ 报告生成（唯一入口）；⑦ 目标页统计。
 *
 * 三条不变量：
 * - **`unknown` 不进分母**：没被任务覆盖的能力项既不通过也不失败，把它当 0 分
 *   会凭空拉低总分（决策 D9-A 口径 1）；
 * - **报告是纯函数产物**：同输入 → 同结果（仅 `id` / `createdAt` 可变），可复算；
 * - **不碰 `LearnerState`**：本文件不 import `learner-model.ts`（决策 D5）。
 */
import type {
  CapabilityItem,
  CapabilityItemSnapshot,
  CapabilityQuote,
  CapabilityReport,
  CapabilityScore,
  CapabilityTask,
  CapabilityVerdict,
} from "../domain";

/** 能力项达标线（与 `MASTERY_THRESHOLD` 同值但**独立常量**：口径不同源）。 */
export const CAPABILITY_THRESHOLD = 0.8;

export const CAPABILITY_LIMITS = {
  /** 能力项条数（AI 提炼与手动维护共用上限；下限仅对 AI 产出做校验）。 */
  minItems: 1,
  maxItems: 6,
  /** 场景任务条数。 */
  minTasks: 2,
  maxTasks: 5,
  /** 单任务可考察的能力项数上限。 */
  maxItemsPerTask: 2,
  labelChars: 60,
  descChars: 200,
  promptChars: 600,
  deliverableHintChars: 200,
  criteriaMax: 4,
  criteriaChars: 120,
  /** 单任务作答长度（下限防敷衍，上限防超上下文）。 */
  answerMinChars: 40,
  answerMaxChars: 4_000,
  rationaleChars: 120,
  quoteMaxChars: 200,
} as const;

/** 单条引用在报告中的展示区间（列表内截断，避免报告被长引用撑爆）。 */
export const CAPABILITY_EVIDENCE_PREVIEW_CHARS = 60;

/** 单任务 · 单能力项的原始分（AI 回填后的结果，报告生成的输入）。 */
export interface CapabilityPerTaskScore {
  taskId: string;
  itemId: string;
  score: number;
  rationale?: string;
  evidence: CapabilityQuote[];
  unanchored?: boolean;
}

/** 目标页 / 摘要卡统计（不依赖 storage —— 由调用方传最新报告）。 */
export interface CapabilityStats {
  total: number;
  passed: number;
  rate: number;
  approved: boolean;
  uncovered: number;
}

/** 分数夹取到 [0,1]（模型越界时的最后一道防线；正常路径不会触发）。 */
export function clampScore(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * 权重归一：全 0 / 全缺省 → 均分；否则按比例归一（总和 1）。
 *
 * 返回**原顺序**的新数组（不改入参 —— 快照是报告渲染依据，不能就地改）。
 */
export function normalizeWeights(
  items: readonly CapabilityItemSnapshot[],
): CapabilityItemSnapshot[] {
  if (items.length === 0) return [];
  const sum = items.reduce((n, i) => n + Math.max(0, i.weight), 0);
  if (sum <= 0) return items.map((i) => ({ ...i, weight: 1 / items.length }));
  return items.map((i) => ({ ...i, weight: Math.max(0, i.weight) / sum }));
}

/**
 * 单项聚合：跨任务取**算术平均**（每任务每项至多一条原始分）。
 *
 * 无任何任务覆盖 → `undefined`（判定为 `unknown`，**不是 0 分**）。
 */
export function scoreOfItem(
  perTask: readonly { taskId: string; itemId: string; score: number }[],
  itemId: string,
): { score: number; fromTaskIds: string[] } | undefined {
  const hits = perTask.filter((r) => r.itemId === itemId);
  if (hits.length === 0) return undefined;
  const sum = hits.reduce((n, r) => n + clampScore(r.score), 0);
  return {
    score: sum / hits.length,
    fromTaskIds: [...new Set(hits.map((r) => r.taskId))],
  };
}

/** 判定：`score >= threshold` → pass（**含等号**）；`<` → fail；`undefined` → unknown。 */
export function verdictOf(score: number | undefined, threshold: number): CapabilityVerdict {
  if (score === undefined) return "unknown";
  return clampScore(score) >= threshold ? "pass" : "fail";
}

/**
 * 覆盖缺口：清单里有、但**没有任何任务 rubric 引用**的能力项 id。
 *
 * 与报告里的 `uncoveredItemIds` 同义（后者由实际评分结果推出，更能反映"模型漏评"）。
 */
export function coverageGaps(
  items: readonly CapabilityItemSnapshot[],
  tasks: readonly CapabilityTask[],
): string[] {
  const covered = new Set<string>();
  for (const t of tasks) for (const r of t.rubric) covered.add(r.itemId);
  return items.filter((i) => !covered.has(i.id)).map((i) => i.id);
}

/**
 * 加权总分：`unknown` / 未覆盖项**不进分母**；有效项为 0 → `undefined`。
 *
 * 有效项权重和为 0（全 0 权重）→ 退化为有效项均分（与 `normalizeWeights` 同口径）。
 */
export function overallScore(
  items: readonly CapabilityItemSnapshot[],
  scores: readonly CapabilityScore[],
): number | undefined {
  const byId = new Map(scores.map((s) => [s.itemId, s]));
  const valid = items.filter((i) => {
    const s = byId.get(i.id);
    return s !== undefined && s.verdict !== "unknown" && s.score !== undefined;
  });
  if (valid.length === 0) return undefined;
  const normalized = normalizeWeights(valid);
  return normalized.reduce((sum, i) => {
    const score = byId.get(i.id)?.score ?? 0;
    return sum + i.weight * clampScore(score);
  }, 0);
}

/** 引用去重（同 quote 文本 + 同起点只留一条；顺序按首次出现）。 */
function dedupeQuotes(quotes: readonly CapabilityQuote[]): CapabilityQuote[] {
  const seen = new Set<string>();
  const out: CapabilityQuote[] = [];
  for (const q of quotes) {
    const key = `${q.start}\u0000${q.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

/**
 * 报告生成（**唯一入口**，纯函数）。
 *
 * 逐项：
 * - 无任务覆盖 → `verdict: "unknown"` + 无 `score`，进 `uncoveredItemIds`；
 * - 有覆盖 → 聚合分 + 判定；**引文一条都锚不上** → `unanchored: true`（保留分数与
 *   理由，但绝不展示伪引用 —— 诚实降级，见 UC-04）。
 *
 * `objective` 由调用方透传（阶段 1 客观卷参考分）：报告**只展示**，不参与任何
 * 加权（决策 D9-A 口径 2/3）。
 */
export function buildReport(input: {
  goalId: string;
  runId: string;
  items: readonly CapabilityItemSnapshot[];
  perTask: readonly CapabilityPerTaskScore[];
  objective?: { paperId: string; totalScore: number };
  now: number;
  id?: string;
}): CapabilityReport {
  const scores: CapabilityScore[] = input.items.map((item) => {
    const hits = input.perTask.filter((r) => r.itemId === item.id);
    const agg = scoreOfItem(input.perTask, item.id);
    if (!agg) {
      return { itemId: item.id, verdict: "unknown", evidence: [], fromTaskIds: [] };
    }
    const evidence = dedupeQuotes(hits.flatMap((h) => h.evidence));
    // 多任务给了同一项理由时取首个非空（避免把两段话拼成一段伪叙述）。
    const rationale = hits.map((h) => h.rationale?.trim() ?? "").find((r) => r.length > 0);
    return {
      itemId: item.id,
      score: agg.score,
      verdict: verdictOf(agg.score, item.threshold),
      ...(rationale ? { rationale } : {}),
      evidence,
      fromTaskIds: agg.fromTaskIds,
      ...(evidence.length === 0 ? { unanchored: true } : {}),
    };
  });

  const uncoveredItemIds = scores.filter((s) => s.verdict === "unknown").map((s) => s.itemId);
  const overall = overallScore(input.items, scores);
  const approved = scores.length > 0 && scores.every((s) => s.verdict === "pass");

  return {
    id: input.id ?? `cap_report_${input.runId}`,
    goalId: input.goalId,
    runId: input.runId,
    items: scores,
    ...(overall !== undefined ? { overall } : {}),
    approved,
    uncoveredItemIds,
    ...(input.objective ? { objective: input.objective } : {}),
    createdAt: input.now,
  };
}

/** 目标页统计（与报告同源；`undefined` = 尚未评测）。 */
export function capabilityStatsOf(report: CapabilityReport | undefined): CapabilityStats {
  if (!report) return { total: 0, passed: 0, rate: 0, approved: false, uncovered: 0 };
  const total = report.items.length;
  const passed = report.items.filter((s) => s.verdict === "pass").length;
  return {
    total,
    passed,
    rate: total > 0 ? passed / total : 0,
    approved: report.approved,
    uncovered: report.uncoveredItemIds.length,
  };
}

/** 发起前校验（UI 禁用态与服务层共用同一判据，避免两处口径漂移）。 */
export function canStartCapabilityRun(items: readonly CapabilityItem[]): boolean {
  return items.length >= CAPABILITY_LIMITS.minItems;
}
