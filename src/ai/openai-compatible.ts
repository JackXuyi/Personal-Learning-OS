/**
 * OpenAI 兼容的 HTTP Provider。
 *
 * 开箱即覆盖 README 的本地优先家族：Ollama（`/v1/chat/completions`）、
 * llama.cpp server 与 LM Studio 都暴露 OpenAI 兼容 API。
 * 同构协议的云厂商（OpenAI、DeepSeek）也复用本实现。
 */
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

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

const LOCAL_KINDS: ReadonlySet<ProviderKind> = new Set([
  "ollama",
  "llama.cpp",
  "lmstudio",
]);
// NOTE: "builtin" 不在此列——它不是 HTTP 服务，由 src/ai/builtin.ts 经
// Tauri 命令直连应用内置的 llama-helper 推理进程。

export function normalizeOpenAiBaseUrl(kind: ProviderKind): string {
  switch (kind) {
    case "builtin":
    case "custom":
      return "";
    case "ollama":
      return "http://localhost:11434/v1";
    case "llama.cpp":
      return "http://localhost:8080/v1";
    case "lmstudio":
      return "http://localhost:1234/v1";
    case "qwen":
      return "https://dashscope.aliyuncs.com/compatible-mode/v1";
    case "deepseek":
      return "https://api.deepseek.com/v1";
    case "glm":
      return "https://open.bigmodel.cn/api/paas/v4";
    case "kimi":
      return "https://api.moonshot.cn/v1";
    case "openai":
      return "https://api.openai.com/v1";
    default:
      return "";
  }
}

export function defaultModelOf(kind: ProviderKind): string {
  switch (kind) {
    case "builtin":
      return "qwen3.5:4b";
    case "ollama":
      return "llama3.1";
    case "qwen":
      return "qwen-plus";
    case "deepseek":
      return "deepseek-chat";
    case "glm":
      return "glm-4.5";
    case "kimi":
      return "moonshot-v1-8k";
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
    // 向量化不在此处挂载:恒定走本地 Embedder(决策 D1/D5,见 ai/embedding.ts)。
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

    const startedAt = Date.now();
    const temperature = input.temperature ?? 0.2;
    const inChars = input.messages.reduce((n, m) => n + m.content.length, 0);
    aiLog("info", this.kind, "chat 请求", {
      model: this.model,
      temperature,
      msgs: input.messages.length,
      inChars,
    });
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: input.messages,
        temperature,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      aiLog("error", this.kind, "chat HTTP 失败", {
        ms: Date.now() - startedAt,
        status: res.status,
        err: aiErrPreview(detail),
      });
      throw new AiProviderError(
        "request-failed",
        `${this.kind} request failed: HTTP ${res.status} ${detail}`,
      );
    }
    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      aiLog("error", this.kind, "chat 返回空内容", { ms: Date.now() - startedAt });
      throw new AiProviderError("request-failed", `${this.kind} returned an empty completion.`);
    }
    aiLog("info", this.kind, "chat 完成", {
      ms: Date.now() - startedAt,
      outChars: content.length,
    });
    return { content };
  }

  // 测评两项能力属于 AI schema（模式）层面的工作，而非传输格式层面的工作。
  // 它们与 chat() 共用同一传输层——待测评提示词设计完成后在下一个里程碑实现。
  // 概念抽取不在本接口（G8）：真实实现见 ai/pipelines.extractChapterConceptsWithAi。
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
