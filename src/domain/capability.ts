/**
 * 目标级能力评测（F6 —— 「我够格了吗」）的领域对象。
 *
 * 与章级测评（`domain/quiz.ts`）明确分层（docs/goal-capability-assessment-design-2026-09.md §13）：
 *
 * | | 章级掌握度 | 目标级能力（本文件） |
 * |---|---|---|
 * | 粒度 | 章（内容单位） | 能力项（人的能力单位） |
 * | 证据 | 试卷客观/主观分 | 真实任务产出（场景任务作答） |
 * | 回答 | 这段内容记住了吗 | 这件事我能独立做成吗 |
 * | 写 mastery | 是（`applyPaperResult`） | **否**（决策 D5：独立证据层） |
 *
 * 三条不变量：
 * 1. **不写 `LearnerState`**：mastery 的唯一写方仍是卷面；能力评测结果只落
 *    `CapabilityReport` + 证据流（`kind="capability"`，`delta=0`）。
 * 2. **能力项 id 内容派生**：`cap_` + djb2(`goalId` + NUL + `label`) —— 标签改写
 *    = 新能力项（同 `DerivedCard` 口径，避免增删/重命名后历史报告错配）。
 * 3. **报告 append-only**：重评产生新报告，历史报告按 run 快照渲染，永不原地更新。
 */

/**
 * 达标判定。
 *
 * `unknown` = **无任务覆盖**该能力项（既非通过也非失败）—— 必须与 `fail` 区分：
 * 把「没测」显示成「没达标」是在制造假结论（报告用黄条而非红标）。
 */
export type CapabilityVerdict = "pass" | "fail" | "unknown";

/** 能力项来源（AI 提炼 / 用户手填）。 */
export type CapabilityItemSource = "ai" | "manual";

/** 能力项：目标级评测的最小判定单位。 */
export interface CapabilityItem {
  /** `cap_` + djb2(`goalId` + `"\u0000"` + `label`) —— 标签改写 = 新项。 */
  id: string;
  goalId: string;
  label: string;
  /** 验收线索（可选；AI 提炼时给出，人工可留空）。 */
  description?: string;
  /** 相对权重（>0；聚合时归一；全为 0 时退化为均分）。 */
  weight: number;
  /** 该项达标线 0..1；默认 `CAPABILITY_THRESHOLD`。 */
  threshold: number;
  source: CapabilityItemSource;
  createdAt: number;
}

/**
 * 定稿快照（run 发起时冻结）。
 *
 * 为什么快照：清单在 run 之后仍可编辑（改名 / 删除 / 调阈值），而历史报告必须
 * 保持「当时那套框架」的语义 —— 报告只读快照，绝不回读当前清单。
 */
export type CapabilityItemSnapshot = Pick<
  CapabilityItem,
  "id" | "label" | "description" | "weight" | "threshold"
>;

/** 单任务 → 单能力项的评判要点（1–4 条，喂给模型做 rubric）。 */
export interface CapabilityTaskRubric {
  itemId: string;
  criteria: string[];
}

/** 场景任务：一个开放式真实任务，考察 1–2 个能力项。 */
export interface CapabilityTask {
  id: string;
  prompt: string;
  /** 交付要求（可选）：写清楚「答到什么程度算合格」。 */
  deliverableHint?: string;
  rubric: CapabilityTaskRubric[];
}

/** 运行状态：draft（作答中）→ collected（作答已落库，待评分）→ scored（已出报告）。 */
export type CapabilityRunStatus = "draft" | "collected" | "scored";

/** 一次评测运行。 */
export interface CapabilityRun {
  id: string;
  goalId: string;
  status: CapabilityRunStatus;
  /** 发起时的能力项快照（报告的唯一渲染依据）。 */
  items: CapabilityItemSnapshot[];
  tasks: CapabilityTask[];
  /** taskId → 作答原文。 */
  answers: Record<string, string>;
  /**
   * 阶段 1 客观摸底卷（可选）。
   *
   * ⚠️ 其卷面分**不参与**能力项判定（决策 D9-A）：客观题不瞄能力项，强行映射
   * 会造出假因果。缺省 = 范围章不足 3 章，跳过阶段 1。
   */
  paperId?: string;
  createdAt: number;
  submittedAt?: number;
}

/** 锚回**用户作答原文**的引用（opaque 给 UI，展示时按区间高亮）。 */
export interface CapabilityQuote {
  quote: string;
  start: number;
  end: number;
}

/** 逐能力项评分。 */
export interface CapabilityScore {
  itemId: string;
  /** 0..1；`undefined` = 无任务覆盖（unknown），**不参与加权**。 */
  score?: number;
  verdict: CapabilityVerdict;
  /** ≤120 字理由。 */
  rationale?: string;
  /** 引用一律锚回用户作答原文（零伪造：锚不上即丢弃该条）。 */
  evidence: CapabilityQuote[];
  /** 该分数来自哪些任务（可追溯 —— roadmap F6 的 Done 标准）。 */
  fromTaskIds: string[];
  /** 有分数但一条引用都没锚上 → true（UI 显式警示，不展示伪引用）。 */
  unanchored?: boolean;
}

/** 能力报告（append-only；不做原地更新，重评产生新报告）。 */
export interface CapabilityReport {
  id: string;
  goalId: string;
  runId: string;
  items: CapabilityScore[];
  /** 加权总分（unknown 项不进分母）；无任何有效分 → `undefined`。 */
  overall?: number;
  /** 全部 `pass` 且无 `unknown`。 */
  approved: boolean;
  /** 未被任何任务覆盖的能力项 id（报告显式标注，不进判定）。 */
  uncoveredItemIds: string[];
  /**
   * 阶段 1 客观卷参考分。
   *
   * ⚠️ **不参与**能力项判定（决策 D9-A 口径 2）：报告中独立成块展示，与能力
   * 达标度并排但不加权、不合成。缺省 = 阶段 1 未完成（跳过客观卷不阻断评测）。
   */
  objective?: { paperId: string; totalScore: number };
  createdAt: number;
}

/**
 * 服务层错误分类（**文案由 UI 走 i18n 映射**，服务层不抛中文 —— 见
 * `rules/engineering-code-style.mdc` 与 `RestatementErrorKind` 同款约定）。
 */
export type CapabilityErrorKind =
  /** 未配置 AI（提炼 / 发起前阻断）。 */
  | "no-ai"
  /** 目标没有圈定章节范围。 */
  | "no-scope"
  /** 范围章节无可用素材（标题与要点都为空）。 */
  | "no-material"
  /** 能力项不足（< minItems）。 */
  | "no-items"
  /** AI 产出不可解析。 */
  | "parse"
  /** 阻断门通过后模型失效（竞态）。 */
  | "not-configured"
  /** 调用 / 读取链路失败。 */
  | "fetch"
  | "generic";

/** 服务层统一返回（六态；文案由 UI 映射）。 */
export type CapabilityStatus = "ok" | "no-ai" | "no-scope" | "no-material" | "no-items" | "error";

/**
 * djb2 32bit → base36：确定性、低碰撞、零依赖。
 *
 * 与 `engine/flashcard-engine.ts::hashId` 同算法（各自私有）—— 分层约束下
 * `domain/` 不得反向 import `engine/`，故两侧各持一份 6 行实现，非通用工具库。
 */
function hashId(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * 能力项稳定 id = `cap_` + djb2(`goalId` + `"\u0000"` + `label`)（决策 D6-A）。
 *
 * **内容派生**，不是 `${goalId}-${index}`：index 型 id 在增删/重排能力项后会把
 * 历史报告错配到另一个能力项上（静默串味）。改写 label = 这是一项**新能力**，
 * 旧报告仍按旧快照渲染（不会崩，也不需要持久化映射表）。
 */
export function capabilityItemId(goalId: string, label: string): string {
  return `cap_${hashId(`${goalId}\u0000${label}`)}`;
}

/**
 * 运行内任务 id。
 *
 * 任务**不跨 run 复用**（每次评测重新生成），故 runId + 序号即稳定且无碰撞。
 * 序号从 1 开始，与喂给模型的 1-based 编号一致，便于排查。
 */
export function capabilityTaskId(runId: string, index: number): string {
  return `task_${runId}-${index + 1}`;
}

/** 发起评测时冻结快照（历史报告不随清单编辑漂移）。 */
export function snapshotItems(items: readonly CapabilityItem[]): CapabilityItemSnapshot[] {
  return items.map((i) => ({
    id: i.id,
    label: i.label,
    ...(i.description !== undefined ? { description: i.description } : {}),
    weight: i.weight,
    threshold: i.threshold,
  }));
}
