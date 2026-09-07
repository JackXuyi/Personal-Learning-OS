/**
 * Provider registry — the single place to construct an AIProvider from a kind.
 *
 * Anthropic & Gemini use non-OpenAI wire formats; their adapters are a
 * separate milestone. Until then the registry returns a `NotImplementedProvider`
 * that fails loudly (never silently) with a typed error.
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
