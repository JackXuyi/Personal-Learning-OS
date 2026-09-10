/**
 * Embedding（向量化元数据 + 向量本体）—— 记录向量化结果。
 *
 * 向量本体落在 SQLite 的 `embeddings.vector`（float32 LE 的 BLOB）：
 * - 桌面端（Tauri）持久化；
 * - 内存后端持有（单测可覆盖向量检索）；
 * - localStorage 后端**不持久化**向量（1000 chunk × 768 维 ≈ 15MB JSON，
 *   必然击穿 5–10MB 配额），仅保留内存态，刷新后降级为纯 FTS。
 *
 * 用途：
 * - 追踪哪些 targets 已向量化（覆盖率 / 判重）
 * - 支持多模型共存（同一 target 可被不同模型向量化）
 * - 检索时提供余弦相似度计算的输入
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
  /**
   * 向量本体（可选）。
   * - 写入路径带上即持久化到 SQLite；
   * - 读路径（listEmbeddings）**不返回**它——元数据清单不该带 MB 级数据；
   *   需要向量时走 `listEmbeddingVectors`；
   * - undefined 表示「元数据在、向量未生成」（老数据 / 生成失败 / 本次未带）。
   */
  vector?: number[];
  createdAt: number;
}

/** 检索用轻量视图（不带 id / createdAt，减少 IPC 与内存开销）。 */
export interface EmbeddingVector {
  targetId: string;
  /** 生成该向量的模型标识（检索时只取与当前配置模型一致的向量）。 */
  model: string;
  /** 向量维度；与查询向量不一致的候选在检索层跳过。 */
  dim: number;
  vector: number[];
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
