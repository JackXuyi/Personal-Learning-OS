/**
 * 向量检索纯函数 —— 余弦相似度与 top-k。
 *
 * 约束：纯函数，零依赖 React / storage / 网络，可 node 直跑单测。
 * 向量本体由 `StorageAdapter.listEmbeddingVectors` 提供（桌面端来自 SQLite BLOB）。
 */
import type { EmbeddingVector } from "../../domain";

export interface VectorHit {
  targetId: string;
  /** 余弦相似度，范围 [-1, 1]；0 表示正交或无法计算。 */
  score: number;
}

/**
 * 余弦相似度。
 *
 * 边界处理：
 * - 任一向量为零向量（或含 NaN/Infinity 导致模长为 0）→ 返回 0，
 *   而不是 `NaN`——NaN 参与排序会让整个结果集顺序不可预期；
 * - 长度不一致时按较短者截断比较（调用方通常已在 `cosineTopK` 里按维度过滤）。
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!Number.isFinite(normA) || !Number.isFinite(normB)) return 0;
  if (normA === 0 || normB === 0) return 0;
  const score = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Number.isFinite(score) ? score : 0;
}

/**
 * 按余弦相似度取 top-k。
 *
 * - 维度与查询向量不一致的候选**跳过并计数**（`skipped`）——换了 embedding 模型后
 *   库里会同时存在新旧维度的向量，直接比较没有意义，但也不该让整次检索崩掉；
 * - 分数相同时按 targetId 字典序，保证结果**确定性可断言**。
 */
export function cosineTopK(
  query: readonly number[],
  candidates: readonly EmbeddingVector[],
  k: number,
): { hits: VectorHit[]; skipped: number } {
  const hits: VectorHit[] = [];
  let skipped = 0;

  for (const c of candidates) {
    if (query.length === 0 || c.vector.length !== query.length) {
      skipped += 1;
      continue;
    }
    hits.push({ targetId: c.targetId, score: cosineSimilarity(query, c.vector) });
  }

  hits.sort((x, y) => y.score - x.score || x.targetId.localeCompare(y.targetId));
  return { hits: hits.slice(0, Math.max(0, k)), skipped };
}
