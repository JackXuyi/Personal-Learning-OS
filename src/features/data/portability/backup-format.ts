/**
 * 导出包格式 —— 类型、版本、纯校验与归一化（方案
 * `docs/data-portability-export-import-design-2026-09.md` §4.3.1 / §8.7）。
 *
 * 本模块是**纯 TS**：不 import storage、不 import React、不碰 IPC
 * → 可在 `tests/data-portability.test.ts` 里 node 直跑。
 *
 * 两条硬不变量（方案 §4.3.1，实施时不得绕开）：
 *  1. `counts` 必须与 `data` **由同一次读取产出** —— `countsOf()` 是唯一真源，
 *     调用方禁止另起一次 `storage.listXxx()` 去填 `counts`；
 *  2. `counts` 在导入时用作**完整性校验** —— 逐字段比对「文件里数组长度 vs 声明的
 *     counts」，不一致判 `corrupt` 并拒绝（防截断 / 手工改坏）。
 */
import type {
  Annotation,
  CapabilityItem,
  CapabilityReport,
  CapabilityRun,
  CardStateMap,
  Chapter,
  Chunk,
  Embedding,
  EvidenceEntry,
  KnowledgeRelation,
  KnowledgeUnit,
  LearnerProfile,
  LearnerState,
  LearningGoal,
  Paper,
  PaperAnswers,
  PaperResult,
  Restatement,
  Section,
  SourceDocument,
} from "../../../domain";

import { isPlainObject, shapeMatches } from "./field-shape";
import type { FieldShape } from "./field-shape";

/** 导出包标识：防「导入了一个别的 JSON」。 */
export const BACKUP_KIND = "plos.backup" as const;

/**
 * 导出格式版本。
 *
 * ⚠️ 与 SQLite 的 `_schema_version`（当前 v4）**无关**，独立演进：
 * 前者是落库表结构的版本，后者是「备份文件长什么样」的版本。
 */
export const EXPORT_VERSION = 1 as const;

/** 备份文件后缀（双重后缀：`.json` 保证任意编辑器 / 终端可直接查看）。 */
export const BACKUP_SUFFIX = ".plosbak.json";

/**
 * 应用版本（仅排障展示，**不参与校验、不参与迁移决策**）。
 *
 * 为什么是常量而不是 import package.json：`tests/*.ts` 在 node
 * `--experimental-strip-types` 下直跑，import JSON 需要 import attributes，
 * 引入它会让纯逻辑单测依赖构建器。改 package.json 版本号时手工同步此行即可。
 */
export const APP_VERSION = "0.1.0";

/** 导出白名单（方案 §4.3.1）—— 多一个字段都要走决策。 */
export interface BackupData {
  documents: SourceDocument[];
  chaptersByDocument: Record<string, Chapter[]>;
  sections: Section[];
  chunks: Chunk[];
  knowledgeUnits: KnowledgeUnit[];
  knowledgeRelations: KnowledgeRelation[];
  /** ⚠️ 默认**不含向量本体**（D4）：向量是可重算的派生数据。 */
  embeddings: Embedding[];
  papers: Paper[];
  paperDrafts: Record<string, PaperAnswers>;
  paperResults: PaperResult[];
  learnerState: LearnerState;
  /** F1 画像；缺省 = 本机从未填写（导入时**绝不**用它清空本机画像）。 */
  profile?: LearnerProfile;
  restatements: Restatement[];
  cardStates: CardStateMap;
  annotations: Annotation[];
  goals: LearningGoal[];
  evidence: EvidenceEntry[];
  capabilityItems: Record<string, CapabilityItem[]>;
  capabilityRuns: CapabilityRun[];
  capabilityReports: CapabilityReport[];
}

/** 各实体条数 —— 导入前的预检真源（由 `countsOf` 从 `data` 派生）。 */
export interface EntityCounts {
  documents: number;
  chapters: number;
  sections: number;
  chunks: number;
  knowledgeUnits: number;
  knowledgeRelations: number;
  embeddings: number;
  papers: number;
  paperDrafts: number;
  paperResults: number;
  /** `learnerState.byUnit` 的单元数。 */
  learnerUnits: number;
  /** 0 / 1（画像是有无，不是条数）。 */
  profile: number;
  restatements: number;
  cardStates: number;
  annotations: number;
  goals: number;
  evidence: number;
  capabilityItems: number;
  capabilityRuns: number;
  capabilityReports: number;
}

/** 完整导出包。 */
export interface BackupFile {
  kind: typeof BACKUP_KIND;
  exportVersion: number;
  appVersion: string;
  /** epoch ms。 */
  exportedAt: number;
  /** `storage.name`（local | memory | tauri）。 */
  backend: string;
  counts: EntityCounts;
  data: BackupData;
}

/** 导入失败分类（只回分类，文案由 UI 经 i18n 映射）。 */
export type BackupErrorKind =
  | "not-json"
  | "not-backup"
  | "version-newer"
  | "unsupported-version"
  | "corrupt";

interface FieldSpec {
  key: keyof BackupData;
  shape: FieldShape;
  /** 缺省即合法（当前只有 `profile`）。 */
  optional?: boolean;
}

/**
 * 字段规格 —— **唯一真源**：`BACKUP_FIELDS` 由它派生，校验与「白名单覆盖率」
 * 单测（TC-EDGE-06）也读它，避免「加了实体忘了导出」这类静默丢失。
 */
const FIELD_SPECS: readonly FieldSpec[] = [
  { key: "documents", shape: "array" },
  { key: "chaptersByDocument", shape: "record" },
  { key: "sections", shape: "array" },
  { key: "chunks", shape: "array" },
  { key: "knowledgeUnits", shape: "array" },
  { key: "knowledgeRelations", shape: "array" },
  { key: "embeddings", shape: "array" },
  { key: "papers", shape: "array" },
  { key: "paperDrafts", shape: "record" },
  { key: "paperResults", shape: "array" },
  { key: "learnerState", shape: "object" },
  { key: "profile", shape: "object", optional: true },
  { key: "restatements", shape: "array" },
  { key: "cardStates", shape: "record" },
  { key: "annotations", shape: "array" },
  { key: "goals", shape: "array" },
  { key: "evidence", shape: "array" },
  { key: "capabilityItems", shape: "record" },
  { key: "capabilityRuns", shape: "array" },
  { key: "capabilityReports", shape: "array" },
];

/** 白名单字段名（顺序与 `FIELD_SPECS` 一致）。 */
export const BACKUP_FIELDS: readonly (keyof BackupData)[] = FIELD_SPECS.map((s) => s.key);

/** `counts` 的键顺序（UI 展开明细与单测共用，避免两处各写一遍顺序）。 */
export const COUNT_KEYS: readonly (keyof EntityCounts)[] = [
  "documents",
  "chapters",
  "sections",
  "chunks",
  "knowledgeUnits",
  "knowledgeRelations",
  "embeddings",
  "papers",
  "paperDrafts",
  "paperResults",
  "learnerUnits",
  "profile",
  "restatements",
  "cardStates",
  "annotations",
  "goals",
  "evidence",
  "capabilityItems",
  "capabilityRuns",
  "capabilityReports",
];

/** 解析结果（判别式，不用异常做控制流）。 */
export type ParseBackupResult =
  | { ok: true; file: BackupFile }
  | { ok: false; kind: BackupErrorKind; detail?: string };

/** 迁移结果（判别式 —— ⚠️ 不能用 `"kind" in file` 判成功，`BackupFile` 自己也有 `kind`）。 */
export type MigrateBackupResult =
  | { ok: true; file: BackupFile }
  | { ok: false; kind: BackupErrorKind };

/**
 * `counts` 从 `data` 直接派生 —— **唯一真源**，禁止另起一次 storage 读取
 * （方案 §4.3.1 不变量 1）。
 */
export function countsOf(data: BackupData): EntityCounts {
  let chapters = 0;
  for (const list of Object.values(data.chaptersByDocument)) chapters += list.length;
  let capabilityItems = 0;
  for (const list of Object.values(data.capabilityItems)) capabilityItems += list.length;
  return {
    documents: data.documents.length,
    chapters,
    sections: data.sections.length,
    chunks: data.chunks.length,
    knowledgeUnits: data.knowledgeUnits.length,
    knowledgeRelations: data.knowledgeRelations.length,
    embeddings: data.embeddings.length,
    papers: data.papers.length,
    paperDrafts: Object.keys(data.paperDrafts).length,
    paperResults: data.paperResults.length,
    learnerUnits: Object.keys(data.learnerState.byUnit ?? {}).length,
    profile: data.profile ? 1 : 0,
    restatements: data.restatements.length,
    cardStates: Object.keys(data.cardStates).length,
    annotations: data.annotations.length,
    goals: data.goals.length,
    evidence: data.evidence.length,
    capabilityItems,
    capabilityRuns: data.capabilityRuns.length,
    capabilityReports: data.capabilityReports.length,
  };
}

/** 两个 counts 是否逐字段相等（导入完整性校验用）。 */
export function countsEqual(a: EntityCounts, b: EntityCounts): boolean {
  return COUNT_KEYS.every((k) => a[k] === b[k]);
}

/** 补零到两位（文件名里的时间戳）。 */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * `YYYYMMDD-HHmmss`（**本地时间**：文件名是给人看的，不是审计时间戳）。
 *
 * 导出给 `pack-format.ts::defaultPackName` 复用 —— 知识包与备份的文件名时间戳
 * 必须是**同一把尺子**（各写一份就会出现两种补零 / 时区写法）。
 */
export function stamp(now: number): string {
  const d = new Date(now);
  const date = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `${date}-${time}`;
}

/** 导出文件名：`plos-backup-YYYYMMDD-HHmmss.plosbak.json`。 */
export function defaultBackupName(now: number = Date.now()): string {
  return `plos-backup-${stamp(now)}${BACKUP_SUFFIX}`;
}

/** replace 导入前的自动预备份文件名：`pre-import-YYYYMMDD-HHmmss.plosbak.json`。 */
export function preImportBackupName(now: number = Date.now()): string {
  return `pre-import-${stamp(now)}${BACKUP_SUFFIX}`;
}

/**
 * 单章 Markdown 文件名：`plos-chapter-YYYYMMDD-HHmmss.md`。
 *
 * ⚠️ 刻意**不用**章标题拼名：标题里的空格 / 斜杠 / 中文会让 Rust 侧的文件名白名单
 * 与跨平台路径规则各说各话（`..` 与分隔符是安全红线）。时间戳命名恒定合法。
 */
export function chapterMarkdownName(now: number = Date.now()): string {
  return `plos-chapter-${stamp(now)}.md`;
}

/** 人类可读体积（1.2 MB 这类）；只用于展示，不参与任何判定。 */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

// ⚠️ `isPlainObject` / `shapeMatches` / `FieldShape` 已抽到 `./field-shape.ts`
// —— F4 备份与 F10 知识包共用同一份形态判定（复制一份＝同一规则两处实现）。

/**
 * 导入前校验（纯函数，可单测）。**绝不抛错** —— 回判别式结果。
 *
 * 失败一律发生在写入之前（方案 §12 用例断言「库快照逐字节不变」）。
 */
export function parseBackup(raw: string): ParseBackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, kind: "not-json" };
  }
  if (!isPlainObject(parsed)) return { ok: false, kind: "not-backup" };
  if (parsed.kind !== BACKUP_KIND) return { ok: false, kind: "not-backup" };

  const exportVersion = parsed.exportVersion;
  if (typeof exportVersion !== "number" || !Number.isInteger(exportVersion)) {
    return { ok: false, kind: "corrupt", detail: "exportVersion" };
  }
  if (exportVersion > EXPORT_VERSION) return { ok: false, kind: "version-newer" };
  if (exportVersion < 1) return { ok: false, kind: "unsupported-version" };

  const data = parsed.data;
  if (!isPlainObject(data)) return { ok: false, kind: "corrupt", detail: "data" };

  for (const spec of FIELD_SPECS) {
    const value = data[spec.key];
    if (value === undefined) {
      if (spec.optional) continue;
      return { ok: false, kind: "corrupt", detail: `data.${spec.key}` };
    }
    if (!shapeMatches(value, spec.shape)) {
      return { ok: false, kind: "corrupt", detail: `data.${spec.key}` };
    }
  }

  const counts = parsed.counts;
  if (!isPlainObject(counts)) return { ok: false, kind: "corrupt", detail: "counts" };
  // 完整性校验：声明值必须与文件内容自洽（防截断 / 手工改坏）。
  if (!countsEqual(countsOf(data as unknown as BackupData), counts as unknown as EntityCounts)) {
    return { ok: false, kind: "corrupt", detail: "counts-mismatch" };
  }

  return { ok: true, file: parsed as unknown as BackupFile };
}

/**
 * 版本迁移钩子。
 *
 * v1 是首个版本 → 没有更早版本可迁移，函数体只留判据 + 注释，**接口留好**：
 * 未来 v2 时在此按版本递推把旧包归一化成当前版本（并补一个新的迁移分支）。
 */
export function migrateBackup(file: BackupFile): MigrateBackupResult {
  if (file.exportVersion === EXPORT_VERSION) return { ok: true, file };
  if (file.exportVersion > EXPORT_VERSION) return { ok: false, kind: "version-newer" };
  return { ok: false, kind: "unsupported-version" };
}
