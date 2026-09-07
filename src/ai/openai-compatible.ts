/**
 * OpenAI 兼容的 HTTP Provider。
 *
 * 开箱即覆盖 README 的本地优先家族：Ollama（`/v1/chat/completions`）、
 * llama.cpp server 与 LM Studio 都暴露 OpenAI 兼容 API。
 * 同构协议的云厂商（OpenAI、DeepSeek）也复用本实现。
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
      // 本地服务通常无需 Key；自定义端点交由用户自行决定。
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

  // 三项知识循环能力属于 AI schema（模式）层面的工作，而非传输格式
  // 层面的工作。它们与 chat() 共用同一传输层——待提取/测评提示词
  // 设计完成后在下一个里程碑实现。
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
