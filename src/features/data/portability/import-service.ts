/**
 * 导入服务 —— `BackupFile` → `StorageAdapter` 写入（方案 §4.3.4 / §8.9）。
 *
 * 四件事必须同时成立，缺一条就是静默数据问题：
 *  1. **校验在 `clearAll()` 之前**：损坏 / 跨版本文件必须零写入（UC-06）；
 *  2. **整批 / 单体语义实体的合并规则显式化**（`saveChapters` / `saveLearnerState`
 *     / `saveCapabilityItems` 都是整体覆盖，直接写会吃掉本机独有内容）；
 *  3. **最后回写一次 `saveGraph(库内全量)`**：`local` 后端 `getGraph()` 读的是
 *     `plos.graph` blob，不回写就会出现「概念图看旧图、检索用新概念」；`tauri`
 *     后端的 `saveGraph` 含 diff-delete，只写「导入那部分」会删掉本机独有概念。
 *     写全量则一条规则同时满足 merge（diff 为空）与 replace（补空库）；
 *  4. **`saveProfile(undefined)` 是「清除」语义** —— 备份里画像缺失时绝不调用。
 */
import type { UnitMastery } from "../../../domain";
import type { StorageAdapter } from "../../../storage/types";
import type { BackupData, BackupErrorKind, EntityCounts } from "./backup-format";
import { migrateBackup, parseBackup } from "./backup-format";
import { exportBackup } from "./export-service";

/** 实际写入条数（键与 `EntityCounts` 同名 → UI 可复用同一套标签）。 */
export type WrittenCounts = Partial<EntityCounts>;

/** 导入结果统计（UI 必须逐项展示，不允许「完成了」三个字了事）。 */
export interface ImportStats {
  mode: "merge" | "replace";
  written: WrittenCounts;
  /** merge 下同 id 冲突且**保留本机**的学习进度条数。 */
  learnerStateKept: number;
  /** 被备份侧覆盖的自测卡调度状态条数。 */
  cardStatesOverwritten: number;
  /** 去重跳过的证据条数。 */
  evidenceSkipped: number;
  /**
   * 被证据上限（`EVIDENCE_LOG_MAX`，5000）裁掉的条数。
   *
   * ⚠️ 为什么必须报出来：`appendEvidence` 溢出丢最旧是**既有语义**，但导入 6000 条
   * 后库内只有 5000 条而界面只说「写入 6000」就是自相矛盾的展示。这个数字由
   * 「导入前条数 + 实际追加条数 − 导入后条数」算出，不重写上限常量（口径唯一来源
   * 仍是 `storage/memory.ts::EVIDENCE_LOG_MAX`）。
   */
  evidenceDropped: number;
  /** 指不到上下文的孤儿（文件内父级缺失）条数，**只计数不重建**。 */
  orphansSkipped: number;
  /** replace 前的自动预备份绝对路径（桌面端才有）。 */
  preBackupPath?: string;
}

/** 导入失败分类（`backup-format` 的分类 + 两个本层专有分类）。 */
export type ImportErrorKind = BackupErrorKind | "sqlite-blocked" | "write-failed" | "quota";

export type ImportOutcome =
  | { ok: true; stats: ImportStats }
  | {
      ok: false;
      kind: ImportErrorKind;
      detail?: string;
      /** 写入中途失败的**已完成部分**（UI 据此说「已写入 X/Y」而不是沉默）。 */
      partial?: ImportStats;
    };

export interface ImportOptions {
  mode: "merge" | "replace";
  /**
   * replace 前自动导出预备份（桌面端注入 `backupSave`；纯浏览器不注入
   * → 由 UI 要求用户勾选「我已自行备份」，**不假装能自动备份**）。
   */
  preBackup?: (json: string) => Promise<string | undefined>;
}

/**
 * 导入备份。
 *
 * 写入顺序（本体 → 关联；无外键约束，顺序只为排障时日志可读）：
 * documents → chapters → sections → chunks → papers/drafts/results →
 * knowledgeUnits/relations/embeddings → learnerState → profile → restatements →
 * cardStates → annotations → goals → evidence → capability* → `saveGraph` 收口。
 */
export async function importBackup(
  storage: StorageAdapter,
  raw: string,
  opts: ImportOptions,
): Promise<ImportOutcome> {
  const parsed = parseBackup(raw);
  if (!parsed.ok) return { ok: false, kind: parsed.kind, detail: parsed.detail };
  const migrated = migrateBackup(parsed.file);
  if (!migrated.ok) return { ok: false, kind: migrated.kind };
  const data = migrated.file.data;

  const stats: ImportStats = {
    mode: opts.mode,
    written: {},
    learnerStateKept: 0,
    cardStatesOverwritten: 0,
    evidenceSkipped: 0,
    evidenceDropped: 0,
    orphansSkipped: 0,
  };

  if (opts.mode === "replace") {
    if (opts.preBackup) {
      // 预备份内容与「导出」同源（同一个 collectSnapshot），不另写一套口径。
      try {
        const { json } = await exportBackup(storage);
        stats.preBackupPath = await opts.preBackup(json);
      } catch {
        // 预备份失败不阻断：它是安全网，不是前置条件（用户已二次确认）。
        stats.preBackupPath = undefined;
      }
    }
    try {
      await storage.clearAll();
    } catch (err) {
      // ⚠️ 明确分类，**不假装成功**：此时数据未改动（tauri 侧先清 SQLite）。
      return { ok: false, kind: "sqlite-blocked", detail: String(err) };
    }
  }

  try {
    await writeBackup(storage, data, stats);
  } catch (err) {
    const partial: ImportStats = { ...stats, written: { ...stats.written } };
    if (isQuotaError(err)) return { ok: false, kind: "quota", partial };
    return { ok: false, kind: "write-failed", detail: String(err), partial };
  }

  return { ok: true, stats };
}

/* ------------------------------------------------------------------ */
/* 写入实现                                                            */
/* ------------------------------------------------------------------ */

async function writeBackup(
  storage: StorageAdapter,
  data: BackupData,
  stats: ImportStats,
): Promise<void> {
  const bump = (key: keyof EntityCounts, n = 1): void => {
    stats.written[key] = (stats.written[key] ?? 0) + n;
  };

  // ===== 文档 =====
  for (const doc of data.documents) {
    await storage.saveDocument(doc);
    bump("documents");
  }

  // ===== 章（整批覆盖语义 → merge 时必须先读本地再合并）=====
  for (const [documentId, incoming] of Object.entries(data.chaptersByDocument)) {
    const local = await storage.listChapters(documentId);
    const merged = mergeById(local, incoming);
    await storage.saveChapters(documentId, merged);
    bump("chapters", incoming.length);
  }

  // ===== 层级子实体（孤儿只计数不重建，见 §4.3.3）=====
  const docIds = new Set(data.documents.map((d) => d.id));
  const chapterIds = new Set(
    Object.values(data.chaptersByDocument).flatMap((list) => list.map((c) => c.id)),
  );

  const sections = data.sections.filter((s) => keep(s.chapterId, chapterIds, stats));
  if (sections.length > 0) {
    await storage.saveSections(sections);
    bump("sections", sections.length);
  }

  const chunks = data.chunks.filter((c) => keep(c.documentId, docIds, stats));
  if (chunks.length > 0) {
    await storage.saveChunks(chunks);
    bump("chunks", chunks.length);
  }

  // ===== 试卷 / 草稿 / 判卷结果 =====
  for (const paper of data.papers) {
    await storage.savePaper(paper);
    bump("papers");
  }
  for (const [paperId, answers] of Object.entries(data.paperDrafts)) {
    await storage.savePaperDraft(paperId, answers);
    bump("paperDrafts");
  }
  for (const result of data.paperResults) {
    await storage.savePaperResult(result);
    bump("paperResults");
  }

  // ===== 概念层（不在这里 saveGraph：由末尾统一收口）=====
  if (data.knowledgeUnits.length > 0) {
    await storage.saveKnowledgeUnits(data.knowledgeUnits);
    bump("knowledgeUnits", data.knowledgeUnits.length);
  }
  if (data.knowledgeRelations.length > 0) {
    await storage.saveRelations(data.knowledgeRelations);
    bump("knowledgeRelations", data.knowledgeRelations.length);
  }
  if (data.embeddings.length > 0) {
    await storage.saveEmbeddings(data.embeddings);
    bump("embeddings", data.embeddings.length);
  }

  // ===== 学习进度（单体覆盖语义 → 逐单元按时间戳取胜）=====
  const localState = await storage.getLearnerState();
  const byUnit: Record<string, UnitMastery> = { ...localState.byUnit };
  for (const [unitId, incoming] of Object.entries(data.learnerState.byUnit ?? {})) {
    const existing = byUnit[unitId];
    // 本机无 → 取导入；两边都有 → 取较新的一侧；时间戳相等或都缺失 → 保留本机。
    if (existing === undefined) {
      byUnit[unitId] = incoming;
      bump("learnerUnits");
      continue;
    }
    if (reviewStamp(incoming) > reviewStamp(existing)) {
      byUnit[unitId] = incoming;
      bump("learnerUnits");
    } else {
      stats.learnerStateKept += 1;
    }
  }
  await storage.saveLearnerState({ byUnit });

  // ===== 画像（⚠️ undefined 绝不调用 saveProfile —— 那是「清除」语义）=====
  if (data.profile !== undefined) {
    await storage.saveProfile(data.profile);
    bump("profile");
  }

  // ===== 复述 / 自测卡 / 划线 =====
  const restatements = data.restatements.filter((r) => keep(r.chapterId, chapterIds, stats));
  for (const record of restatements) {
    await storage.saveRestatement(record);
    bump("restatements");
  }

  const localCards = await storage.listCardStates();
  for (const card of Object.values(data.cardStates)) {
    if (localCards[card.cardId] !== undefined) stats.cardStatesOverwritten += 1;
    await storage.saveCardState(card);
    bump("cardStates");
  }

  const annotations = data.annotations.filter((a) => keep(a.documentId, docIds, stats));
  for (const annotation of annotations) {
    await storage.saveAnnotation(annotation);
    bump("annotations");
  }

  // ===== 目标 =====
  for (const goal of data.goals) {
    await storage.saveGoal(goal);
    bump("goals");
  }

  // ===== 证据（去重后按 at 升序追加：顺序影响 5000 上限的裁剪结果）=====
  const localEvidence = await storage.listEvidence();
  const seen = new Set(localEvidence.map(evidenceKey));
  const incomingEvidence = [...data.evidence].sort((a, b) => a.at - b.at);
  let appended = 0;
  for (const entry of incomingEvidence) {
    const key = evidenceKey(entry);
    if (seen.has(key)) {
      stats.evidenceSkipped += 1;
      continue;
    }
    seen.add(key);
    await storage.appendEvidence(entry);
    appended += 1;
    bump("evidence");
  }
  // 溢出裁剪由基类的 appendEvidence 决定（不在这里重写上限常量）；只把差额如实报出。
  const evidenceAfter = (await storage.listEvidence()).length;
  stats.evidenceDropped = Math.max(0, localEvidence.length + appended - evidenceAfter);

  // ===== 能力评测（清单是「一个目标一份」的强绑定 → 目标级整批覆盖）=====
  for (const [goalId, items] of Object.entries(data.capabilityItems)) {
    // ⚠️ 空清单**不写**：`saveCapabilityItems(goalId, [])` 是「清空该目标清单」语义，
    // 而备份里「该目标没有清单」应当理解为「本机有而备份无 → 保留本机」
    // （方案 §4.3.4）。replace 模式下本机清单已被 clearAll 清掉，跳过等价于写入空。
    if (items.length === 0) continue;
    await storage.saveCapabilityItems(goalId, items);
    bump("capabilityItems", items.length);
  }
  for (const run of data.capabilityRuns) {
    await storage.saveCapabilityRun(run);
    bump("capabilityRuns");
  }
  for (const report of data.capabilityReports) {
    await storage.saveCapabilityReport(report);
    bump("capabilityReports");
  }

  // ===== 收口：概念图以「库内全量」回写一次 =====
  // merge：diff 为空（刚 upsert 过，不误删本机独有概念）；
  // replace：把被清空的图补成导入内容。一条规则覆盖两种模式，无需分支。
  await storage.saveGraph({
    units: await storage.listKnowledgeUnits(),
    relations: await storage.listRelations(),
  });
}

/** 孤儿过滤：父级不在文件里 → 跳过并计数（不重建、不抛错）。 */
function keep(parentId: string, known: Set<string>, stats: ImportStats): boolean {
  if (known.has(parentId)) return true;
  stats.orphansSkipped += 1;
  return false;
}

/** 同 id 取导入侧；本机独有的保留（`saveChapters` 是整文档覆盖语义）。 */
function mergeById<T extends { id: string }>(local: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of local) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

/** 学习进度的「较新」判据（唯一口径：复习过用复习时间，否则用测评时间）。 */
function reviewStamp(unit: UnitMastery): number {
  return unit.lastReviewedAt ?? unit.lastAssessmentAt ?? 0;
}

/** 证据去重键：同一次事件（同刻同类同主体同来源）只入一次。 */
function evidenceKey(entry: {
  at: number;
  kind: string;
  subjectId: string;
  sourceId?: string;
}): string {
  return `${entry.at}|${entry.kind}|${entry.subjectId}|${entry.sourceId ?? ""}`;
}

/**
 * 浏览器预览的 localStorage 配额击穿（各内核写法不一，逐个判名）。
 *
 * 导出给 `pack-import-service.ts` 复用 —— 知识包导入的 quota 分类必须与备份导入
 * **同一把尺子**（抄一份就会出现「一边认出、一边认不出」的分叉）。
 */
export function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}
