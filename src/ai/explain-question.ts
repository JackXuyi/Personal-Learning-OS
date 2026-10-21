/**
 * 客观题即时解释的 AI 管线（explain-question）—— 提示词 + 解析 + 执行器。
 *
 * 设计（docs/ai-immediate-explain-design-2026-10.md §8.2）：
 * - 范式照抄 `ai/chapter-qa.ts`：**只产出 `quotes: string[]`，不产出任何偏移量**。
 *   偏移一律由 service 层用 `locateQuote` 反查（「不信 AI 的偏移量」是既有护栏）。
 * - **宽容取值 + 严判 found**：缺字段 / 字符串 `"true"` 一律按「没找到」——
 *   宁可说「原文里没依据」，也不许用模型自身知识补一段解释。
 *
 * 🔴 设计红线（决策 D3）：**绝不要把正确答案 / 正确项索引送进 prompt**。
 *   一旦模型知道答案，小模型会顺着答案倒编理由（把自己没依据的推理写得像
 *   原文支持），直接摧毁「有源 Grounded」。本管线只回答「原文里是怎么讲的
 *   这件事」，正确答案由 UI 侧用本地 `q.answer` 单独渲染（UC-02）。
 *   附带红利：讲解与用户选了什么无关 ⇒ 改答案不必重算，省一次调用。
 *
 * 依赖方向：只 import `./pipeline-core` / `./types` 与检索类型，
 * **不 import `features/**`**（分层红线 `rules/layer-import-boundaries.mdc`）。
 */
import type { AIProvider, ChatMessage } from "./types";
import { chatJson, isRecord, PIPELINE_LIMITS, str, TEMPERATURE } from "./pipeline-core";
import type { ContextBlock } from "./retrieval/chapter-context";

export const EXPLAIN_SYSTEM = [
  "你是用户学习资料的讲解助手。你唯一的依据是下面给出的【原文片段】。",
  "",
  "硬性规则：",
  "1. 严禁使用片段之外的任何知识、常识、经验或推测。",
  "2. 你不知道这道题的正确答案，也不需要给出「选哪个」——你的任务是讲清原文怎么说。",
  "3. explanation 控制在 2–4 句，讲清楚「相关概念在原文中的关系」，不要复述题目。",
  "4. quotes 必须是【原文片段】中**逐字复制**的原文，不得改写、不得把相隔很远的两句拼在一起。",
  "5. 片段不足以讲清 → 返回 found=false，reason 说明「资料中未讲述这一点」。",
  "",
  '只输出 JSON：{"found":true,"explanation":"…","quotes":["…"]}',
  '或 {"found":false,"reason":"…"}。不要输出任何其他文字。',
].join("\n");

export interface ExplainQuestionInput {
  question: string;
  /** choice 的选项原文（**按原序传入，不含任何正确项标记**）。 */
  options?: readonly string[];
  chapterTitle: string;
  documentTitle: string;
  blocks: readonly ContextBlock[];
  /** 讲解深度（决策 D2）：hint = 只给思路不给结论；answer = 允许给出结论句。 */
  depth: "hint" | "answer";
}

/** 模型原始产出（**不含偏移量** —— 偏移一律由 service 层用 locateQuote 算出）。 */
export interface ExplainQuestionDraft {
  found: boolean;
  explanation: string;
  /** verbatim 引文；必须能在原文逐字找到，否则会被 service 层丢弃。 */
  quotes: string[];
  /** found=false 时的说明。 */
  reason?: string;
}

export function buildExplainMessages(input: ExplainQuestionInput): ChatMessage[] {
  // 与 chapter-qa 同口径：只标章标题，片段序号不是章序号。
  const ctx = input.blocks
    .map((b) => `【片段 ${b.index}】来源：「${b.chapterTitle}」\n${b.text}`)
    .join("\n\n");
  /**
   * ⚠️ 安全关键：options **原序、无标记**。
   * 任何「正确答案：B」「正确项」字样，或把正确项排到特殊位置，都是安全事故 ——
   * 见文件头的 D3 红线。单测 `tests/quiz-explain.test.ts` 对此有断言。
   */
  const optionsBlock =
    input.options && input.options.length > 0
      ? [
          "",
          "【本题选项】（仅作语境参考，**不含正确项信息**）",
          ...input.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`),
        ].join("\n")
      : "";
  const depthLine =
    input.depth === "hint"
      ? "本次请给「思路」：指出该看原文里的什么、概念之间是什么关系，**不要**直接给出结论句。"
      : "本次可以给出明确的结论句，但仍必须有原文依据。";

  return [
    { role: "system", content: EXPLAIN_SYSTEM },
    {
      role: "user",
      content: [
        `资料：《${input.documentTitle}》 · 当前章：《${input.chapterTitle}》`,
        "",
        "【原文片段】",
        ctx,
        optionsBlock,
        "",
        `【用户正在作答的题目】${input.question}`,
        depthLine,
      ].join("\n"),
    },
  ];
}

/**
 * 解析模型产出（策略与 `parseChapterQaAnswer` 完全一致：宽容取值 + 严判 found）。
 *
 * 严判三条件：`found` 显式为布尔 true **且** explanation 非空 **且** quotes 非空。
 * 少了引文的解释对「有源」没有意义 —— 那正是 D3 要防的东西。
 */
export function parseExplainAnswer(raw: unknown): ExplainQuestionDraft {
  if (!isRecord(raw)) return { found: false, explanation: "", quotes: [] };

  const explanation = (str(raw.explanation) ?? "").trim();
  const seen = new Set<string>();
  const quotes: string[] = [];
  for (const item of Array.isArray(raw.quotes) ? raw.quotes : []) {
    const q = (str(item) ?? "").trim();
    if (!q || seen.has(q)) continue;
    seen.add(q);
    quotes.push(q.slice(0, PIPELINE_LIMITS.explainQuoteMaxChars));
    if (quotes.length >= PIPELINE_LIMITS.explainMaxQuotes) break;
  }

  const reason = (str(raw.reason) ?? "").trim() || undefined;
  const found = raw.found === true && explanation.length > 0 && quotes.length > 0;
  if (!found) {
    return { found: false, explanation: "", quotes: [], ...(reason ? { reason } : {}) };
  }
  return { found: true, explanation, quotes, ...(reason ? { reason } : {}) };
}

/**
 * 执行一次客观题解释调用。
 *
 * `TEMPERATURE.explain`（0.1）与 `grade` 同档：事实讲解，温度一高小模型就开始
 * 补自己的推理。
 */
export async function explainQuestion(
  provider: AIProvider,
  input: ExplainQuestionInput,
): Promise<ExplainQuestionDraft> {
  const raw = await chatJson(provider, buildExplainMessages(input), TEMPERATURE.explain);
  return parseExplainAnswer(raw);
}
