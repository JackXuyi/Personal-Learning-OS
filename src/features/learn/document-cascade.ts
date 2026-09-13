/**
 * 资料删除级联（document-cascade）—— 纯编排，不 import 任何 store。
 *
 * 2026-09-13 自 library-actions.ts 抽出：导入管道的「覆盖式导入」（O2/D1）
 * 也要走同一条级联删除链路，而 import/pipeline.ts 必须保持 node 单测可直跑
 * （不得拖进 zustand store）。本模块只依赖 domain / storage 类型，store 由
 * 调用方显式传入；library-actions 保留带默认 store 的兼容包装。
 *
 * 顺序固定，避免半清理：
 *  0) Chunk：先清该资料的 chunk 与其向量（RAG 索引）——必须先查旧 chunk id，
 *     因为 chunk 行删掉之后就查不到「谁有向量」了
 *  1) 试卷：scope 命中该资料章节的全部试卷 → deletePaper（级联清草稿与结果）
 *  2) 概念：按章 unitIds 反查全局图，清单元与相关关系（无孤儿节点）→ saveGraph
 *  3) 资料本体：deleteDocument（适配器内部再级联删章节）
 */
import type { StorageAdapter } from "../../storage";

/** 删除连带清理的数量报告（确认弹窗展示用）。 */
export interface DeleteReport {
  chapters: number;
  papers: number;
  concepts: number;
  /** 该资料已落库的 Chunk 数（RAG 索引；无索引时为 0）。 */
  chunks: number;
}

/** 删除前预检：只读统计，返回将被连带清理的数量（供确认弹窗展示）。 */
export async function previewDeleteCascade(
  docId: string,
  store: StorageAdapter,
): Promise<DeleteReport> {
  const chapters = await store.listChapters(docId);
  const chapterIds = new Set(chapters.map((c) => c.id));

  // PLOS 出卷恒为「单资料范围」：任一命中该资料章节即视为该资料的试卷。
  const papers = (await store.listPapers()).filter((p) =>
    p.scope.chapterIds.some((id) => chapterIds.has(id)),
  );

  const unitIds = new Set(chapters.flatMap((c) => c.unitIds));
  let concepts = 0;
  if (unitIds.size > 0) {
    const g = await store.getGraph();
    concepts = g.units.filter((u) => unitIds.has(u.id)).length;
  }
  const chunks = (await store.listChunksByDocument(docId)).length;
  return { chapters: chapters.length, papers: papers.length, concepts, chunks };
}

/** 删除资料并级联清理（顺序见模块头）。store 必传——保持 node 单测可直跑。 */
export async function deleteDocumentCascade(
  docId: string,
  store: StorageAdapter,
): Promise<DeleteReport> {
  const chapters = await store.listChapters(docId);
  const chapterIds = new Set(chapters.map((c) => c.id));

  // 0) Chunk + 向量（RAG 索引）
  const chunks = await store.listChunksByDocument(docId);
  for (const c of chunks) await store.deleteEmbeddingsByTarget(c.id);
  await store.deleteChunksByDocument(docId);

  // 1) 试卷（含草稿与结果）
  const papers = (await store.listPapers()).filter((p) =>
    p.scope.chapterIds.some((id) => chapterIds.has(id)),
  );
  for (const p of papers) await store.deletePaper(p.id);

  // 2) 概念：只保留不在该资料单元集内的单元；关系两端都保留才保留
  const unitIds = new Set(chapters.flatMap((c) => c.unitIds));
  let concepts = 0;
  if (unitIds.size > 0) {
    const g = await store.getGraph();
    const keepUnits = g.units.filter((u) => !unitIds.has(u.id));
    concepts = g.units.length - keepUnits.length;
    const keep = new Set(keepUnits.map((u) => u.id));
    await store.saveGraph({
      units: keepUnits,
      relations: g.relations.filter((r) => keep.has(r.fromId) && keep.has(r.toId)),
    });
  }

  // 3) 资料本体（适配器内部再级联删章节）
  await store.deleteDocument(docId);
  return { chapters: chapters.length, papers: papers.length, concepts, chunks: chunks.length };
}
