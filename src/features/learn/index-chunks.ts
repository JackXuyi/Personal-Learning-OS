/**
 * Chunk 索引接线服务（index-chunks）—— 切分产物 → RAG 写入（纯代码，零 AI）。
 *
 * 职责边界（与 split-service 对称，docs/rag-wiring-design-2026-09.md §4.1）：
 * - 「切分归代码、向量化归 AI」：本模块只做**确定性**的 chunk 生产与落库，
 *   绝不 import `ai/*`；向量化是 `index-service` 的职责，二者互不依赖；
 * - 导入管道（pipeline）与手动切分（split-service）共用本模块，保证两条入口
 *   落库口径一致；
 * - 幂等：先清该文档的旧 chunk（及其向量）再写新的，重切两次不翻倍。
 *
 * 为什么清理顺序是「先查旧 chunk → 清向量 → 删 chunk」：
 * 向量按 targetId 记录且不在文档维度上做级联（见 StorageAdapter 契约注释），
 * chunk 行删掉之后就再也查不到「哪些 chunk 曾有过向量」——所以必须先取后删。
 * 方案 §8.2 的伪代码原为先删后查（查回来必然为空），此处按实际语义修正。
 */
import type { Chapter, SourceDocument } from "../../domain";
import type { StorageAdapter } from "../../storage";
import { chunkDocument } from "../../engine/chunk-engine";

/** 重建结果（chunk 落库条数）。 */
export interface RebuildChunksResult {
  /** 本次写入的 chunk 数（0 = 该文档切不出正文块）。 */
  chunks: number;
  /** 被一并失效的旧向量条数（排障 / 单测用）。 */
  staleVectors: number;
}

/**
 * 重建一份文档的全部 chunk（先删后写，幂等）。
 *
 * 失败策略与 `runUnitImport` 契约一致：**向上抛**，不写半成品。
 * 注意顺序——先清向量与旧 chunk 再写新 chunk，因此中途失败会留下「旧 chunk 已被删、
 * 新 chunk 未写入」的空窗；调用方（导入管道 / 切分服务）本身就是「写失败即整体失败」，
 * 下一次重跑 `rebuildChunks` 即可恢复，不会累积脏数据。
 */
export async function rebuildChunks(
  doc: Pick<SourceDocument, "id" | "textPreview">,
  chapters: readonly Chapter[],
  storage: StorageAdapter,
): Promise<RebuildChunksResult> {
  // 1) 取旧 chunk（删之前必须查，否则拿不到向量清理依据）
  const stale = await storage.listChunksByDocument(doc.id);

  // 2) 旧向量随旧 chunk 一起失效：避免「新 chunk 配旧向量」的错配
  for (const c of stale) {
    await storage.deleteEmbeddingsByTarget(c.id);
  }

  // 3) 清旧 chunk（含 FTS 索引与关联表）
  await storage.deleteChunksByDocument(doc.id);

  // 4) 写新 chunk
  const chunks = chunkDocument(doc, chapters);
  if (chunks.length > 0) await storage.saveChunks(chunks);

  return { chunks: chunks.length, staleVectors: stale.length };
}
