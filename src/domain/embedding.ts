/**
 * Embedding（向量化元数据）—— 记录向量化结果。
 *
 * 具体向量库选型延后（P1），本表仅记录元数据与向量基本信息。
 * 实际向量存储在向量库（SQLite vector / LanceDB / Qdrant）或单独 BLOB 表中。
 *
 * 用途：
 * - 追踪哪些 targets 已向量化
 * - 支持多模型共存（同一 target 可被不同模型向量化）
 * - 维持向量库与数据库的同步状态
 */

export type EmbeddingTargetType = "chunk" | "knowledge" | "chapter";

export interface Embedding {
  id: string;
  /** 向量化目标类型。 */
  targetType: EmbeddingTargetType;
  /** 目标 ID（Chunk.id / KnowledgeUnit.id / Chapter.id）。 */
  targetId: string;
  /** 模型标识（如 "qwen-1.5b" | "openai-3-small"）。 */
  model: string;
  /** 向量维度（便于查询检查）。 */
  vectorDim: number;
  createdAt: number;
}

/**
 * 生成 embedding 查找 key（targetType + targetId + model）。
 * 用于快速定位同一 target 的多模型向量。
 */
export function embeddingKey(
  targetType: EmbeddingTargetType,
  targetId: string,
  model?: string,
): string {
  if (model) {
    return `${targetType}:${targetId}:${model}`;
  }
  return `${targetType}:${targetId}`;
}
