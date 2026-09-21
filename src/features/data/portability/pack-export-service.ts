/**
 * 知识包导出服务 —— 选中资料 → `KnowledgePackFile`（F10 · 方案 §4.3.3 / §8.4）。
 *
 * 纯编排：只调 `StorageAdapter` 的公开方法，**不绕过适配器**去读 localStorage /
 * SQLite 原文（分层约束：UI → stores/storage）。**不产出用户文案**（只回分类与
 * 数字），文案由 UI 经 i18n 映射。
 *
 * ⚠️ 遍历式收集的原因同 F4（`export-service.ts`）：接口层没有全量 sections / chunks
 * 入口，这些读取入口都带维度参数（chapterId / documentId）→ 只能从文档 / 章逐层收集。
 */
import type {
  Chapter,
  Chunk,
  KnowledgeRelation,
  KnowledgeUnit,
  Section,
  SourceDocument,
} from "../../../domain";
import type { StorageAdapter } from "../../../storage/types";
import { APP_VERSION, PACK_KIND, PACK_VERSION, contentHashOf, countsOfPack, utf8BytesOf } from "./pack-format";
import type {
  KnowledgePackFile,
  PackData,
  PackManifest,
  PackSourceRef,
} from "./pack-format";

export interface PackSelection {
  documentIds: readonly string[];
  /**
   * 包头部信息。
   *
   * ⚠️ `title` 由 **UI 经 i18n** 保证非空 —— 服务层**不做**「N 份资料」这类文案兜底
   * （全仓「服务层零文案」纪律；i18n 没有 React 外的消息访问器）。
   */
  manifest: Pick<PackManifest, "title" | "description" | "author" | "license">;
}

export type PackWarningKind =
  | "too-large" // bytes > storage.storeCapacityBytes（③ 的**导出侧提示**：对方后端可能装不下，不阻断）
  | "doc-without-body" // textPreview 为空 → 对方看不到原文
  | "doc-without-chunks"
  | "orphan-units" // 概念指向包外文档
  | "orphan-relations"; // 关系端点缺一

export interface PackWarning {
  kind: PackWarningKind;
  count: number;
}

export interface PackBuild {
  json: string;
  file: KnowledgePackFile;
  warnings: PackWarning[];
  /**
   * UTF-8 字节数 —— **全链路唯一的体积口径**（导入前置拒、落盘提示、拉取预检共用）。
   * ⚠️ 与 `PackCounts.chars`（各 `textPreview.length` 之和，只用于「正文规模」展示）
   * **不是同一把尺子**：前者含 JSON 结构开销且非 ASCII 按多字节计，后者是纯字符数。
   * 二者都保留，但**判定一律用 `bytes`**。
   */
  bytes: number;
}

/** 同名警告累加计数（同一份资料多次触发 → 一条 count+N，UI 不必去重）。 */
function bump(list: PackWarning[], kind: PackWarningKind, count = 1): void {
  const found = list.find((w) => w.kind === kind);
  if (found) found.count += count;
  else list.push({ kind, count });
}

/**
 * 剥隐私：本机绝对路径（`path`）与指向本机目标的关联（`goalIds`）**一律不进包**。
 * 其余字段原样带出（`uri` 若指向公网是可溯源信息，保留）。
 */
function sanitizeDocument(doc: SourceDocument): SourceDocument {
  const { path: _path, goalIds: _goalIds, ...rest } = doc;
  return rest;
}

/** 溯源引用：只用 `title` / `format` / `source` / `uri`（**无 `path`**）。 */
function packSourceRefOf(doc: SourceDocument): PackSourceRef {
  const ref: PackSourceRef = { title: doc.title, format: doc.format };
  if (doc.source !== undefined) ref.source = doc.source;
  if (doc.uri !== undefined) ref.uri = doc.uri;
  return ref;
}

/**
 * 是否含 AI 派生内容（概览 / 要点 / 概念任一存在）。
 *
 * 诚实口径：导入方据此知道「要点不是自己跑的」，而不是把别人的 AI 结论当成自己的。
 */
function hasAiDerived(data: PackData): boolean {
  if (data.knowledgeUnits.length > 0) return true;
  if (data.documents.some((d) => d.overview !== undefined)) return true;
  for (const list of Object.values(data.chaptersByDocument)) {
    if (list.some((c) => (c.keyPoints?.length ?? 0) > 0)) return true;
  }
  return false;
}

/**
 * 收集选中资料 → 打成包。
 *
 * **收集顺序（确定性，便于 round-trip 深比较）**：
 * 选中的 documents（按 selection 顺序）→ 逐文档 chapters（已按 order 排）→ sections
 * → 逐文档 chunks → 概念与关系。
 *
 * `counts` 由 `countsOfPack(data)` 在**同一次读取**上算出（唯一真源）；`bytes` 由
 * **同一份 `json`** 量出 —— 两者都不得另起一次读取。
 */
export async function buildPack(storage: StorageAdapter, sel: PackSelection): Promise<PackBuild> {
  const byId = new Map((await storage.listDocuments()).map((d) => [d.id, d]));

  const documents: SourceDocument[] = [];
  const chaptersByDocument: Record<string, Chapter[]> = {};
  const sections: Section[] = [];
  const chunks: Chunk[] = [];
  const warnings: PackWarning[] = [];

  for (const id of sel.documentIds) {
    const doc = byId.get(id);
    if (doc === undefined) continue; // 已被并发删除 → 跳过（不崩）
    if (!doc.textPreview?.length) bump(warnings, "doc-without-body");
    documents.push(sanitizeDocument(doc)); // ← 删 path / goalIds

    const chapters = await storage.listChapters(doc.id);
    chaptersByDocument[doc.id] = chapters;
    const perChapter = await Promise.all(chapters.map((c) => storage.listSections(c.id)));
    for (const list of perChapter) sections.push(...list);

    const docChunks = await storage.listChunksByDocument(doc.id);
    if (docChunks.length === 0) bump(warnings, "doc-without-chunks");
    chunks.push(...docChunks);
  }

  // 全量读 → 过滤到选中范围。⚠️ `listKnowledgeUnits(documentId)` 其实支持按文档过滤，
  // 这里仍取全量：过滤条件是「概念属于包内文档」，需要看到全量集合才能同时算出
  // 「包外概念」的量（`orphan-units` 的判据），且与 F4 `collectSnapshot` 的读取口径同源。
  const docIdSet = new Set(documents.map((d) => d.id));
  const allUnits = await storage.listKnowledgeUnits();
  const knowledgeUnits: KnowledgeUnit[] = allUnits.filter(
    (u) => u.sourceDocumentId !== undefined && docIdSet.has(u.sourceDocumentId),
  );
  // ⚠️ 包外概念**不**发警告：用户没选那份资料，它的概念不进包是**预期行为**，
  // 不是缺陷。`orphan-units` 枚举保留给将来「包内章节引用了包外概念」这类真问题。
  const unitIdSet = new Set(knowledgeUnits.map((u) => u.id));
  const allRelations: KnowledgeRelation[] = await storage.listRelations();
  const knowledgeRelations = allRelations.filter(
    (r) => unitIdSet.has(r.fromId) && unitIdSet.has(r.toId),
  );
  if (allRelations.length !== knowledgeRelations.length) {
    bump(warnings, "orphan-relations", allRelations.length - knowledgeRelations.length);
  }

  const data: PackData = {
    documents,
    chaptersByDocument,
    sections,
    chunks,
    knowledgeUnits,
    knowledgeRelations,
  };
  const counts = countsOfPack(data); // ← 唯一真源（同一次读取）
  const manifest: PackManifest = {
    title: sel.manifest.title.trim(),
    ...(sel.manifest.description?.trim()
      ? { description: sel.manifest.description.trim().slice(0, 200) }
      : {}),
    ...(sel.manifest.author?.trim() ? { author: sel.manifest.author.trim().slice(0, 60) } : {}),
    ...(sel.manifest.license ? { license: sel.manifest.license } : {}),
    sources: documents.map((d) => packSourceRefOf(d)), // 只用 title/format/source/uri（无 path）
    aiDerived: hasAiDerived(data), // overview / keyPoints / units 任一存在
    contentHash: contentHashOf(data),
  };
  const file: KnowledgePackFile = {
    kind: PACK_KIND,
    packVersion: PACK_VERSION,
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    manifest,
    counts,
    data,
  };
  const json = JSON.stringify(file);
  // 唯一的体积计量点：与导入侧前置拒、UI 文案共用同一口径（D7「一把尺子」）
  const bytes = utf8BytesOf(json);
  // ⚠️ 容量可选（D16）：`undefined` = 本后端不设应用层上限（桌面端）→ 无警告。
  const capacity = storage.storeCapacityBytes;
  if (capacity !== undefined && bytes > capacity) bump(warnings, "too-large"); // 仅提示，不阻断
  return { json, file, warnings, bytes };
}
