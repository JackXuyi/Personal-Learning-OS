/**
 * ActiveSource —— 「当前使用模型」的设置层模型(Q2:store 本期迁移)。
 *
 * 概念:整个应用只存在一份「当前使用模型」,要么是应用自己下载的本地模型
 * (source: local),要么是配置好的 API 端点(source: api)。
 * 详见 docs/ai-model-center-plan-2026-09.md §3。
 */
import type { Answer, Evaluation, Question } from "../domain";
import { createProvider } from "./registry";
import type {
  AIProvider,
  ChatInput,
  ChatOutput,
  ProviderConfig,
  ProviderKind,
} from "./types";
import { AiProviderError } from "./types";

/** API 端点型 provider(builtin 之外的 kind 全集)。 */
export type ApiProviderKind = Exclude<ProviderKind, "builtin">;

/** 设置层持久化的「当前使用模型」。 */
export type ActiveSource =
  | { readonly source: "local"; readonly model: string }
  | {
      readonly source: "api";
      readonly provider: ApiProviderKind;
      readonly baseUrl: string;
      readonly model: string;
      readonly apiKey: string;
    };

/** null = 尚未选择任何模型(引擎走离线启发式)。 */
export type SavedActive = ActiveSource | null;

/** 把 ActiveSource 映射回引擎层 ProviderConfig(local→builtin)。 */
export function activeToProviderConfig(active: SavedActive): ProviderConfig | null {
  if (!active) return null;
  if (active.source === "local") {
    return { kind: "builtin", model: active.model };
  }
  return {
    kind: active.provider,
    baseUrl: active.baseUrl.trim() || undefined,
    model: active.model.trim() || undefined,
    apiKey: active.apiKey.trim() || undefined,
  };
}

/** 未选择任何模型时的兜底 provider:isConfigured()=false,调用即带类型错误。 */
class NoActiveProvider implements AIProvider {
  readonly kind: ProviderKind = "builtin";
  isConfigured(): boolean {
    return false;
  }
  private fail(): never {
    throw new AiProviderError(
      "not-configured",
      "尚未选择模型:请到「设置 → AI 模型中心」选择本地模型或配置 API 模型。",
    );
  }
  chat(_input: ChatInput): Promise<ChatOutput> {
    return Promise.reject(this.fail());
  }
  generateAssessment(): Promise<Question> {
    return Promise.reject(this.fail());
  }
  evaluateAnswer(_question: Question, _answer: Answer): Promise<Evaluation> {
    return Promise.reject(this.fail());
  }
}

/** 由「当前使用模型」构造引擎实际使用的 provider(无选择时返回离线兜底)。 */
export function providerFromActive(active: SavedActive): AIProvider {
  const cfg = activeToProviderConfig(active);
  return cfg ? createProvider(cfg) : new NoActiveProvider();
}

/**
 * ⚠️ 这里曾经有一个 `buildActiveProvider()` 导出，实现为
 * `new NoActiveProvider().isConfigured() ? … : null` —— 恒返回 `null`，
 * 导致消费方（资料详情页的切分/知识点 Tab）的 AI 按钮永远禁用（B2 · P0）。
 *
 * 已删除。**AI provider 的唯一构造入口是 `stores/useSettingsStore` 的
 * `buildActiveProvider()`**（它读全局 `active` 并在钥匙串回填后带真值）。
 * 需要判定「AI 是否就绪」的 UI，用 `hooks/useAiReady`（响应式订阅
 * `providerReady`），不要在这里再造入口。
 */
