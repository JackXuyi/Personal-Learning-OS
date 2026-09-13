/**
 * AI 管道底层共享件 —— 传输（`chatJson`）+ JSON 归一化（`extractJson`）+ 尺寸
 * 上限（`PIPELINE_LIMITS`）+ 通用判型工具（`isRecord` / `str`）。
 *
 * 为什么单独成文件：`pipelines.ts` 需要 re-export `chapter-map-reduce` 与
 * `refine-batch`（保持既有导出名不让调用方改动），而这两个新模块又需要
 * `chatJson` / `isRecord` / `str` / `PIPELINE_LIMITS`。若它们反过来从
 * `pipelines.ts` import，就形成模块循环 —— ESM 下顶层求值跨模块 `const`
 * 会命中 TDZ。把共享件下沉到本模块后依赖严格单向：
 *
 *   types / json-repair / log
 *      ↑
 *   pipeline-core
 *      ↑
 *   text-blocks · chapter-map-reduce · refine-batch · pipelines · overview-pipeline
 *
 * 本模块**不** import 上述任何同目录业务模块（只依赖 `./types`、`./json-repair`、
 * `./log`），因此可安全被任意管道引用。
 */
import type { AIProvider, ChatMessage } from "./types";
import { AiProviderError } from "./types";
import { repairTruncatedJson } from "./json-repair";
import { aiLog } from "./log";

/* ------------------------------------------------------------------ */
/* 尺寸上限                                                            */
/* ------------------------------------------------------------------ */

/** 各管道输入尺寸上限（防止提示词超出小模型上下文）。 */
export const PIPELINE_LIMITS = {
  /** AI 精修的单批最大章数（再多则分批；由输出长度反推，避开小模型截断）。 */
  refineBatchChapters: 12,
  /** AI 精修单批内的摘录字符上限（输入侧护栏）。 */
  refineBatchExcerptChars: 24_000,
  /** 出题提示词总字符上限（超出回退本地题库）。 */
  quizMaxPromptChars: 32_000,
  /** 正文摘录每章最大字符（出题上下文）。 */
  quizExcerptChars: 700,
  /** 主观批改单请求最大条数（超出分批）。 */
  gradeChunkSize: 8,
  /** 章内分块：块尺寸下限（也是「短章单块直出」门槛）。 */
  chapterBlockMinChars: 3_000,
  /** 章内分块：块尺寸上限。 */
  chapterBlockMaxChars: 12_000,
  /** 章内分块：单章块数硬上限。 */
  chapterBlockMaxChunks: 8,
  /** 单块概念抽取的正文最大字符数（超出拒绝——分块算法异常时兜底）。 */
  conceptBlockMaxChars: 40_000,
  /** 单块要点抽取的正文最大字符数（与概念同口径）。 */
  keyPointBlockMaxChars: 40_000,
  /** 概念归并后的条数上限。 */
  conceptMergeMax: 20,
  /** 要点归并后的条数上限（D4：单块与多块统一口径）。 */
  keyPointMergeMax: 8,
  /** 单条要点 / 原文摘录的字符上限（防 AI 灌水）。 */
  keyPointMaxChars: 60,
  keyPointQuoteMaxChars: 200,
} as const;

/** 温度：精修/出题偏稳定，批改最低（事实判定）。 */
export const TEMPERATURE = { refine: 0.2, quiz: 0.3, grade: 0.1, concept: 0.2, keyPoint: 0.2 };

/* ------------------------------------------------------------------ */
/* JSON 归一化                                                         */
/* ------------------------------------------------------------------ */

/** 从模型输出中抽出首个 JSON（剥掉 ```json 围栏与前后说明文字）。 */
export function extractJson(content: string): unknown {
  const stripped = content
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  // 取剥离后首个「{ 或 [」到末个「} 或 ]」。
  const open = stripped.search(/[\[{]/);
  const close = Math.max(stripped.lastIndexOf("}"), stripped.lastIndexOf("]"));
  if (open === -1) {
    aiLog("error", "parse", "AI 返回内容中未找到 JSON", {
      head: stripped.slice(0, 120) || "(空)",
    });
    throw new AiProviderError(
      "request-failed",
      `AI 返回内容中未找到 JSON：${stripped.slice(0, 120) || "(空)"}`,
    );
  }
  // close <= open：从 open 起没有任何闭合符 —— 截断发生在第一个元素中间，
  // 同样交给截断修复（回退容器边界）处理，而不是直接判死。
  const slice = stripped.slice(open, close > open ? close + 1 : undefined);
  try {
    return JSON.parse(slice) as unknown;
  } catch {
    // 输出被 max_tokens 截断是本地小模型的常见失败模式：JSON 停在半途、
    // 花括号不闭合。先尝试抢救「完整前缀」（只保留完整元素，不伪造半条），
    // 不可修复再走统一抛错。
    const repaired = repairTruncatedJson(slice);
    if (repaired !== undefined) {
      aiLog("warn", "parse", "截断 JSON 已抢救（只保留完整元素）", {
        rawChars: slice.length,
        repairedChars: repaired.length,
      });
      try {
        return JSON.parse(repaired) as unknown;
      } catch {
        // 理论不可达（repair 内部已验证过），落到统一抛错
      }
    }
    aiLog("error", "parse", "JSON 解析失败（可能是输出被长度截断）", {
      head: stripped.slice(open, Math.min(open + 120, stripped.length)),
    });
    throw new AiProviderError(
      "request-failed",
      `AI 返回的 JSON 无法解析（可能是输出被长度截断）：${stripped.slice(open, Math.min(close + 1, open + 160))}…`,
    );
  }
}

/** 发起一次「期望返回 JSON」的 chat；未配置 / 失败都以带类型错误抛出。 */
export async function chatJson(
  provider: AIProvider,
  messages: ChatMessage[],
  temperature: number,
): Promise<unknown> {
  if (!provider.isConfigured()) {
    throw new AiProviderError(
      "not-configured",
      "AI 未就绪：请到「设置 → AI 模型中心」配置本地模型或 API。",
    );
  }
  // 关键修复：temperature 此前对 builtin 档被静默丢弃（builtin.chat 只组
  // model+messages）；jsonMode 声明结构化意图 → builtin 映射为近贪心采样预设。
  const startedAt = Date.now();
  const { content } = await provider.chat({ messages, temperature, jsonMode: true });
  if (!content) {
    aiLog("error", "chatJson", "AI 返回了空内容", { provider: provider.kind });
    throw new AiProviderError("request-failed", "AI 返回了空内容。");
  }
  aiLog("info", "chatJson", "调用完成", {
    provider: provider.kind,
    temperature,
    outChars: content.length,
    ms: Date.now() - startedAt,
  });
  return extractJson(content);
}

/* ------------------------------------------------------------------ */
/* 通用判型                                                            */
/* ------------------------------------------------------------------ */

/** 判断是否为「普通对象」（排除 null 与数组）。 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 取字符串值（非字符串 → undefined）。 */
export function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
