/**
 * builtin Provider —— 应用内置的本地模型(meetily 式 llama-helper 推理进程)。
 *
 * 与其它 Provider 不同,它不走 HTTP:前端经 Tauri 命令直连桌面端 Rust 侧
 * 的 llama-helper sidecar,模型下载/激活/推理全由应用自己管理
 * (详见 docs/local-llm-loading-plan-2026-09.md)。
 *
 * 能力边界:
 * - `chat` 已打通(llm_generate)。
 * - `generateAssessment / evaluateAnswer` 属提示词管线里程碑,当前显式
 *   not-implemented(与 OpenAI 兼容层保持一致)。
 * - 概念抽取不走本 Provider 接口：见 `ai/pipelines.ts`
 *   `extractChapterConceptsWithAi`（G8：接口上的 `extractKnowledge` 空实现已删除）。
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Answer, Evaluation, Question } from "../domain";
import type {
  AIProvider,
  AssessmentContext,
  ChatInput,
  ChatOutput,
  ProviderConfig,
  ProviderKind,
} from "./types";
import { AiProviderError } from "./types";
import { aiErrPreview, aiLog } from "./log";

/**
 * 本地模型结构化调用的默认输出上限。
 * 原 Rust 兜底 2048 会在概念抽取的长 JSON（单章 6~14 条概念）中途截断，
 * 导致解析层拿到不闭合的 JSON —— 见 docs/ai-analysis-summary-fix-design-2026-09.md。
 */
export const BUILTIN_MAX_TOKENS = 4096;

export interface LlmGenerateRequest {
  model: string;
  messages: { role: string; content: string }[];
  maxTokens?: number;
  /** 覆盖模型预设温度（JSON 管道传 0.1~0.3；缺省用模型预设）。 */
  temperature?: number;
  /** 采样预设："tight" = 近贪心结构化预设（Rust 侧 tight_structured()）。 */
  samplingPreset?: "tight";
}

/** Rust `manager.rs` 序列化出的模型信息(键保持 snake_case)。 */
export interface LlmModelInfo {
  name: string;
  display_name: string;
  approx_bytes: number;
  context_size: number;
  status: "not_found" | "downloading" | "ready" | "corrupted";
  description: string;
  /** 设备匹配(M1):运行该档所需最低内存;Rust 返回前可能缺省。 */
  min_ram_gb?: number;
  /** 设备匹配(M1):当前设备是否支持下载/启用。 */
  supported?: { ok: boolean; reason?: string };
  /** 用途:"llm" | "embedding"(embed_list_models 恒为 "embedding")。 */
  kind?: "llm" | "embedding";
  /** 向量维度(仅 embedding)。 */
  dim?: number | null;
}

/** 当前设备能力(llm_status 返回;Rust 扩展前可能缺省)。 */
export interface LlmDeviceInfo {
  os: string;
  arch: string;
  ram_gb: number;
  metal: boolean;
}

/** 下载进度事件负载(Rust 命令层 emit,键为 camelCase)。 */
export interface LlmDownloadProgress {
  model: string;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  mbps: number;
}

/** 本地模型是否可用(桌面端 + helper 二进制就位)。 */
export function isBuiltinAvailable(): boolean {
  return isTauri();
}

export const DOWNLOAD_PROGRESS_EVENT = "llm://download-progress";
/** 向量模型下载进度事件名(独立通道,与聊天模型下载互不干扰)。 */
export const EMBED_DOWNLOAD_PROGRESS_EVENT = "embed://download-progress";

// ---- Tauri 命令封装(仅桌面端可调用)----

export function llmListModels(): Promise<LlmModelInfo[]> {
  return invoke<LlmModelInfo[]>("llm_list_models");
}

export function llmDownload(model: string): Promise<void> {
  return invoke("llm_download", { model });
}

export function llmCancelDownload(model: string): Promise<void> {
  return invoke("llm_cancel_download", { model });
}

export function llmDelete(model: string): Promise<void> {
  return invoke("llm_delete", { model });
}

export function llmStatus(): Promise<{
  helper_ready: boolean;
  default_model: string;
  helper_path: string;
  device?: LlmDeviceInfo;
}> {
  return invoke("llm_status");
}

// ---- 向量化命令(embed_*)----
//
// 与 llm_* 完全独立:独立模型清单(models/embedding)、独立 sidecar 进程。
// 只走本机推理,不发任何 HTTP 请求(决策 D1:云端 /embeddings 已移除)。

export function embedListModels(): Promise<LlmModelInfo[]> {
  return invoke<LlmModelInfo[]>("embed_list_models");
}

export function embedDownload(model: string): Promise<void> {
  return invoke("embed_download", { model });
}

export function embedCancelDownload(model: string): Promise<void> {
  return invoke("embed_cancel_download", { model });
}

export function embedDelete(model: string): Promise<void> {
  return invoke("embed_delete", { model });
}

export function embedDefaultModel(): Promise<string> {
  return invoke<string>("embed_default_model");
}

/** Rust `EmbedResponse`(camelCase 已在此处对齐为 TS 命名)。 */
export interface EmbedTextsResult {
  dim: number;
  vectors: number[][];
  /** 因超过 context_size 被截断的条数。 */
  truncated: number;
}

export function embedTexts(model: string, texts: string[]): Promise<EmbedTextsResult> {
  return invoke<EmbedTextsResult>("embed_texts", { request: { model, texts } });
}

export class BuiltinProvider implements AIProvider {
  readonly kind: ProviderKind = "builtin";
  private readonly model: string;

  constructor(config: ProviderConfig) {
    this.model = config.model || "qwen3.5:4b";
  }

  isConfigured(): boolean {
    // 内置推理进程仅在 Tauri 桌面端存在;纯浏览器(web 预览)不可用。
    return isBuiltinAvailable() && this.model.length > 0;
  }

  private requireDesktop(): void {
    if (!this.isConfigured()) {
      throw new AiProviderError(
        "not-configured",
        "builtin 本地模型需在桌面端使用(tauri dev / 打包版);纯浏览器预览不可用。",
      );
    }
  }

  async chat(input: ChatInput): Promise<ChatOutput> {
    this.requireDesktop();
    const request: LlmGenerateRequest = {
      model: this.model,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      // 输出上限：未指定时用 builtin 默认（2048 会截断长 JSON）。
      maxTokens: input.maxTokens ?? BUILTIN_MAX_TOKENS,
      // 温度透传（此前被静默丢弃，管道层设置的低温度全部作废）。
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      // 结构化意图 → 近贪心采样预设（抑制 JSON 键名漂移）。
      ...(input.jsonMode ? { samplingPreset: "tight" as const } : {}),
    };
    // 排查日志：请求参数全量可见（此前温度/上限丢失只能靠读代码归因）。
    const startedAt = Date.now();
    const inChars = request.messages.reduce((n, m) => n + m.content.length, 0);
    aiLog("info", "builtin", "生成请求", {
      model: request.model,
      temperature: input.temperature,
      preset: request.samplingPreset,
      maxTokens: request.maxTokens,
      msgs: request.messages.length,
      inChars,
    });
    try {
      const content = await invoke<string>("llm_generate", { request });
      aiLog("info", "builtin", "生成完成", {
        ms: Date.now() - startedAt,
        outChars: content.length,
      });
      return { content };
    } catch (err) {
      aiLog("error", "builtin", "生成失败", {
        ms: Date.now() - startedAt,
        err: aiErrPreview(err),
      });
      const message = err instanceof Error ? err.message : String(err);
      throw new AiProviderError("request-failed", message);
    }
  }

  async generateAssessment(_context: AssessmentContext): Promise<Question> {
    throw new AiProviderError(
      "not-implemented",
      "generateAssessment prompt pipeline is not implemented yet (next milestone).",
    );
  }

  async evaluateAnswer(_question: Question, _answer: Answer): Promise<Evaluation> {
    throw new AiProviderError(
      "not-implemented",
      "evaluateAnswer prompt pipeline is not implemented yet (next milestone).",
    );
  }
}
