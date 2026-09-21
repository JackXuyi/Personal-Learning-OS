/**
 * 社区知识包格式 —— 类型、常量、纯校验与规范化（F10）。
 *
 * 方案：`docs/community-knowledge-pack-design-2026-09.md` §4.3.1 / §8.3。
 *
 * 本模块是**纯 TS**：不 import storage、不 import React、不碰 IPC
 * → 可在 `tests/knowledge-pack.test.ts` 里 node 直跑。
 *
 * ⚠️ 体积三常量与 `utf8BytesOf` **定义在 `domain/knowledge-pack.ts`**（`storage/`
 * 也要用 → 放 features 会破依赖单向），本模块只**重导出**，绝不重写那些数字。
 * 同理 `countsEqualPack` / `stableStringify` / 通用指纹函数也来自 domain。
 */
import { APP_VERSION, stamp } from "./backup-format";
import { isPlainObject, shapeMatches } from "./field-shape";
import {
  PACK_HARD_MAX_BYTES,
  PACK_WORKER_MIN_BYTES,
  contentHashOf as genericContentHashOf,
  countsEqualPack,
  utf8BytesOf,
} from "../../../domain";
import type { PackCounts } from "../../../domain";
import type {
  Chapter,
  Chunk,
  DocumentFormat,
  KnowledgeRelation,
  KnowledgeUnit,
  Section,
  SourceDocument,
} from "../../../domain";

// ===== 从 domain 重导出（唯一真源在 domain，本模块只是「包的入口」）=====
export {
  PACK_HARD_MAX_BYTES,
  PACK_WORKER_MIN_BYTES,
  PACK_LOCAL_STORE_BUDGET_BYTES,
  utf8BytesOf,
  countsEqualPack,
  stableStringify,
} from "../../../domain";

/** 包标识 —— 与 F4 的 `"plos.backup"` 严格区分（互为反向白名单）。 */
export const PACK_KIND = "plos.pack" as const;
/** 包格式版本（独立演进，与 `EXPORT_VERSION` / SQLite `_schema_version` 均无关）。 */
export const PACK_VERSION = 1 as const;
/** 双重后缀：`.json` 保证任意编辑器可直接查看。 */
export const PACK_SUFFIX = ".ploskp.json";

export type PackLicense = "cc0" | "cc-by" | "cc-by-sa" | "public-domain" | "other";

/** 包内每份资料的来源（溯源用；**不含本机路径**）。 */
export interface PackSourceRef {
  title: string;
  format: DocumentFormat;
  source?: string;
  /** 仅保留公开可验证的来源链接（http/https）；本机路径一律不写。 */
  uri?: string;
}

export interface PackManifest {
  /** 包标题（用户填；缺省 = 「N 份资料」）。 */
  title: string;
  /** 说明（可选，≤200 字，超长截断）。 */
  description?: string;
  /** 作者署名（可选自由文本，≤60 字；不做身份验证）。 */
  author?: string;
  license?: PackLicense;
  sources: PackSourceRef[];
  /** 是否含 AI 派生内容（概览 / 要点 / 概念）。诚实口径：导入方据此知道「要点不是自己跑的」。 */
  aiDerived: boolean;
  /**
   * 内容指纹（规范化 JSON 的 FNV-1a 十六进制）。
   * 用途**仅限**「同一包」识别提示；**不是**签名、不用于完整性保证、不用于安全判定。
   */
  contentHash: string;
}

/** ⚠️ 白名单 6 项 —— 多一个字段都要走决策（与备份的 20 项互为反向）。 */
export interface PackData {
  documents: SourceDocument[];
  chaptersByDocument: Record<string, Chapter[]>;
  sections: Section[];
  chunks: Chunk[];
  knowledgeUnits: KnowledgeUnit[];
  knowledgeRelations: KnowledgeRelation[];
}

export interface KnowledgePackFile {
  kind: typeof PACK_KIND;
  packVersion: number;
  appVersion: string;
  /** epoch ms。 */
  exportedAt: number;
  manifest: PackManifest;
  counts: PackCounts;
  data: PackData;
}

export type PackErrorKind =
  | "not-json" // JSON.parse 失败
  | "not-pack" // kind 不是 plos.pack（含「误把备份当包导入」）
  | "version-newer" // packVersion > PACK_VERSION
  | "unsupported-version" // packVersion < 1
  | "corrupt" // 结构 / counts 不自洽 / 白名单字段形态不符
  | "too-large" // utf8Bytes(raw) > PACK_HARD_MAX_BYTES（① 文件 / 网络层）
  | "empty"; // 包里 0 份资料 / 0 个章节
// ⚠️ 容量拒（③）**刻意不在这里**：它需要 `storage`（后端容量），归 `PackImportErrorKind`，
//    判定发生在 parse 通过与格式校验之后、写入之前。

export type ParsePackResult =
  | { ok: true; file: KnowledgePackFile; bytes: number } // bytes = utf8Bytes(raw)，供 ③ 复用
  | { ok: false; kind: PackErrorKind; detail?: string };

/** 与备份同款：`FIELD_SPECS` 是**唯一真源**，校验与「白名单覆盖率」单测都读它。 */
const PACK_FIELD_SPECS: readonly { key: keyof PackData; shape: "array" | "record" }[] = [
  { key: "documents", shape: "array" },
  { key: "chaptersByDocument", shape: "record" },
  { key: "sections", shape: "array" },
  { key: "chunks", shape: "array" },
  { key: "knowledgeUnits", shape: "array" },
  { key: "knowledgeRelations", shape: "array" },
];
/** 白名单字段名（顺序与 `PACK_FIELD_SPECS` 一致）。 */
export const PACK_FIELDS: readonly (keyof PackData)[] = PACK_FIELD_SPECS.map((s) => s.key);

/** 泄漏黑名单 —— 包 JSON 里**永不**允许出现的键名（单测 TC-LEAK-01 逐项扫）。 */
export const FORBIDDEN_KEYS: readonly string[] = [
  "learnerState",
  "profile",
  "evidence",
  "annotations",
  "restatements",
  "cardStates",
  "papers",
  "paperDrafts",
  "paperResults",
  "goals",
  "capabilityItems",
  "capabilityRuns",
  "capabilityReports",
  "memoryDoc",
  "memoryMeta",
];

/**
 * 由数据本身数出计数 —— **唯一真源**：导出侧写 manifest、导入侧交叉核对都经它。
 * 调用方禁止另起一次 `storage.listXxx()` 去填 `counts`（同一规则两处实现＝两把尺子）。
 */
export function countsOfPack(data: PackData): PackCounts {
  let chapters = 0;
  for (const list of Object.values(data.chaptersByDocument)) chapters += list.length;
  let chars = 0;
  for (const d of data.documents) chars += d.textPreview?.length ?? 0;
  return {
    documents: data.documents.length,
    chapters,
    sections: data.sections.length,
    chunks: data.chunks.length,
    knowledgeUnits: data.knowledgeUnits.length,
    knowledgeRelations: data.knowledgeRelations.length,
    chars,
  };
}

/**
 * 内容指纹（薄包装）。
 *
 * `PackData` 留在本模块（它 import 6 个 domain 实体类型），而指纹实现需要落到
 * `domain/knowledge-pack.ts`（`storage/` 要用的东西不能放 features）→ 后者接受
 * **结构化入参**（`PackHashInput`）以避免反向依赖，这里做一次结构化转交。
 *
 * 与 manifest 无关（避免自引用）→ 只在 `data` 上算，可同库复现。
 */
export function contentHashOf(data: PackData): string {
  return genericContentHashOf(data);
}

/** 导出文件名：`plos-pack-YYYYMMDD-HHmmss.ploskp.json`（本地时间，给人看）。 */
export function defaultPackName(now: number = Date.now()): string {
  return `plos-pack-${stamp(now)}${PACK_SUFFIX}`;
}

/**
 * 导入前校验（纯函数 · **异步** · **绝不抛错** —— 回判别式结果）。
 *
 * ⚠️ **异步**：当 `utf8Bytes(raw) >= PACK_WORKER_MIN_BYTES` 时改在 **Web Worker** 内
 * 执行 `JSON.parse`（100 MiB 的同步解析会冻结主线程 1–3 s）。
 * `parseInWorker` 可注入 —— node 单测环境无 Web Worker，必须能显式关闭。
 *
 * 失败一律发生在写入之前（单测断言「库快照逐字节不变」）。
 * 校验顺序见方案 §4.3.1（① 体积 → ② 解析 → 标识 → 版本 → manifest → 逐字段形态 → counts 自洽 → 非空）。
 */
export async function parsePack(
  raw: string,
  opts: { parseInWorker?: boolean; maxBytes?: number } = {},
): Promise<ParsePackResult> {
  const maxBytes = opts.maxBytes ?? PACK_HARD_MAX_BYTES; // 单测注入小阈值，产品路径恒为 100 MiB

  // ① 文件 / 网络层：先 O(1) 上界预判（utf8Bytes >= raw.length 恒成立 → 超限无需编码）
  if (raw.length > maxBytes) return { ok: false, kind: "too-large" };
  const bytes = utf8BytesOf(raw);
  if (bytes > maxBytes) return { ok: false, kind: "too-large" };

  // ② 解析（≥ 阈值且在支持 Worker 的环境下改走 Worker）
  let parsed: unknown;
  try {
    parsed = await parseJsonMaybeWorker(raw, opts.parseInWorker);
  } catch {
    return { ok: false, kind: "not-json" };
  }

  // ③ 标识 / 版本
  if (!isPlainObject(parsed) || parsed.kind !== PACK_KIND) return { ok: false, kind: "not-pack" };
  const packVersion = parsed.packVersion;
  if (typeof packVersion !== "number" || !Number.isInteger(packVersion)) {
    return { ok: false, kind: "corrupt", detail: "packVersion" };
  }
  if (packVersion > PACK_VERSION) return { ok: false, kind: "version-newer" };
  if (packVersion < 1) return { ok: false, kind: "unsupported-version" };
  if (!isPlainObject(parsed.manifest) || typeof parsed.manifest.title !== "string") {
    return { ok: false, kind: "corrupt", detail: "manifest" };
  }

  // ④ 逐字段形态（白名单 6 项，一个都不许缺）
  const data = parsed.data;
  if (!isPlainObject(data)) return { ok: false, kind: "corrupt", detail: "data" };
  for (const spec of PACK_FIELD_SPECS) {
    const v = data[spec.key];
    if (v === undefined) return { ok: false, kind: "corrupt", detail: `data.${spec.key}` };
    if (!shapeMatches(v, spec.shape)) return { ok: false, kind: "corrupt", detail: `data.${spec.key}` };
  }

  // ⑤ counts 自洽（防截断 / 手工改坏）
  const counts = parsed.counts;
  if (!isPlainObject(counts)) return { ok: false, kind: "corrupt", detail: "counts" };
  const packData = data as unknown as PackData;
  if (!countsEqualPack(countsOfPack(packData), counts as unknown as PackCounts)) {
    return { ok: false, kind: "corrupt", detail: "counts-mismatch" };
  }

  // ⑥ 非空（0 份资料 / 0 个章节的包没有导入意义）
  if (packData.documents.length === 0 || countsOfPack(packData).chapters === 0) {
    return { ok: false, kind: "empty" };
  }

  return { ok: true, file: parsed as unknown as KnowledgePackFile, bytes }; // bytes 供 ③ 容量判定复用，避免二次编码全串
}

/**
 * 解析派发：小包 / 无 Worker 宿主（node 单测）走同步路径，大包改走 Worker。
 *
 * ⚠️ `typeof Worker !== "undefined"` 守卫**必须**保留：无 Worker 的宿主自动退化为
 * 同步解析，**不报错、不跳过**（这也是 `parseInWorker` 只用于显式覆盖、而非唯一开关的原因）。
 */
async function parseJsonMaybeWorker(raw: string, inWorker?: boolean): Promise<unknown> {
  const shouldWorker =
    inWorker ?? (utf8BytesOf(raw) >= PACK_WORKER_MIN_BYTES && typeof Worker !== "undefined");
  if (!shouldWorker) return JSON.parse(raw); // node 单测 / 小包：同步路径

  // 一次性 Worker：解析完立即 terminate，不常驻、不池化
  // ⚠️ `new URL("./pack-parse.worker.ts", import.meta.url)` 是 Vite 静态分析可识别的形式，
  //    换成变量拼路径打包后会 404。
  const worker = new Worker(new URL("./pack-parse.worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    return await new Promise<unknown>((resolve, reject) => {
      worker.addEventListener(
        "message",
        (ev: MessageEvent<{ ok: boolean; value?: unknown; error?: string }>) =>
          ev.data.ok ? resolve(ev.data.value) : reject(new Error(ev.data.error)),
      );
      worker.addEventListener("error", (e) => reject(e)); // Worker 构造 / 执行失败 → not-json
      worker.postMessage({ raw });
    });
  } finally {
    worker.terminate();
  }
}

/** 让 `APP_VERSION` 与包文件版本一起导出，避免调用方另 import 一次（同源）。 */
export { APP_VERSION };
