/**
 * Chunk（块）—— 向量化与全文检索的基础单位。
 * 由 semanticChunk 引擎产生（将 Section/Paragraph 分割为语义块）。
 *
 * 约束：
 * - content 长度通常 ≤ 512 tokens（为向量化优化）
 * - 必须保留完整 source context（document/chapter/section）
 * - knowledgeIds 为后续概念层（N5）预留
 */

export interface ChunkMetadata {
  heading?: string;
  page?: number;
  sourceLocation?: string;  // "7.2" 等
}

export interface Chunk {
  id: string;
  documentId: string;
  chapterId: string;
  sectionId?: string;
  /** 实际正文（≤ 512 tokens 建议）。 */
  content: string;
  /** 在整文中的序号。 */
  position: number;
  tokenCount?: number;
  /** 关联的 KnowledgeUnit IDs（N5 启用）。 */
  knowledgeIds: string[];
  metadata?: ChunkMetadata;
  createdAt: number;
}

/** 按 position 升序排序。 */
export function sortChunksByPosition(chunks: Chunk[]): Chunk[] {
  return [...chunks].sort((a, b) => a.position - b.position);
}

/**
 * 估算 token 数量（简单启发式）。
 * 中文 ~1.5 字/token，英文 ~4 字符/token。
 */
export function estimateTokenCount(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}
