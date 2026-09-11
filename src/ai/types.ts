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
  // 注:曾有过 `embeddingModel`(云端 /embeddings),已按决策 D1 移除——
  // 向量化恒定走本地模型,见 `ai/embedding.ts` 的 Embedder。
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

  // 注:**向量化不在本接口**(决策 D1/D5)。
  // 它恒定走本机模型(与「当前使用模型」无关),唯一入口是
  // `ai/embedding.ts` 的 `createEmbedder()` —— 若挂在 provider 上,
  // 聊天切到云端 API 时向量化就会跟着消失,属设计缺陷。

  /**
   * 概念抽取**不在此接口**（G8 修复）：真实实现是
   * `ai/pipelines.ts` 的 `extractChapterConceptsWithAi`（章级、带原文锚定）。
   * 接口上曾有一个 `extractKnowledge(document)` 空实现（恒抛 not-implemented、
   * 零调用方），与真实实现构成双轨隐性坑 —— 已删除。
   */
  generateAssessment(context: AssessmentContext): Promise<Question>;

  evaluateAnswer(question: Question, answer: Answer): Promise<Evaluation>;
}
