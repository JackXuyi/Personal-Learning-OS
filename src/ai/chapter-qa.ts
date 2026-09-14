/**
 * 章内提问的 AI 管线（chapter-qa）—— 提示词 + 解析 + 执行器。
 *
 * 设计（docs/learn-chapter-qa-design-2026-09.md §8.4）：
 * - **只产出 `quotes: string[]`，不产出任何偏移量**。偏移一律由 service 层用
 *   `locateQuote` 反查（「不信 AI 的偏移量」是既有护栏，见 evidence-anchor）。
 *   好处：本模块可零 IO 纯逻辑单测，`quotes` 就是可断言的原始事实。
 * - **宽容取值 + 严判 found**：`found` 必须显式为 `true` 才算找到；缺字段 /
 *   字符串 "true" 一律视为 `false`（宁可说「资料里没有」，也不许用模型自身
 *   知识补答）。
 *
 * 依赖方向：只 import `./pipeline-core` 与 `./types`，**不 import `pipelines.ts`**
 * —— 无环、无 TDZ 风险。锚定（`features/` 层）不在此处。
 */
import type { AIProvider, ChatMessage } from "./types";
import { chatJson, isRecord, PIPELINE_LIMITS, str, TEMPERATURE } from "./pipeline-core";
import type { ContextBlock } from "./retrieval/chapter-context";

export const CHAPTER_QA_SYSTEM = [
  "你是用户学习资料的问答助手。你唯一的依据是下面给出的【原文片段】。",
  "",
  "硬性规则：",
  "1. 严禁使用片段之外的任何知识、常识、经验或推测；不得补充片段未出现的信息。",
  "2. 回答尽量简短（2–3 句），可在句末用 [1] [2] 标注依据来自哪个片段。",
  "3. quotes 必须是【原文片段】中**逐字复制**的原文，不得改写、不得润色、",
  "   不得把相隔很远的两句拼在一起、不得省略中间内容。每条 ≤200 字。",
  "4. 如果片段不足以回答，必须返回 found=false，reason 说明「资料中未提及」。",
  "   宁可不答，也不许用你自己的知识补答。",
  "",
  '只输出 JSON：{"found":true,"answer":"…","quotes":["…"]}',
  '或 {"found":false,"reason":"…"}。不要输出任何其他文字。',
].join("\n");

export interface ChapterQaInput {
  chapterTitle: string;
  documentTitle: string;
  question: string;
  blocks: readonly ContextBlock[];
}

/** 模型原始产出（**不含偏移量** —— 偏移一律由 service 层用 locateQuote 算出）。 */
export interface ChapterQaDraft {
  found: boolean;
  answer: string;
  /** verbatim 引文；必须能在原文逐字找到，否则会被 service 层丢弃。 */
  quotes: string[];
  /** found=false 时的说明（如「本资料未提及」）。 */
  reason?: string;
}

export function buildChapterQaMessages(input: ChapterQaInput): ChatMessage[] {
  // 来源只标章标题：片段序号 **不是** 章序号，写「第 n 章」会把两者混为一谈
  // （方案 §8.4 的字面写法在此修正，属实现偏差，见 runbook）。
  const ctx = input.blocks
    .map((b) => `【片段 ${b.index}】来源：「${b.chapterTitle}」\n${b.text}`)
    .join("\n\n");
  return [
    { role: "system", content: CHAPTER_QA_SYSTEM },
    {
      role: "user",
      content: [
        `资料：《${input.documentTitle}》 · 当前章：《${input.chapterTitle}》`,
        "",
        "【原文片段】",
        ctx,
        "",
        `【用户问题】${input.question}`,
      ].join("\n"),
    },
  ];
}

/**
 * 解析模型产出。
 *
 * 策略与既有管线一致：**宽容取值 + 严判 found**。
 * - `found` 必须显式为布尔 `true`（缺字段 / `"true"` 字符串 → `false`）；
 * - `quotes` 逐条 `str()` 过滤 → `trim` → 去空 → 去重 → 单条截断 → 条数上限；
 * - `answer` 为空串、或 `quotes` 为空数组 → 视为 `found=false`（没有回答就没有答案）。
 */
export function parseChapterQaAnswer(raw: unknown): ChapterQaDraft {
  if (!isRecord(raw)) return { found: false, answer: "", quotes: [] };

  const answer = (str(raw.answer) ?? "").trim();
  const rawQuotes = Array.isArray(raw.quotes) ? raw.quotes : [];
  const seen = new Set<string>();
  const quotes: string[] = [];
  for (const item of rawQuotes) {
    const q = (str(item) ?? "").trim();
    if (!q || seen.has(q)) continue;
    seen.add(q);
    quotes.push(q.slice(0, PIPELINE_LIMITS.chapterQaQuoteMaxChars));
    if (quotes.length >= PIPELINE_LIMITS.chapterQaMaxQuotes) break;
  }

  const reason = (str(raw.reason) ?? "").trim() || undefined;
  // 严判：found 必须显式为 true，且确有回答与引文 —— 否则一律按「没找到」。
  const found = raw.found === true && answer.length > 0 && quotes.length > 0;
  if (!found) {
    return { found: false, answer: "", quotes: [], ...(reason ? { reason } : {}) };
  }
  return { found: true, answer, quotes, ...(reason ? { reason } : {}) };
}

/**
 * 执行一次章内问答调用。
 *
 * `TEMPERATURE.grade`（0.1）复用既有最低温度档：事实判定类任务，与
 * `gradeSubjectiveWithAi` 同口径。
 */
export async function answerChapterQuestion(
  provider: AIProvider,
  input: ChapterQaInput,
): Promise<ChapterQaDraft> {
  const raw = await chatJson(provider, buildChapterQaMessages(input), TEMPERATURE.grade);
  return parseChapterQaAnswer(raw);
}
