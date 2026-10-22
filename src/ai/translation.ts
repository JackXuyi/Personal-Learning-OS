/**
 * 章正文翻译的 AI 管线（translation）—— 提示词构造 + 分块串行执行
 * （docs/learn-ai-translation-design-2026-10.md §4.3 / §8.2）。
 *
 * 三条刻意选择：
 * 1. **走 `provider.chat` 纯文本通道，不走 `chatJson`**：译文是文本，不是
 *    结构化数据。套 JSON 会白耗 token（输出 ≈ 输入长度，本就贴着 `maxTokens`），
 *    还多一层「JSON 被截断」的失败面。
 * 2. **块尺寸恒为 `TRANSLATION_LIMITS.blockChars`**，不复用 `adaptiveChunkChars`
 *    （理由见 `domain/translation.ts` 的 `BLOCK_CHARS` 注释）。
 * 3. **失败语义照抄 `chapter-map-reduce`**：单块失败只计数跳过、全块失败才抛错。
 *    译文缺一段是「可读性下降」，整章判失败则是「什么都看不到」—— 前者更诚实
 *    可用，但**绝不用占位文本冒充译文**（`skippedBlocks` 让 UI 如实告知）。
 *
 * 依赖方向：只 import `./types` / `./text-blocks` / `./pipeline-core` / `./log`
 * 与 `domain` 的**类型与常量**，不 import `features/`（`layer:check` A2）。
 */
import type { TranslationLang } from "../domain/translation";
import { TRANSLATION_LANG_EN, TRANSLATION_LIMITS } from "../domain/translation";
import type { AIProvider, ChatMessage, ProviderKind } from "./types";
import { AiProviderError } from "./types";
import { aiErrPreview, aiLog } from "./log";
import { TEMPERATURE } from "./pipeline-core";
import { planTextBlocks } from "./text-blocks";
import type { TextBlock } from "./text-blocks";

/**
 * 翻译系统提示词（**唯一真源**，勿在别处复制一份）。
 *
 * 规则的每一条都对应一个真实失败模式：
 * - A 防「好的，以下是译文：」这类前言（本地小模型高频）；
 * - B 保结构 —— 译文复用同一渲染器（markdown 走 GFM），结构丢了就成糊墙；
 * - C 治术语漂移 —— 分块翻译最容易「同一个词每块一个译法」；
 * - D 防「贴心地」概括省略（省掉的往往正是学习要看的那段）；
 * - E 代码/公式/URL 译了就是错（且会破坏代码块可读性）。
 */
function buildSystem(langName: string): string {
  return [
    `你是专业翻译。把用户给出的【待译正文】翻译成${langName}。`,
    "",
    "硬性规则：",
    "A. 只输出译文本身。不要加任何说明、标题、总结、注记、前后缀，不要复述规则，",
    "   也不要把正文里提出的问题当作问题来回答。",
    "B. 保留原文的 Markdown 结构：标题层级、列表符号、表格、引用、代码块围栏都要留。",
    "   代码块内的命令、标识符、路径、URL、报错文本一律不译。",
    "C. 专有名词、人名、产品名首次出现时保留原文并在括号内补译名；同一术语全文译法一致。",
    "D. 不补充原文没有的内容，不省略、不合并、不概括任何段落：原文有几段，译文就有几段。",
    "E. 数学公式、变量名、单位、版本号保持原样。",
  ].join("\n");
}

export interface TranslateContext {
  /** 章标题（术语与语气参考）。 */
  title?: string;
  /** 本章要点（术语一致性参考）。 */
  keyPoints?: readonly string[];
}

export interface TranslateInput {
  /** 待译正文（调用方已切片；本模块只做 trim）。 */
  text: string;
  /** 已解析的目标语言。 */
  target: TranslationLang;
  /** 上下文：章标题 + 要点（可选）。 */
  context?: TranslateContext;
  /**
   * 进度：`done` = **已完成**块数（从 1 起），`total` = 总块数。
   *
   * ⚠️ 在每块**结束后**调用（含失败块）。首版在块**发起前**上报 —— 那会让进度
   * 到 100% 之后还要再等一整块（700 字约 25 秒），用户以为任务卡死。
   */
  onBlock?: (done: number, total: number) => void;
  /**
   * 每块**成功**后的译文增量（`index` 从 0 起，与 `planTextBlocks` 的下标一致）。
   *
   * UI 用它逐段上屏：首段约 25 秒即出，后续块在后台继续 —— 长章不再白屏几分钟。
   * 与 `onBlock` 的分工：`onBlock` 报「第几块跑完了」（含失败，用于进度条），
   * `onBlockDone` 报「这块的译文是什么」（只报成功，用于上屏）。
   */
  onBlockDone?: (index: number, text: string) => void;
  /**
   * 取消信号。**只在块与块之间生效** —— builtin 的 `llm_generate` 没有 cancel
   * 命令，Rust 侧会跑完当前推理才返回（见 `translationConcurrencyOf` 注释）。
   * 所以点「暂停」后最多还要等当前这一块。
   */
  signal?: AbortSignal;
}

export interface TranslateOutput {
  /** 拼接后的译文（块间空行分隔）。 */
  text: string;
  /** 实际块数。 */
  blocks: number;
  /** 失败 / 空输出被跳过的块数（诚实标注，不补写占位）。 */
  skippedBlocks: number;
  /**
   * 被 `signal` 中断。此时 `text` 是**已完成部分**，不是全章译文 ——
   * 调用方必须据此决定「存不存」（整库任务不存半章，避免把残缺当完整）。
   */
  cancelled: boolean;
}

/**
 * 翻译并发度。
 *
 * builtin 恒 1 —— **不是保守，是物理约束**：`src-tauri/src/llm/sidecar.rs::generate`
 * 用 `self.io.lock().await` 做**全局串行临界区**（同一 helper 进程的 stdin/stdout），
 * 并发请求只会排队，还更容易撞 `GENERATION_TIMEOUT_SECS`。
 *
 * HTTP provider（openai-compatible 家族）每次是独立请求，可并发 3：整库 200 章
 * 从「串行 N 轮」压到「N/3 轮」。上限不再往上抬 —— 多数云 API 有 RPM 限制，
 * 3 是「明显更快又不容易被限流」的折中值。
 */
export function translationConcurrencyOf(kind: ProviderKind): number {
  return kind === "builtin" ? 1 : 3;
}

export interface BuildTranslationMessagesInput {
  target: TranslationLang;
  text: string;
  context?: TranslateContext;
  /** 多块时给模型位置感（`0` 起）：避免每块都自己加开头/结尾套话。 */
  blockIndex?: number;
  blockTotal?: number;
}

/** 构造翻译提示词（纯函数，可直跑单测）。 */
export function buildTranslationMessages(input: BuildTranslationMessagesInput): ChatMessage[] {
  const langName = TRANSLATION_LANG_EN[input.target];
  const lines: string[] = [];

  const title = input.context?.title?.trim();
  if (title) lines.push(`【本章标题】${title}`, "");
  const keyPoints = input.context?.keyPoints ?? [];
  if (keyPoints.length > 0) {
    lines.push("【本章要点】（仅供术语与语气参考，不要翻译这部分，也不要写进译文）");
    for (const kp of keyPoints) lines.push(`· ${kp}`);
    lines.push("");
  }

  const total = input.blockTotal ?? 1;
  const index = input.blockIndex ?? 0;
  if (total > 1) {
    lines.push(
      `【位置】这是全文的第 ${index + 1}/${total} 段 —— 只翻译这一段：不要补上一段的结尾，`,
      "不要提前翻下一段，也不要写「未完待续」之类的话。",
      "",
    );
  }

  lines.push("【待译正文】", input.text);

  return [
    { role: "system", content: buildSystem(langName) },
    { role: "user", content: lines.join("\n") },
  ];
}

/** 单块调用（多块与单块共用同一构造，避免两套提示词各自演化）。 */
async function translateBlock(
  provider: AIProvider,
  input: {
    text: string;
    target: TranslationLang;
    context?: TranslateContext;
    blockIndex?: number;
    blockTotal?: number;
  },
): Promise<string> {
  const { content } = await provider.chat({
    messages: buildTranslationMessages({
      target: input.target,
      text: input.text,
      ...(input.context ? { context: input.context } : {}),
      ...(input.blockIndex !== undefined ? { blockIndex: input.blockIndex } : {}),
      ...(input.blockTotal !== undefined ? { blockTotal: input.blockTotal } : {}),
    }),
    temperature: TEMPERATURE.translation,
  });
  return content?.trim() ?? "";
}

/**
 * 块计划 —— **块尺寸恒定、块数随正文线性增长**。
 *
 * 导出的理由：服务层拆批时要预知「每批多少块」才能给跨批进度一个稳定分母。
 * 让执行侧与报进度侧调**同一个函数**，比各算一遍 `ceil(len / blockChars)`
 * 可靠得多（`planTextBlocks` 会按段落边界切，实际块数不严格等于总数）。
 *
 * ⚠️ `maxChunks` 传的是 `ceil(len / blockChars)` **本身** —— 这是「别放大块尺寸」
 * 的声明，不是上限。`planTextBlocks` 在块数超限时会放大块尺寸重跑，一放大
 * 首字延迟就跟着涨（4.6 万字会被改成 1148 字一块）。
 */
export function planTranslationBlocks(text: string): TextBlock[] {
  return planTextBlocks({
    text,
    chunkChars: TRANSLATION_LIMITS.blockChars,
    maxChunks: Math.max(1, Math.ceil(text.length / TRANSLATION_LIMITS.blockChars)),
  });
}

/**
 * 翻译一段正文：按 `blockChars` 分块、逐块串行调用、拼接结果。
 *
 * 串行而非并发：本地模型（默认 `qwen3.5:4b`）单实例推理，并发只会把请求排队，
 * 却让进度条乱跳；串行还能让上文的术语在块间自然延续（同一进程、同一会话）。
 *
 * 抛错条件（其余一律计 skip）：
 * - 空正文 / 单批超限 / 未配置（`AiProviderError`，走 `aiFailureKindOf` 分类）；
 * - **全部**块失败（`request-failed`）—— 此时没有任何可用译文，不能报成功。
 */
export async function translateText(
  provider: AIProvider,
  input: TranslateInput,
): Promise<TranslateOutput> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new AiProviderError("request-failed", "正文为空，无法翻译。");
  }
  // 单次调用只负责**一批**：更长的正文必须由 `translateChapterBody` 先拆批。
  // 这里 fail loud，而不是让它一路传下去被 `planTextBlocks` 悄悄放大块尺寸。
  if (text.length > TRANSLATION_LIMITS.bodyMaxChars) {
    throw new AiProviderError(
      "request-failed",
      `单批正文超限（${text.length} > ${TRANSLATION_LIMITS.bodyMaxChars}），请走 translateChapterBody。`,
    );
  }
  if (!provider.isConfigured()) {
    throw new AiProviderError("not-configured", "AI 未就绪。");
  }
  if (input.signal?.aborted) {
    throw new AiProviderError("request-failed", "已取消。");
  }

  const blocks = planTranslationBlocks(text);
  if (blocks.length === 0) {
    throw new AiProviderError("request-failed", "正文为空，无法翻译。");
  }

  // 短章：一次调用即可（`planTextBlocks` 只在装得下时给 1 块）。
  if (blocks.length === 1) {
    const out = await translateBlock(provider, {
      text,
      target: input.target,
      ...(input.context ? { context: input.context } : {}),
    });
    if (!out) throw new AiProviderError("request-failed", "AI 返回了空译文。");
    input.onBlockDone?.(0, out);
    input.onBlock?.(1, 1);
    return { text: out, blocks: 1, skippedBlocks: 0, cancelled: false };
  }

  const total = blocks.length;
  const parts: string[] = [];
  let skipped = 0;
  let cancelled = false;
  for (let i = 0; i < total; i++) {
    // 取消只在**块间**生效：推理一旦发起就必须跑完（builtin 无 cancel 命令）。
    if (input.signal?.aborted) {
      cancelled = true;
      break;
    }
    try {
      const out = await translateBlock(provider, {
        text: text.slice(blocks[i].start, blocks[i].end),
        target: input.target,
        blockIndex: i,
        blockTotal: total,
        ...(input.context ? { context: input.context } : {}),
      });
      if (!out) {
        // 空输出按失败计：补一个空串进 parts 会伪造「这一段翻过了」。
        skipped += 1;
        aiLog("warn", "translation", "空输出块已跳过", { block: i + 1, total });
      } else {
        parts.push(out);
        // 先上报增量（UI 立刻上屏），再报进度 —— 上屏比进度条更该抢先。
        input.onBlockDone?.(i, out);
      }
    } catch (err) {
      if (input.signal?.aborted) {
        // 取消导致的失败不记为 skip：它不是「这块翻不出来」，而是「用户喊停」。
        cancelled = true;
        break;
      }
      skipped += 1;
      aiLog("warn", "translation", "块翻译失败已跳过", {
        block: i + 1,
        total,
        err: aiErrPreview(err),
      });
    }
    input.onBlock?.(i + 1, total);
  }

  if (parts.length === 0) {
    throw new AiProviderError("request-failed", cancelled ? "已取消。" : "全部段落翻译失败。");
  }
  aiLog("info", "translation", cancelled ? "翻译已取消" : "翻译完成", {
    target: input.target,
    blocks: total,
    skipped,
    cancelled,
    inChars: text.length,
    outChars: parts.reduce((n, p) => n + p.length, 0),
  });
  // 块间空行拼接：与 `planTextBlocks` 的语义边界（段落空行）同源，
  // 避免两段译文首尾相接糊成一句。
  return { text: parts.join("\n\n"), blocks: total, skippedBlocks: skipped, cancelled };
}
