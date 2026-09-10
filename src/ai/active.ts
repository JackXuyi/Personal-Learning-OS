/**
 * ActiveSource —— 「当前使用模型」的设置层模型(Q2:store 本期迁移)。
 *
 * 概念:整个应用只存在一份「当前使用模型」,要么是应用自己下载的本地模型
 * (source: local),要么是配置好的 API 端点(source: api)。
 * 详见 docs/ai-model-center-plan-2026-09.md §3。
 */
import type { Answer, Evaluation, KnowledgeUnit, Question, SourceDocument } from "../domain";
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
  extractKnowledge(_document: SourceDocument): Promise<KnowledgeUnit[]> {
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
 * buildActiveProvider —— 前端快速构造当前模型 provider。
 * 与 useSettingsStore.activeSource 耦合，供 UI 层判定 AI 是否就绪。
 * TODO(P2): 迁移 activeSource 到 useSettingsStore，此处改为注入 store。
 */
export function buildActiveProvider(): AIProvider | null {
  // 临时：若无 active source，返回 null；UI 层自处理禁用/提示。
  // 最终应从 useSettingsStore 读取。
  return new NoActiveProvider().isConfigured() ? providerFromActive(null) : null;
}
