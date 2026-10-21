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
import {
  deleteDocumentCascade as deleteDocumentCascadePure,
  previewDeleteCascade as previewDeleteCascadePure,
  type DeleteReport,
} from "./document-cascade";

export type { DeleteReport };

/**
 * 写操作的前置校验失败（docs/copy-terminology-2026-10.md §3：服务层只产机器令牌，
 * 文案由 UI 按 kind 映射 ⇒ 切英文时不残留中文）。
 *
 * ⚠️ 消费方 `dialogs.tsx` 目前按 `msg.includes("上限")` 匹配，改这里须同步改那份判据。
 */
export class LibraryActionError extends Error {
  readonly kind: "empty-title" | "empty-append" | "append-too-large";
  // 不用 TS 参数属性（constructor(readonly kind)）——strip-only 模式不支持该语法糖。
  constructor(kind: "empty-title" | "empty-append" | "append-too-large", message: string) {
    super(message);
    this.name = "LibraryActionError";
    this.kind = kind;
  }
}

/**
 * 删除级联实现已下沉 `document-cascade.ts`（纯编排，store 必传）——
 * 导入管道的「覆盖式导入」（O2/D1）复用同一条链路且不得拖进 store 模块。
 * 此处保留带默认 store 的兼容包装，既有消费方零改动。
 */

/** 删除前预检：只读统计，返回将被连带清理的数量（供确认弹窗展示）。 */
export async function previewDeleteCascade(
  docId: string,
  store: StorageAdapter = storage,
): Promise<DeleteReport> {
  return previewDeleteCascadePure(docId, store);
}

/** 删除资料并级联清理（顺序见 document-cascade 模块头；默认全局 store）。 */
export async function deleteDocumentCascade(
  docId: string,
  store: StorageAdapter = storage,
): Promise<DeleteReport> {
  return deleteDocumentCascadePure(docId, store);
}

/** 重命名（title 去空白，空则拒绝）。 */
export async function renameDocument(
  doc: SourceDocument,
  title: string,
  store: StorageAdapter = storage,
): Promise<SourceDocument> {
  const t = title.trim();
  if (!t) throw new LibraryActionError("empty-title", "library:empty-title");
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
  if (!add) throw new LibraryActionError("empty-append", "library:empty-append");
  const merged = `${doc.textPreview ?? ""}\n\n${add}`;
  if (merged.length > LIMITS.githubTotalChars) {
    throw new LibraryActionError("append-too-large", "library:append-too-large");
  }
  const next: SourceDocument = { ...doc, textPreview: merged, analysis: undefined };
  await opts.storage.saveDocument(next);
  const res = await splitDocumentNow(next, { storage: opts.storage }); // 无 provider
  return { ...res, appendedChars: add.length };
}
