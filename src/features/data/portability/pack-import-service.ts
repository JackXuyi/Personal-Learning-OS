/**
 * 知识包导入服务 —— `KnowledgePackFile` → 本机库（F10 · 方案 §4.3.2 / §4.3.4 / §8.5）。
 *
 * 与 F4 备份导入的**三条共同口径**（刻意一致，不许分叉）：
 *  1. `counts` / 统计一律由**同一次读取**派生，不另起一次 `storage.listXxx()`；
 *  2. 末尾 `saveGraph(库内全量)` 收口 —— tauri 的 `saveGraph` 带 diff-delete，
 *     只写「包里那部分概念」会把本机独有概念删掉；
 *  3. quota 分类复用 F4 的 `isQuotaError`。
 *
 * 与 F4 备份导入的**三条刻意差异**：
 *  1. **不调 `clearAll`** —— 包是「加内容」，不是「换整库」；
 *  2. **不碰任何个人实体**（学习状态 / 画像 / 证据 / 笔记 / 卡片 / 试卷 / 目标）；
 *  3. **外来学习状态一律丢弃**（D5）：`Chapter.status` 统一重置 `not-started`，
 *     并把丢弃条数如实报给用户，而不是「悄悄重置」。
 */
import { newId } from "../../../domain";
import type {
  Chapter,
  Chunk,
  KnowledgeRelation,
  KnowledgeUnit,
  Section,
  SourceDocument,
} from "../../../domain";
import type { StorageAdapter } from "../../../storage/types";
import { isQuotaError } from "./import-service";
import { parsePack } from "./pack-format";
import type { PackData, PackErrorKind } from "./pack-format";

export interface PackIdMap {
  documents: Map<string, string>;
  chapters: Map<string, string>;
  sections: Map<string, string>;
  chunks: Map<string, string>;
  units: Map<string, string>;
}

export interface RemapResult {
  data: PackData;
  map: PackIdMap;
  /** 被置空 / 丢弃的外键数（父级不在包内 → 置 `undefined` 而非留悬空）。 */
  danglingCleared: number;
  /** 端点缺一被整条丢弃的关系数。 */
  relationsDropped: number;
  /** 被丢弃的外来章节学习状态条数（D5；= 包内非 `not-started` 的章数）。 */
  foreignProgressDropped: number;
}

export interface PackImportOptions {
  /** id 生成器可注入（单测固定），默认 `newId`。 */
  idGen?: (prefix: string) => string;
  /** 来源（链接拉取时填；本地文件缺省）。 */
  sourceUrl?: string;
  /** 时间基准（入口注入一次；本模块不自己取 `Date.now()`）。 */
  now: number;
  /**
   * 是否允许在 Web Worker 内 `JSON.parse`（②，默认按体积自动决定）。
   * **node 单测必须显式传 `false`**：`tests/*.test.ts` 直跑于 node，无 Web Worker。
   */
  parseInWorker?: boolean;
}

export interface PackImportStats {
  packTitle: string;
  contentHash: string;
  documents: number;
  chapters: number;
  sections: number;
  chunks: number;
  knowledgeUnits: number;
  knowledgeRelations: number;
  /** 新资料 id（供 UI 跳转与溯源记录）。 */
  importedDocumentIds: string[];
  /** 被丢弃的外来章节学习状态条数（D5；= 包内非 `not-started` 的章数）。 */
  foreignProgressDropped: number;
  /** 被置空的外键数。 */
  danglingCleared: number;
  /** 悬空关系被丢弃条数。 */
  relationsDropped: number;
}

export type PackImportErrorKind =
  | PackErrorKind
  | "too-large-for-store" // ③ 前置容量拒：bytes > storage.storeCapacityBytes（D7）
  | "write-failed"
  | "quota";

export type PackImportOutcome =
  | { ok: true; stats: PackImportStats }
  | { ok: false; kind: PackImportErrorKind; detail?: string; partial?: Partial<PackImportStats> };

/**
 * id 重映射 —— **两遍法**：先建全量映射表，再统一重写外键。
 *
 * ⚠️ 一遍法会出现「引用了一个还没生成的 id」（概念关系 / 章节的 `unitIds` 都指向
 * 同批其它实体）。因此映射表必须**先全部建好**再改写。
 *
 * ⚠️ **偏移字段一律不动**（`contentRef` / `KeyPointRef.start-end` /
 * `ConceptEvidence.start-end`）：它们都是**相对 `doc.textPreview` 的字符偏移**，
 * 而正文随包原样带入 → 偏移仍然成立。若哪天决定「包内只带章节不带全文」，
 * 这些偏移必须一并作废（否则出现「引文指向不存在的正文」）。
 */
export function remapPackIds(data: PackData, idGen: (prefix: string) => string): RemapResult {
  // ===== pass 1：建表 =====
  const map: PackIdMap = {
    documents: new Map(),
    chapters: new Map(),
    sections: new Map(),
    chunks: new Map(),
    units: new Map(),
  };
  for (const d of data.documents) map.documents.set(d.id, idGen("doc"));
  for (const list of Object.values(data.chaptersByDocument)) {
    for (const c of list) map.chapters.set(c.id, idGen("ch"));
  }
  for (const s of data.sections) map.sections.set(s.id, idGen("sec"));
  for (const c of data.chunks) map.chunks.set(c.id, idGen("ck"));
  for (const u of data.knowledgeUnits) map.units.set(u.id, idGen("ku"));

  // ===== pass 2：重写 =====
  let danglingCleared = 0;
  /** 查表；原值为 `undefined` → 静默返回（不算悬空）；查不到 → 计数并返回 `undefined`。 */
  const pick = (m: Map<string, string>, id?: string): string | undefined => {
    if (id === undefined) return undefined;
    const next = m.get(id);
    if (next === undefined) {
      danglingCleared += 1;
      return undefined;
    }
    return next;
  };

  // 资料：重映射 id，并**再剥一次** path / goalIds（导入侧不信任包内容）
  const documents: SourceDocument[] = data.documents.map((d) => {
    const { path: _path, goalIds: _goalIds, ...rest } = d;
    return { ...rest, id: map.documents.get(d.id)! };
  });

  // 章节：unitIds 过滤到包内；status 重置（D5）
  let foreignProgressDropped = 0;
  const chaptersByDocument: Record<string, Chapter[]> = {};
  for (const [oldDocId, list] of Object.entries(data.chaptersByDocument)) {
    const newDocId = map.documents.get(oldDocId);
    if (newDocId === undefined) {
      danglingCleared += list.length; // 父资料不在包内 → 整组章节作废
      continue;
    }
    chaptersByDocument[newDocId] = list.map((c) => {
      if (c.status !== "not-started") foreignProgressDropped += 1;
      return {
        ...c,
        id: map.chapters.get(c.id)!,
        documentId: newDocId,
        unitIds: c.unitIds.map((u) => pick(map.units, u)).filter((x): x is string => x !== undefined),
        status: "not-started" as const, // D5：原作者的学习状态一律丢弃
      };
    });
  }

  // 分节：父级（章 / 资料）缺一 → 整条丢弃
  const sections: Section[] = [];
  for (const s of data.sections) {
    const chapterId = pick(map.chapters, s.chapterId);
    const documentId = pick(map.documents, s.documentId);
    if (chapterId === undefined || documentId === undefined) continue;
    sections.push({ ...s, id: map.sections.get(s.id)!, chapterId, documentId });
  }

  // 切片：父级缺一 → 整条丢弃；`sectionId` 不在包内 → **置 undefined 而不丢 chunk**
  const chunks: Chunk[] = [];
  for (const c of data.chunks) {
    const documentId = pick(map.documents, c.documentId);
    const chapterId = pick(map.chapters, c.chapterId);
    if (documentId === undefined || chapterId === undefined) continue;
    chunks.push({
      ...c,
      id: map.chunks.get(c.id)!,
      documentId,
      chapterId,
      sectionId: pick(map.sections, c.sectionId),
      knowledgeIds: c.knowledgeIds
        .map((k) => pick(map.units, k))
        .filter((x): x is string => x !== undefined),
    });
  }

  // 概念：`sourceDocumentId` 不在包内 → 置 undefined（**不删概念**）；
  // `evidence.documentId` 不在包内 → 整块 evidence 丢弃（引用指向不存在的正文，留着是错数据）
  const knowledgeUnits: KnowledgeUnit[] = data.knowledgeUnits.map((u) => {
    const sourceDocumentId = pick(map.documents, u.sourceDocumentId);
    let evidence = u.evidence;
    if (evidence !== undefined) {
      const docId = pick(map.documents, evidence.documentId);
      evidence = docId === undefined ? undefined : { ...evidence, documentId: docId };
    }
    return { ...u, id: map.units.get(u.id)!, sourceDocumentId, evidence };
  });

  // 关系：端点缺一 → **整条丢弃**并计数（悬空关系无意义）
  const relations: KnowledgeRelation[] = [];
  for (const r of data.knowledgeRelations) {
    const fromId = map.units.get(r.fromId);
    const toId = map.units.get(r.toId);
    if (fromId === undefined || toId === undefined) continue;
    relations.push({ ...r, id: idGen("kr"), fromId, toId });
  }

  return {
    data: {
      documents,
      chaptersByDocument,
      sections,
      chunks,
      knowledgeUnits,
      knowledgeRelations: relations,
    },
    map,
    danglingCleared,
    relationsDropped: data.knowledgeRelations.length - relations.length,
    foreignProgressDropped,
  };
}

/**
 * 导入一个知识包。
 *
 * **写入顺序（本体 → 关联；无外键约束，顺序只为日志可读）**：
 * ① `parsePack`（文件层判定 + 格式校验，失败 → **零写入**）→ ② ③ 容量前置拒
 * （仍在**零写入**阶段）→ `remapPackIds`（纯函数）→ 逐实体写入 → `saveGraph` 收口。
 *
 * ⚠️ **前置拒（③）必须发生在任何写入之前** —— 否则「装不下」会在写到一半时才暴露，
 * 留下半份包在库里。判空写在条件里，**不要**用 `?? 0` 兜底（那会让「没有这条线」
 * 变成「零容量」，一条包都导不进来）。
 */
export async function importPack(
  storage: StorageAdapter,
  raw: string,
  opts: PackImportOptions,
): Promise<PackImportOutcome> {
  const parsed = await parsePack(raw, { parseInWorker: opts.parseInWorker });
  if (!parsed.ok) return { ok: false, kind: parsed.kind, detail: parsed.detail };

  // ③ 容量层前置拒 —— 仍在**零写入**阶段。
  // ⚠️ `storeCapacityBytes` 是**可选**的（D16）：`undefined` = 本后端不设应用层
  //    容量上限（桌面端）→ **整步跳过**。数字只从 `storage` 读，服务层不写死。
  const capacity = storage.storeCapacityBytes;
  if (capacity !== undefined && parsed.bytes > capacity) {
    return { ok: false, kind: "too-large-for-store", detail: `${parsed.bytes}>${capacity}` };
  }

  const idGen = opts.idGen ?? newId;
  const { data, danglingCleared, relationsDropped, foreignProgressDropped } = remapPackIds(
    parsed.file.data,
    idGen,
  );

  const stats: PackImportStats = {
    packTitle: parsed.file.manifest.title,
    contentHash: parsed.file.manifest.contentHash,
    documents: 0,
    chapters: 0,
    sections: 0,
    chunks: 0,
    knowledgeUnits: 0,
    knowledgeRelations: 0,
    importedDocumentIds: [],
    foreignProgressDropped,
    danglingCleared,
    relationsDropped,
  };

  try {
    for (const doc of data.documents) {
      await storage.saveDocument(doc);
      stats.documents += 1;
      stats.importedDocumentIds.push(doc.id);
    }
    for (const [documentId, chapters] of Object.entries(data.chaptersByDocument)) {
      await storage.saveChapters(documentId, chapters);
      stats.chapters += chapters.length;
    }
    if (data.sections.length) {
      await storage.saveSections(data.sections);
      stats.sections = data.sections.length;
    }
    if (data.chunks.length) {
      await storage.saveChunks(data.chunks);
      stats.chunks = data.chunks.length;
    }
    if (data.knowledgeUnits.length) {
      await storage.saveKnowledgeUnits(data.knowledgeUnits);
      stats.knowledgeUnits = data.knowledgeUnits.length;
    }
    if (data.knowledgeRelations.length) {
      await storage.saveRelations(data.knowledgeRelations);
      stats.knowledgeRelations = data.knowledgeRelations.length;
    }

    // 收口：库内**全量**（tauri 的 saveGraph 带 diff-delete，只写包内会删掉本机独有概念）
    await storage.saveGraph({
      units: await storage.listKnowledgeUnits(),
      relations: await storage.listRelations(),
    });
  } catch (err) {
    const partial: Partial<PackImportStats> = {
      ...stats,
      importedDocumentIds: [...stats.importedDocumentIds],
    };
    return isQuotaError(err)
      ? { ok: false, kind: "quota", partial }
      : { ok: false, kind: "write-failed", detail: String(err), partial };
  }
  return { ok: true, stats };
}
