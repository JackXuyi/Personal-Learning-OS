/**
 * AI Provider abstraction — the contract the whole app depends on.
 *
 * Business logic must never talk to a concrete vendor. Every AI capability
 * goes through `AIProvider`, so local AI (Ollama / llama.cpp / LM Studio),
 * cloud AI (OpenAI / Anthropic / Gemini / DeepSeek) and future community
 * providers can be swapped freely.
 */
import type {
  Answer,
  Evaluation,
  KnowledgeUnit,
  Question,
  SourceDocument,
} from "../domain";

export type ProviderKind =
  | "ollama"
  | "llama.cpp"
  | "lmstudio"
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "custom";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatInput {
  messages: ChatMessage[];
  temperature?: number;
}

export interface ChatOutput {
  content: string;
}

export interface ProviderConfig {
  kind: ProviderKind;
  /** HTTP base URL of the OpenAI-compatible endpoint. */
  baseUrl?: string;
  /** Model name to use. */
  model?: string;
  /** API key. Local providers usually don't need one. */
  apiKey?: string;
}

/** Question-generation context from the Assessment Engine. */
export interface AssessmentContext {
  unitId: string;
  /** Target Bloom level for the generated question. */
  cognitiveLevel: Question["cognitiveLevel"];
  questionType: Question["type"];
}

/** Typed error so engines can degrade gracefully instead of crashing. */
export class AiProviderError extends Error {
  readonly code: "not-configured" | "not-implemented" | "request-failed";
  constructor(
    code: "not-configured" | "not-implemented" | "request-failed",
    message: string,
  ) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
  }
}

export interface AIProvider {
  readonly kind: ProviderKind;

  /** True when this provider has enough config to talk to a real endpoint. */
  isConfigured(): boolean;

  chat(input: ChatInput): Promise<ChatOutput>;

  extractKnowledge(document: SourceDocument): Promise<KnowledgeUnit[]>;

  generateAssessment(context: AssessmentContext): Promise<Question>;

  evaluateAnswer(question: Question, answer: Answer): Promise<Evaluation>;
}
