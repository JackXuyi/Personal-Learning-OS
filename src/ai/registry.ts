/**
 * Provider registry（提供者注册表）——由 kind 构造 AIProvider 的唯一入口。
 *
 * Anthropic 与 Gemini 采用非 OpenAI 的传输格式；它们的适配器属于
 * 单独的里程碑。在此之前，注册表返回一个 `NotImplementedProvider`，
 * 它会以带类型的错误"大声失败"（绝不静默）。
 */
import type { Answer, Evaluation, KnowledgeUnit, Question, SourceDocument } from "../domain";
import { OpenAICompatibleProvider } from "./openai-compatible";
import type {
  AIProvider,
  ChatOutput,
  ProviderConfig,
  ProviderKind,
} from "./types";
import { AiProviderError } from "./types";

/** Providers whose adapters are deferred (non-OpenAI wire formats). */
const DEFERRED: ReadonlySet<ProviderKind> = new Set(["anthropic", "gemini"]);

class NotImplementedProvider implements AIProvider {
  readonly kind: ProviderKind;
  constructor(kind: ProviderKind) {
    this.kind = kind;
  }
  isConfigured(): boolean {
    return false;
  }
  private fail(): never {
    throw new AiProviderError(
      "not-implemented",
      `${this.kind} adapter is not implemented yet. Use an OpenAI-compatible provider in the foundation scaffold.`,
    );
  }
  chat(): Promise<ChatOutput> {
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

export function createProvider(config: ProviderConfig): AIProvider {
  if (DEFERRED.has(config.kind)) {
    return new NotImplementedProvider(config.kind);
  }
  return new OpenAICompatibleProvider(config);
}
