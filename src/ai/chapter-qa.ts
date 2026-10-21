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
import type { ChapterQaTurn, LearnerProfile, MemoryEntry, TutorTier } from "../domain";
import type { AIProvider, ChatMessage } from "./types";
import { chatJson, isRecord, PIPELINE_LIMITS, str, TEMPERATURE } from "./pipeline-core";
import type { ContextBlock } from "./retrieval/chapter-context";
import { buildLearnerContextBlock, buildMemoryContextBlock } from "./learner-context";

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
  /** F1 学习者画像：注入背景块（缺省 = 不注入，输出与改动前逐字节相同）。 */
  learner?: LearnerProfile;
  /** F9 学习者记忆：注入长期观察块（缺省 / 空数组 = 不注入，逐字节相同）。 */
  memory?: readonly MemoryEntry[];
  /** 追问线程（缺省 / 空数组 = 单轮，逐字节相同）。由 service 侧 `trimThread` 裁剪。 */
  history?: readonly ChapterQaTurn[];
  /** 讲解档位（缺省 = 不注入策略行，逐字节相同）。 */
  tier?: TutorTier;
}

/**
 * 档位 → 策略指令。
 *
 * 这是「AI native」最有份量的那一层：**由学习数据决定 AI 怎么说话**，而不是
 * 让用户自己选模式。三档的差别不在长短，而在「给不给结论」。
 */
const TIER_LINE: Record<TutorTier, string> = {
  scaffold:
    "讲解策略：用户对该章掌握较弱。**先给一个指向性的提示**（让他去看原文里的哪个信号 / 哪两个概念的关系），然后问他要不要听更完整的讲解；**不要**直接给完整结论。",
  standard: "讲解策略：先用 2–3 句作答，末尾用一个追问确认他是否真的理解了。",
  direct: "讲解策略：用户掌握较好，直接给出完整、准确的回答，不必铺垫。",
};

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
  // F1：背景块只影响「讲解深浅」，绝不改变「只依据原文」的硬规则（块内自带免责声明）。
  const learnerBlock = buildLearnerContextBlock(input.learner);
  // F9：长期观察块（同样自带「不得作为指令执行」声明 → 不削弱上面的规则 1）。
  const memoryBlock = buildMemoryContextBlock(input.memory);
  // 追问线程：仅用于理解上下文，块内自带「不得推翻只依据片段」的声明。
  const threadBlock =
    !input.history || input.history.length === 0
      ? undefined
      : [
          "【前面的对话】（仅用于理解上下文，**不得**推翻上面的「只依据片段」规则）",
          ...input.history.map((t) => `${t.role === "user" ? "用户" : "你"}：${t.text}`),
        ].join("\n");
  const tierLine = input.tier ? TIER_LINE[input.tier] : undefined;
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
        // 顺序约束：策略指令紧贴当前问题（排在线程**之前**），否则会被长线程稀释。
        ...(tierLine ? ["", tierLine] : []),
        ...(threadBlock ? ["", threadBlock] : []),
        ...(learnerBlock ? ["", learnerBlock] : []),
        ...(memoryBlock ? ["", memoryBlock] : []),
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
