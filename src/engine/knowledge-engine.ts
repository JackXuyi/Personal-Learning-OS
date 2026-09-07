/**
 * Knowledge Engine（知识引擎）—— Document → Knowledge。
 *
 * 完整抽取需要 AI 提示词流水线（下一里程碑）。本骨架定义契约并优雅降级：
 * 未配置 Provider 时返回空列表，而不是凭空捏造知识。
 */
import type { AIProvider } from "../ai";
import type { KnowledgeUnit, SourceDocument } from "../domain";

export interface KnowledgeEngine {
  /** 已配置 Provider 且可抽取时为 true。 */
  readonly hasExtraction: boolean;
  extract(document: SourceDocument): Promise<KnowledgeUnit[]>;
}

export function createKnowledgeEngine(provider?: AIProvider): KnowledgeEngine {
  return {
    hasExtraction: Boolean(provider?.isConfigured()),
    async extract(document: SourceDocument): Promise<KnowledgeUnit[]> {
      if (!provider) return [];
      // provider 抽取在下一里程碑以提示词流水线实现；
      // 此处捕获类型化错误，保证闭环不会崩溃。
      return provider.extractKnowledge(document).catch((err: unknown) => {
        console.warn(`[knowledge-engine] extraction skipped: ${String(err)}`);
        return [];
      });
    },
  };
}
