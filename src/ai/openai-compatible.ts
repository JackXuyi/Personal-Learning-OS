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

/** `/embeddings` 返回体（OpenAI 兼容协议）。 */
interface EmbeddingsResponse {
  data?: { index?: number; embedding?: number[] }[];
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
  private readonly embeddingModel: string;

  /**
   * 向量化能力（可选方法，见 AIProvider 契约）。
   *
   * **按配置决定是否挂载**：未配 `embeddingModel` 时保持 `undefined`，
   * 调用方的 `typeof provider.embed === "function"` 检查自然判定为「无此能力」，
   * 从而降级为纯 FTS 检索——而不是等到真调用时抛错（B2 那类「静默失效」的教训：
   * 能力判定必须是可提前查询的，不能靠异常兜底）。
   */
  embed?: (texts: readonly string[]) => Promise<number[][]>;

  constructor(config: ProviderConfig) {
    this.kind = config.kind;
    this.baseUrl =
      config.baseUrl?.replace(/\/+$/, "") ||
      normalizeOpenAiBaseUrl(config.kind);
    this.model = config.model || defaultModelOf(config.kind);
    this.apiKey = config.apiKey;
    this.embeddingModel = config.embeddingModel?.trim() ?? "";

    if (this.embeddingModel) {
      this.embed = (texts) => this.requestEmbeddings(texts);
    }
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

  /**
   * `POST {baseUrl}/embeddings`（OpenAI 兼容协议）。
   *
   * 仅当 `embeddingModel` 已配置时才会被挂到实例上（见构造函数），
   * 因此本方法内的模型名校验属于「二次防线」。
   *
   * 校验策略（宁可整批失败也不写脏向量）：
   * - 返回条数必须与入参一致；
   * - 每条的维度必须一致；
   * - 任一不满足 → 抛 `request-failed`，由 index-service 计入该批失败。
   */
  private async requestEmbeddings(texts: readonly string[]): Promise<number[][]> {
    if (!this.isConfigured()) {
      throw new AiProviderError(
        "not-configured",
        `${this.kind} is not configured. Set a base URL${LOCAL_KINDS.has(this.kind) ? "" : " and API key"} in Settings.`,
      );
    }
    if (!this.embeddingModel) {
      throw new AiProviderError(
        "not-configured",
        `${this.kind} 未配置 Embedding 模型，请在「设置 → AI 模型中心 → 向量索引」填写。`,
      );
    }
    if (texts.length === 0) return [];

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: this.embeddingModel, input: [...texts] }),
    });
    if (!res.ok) {
      throw new AiProviderError(
        "request-failed",
        `${this.kind} embeddings request failed: HTTP ${res.status} ${await res.text()}`,
      );
    }

    const data = (await res.json()) as EmbeddingsResponse;
    const rows = data.data ?? [];
    if (rows.length !== texts.length) {
      throw new AiProviderError(
        "request-failed",
        `${this.kind} embeddings 条数不匹配：请求 ${texts.length}，返回 ${rows.length}`,
      );
    }

    // 协议只保证「按 index 可还原顺序」，不保证数组顺序 → 显式按 index 落位。
    const ordered: number[][] = new Array(texts.length);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const at = typeof row.index === "number" ? row.index : i;
      if (!Array.isArray(row.embedding) || row.embedding.length === 0) {
        throw new AiProviderError(
          "request-failed",
          `${this.kind} embeddings 第 ${at} 条为空`,
        );
      }
      if (at < 0 || at >= texts.length) {
        throw new AiProviderError(
          "request-failed",
          `${this.kind} embeddings 返回越界 index：${at}`,
        );
      }
      ordered[at] = row.embedding;
    }

    const dim = ordered[0].length;
    for (const v of ordered) {
      if (!v || v.length !== dim) {
        throw new AiProviderError(
          "request-failed",
          `${this.kind} embeddings 维度不一致（期望 ${dim}）`,
        );
      }
    }
    return ordered;
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
