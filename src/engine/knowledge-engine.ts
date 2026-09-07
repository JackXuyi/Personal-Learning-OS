/**
 * Knowledge Engine — Document → Knowledge.
 *
 * Full extraction needs an AI prompt pipeline (next milestone). This skeleton
 * defines the contract and degrades gracefully: without a configured provider
 * it returns an empty list instead of inventing knowledge.
 */
import type { AIProvider } from "../ai";
import type { KnowledgeUnit, SourceDocument } from "../domain";

export interface KnowledgeEngine {
  /** True when a provider is configured and extraction is available. */
  readonly hasExtraction: boolean;
  extract(document: SourceDocument): Promise<KnowledgeUnit[]>;
}

export function createKnowledgeEngine(provider?: AIProvider): KnowledgeEngine {
  return {
    hasExtraction: Boolean(provider?.isConfigured()),
    async extract(document: SourceDocument): Promise<KnowledgeUnit[]> {
      if (!provider) return [];
      // Provider extraction is implemented as a prompt pipeline in the next
      // milestone; typed errors are caught here so the loop never crashes.
      return provider.extractKnowledge(document).catch((err: unknown) => {
        console.warn(`[knowledge-engine] extraction skipped: ${String(err)}`);
        return [];
      });
    },
  };
}
