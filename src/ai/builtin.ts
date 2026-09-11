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

export interface LlmGenerateRequest {
  model: string;
  messages: { role: string; content: string }[];
  maxTokens?: number;
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
    };
    try {
      const content = await invoke<string>("llm_generate", { request });
      return { content };
    } catch (err) {
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
