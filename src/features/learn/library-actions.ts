/**
 * 资料级写操作编排（library-actions）—— 删除级联 / 重命名 / 改元信息 /
 * 替换正文 / 追加正文（docs/library-module-design-2026-09.md §4.3.4 / §8.5）。
 *
 * 边界约束：
 * - 纯 TS 编排层：只依赖 domain / storage / 本目录服务，不 import React；
 * - 替换/追加正文只做**代码切分**（splitDocumentNow，零 AI），不走导入管道
 *   的 refine 阶段——「切分由代码、分析由用户显式触发」；
 * - 正文变更后 `analysis` 清空：旧分析结论已不对应新内容，详情页回到
 *   「未分析」，由用户按需重新分析。
 */
import type { DocumentFormat, SourceDocument } from "../../domain";
import type { StorageAdapter } from "../../storage";
import { storage } from "../../stores/useLoopStore";
import { LIMITS } from "./import/types";
import type { ImportUnit } from "./import/types";
import { splitDocumentNow } from "./split-service";
import type { SplitRunResult } from "./split-service";

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
  store: StorageAdapter = storage,
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

/**
 * 删除资料并级联清理（顺序固定，避免半清理）：
 *  0) Chunk：先清该资料的 chunk 与其向量（RAG 索引）——必须先查旧 chunk id，
 *     因为 chunk 行删掉之后就查不到「谁有向量」了
 *  1) 试卷：scope 命中该资料章节的全部试卷 → deletePaper（级联清草稿与结果）
 *  2) 概念：按章 unitIds 反查全局图，清单元与相关关系（无孤儿节点）→ saveGraph
 *  3) 资料本体：deleteDocument（适配器内部再级联删章节）
 */
export async function deleteDocumentCascade(
  docId: string,
  store: StorageAdapter = storage,
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

/** 重命名（title 去空白，空则拒绝）。 */
export async function renameDocument(
  doc: SourceDocument,
  title: string,
  store: StorageAdapter = storage,
): Promise<SourceDocument> {
  const t = title.trim();
  if (!t) throw new Error("标题不能为空");
  const next = { ...doc, title: t };
  await store.saveDocument(next);
  return next;
}

/** 编辑元信息（title / source / format 局部更新；undefined 字段保持原值）。 */
export async function updateDocumentMeta(
  doc: SourceDocument,
  patch: { title?: string; source?: string; format?: DocumentFormat },
  store: StorageAdapter = storage,
): Promise<SourceDocument> {
  const next: SourceDocument = {
    ...doc,
    ...(patch.title !== undefined ? { title: patch.title.trim() || doc.title } : {}),
    ...(patch.source !== undefined ? { source: patch.source.trim() } : {}),
    ...(patch.format !== undefined ? { format: patch.format } : {}),
  };
  await store.saveDocument(next);
  return next;
}

/** 替换正文阶段（自有一套三阶段，不依赖导入管道的五阶段）。 */
export type ReplacePhaseKey = "save" | "split" | "migrate";
export type PhaseState = "active" | "done";

/**
 * 替换正文：覆盖 textPreview（保留 id / importedAt）→ 调 splitDocumentNow
 * 重新切分（代码，掌握度同源迁移）。不走导入管道的 refine 阶段。
 */
export async function replaceDocumentBody(
  doc: SourceDocument,
  unit: ImportUnit,
  opts: {
    storage: StorageAdapter;
    onPhase?: (k: ReplacePhaseKey, s: PhaseState) => void;
  },
): Promise<SplitRunResult> {
  const onPhase = opts.onPhase ?? (() => {});

  onPhase("save", "active");
  const next: SourceDocument = {
    ...doc,
    title: unit.title.trim() || doc.title,
    format: unit.format,
    ...(unit.source ? { source: unit.source } : {}),
    textPreview: unit.text,
    analysis: undefined, // 正文换了 → 旧分析失效，清空分析标记
  };
  await opts.storage.saveDocument(next);
  onPhase("save", "done");

  onPhase("split", "active");
  const res = await splitDocumentNow(next, { storage: opts.storage }); // 无 provider
  onPhase("split", "done");

  onPhase("migrate", "active");
  onPhase("migrate", "done"); // 迁移在 splitDocumentNow 内完成，此处仅对齐阶段观感
  return res;
}

/**
 * 追加正文：newText 去空白后以 "\n\n" 拼到 textPreview 尾部 →
 * 总量超 LIMITS.githubTotalChars（1.5M 字符）则抛错 → 整篇重新切分
 * （代码，掌握度同源保留）。
 */
export async function appendDocumentBody(
  doc: SourceDocument,
  newText: string,
  opts: { storage: StorageAdapter },
): Promise<SplitRunResult & { appendedChars: number }> {
  const add = newText.trim();
  if (!add) throw new Error("追加内容不能为空");
  const merged = `${doc.textPreview ?? ""}\n\n${add}`;
  if (merged.length > LIMITS.githubTotalChars) {
    throw new Error("追加后正文超出大小上限");
  }
  const next: SourceDocument = { ...doc, textPreview: merged, analysis: undefined };
  await opts.storage.saveDocument(next);
  const res = await splitDocumentNow(next, { storage: opts.storage }); // 无 provider
  return { ...res, appendedChars: add.length };
}
