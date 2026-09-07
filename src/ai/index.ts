/**
 * AI layer — provider abstraction, OpenAI-compatible transport and registry.
 *
 * App code should go through `createProvider` + the `AIProvider` interface
 * only; never import a concrete vendor implementation directly.
 */

export * from "./types";
export { OpenAICompatibleProvider } from "./openai-compatible";
export { createProvider } from "./registry";
