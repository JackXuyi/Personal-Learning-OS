/**
 * 导出服务 —— `StorageAdapter` 全量快照 → `BackupFile`（方案 §4.3.3 / §8.8）。
 *
 * 纯编排：只调 `StorageAdapter` 的公开方法，**不绕过适配器去读 localStorage /
 * SQLite 原文**（分层约束：UI → stores/storage）。不产出用户文案（只回数字与
 * 分类），文案由 UI 经 i18n 映射。
 *
 * ⚠️ 遍历式收集的原因：接口层**没有** `listAllSections()` / `listAllChunks()` /
 * `listAllRestatements()` / `listAllAnnotations()`，这些读取入口都带维度参数
 * （chapterId / documentId）→ 只能从文档 / 章 / 目标逐层往下收集。不要为了
 * 「看起来整齐」去新增全量接口。
 */
import type { Embedding } from "../../../domain";
import type { StorageAdapter } from "../../../storage/types";
import { APP_VERSION, BACKUP_KIND, EXPORT_VERSION, countsOf } from "./backup-format";
import type { BackupData, BackupFile } from "./backup-format";

/**
 * 一次读取的产物：`data` + 三类**可观测**孤儿计数。
 *
 * 三者必须来自同一次遍历 —— 拆成两个函数就会各读一遍库，正是 F2「两把尺子」
 * 的同类陷阱（结果面板的数字与实际内容不一致）。
 */
export interface Snapshot {
  data: BackupData;
  /** `sourceDocumentId` 指向已不存在的文档的概念数。 */
  orphanUnits: number;
  /** 端点（`fromId` / `toId`）指不到任何概念的关系数。 */
  orphanRelations: number;
  /** `targetId` 指不到任何 chunk 的 chunk 向量元数据条数。 */
  orphanEmbeddings: number;
}

/**
 * 孤儿总数（结果面板展示用）。
 *
 * ⚠️ 口径边界（诚实声明）：接口层没有全量 sections / chunks 入口，**孤儿
 * Section / Chunk 在导出侧不可观测**（它们的父级被删后，逐层遍历根本走不到
 * 它们）。因此这里只数「读了全量表、能算出指向失效」的三类。导出侧不清理、
 * 不阻止导出（清理涉 FTS 与向量级联，另案决策）。
 */
export function orphanTotal(s: Snapshot): number {
  return s.orphanUnits + s.orphanRelations + s.orphanEmbeddings;
}

/**
 * 全量快照（导出与 replace 前置的自动预备份**共用同一个**收集口径）。
 *
 * 遍历顺序见方案 §4.3.3；结果顺序确定性（父级顺序 → 子级顺序），便于
 * round-trip 单测做逐字段深比较。
 */
export async function collectSnapshot(storage: StorageAdapter): Promise<Snapshot> {
  const documents = await storage.listDocuments();

  const chaptersByDocument: BackupData["chaptersByDocument"] = {};
  const sections: BackupData["sections"] = [];
  const restatements: BackupData["restatements"] = [];
  const chunks: BackupData["chunks"] = [];
  const annotations: BackupData["annotations"] = [];

  for (const doc of documents) {
    const chapters = await storage.listChapters(doc.id);
    chaptersByDocument[doc.id] = chapters;
    // 章级子实体并行取（同一文档内互不依赖），结果按章顺序拼接 → 顺序确定。
    const [chapterSections, chapterRestatements] = await Promise.all([
      Promise.all(chapters.map((c) => storage.listSections(c.id))),
      Promise.all(chapters.map((c) => storage.listRestatements(c.id))),
    ]);
    for (const list of chapterSections) sections.push(...list);
    for (const list of chapterRestatements) restatements.push(...list);
    // 文档级子实体
    chunks.push(...(await storage.listChunksByDocument(doc.id)));
    annotations.push(...(await storage.listAnnotations(doc.id)));
  }

  // 全量读取的三类（不传维度参数 = 全量）
  const knowledgeUnits = await storage.listKnowledgeUnits();
  const knowledgeRelations = await storage.listRelations();
  // ⚠️ D4：默认**不含向量本体**。读路径本就不回传 vector，这里再显式剥一次，
  // 保证「无论哪个适配器实现都不把 MB 级向量带进包」。
  const embeddings: Embedding[] = (await storage.listEmbeddings()).map(
    ({ vector: _vector, ...meta }) => meta,
  );

  const papers = await storage.listPapers();
  const paperDrafts: BackupData["paperDrafts"] = {};
  for (const paper of papers) {
    const draft = await storage.getPaperDraft(paper.id);
    // 无草稿 → 跳过（不写空对象，避免导入侧把「没作答」当成「作答为空」）。
    if (draft !== undefined) paperDrafts[paper.id] = draft;
  }

  const goals = await storage.listGoals();
  const capabilityItems: BackupData["capabilityItems"] = {};
  const capabilityRuns: BackupData["capabilityRuns"] = [];
  const capabilityReports: BackupData["capabilityReports"] = [];
  for (const goal of goals) {
    capabilityItems[goal.id] = await storage.listCapabilityItems(goal.id);
    capabilityRuns.push(...(await storage.listCapabilityRuns(goal.id)));
    capabilityReports.push(...(await storage.listCapabilityReports(goal.id)));
  }

  const data: BackupData = {
    documents,
    chaptersByDocument,
    sections,
    chunks,
    knowledgeUnits,
    knowledgeRelations,
    embeddings,
    papers,
    paperDrafts,
    paperResults: await storage.listPaperResults(),
    learnerState: await storage.getLearnerState(),
    ...(await attachProfile(storage)),
    restatements,
    cardStates: await storage.listCardStates(),
    annotations,
    goals,
    evidence: await storage.listEvidence(),
    capabilityItems,
    capabilityRuns,
    capabilityReports,
  };

  // 孤儿检测：用全量表与「遍历收集到的父级 id 集合」做差集。
  const docIds = new Set(documents.map((d) => d.id));
  const unitIds = new Set(knowledgeUnits.map((u) => u.id));
  const chunkIds = new Set(chunks.map((c) => c.id));

  return {
    data,
    orphanUnits: knowledgeUnits.filter(
      (u) => u.sourceDocumentId !== undefined && !docIds.has(u.sourceDocumentId),
    ).length,
    orphanRelations: knowledgeRelations.filter(
      (r) => !unitIds.has(r.fromId) || !unitIds.has(r.toId),
    ).length,
    orphanEmbeddings: embeddings.filter(
      (e) => e.targetType === "chunk" && !chunkIds.has(e.targetId),
    ).length,
  };
}

/** 画像是可缺省字段：`undefined` 时不写这个 key（语义 = 本机从未填写）。 */
async function attachProfile(
  storage: StorageAdapter,
): Promise<Pick<BackupData, "profile"> | Record<string, never>> {
  const profile = await storage.getProfile();
  return profile === undefined ? {} : { profile };
}

/** 导出结果：JSON 文本 + 结构化文件对象（UI 展示 counts/文件名用）+ 孤儿数。 */
export interface ExportOutcome {
  json: string;
  file: BackupFile;
  snapshot: Snapshot;
}

/**
 * 全量导出。
 *
 * `counts` 由 `countsOf(data)` 从**同一次读取**的 data 派生（不变量 1），
 * 绝不允许另起一次 `storage.listXxx()` 去填。
 * `JSON.stringify` **不做 pretty-print**（体积优先；备份是给程序读的，
 * 需要人看时用编辑器格式化即可）。
 */
export async function exportBackup(storage: StorageAdapter): Promise<ExportOutcome> {
  const snapshot = await collectSnapshot(storage);
  const file: BackupFile = {
    kind: BACKUP_KIND,
    exportVersion: EXPORT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    backend: storage.name,
    counts: countsOf(snapshot.data),
    data: snapshot.data,
  };
  return { json: JSON.stringify(file), file, snapshot };
}
