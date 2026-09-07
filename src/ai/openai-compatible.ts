/**
 * OpenAI-compatible HTTP provider.
 *
 * Covers the README's local-first family out of the box, because Ollama
 * (`/v1/chat/completions`), llama.cpp server and LM Studio all expose an
 * OpenAI-compatible API. Cloud vendors with the same wire format
 * (OpenAI, DeepSeek) reuse it too.
 */
import type {
  Answer,
  Evaluation,
  KnowledgeUnit,
  Question,
  SourceDocument,
} from "../domain";
import type {
  AIProvider,
  AssessmentContext,
  ChatInput,
  ChatOutput,
  ProviderConfig,
  ProviderKind,
} from "./types";
import { AiProviderError } from "./types";

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

const LOCAL_KINDS: ReadonlySet<ProviderKind> = new Set([
  "ollama",
  "llama.cpp",
  "lmstudio",
]);

export function normalizeOpenAiBaseUrl(kind: ProviderKind): string {
  switch (kind) {
    case "ollama":
      return "http://localhost:11434/v1";
    case "llama.cpp":
      return "http://localhost:8080/v1";
    case "lmstudio":
      return "http://localhost:1234/v1";
    case "openai":
      return "https://api.openai.com/v1";
    case "deepseek":
      return "https://api.deepseek.com/v1";
    default:
      return "";
  }
}

export function defaultModelOf(kind: ProviderKind): string {
  switch (kind) {
    case "ollama":
      return "llama3.1";
    case "deepseek":
      return "deepseek-chat";
    case "lmstudio":
    case "llama.cpp":
    case "openai":
    case "custom":
    case "anthropic":
    case "gemini":
      return "";
  }
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly kind: ProviderKind;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;

  constructor(config: ProviderConfig) {
    this.kind = config.kind;
    this.baseUrl =
      config.baseUrl?.replace(/\/+$/, "") ||
      normalizeOpenAiBaseUrl(config.kind);
    this.model = config.model || defaultModelOf(config.kind);
    this.apiKey = config.apiKey;
  }

  isConfigured(): boolean {
    if (!this.baseUrl) return false;
    if (LOCAL_KINDS.has(this.kind) || this.kind === "custom") {
      // Local servers usually need no key; custom endpoints are user's choice.
      return true;
    }
    return Boolean(this.apiKey);
  }

  async chat(input: ChatInput): Promise<ChatOutput> {
    if (!this.isConfigured()) {
      throw new AiProviderError(
        "not-configured",
        `${this.kind} is not configured. Set a base URL${LOCAL_KINDS.has(this.kind) ? "" : " and API key"} in Settings.`,
      );
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
      }),
    });
    if (!res.ok) {
      throw new AiProviderError(
        "request-failed",
        `${this.kind} request failed: HTTP ${res.status} ${await res.text()}`,
      );
    }
    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new AiProviderError("request-failed", `${this.kind} returned an empty completion.`);
    }
    return { content };
  }

  // The three knowledge-loop capabilities are AI-schema work, not wire-format
  // work. They share the same transport as chat() — implement them in the next
  // milestone once the extraction/assessment prompts are designed.
  async extractKnowledge(_document: SourceDocument): Promise<KnowledgeUnit[]> {
    throw new AiProviderError(
      "not-implemented",
      "extractKnowledge prompt pipeline is not implemented yet (next milestone).",
    );
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
