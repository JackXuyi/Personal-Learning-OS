/**
 * 目标级能力评测（F6）的 AI 管线 —— 提炼能力项 / 出场景任务 / 逐项判分。
 *
 * 设计（docs/goal-capability-assessment-design-2026-09.md §8.6）：
 * - **只产出文字与 `quotes`，绝不产出偏移量**。偏移一律由 service 层用
 *   `locateQuote` 在**用户作答原文**里反查（沿用 `evidence-anchor` 的
 *   「不信 AI 的偏移量」护栏）。好处：本模块零 IO 纯逻辑可直跑单测。
 * - **模型用 1-based 序号引用能力项**（`itemIndex` / `itemIndexes`），不引用
 *   能力项名字作标识：名字会被模型改写/缩写，序号是唯一稳定的对应关系；
 *   解析时把序号映射回 `CapabilityItem.id`，越界序号 → 丢弃该引用。
 * - **宽容取值 + 严判**：缺字段 / 空串一律丢该条，`!isRecord` → 全空草稿，
 *   **绝不抛解析错**（由 service 判 `parse` 失败），与 `parseRestatementDraft` 同款。
 *
 * 依赖方向：只 import `./pipeline-core`、`./types`、`./learner-context` 与
 * `domain` 的类型，**不 import `pipelines.ts` / `features/`** —— 无环、无 TDZ。
 */
import type { CapabilityItemSnapshot, GoalType, LearnerProfile } from "../domain";
import type { AIProvider, ChatMessage } from "./types";
import { chatJson, isRecord, PIPELINE_LIMITS, str, TEMPERATURE } from "./pipeline-core";
import { buildLearnerContextBlock } from "./learner-context";

/* ------------------------------------------------------------------ */
/* 提示词                                                              */
/* ------------------------------------------------------------------ */

/** 目标类型 → 提示词用中文标签（枚举原值对模型信号更弱，同 `learner-context` 口径）。 */
export const GOAL_TYPE_LABEL: Record<GoalType, string> = {
  career: "职业发展",
  study: "学业深造",
  exam: "考试备考",
  personal: "个人成长",
  research: "研究",
  project: "项目交付",
};

export const CAPABILITY_ITEMS_SYSTEM = [
  "你是资深岗位能力评估专家。根据给定的学习目标与资料要点，提炼 3–6 项**可被任务验证**的能力项。",
  "硬性规则：",
  "A. 只依据给定材料推断，不得臆造材料未涉及的领域能力；",
  "B. 能力项必须是「能做某事」的行为描述，不写「了解 / 熟悉」这类不可验证的措辞；",
  "C. 能力项之间不得语义重叠；宁可少给，不要凑数。",
  "",
  '只输出 JSON：{"items":[{"label":"…（≤30 字）","description":"…（≤60 字，验收线索）"}]}。',
  "不要输出其他文字。",
].join("\n");

export const CAPABILITY_TASKS_SYSTEM = [
  "你是资深技术面试官。下面给出目标与能力项（**编号**）。",
  "请设计 2–5 个**开放式真实任务**，每个任务考察 1–2 个能力项，作为该能力项的判定依据。",
  "硬性规则：",
  "A. 任务必须能在纯文字作答中完成（不要求运行代码、不要求外部工具）；",
  "B. 任务要贴近真实工作情境，给出具体约束与冲突（有取舍空间），不要出成简答题；",
  "C. 每个任务给出交付要求，以及与所考察能力项对应的评判要点（criteria，1–4 条）；",
  "D. 能力项用**编号**引用（从 1 开始），不得输出能力项名字作为标识。",
  "",
  '只输出 JSON：{"tasks":[{"prompt":"…","deliverableHint":"…","itemIndexes":[1,2],"criteria":["…"]}]}。',
  "不要输出其他文字。",
].join("\n");

export const CAPABILITY_SCORE_SYSTEM = [
  "你是严格的岗位能力评审。依据每个任务的评判要点，对用户提交的作答**逐能力项**打分。",
  "硬性规则：",
  "A. 只依据用户作答与给定材料判断，不得补充作答中不存在的信息；",
  "B. `score` 为 0–1 的连续分，严格按评判要点的覆盖程度给分，不给人情分；",
  "C. `quotes` 必须**逐字复制用户作答原文**（≤200 字），不得改写、不得拼接相隔很远的句子；",
  "D. 一条都引用不出来时，`quotes` 返回空数组（宁可不给，也不要编造引文）；",
  "E. `rationale` ≤120 字，说明得分理由，不要复述题面。",
  "",
  '只输出 JSON：{"scores":[{"itemIndex":1,"score":0.7,"rationale":"…","quotes":["…"]}]}。',
  "不要输出其他文字。",
].join("\n");

/* ------------------------------------------------------------------ */
/* 输入 / 产出类型                                                     */
/* ------------------------------------------------------------------ */

/** 素材：范围章（标题 + 要点）；正文不注入（要点已足够刻画能力面，且省上下文）。 */
export interface CapabilityMaterial {
  chapterTitle: string;
  keyPoints: readonly string[];
}

/** 能力项在提示词中的编号视图（1-based；**必须携带真实 id**，见 `CapabilityIdRefs`）。 */
export interface IndexedCapabilityItem {
  /** 真实能力项 id（`domain/capability.ts::capabilityItemId` 产出）。 */
  id: string;
  index: number;
  label: string;
  description?: string;
}

/**
 * 解析函数只关心「序号 → id」一件事，故只要求「有序 + 带 id」。
 *
 * 为什么不让 parse 直接收 `IndexedCapabilityItem[]`：真实调用方（service）手上
 * 是 `CapabilityItemSnapshot[]`，而提示词的编号视图是它的派生 —— 两者结构兼容，
 * 用一个最小的结构类型即可，避免为「取个 id」而做无意义的形状转换。
 */
export type CapabilityIdRefs = readonly { id: string }[];

export interface CapabilityItemsInput {
  goalTitle: string;
  goalType: GoalType;
  goalDescription?: string;
  material: readonly CapabilityMaterial[];
  /** F1 学习者画像：注入背景块（缺省 = 不注入，与改动前逐字节相同）。 */
  learner?: LearnerProfile;
}

export interface CapabilityTasksInput {
  goalTitle: string;
  items: readonly IndexedCapabilityItem[];
  material: readonly CapabilityMaterial[];
  learner?: LearnerProfile;
}

export interface CapabilityScoreInput {
  goalTitle: string;
  items: readonly IndexedCapabilityItem[];
  /** 本次要判分的任务（含用户作答原文）；**一次调用只判一个任务**（见 service）。 */
  tasks: readonly {
    index: number;
    prompt: string;
    criteria: readonly string[];
    answer: string;
  }[];
  learner?: LearnerProfile;
}

/** 能力项提炼产出。 */
export interface CapabilityItemsDraft {
  items: { label: string; description?: string }[];
}

/** 场景任务产出（`itemIds` 已由序号映射回真实能力项 id）。 */
export interface CapabilityTasksDraft {
  tasks: {
    prompt: string;
    deliverableHint?: string;
    itemIds: string[];
    criteria: string[];
  }[];
}

/** 判分产出（`itemId` 已由序号映射回真实能力项 id；`quotes` 仍待 service 锚定）。 */
export interface CapabilityScoreDraft {
  scores: { itemId: string; score: number; rationale?: string; quotes: string[] }[];
}

/* ------------------------------------------------------------------ */
/* 共享组装件                                                          */
/* ------------------------------------------------------------------ */

/** 能力项清单 → 提示词编号视图（1-based，与提示词里的编号一致）。 */
export function toIndexedItems(
  items: readonly CapabilityItemSnapshot[],
): IndexedCapabilityItem[] {
  return items.map((item, i) => ({
    id: item.id,
    index: i + 1,
    label: item.label,
    ...(item.description !== undefined ? { description: item.description } : {}),
  }));
}

/** 组装「目标 + 范围素材 + 学习者背景」公共块。 */
function buildCommonBlock(input: {
  goalTitle: string;
  goalType?: GoalType;
  goalDescription?: string;
  material: readonly CapabilityMaterial[];
  learner?: LearnerProfile;
}): string {
  const materialLines: string[] = [];
  let used = 0;
  for (const chapter of input.material) {
    const block = [
      `## ${chapter.chapterTitle}`,
      ...chapter.keyPoints.map((k) => `- ${k}`),
    ].join("\n");
    if (used + block.length > PIPELINE_LIMITS.capabilityMaterialChars) break;
    used += block.length;
    materialLines.push(block);
  }
  const learnerBlock = buildLearnerContextBlock(input.learner);
  return [
    `学习目标：《${input.goalTitle}》${
      input.goalType ? `（类型：${GOAL_TYPE_LABEL[input.goalType]}）` : ""
    }`,
    ...(input.goalDescription ? [`目标说明：${input.goalDescription}`] : []),
    "",
    "【范围章节要点】",
    materialLines.join("\n\n") || "（无）",
    ...(learnerBlock ? ["", learnerBlock] : []),
  ].join("\n");
}

/** 编号视图 → 文本行（`1. label —— description`）。 */
function renderItems(items: readonly IndexedCapabilityItem[]): string {
  return items.length === 0
    ? "（无）"
    : items
        .map((i) => `${i.index}. ${i.label}${i.description ? ` —— ${i.description}` : ""}`)
        .join("\n");
}

/* ------------------------------------------------------------------ */
/* ① 提炼能力项                                                        */
/* ------------------------------------------------------------------ */

export function buildCapabilityItemsMessages(input: CapabilityItemsInput): ChatMessage[] {
  return [
    { role: "system", content: CAPABILITY_ITEMS_SYSTEM },
    {
      role: "user",
      content: [
        buildCommonBlock({
          goalTitle: input.goalTitle,
          goalType: input.goalType,
          goalDescription: input.goalDescription,
          material: input.material,
          learner: input.learner,
        }),
        "",
        `请提炼 3–${PIPELINE_LIMITS.capabilityItemMax} 项能力项（宁少勿凑）。`,
      ].join("\n"),
    },
  ];
}

/**
 * 解析能力项产出。
 *
 * 宽容 + 三条硬判：
 * - `label` 非空才留（`description` 可缺）；
 * - `label` 截断 `capabilityItemLabelChars`、`description` 截断 `capabilityItemDescChars`；
 * - **label 去重**（模型爱给近义重复项）+ 总条数截断 `capabilityItemMax`。
 */
export function parseCapabilityItemsDraft(raw: unknown): CapabilityItemsDraft {
  if (!isRecord(raw)) return { items: [] };
  const arr = Array.isArray(raw.items) ? raw.items : [];
  const out: { label: string; description?: string }[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (out.length >= PIPELINE_LIMITS.capabilityItemMax) break;
    if (!isRecord(item)) continue;
    const label = (str(item.label) ?? "").trim().slice(0, PIPELINE_LIMITS.capabilityItemLabelChars);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const description = (str(item.description) ?? "")
      .trim()
      .slice(0, PIPELINE_LIMITS.capabilityItemDescChars);
    out.push({ label, ...(description ? { description } : {}) });
  }
  return { items: out };
}

export async function extractCapabilityItems(
  provider: AIProvider,
  input: CapabilityItemsInput,
): Promise<CapabilityItemsDraft> {
  const raw = await chatJson(provider, buildCapabilityItemsMessages(input), TEMPERATURE.grade);
  return parseCapabilityItemsDraft(raw);
}

/* ------------------------------------------------------------------ */
/* ② 生成场景任务                                                      */
/* ------------------------------------------------------------------ */

export function buildCapabilityTasksMessages(input: CapabilityTasksInput): ChatMessage[] {
  return [
    { role: "system", content: CAPABILITY_TASKS_SYSTEM },
    {
      role: "user",
      content: [
        buildCommonBlock({
          goalTitle: input.goalTitle,
          material: input.material,
          learner: input.learner,
        }),
        "",
        "【能力项（用编号引用）】",
        renderItems(input.items),
        "",
        `请设计 2–${PIPELINE_LIMITS.capabilityTaskMax} 个任务。`,
      ].join("\n"),
    },
  ];
}

/**
 * 解析场景任务产出。
 *
 * 序号 → id 映射失败（越界 / 非数字）即丢弃该引用；**引用全空的整条任务丢弃**
 * （没挂到能力项的任务对其判定无贡献，留着只会在作答页浪费用户时间）；
 * `criteria` 全空的同样丢弃（没有 rubric 就无法判分，保留会产出伪证据）。
 */
export function parseCapabilityTasksDraft(
  raw: unknown,
  items: CapabilityIdRefs,
): CapabilityTasksDraft {
  if (!isRecord(raw)) return { tasks: [] };
  const arr = Array.isArray(raw.tasks) ? raw.tasks : [];
  const { capabilityTaskMax, capabilityTaskPromptChars } = PIPELINE_LIMITS;
  const out: CapabilityTasksDraft["tasks"] = [];
  const seenPrompts = new Set<string>();

  for (const item of arr) {
    if (out.length >= capabilityTaskMax) break;
    if (!isRecord(item)) continue;
    const prompt = (str(item.prompt) ?? "").trim().slice(0, capabilityTaskPromptChars);
    if (!prompt || seenPrompts.has(prompt)) continue;

    const rawIndexes = Array.isArray(item.itemIndexes) ? item.itemIndexes : [];
    const itemIds: string[] = [];
    for (const v of rawIndexes) {
      const idx = typeof v === "number" ? Math.trunc(v) : Number.NaN;
      const target = items[idx - 1]; // 1-based → 0-based
      if (!target || itemIds.includes(target.id)) continue;
      itemIds.push(target.id);
    }
    if (itemIds.length === 0) continue;

    const rawCriteria = Array.isArray(item.criteria) ? item.criteria : [];
    const criteria: string[] = [];
    for (const c of rawCriteria) {
      if (criteria.length >= PIPELINE_LIMITS.capabilityTaskCriteriaMax) break;
      const text = (str(c) ?? "").trim().slice(0, PIPELINE_LIMITS.capabilityTaskCriteriaChars);
      if (text) criteria.push(text);
    }
    if (criteria.length === 0) continue;

    const deliverableHint = (str(item.deliverableHint) ?? "")
      .trim()
      .slice(0, PIPELINE_LIMITS.capabilityTaskHintChars);
    seenPrompts.add(prompt);
    out.push({
      prompt,
      ...(deliverableHint ? { deliverableHint } : {}),
      itemIds,
      criteria,
    });
  }
  return { tasks: out };
}

export async function generateCapabilityTasks(
  provider: AIProvider,
  input: CapabilityTasksInput,
): Promise<CapabilityTasksDraft> {
  const raw = await chatJson(provider, buildCapabilityTasksMessages(input), TEMPERATURE.grade);
  // 关键：把 `items` 原样交给 parse —— 它与提示词里的编号**同序**，
  // 故「序号 → 真实 id」的映射在 build 与 parse 两侧必然一致。
  return parseCapabilityTasksDraft(raw, input.items);
}

/* ------------------------------------------------------------------ */
/* ③ 逐项判分                                                          */
/* ------------------------------------------------------------------ */

export function buildCapabilityScoreMessages(input: CapabilityScoreInput): ChatMessage[] {
  const tasks = input.tasks.map((t) =>
    [
      `### 任务 ${t.index}`,
      `题面：${t.prompt}`,
      "评判要点：",
      ...t.criteria.map((c) => `- ${c}`),
      "",
      "用户作答：",
      t.answer.slice(0, PIPELINE_LIMITS.capabilityAnswerChars),
    ].join("\n"),
  );
  const learnerBlock = buildLearnerContextBlock(input.learner);
  return [
    { role: "system", content: CAPABILITY_SCORE_SYSTEM },
    {
      role: "user",
      content: [
        `学习目标：《${input.goalTitle}》`,
        "",
        "【能力项（用编号引用）】",
        renderItems(input.items),
        "",
        ...tasks,
        ...(learnerBlock ? ["", learnerBlock] : []),
      ].join("\n"),
    },
  ];
}

/**
 * 解析判分产出。
 *
 * - 序号 → id 失败 / `score` 非有限数 → 丢该条；
 * - `score` clamp 到 [0,1]（模型越界时的最后一道防线）；
 * - `quotes` 逐条 trim + 截断 `capabilityQuoteMaxChars` + 去重 + 丢弃空串 ——
 *   **空数组是合法产出**（规则 D：「一条都引用不出来时返回空数组」），
 *   service 会据此标 `unanchored`，而不是在这里编一条引文出来；
 * - 同一能力项重复出现时取**首次**（避免模型自我加权重）。
 */
export function parseCapabilityScoreDraft(
  raw: unknown,
  items: CapabilityIdRefs,
): CapabilityScoreDraft {
  if (!isRecord(raw)) return { scores: [] };
  const arr = Array.isArray(raw.scores) ? raw.scores : [];
  const { capabilityRationaleChars, capabilityQuoteMaxChars } = PIPELINE_LIMITS;
  const out: CapabilityScoreDraft["scores"] = [];
  const seen = new Set<string>();

  for (const item of arr) {
    if (!isRecord(item)) continue;
    const idx = typeof item.itemIndex === "number" ? Math.trunc(item.itemIndex) : Number.NaN;
    const target = items[idx - 1]; // 1-based → 0-based
    if (!target || seen.has(target.id)) continue;
    const score = typeof item.score === "number" && Number.isFinite(item.score) ? item.score : undefined;
    if (score === undefined) continue;

    const quotes: string[] = [];
    const rawQuotes = Array.isArray(item.quotes) ? item.quotes : [];
    for (const q of rawQuotes) {
      const text = (str(q) ?? "").trim().slice(0, capabilityQuoteMaxChars);
      if (text && !quotes.includes(text)) quotes.push(text);
    }
    const rationale = (str(item.rationale) ?? "").trim().slice(0, capabilityRationaleChars);

    seen.add(target.id);
    out.push({
      itemId: target.id,
      score: Math.min(1, Math.max(0, score)),
      ...(rationale ? { rationale } : {}),
      quotes,
    });
  }
  return { scores: out };
}

export async function scoreCapabilityWithAi(
  provider: AIProvider,
  input: CapabilityScoreInput,
): Promise<CapabilityScoreDraft> {
  const raw = await chatJson(provider, buildCapabilityScoreMessages(input), TEMPERATURE.grade);
  return parseCapabilityScoreDraft(raw, input.items);
}
