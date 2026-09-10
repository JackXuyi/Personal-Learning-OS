/**
 * AI 层——Provider 抽象、OpenAI 兼容传输层与注册表。
 *
 * 应用代码只应经由 `createProvider` 与 `AIProvider` 接口；
 * 绝不要直接 import 具体厂商的实现。
 */

export * from "./types";
export { OpenAICompatibleProvider } from "./openai-compatible";
export { createProvider } from "./registry";
export * from "./pipelines";
// 检索层（RAG 链路下游）：向量纯函数 + RRF 融合 + 混合检索编排
export * from "./retrieval/vector-search";
export * from "./retrieval/rrf";
export * from "./retrieval/hybrid-search";
