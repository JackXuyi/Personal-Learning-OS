/**
 * AI Provider 抽象 —— 整个应用依赖的契约。
 *
 * 业务逻辑绝不能直接面向某个具体厂商。每一项 AI 能力都经由 `AIProvider`
 * 转发，因此内置本地模型（builtin：应用自带 llama-helper 推理进程）、
 * 本地 AI（Ollama / llama.cpp / LM Studio）、云端 AI
 * （OpenAI / Anthropic / Gemini / DeepSeek）以及未来的社区
 * Provider 都可以自由替换。
 */
import type { Answer, Evaluation, Question } from "../domain";

export type ProviderKind =
  | "builtin"
  | "ollama"
  | "llama.cpp"
  | "lmstudio"
  // OpenAI 兼容的开源/开放模型云端 API(决策 Q3,见 ai-model-center-plan)
  | "qwen"
  | "deepseek"
  | "glm"
  | "kimi"
  | "openai"
  | "anthropic"
  | "gemini"
  | "custom";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatInput {
  messages: ChatMessage[];
  temperature?: number;
  /**
   * 输出上限（token）；未给则由各 Provider 自决默认值
   * （builtin: 4096 —— 低于此值长 JSON 会在中途被截断；HTTP: 不设上限）。
   */
  maxTokens?: number;
  /**
   * 期望结构化（JSON）输出。
   * - builtin：映射为近贪心采样预设（`samplingPreset: "tight"`）；
   * - HTTP provider：当前忽略（API 档零改动，见 ai-analysis-summary-fix-design）。
   */
  jsonMode?: boolean;
}

export interface ChatOutput {
  content: string;
}

export interface ProviderConfig {
  kind: ProviderKind;
  /** OpenAI 兼容端点的 HTTP 基础地址。 */
  baseUrl?: string;
  /** Model name to use. */
  model?: string;
  /** API key. Local providers usually don't need one. */
  apiKey?: string;
  /**
   * 向量化模型名（可选，D3-A）。
   *
   * chat 与 embedding 模型天然不同（如 `deepseek-chat` vs `text-embedding-v3`），
   * 但**端点与 Key 复用同一份 `active` 配置**，避免配置面翻倍。
   * 未配置 → 该 provider 不挂载 `embed` 方法（无向量能力，检索自动降级 FTS）。
   */
  embeddingModel?: string;
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

  /**
   * 文本向量化（**可选能力**）。
   *
   * - 配置了 `embeddingModel` 的 HTTP provider 才挂载本方法；
   * - builtin 本地模型（Rust 侧 llm 只有生成、无 embedding）与
   *   `NoActiveProvider` 都不实现 → 属性为 `undefined`；
   * - 调用方（index-service / hybrid-search）**必须先做能力检查**
   *   `typeof provider.embed === "function"` 再调用，不可直接 await，
   *   否则会拿到 `undefined is not a function` 而不是可降级的语义。
   *
   * @returns 与入参等长、顺序一致的向量数组（实现负责按 index 还原顺序）
   */
  embed?(texts: readonly string[]): Promise<number[][]>;

  /**
   * 概念抽取**不在此接口**（G8 修复）：真实实现是
   * `ai/pipelines.ts` 的 `extractChapterConceptsWithAi`（章级、带原文锚定）。
   * 接口上曾有一个 `extractKnowledge(document)` 空实现（恒抛 not-implemented、
   * 零调用方），与真实实现构成双轨隐性坑 —— 已删除。
   */
  generateAssessment(context: AssessmentContext): Promise<Question>;

  evaluateAnswer(question: Question, answer: Answer): Promise<Evaluation>;
}
