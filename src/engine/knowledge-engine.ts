/**
 * Knowledge Engine（知识引擎）—— Document → Knowledge。
 *
 * 状态（N5 概念层回归）：实际抽取已由 ai/pipelines.extractChapterConceptsWithAi
 * 承担（章文本 → KnowledgeUnit + 关系，消费点 ChapterGraphPage），本文件保留
 * V1 契约骨架仅为兼容旧桶导出；新代码不要经此入口——直接走 pipelines +
 * graph-engine.replaceChapterConcepts / subgraphOf。
 * 诚实降级原则不变：未配置 Provider 返回空，绝不凭空捏造知识。
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
      // 旧契约：整文档抽取在 N5 后不再由本入口提供（见文件头注释）。
      void document;
      return [];
    },
  };
}
