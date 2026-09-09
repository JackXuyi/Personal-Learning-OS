/**
 * 导入适配层（src/features/learn/import/）—— 统一类型与护栏常量。
 *
 * 使命：把「粘贴 / 本地文件 / GitHub 仓库」三类来源归一化为 ImportUnit，
 * 交给 pipeline.ts 的共享管道（save → split → refine → saveChapters）。
 * 本模块为纯 TS：不触碰 React / DOM / fetch / pdf.js，node 单测可直跑。
 *
 * 设计依据：docs/knowledge-import-design-2026-09.md §4.2 / §4.3
 */
import type { DocumentFormat } from "../../../domain";
import type { SplitFormat } from "../../../engine";

/** 导入弹窗的来源 Tab。 */
export type ImportTab = "paste" | "local" | "github";

/** 各来源体积护栏（localStorage 占位后端的安全线；SQLite 落地后可放宽）。 */
export const LIMITS = {
  /** 单个 .md ≤ 1MB。 */
  localMdBytes: 1 * 1024 * 1024,
  /** 单个 .pdf ≤ 30MB（pdf.js 内存解析护栏）。 */
  localPdfBytes: 30 * 1024 * 1024,
  /** PDF 页数护栏（内存/耗时）。 */
  pdfMaxPages: 500,
  /** GitHub 仓库抽取 md 文件数上限（未认证 API/raw 并发护栏）。 */
  githubFileCount: 60,
  /** 仓库内单个 md 拉取上限（超过跳过并计入 skipped）。 */
  githubFileBytes: 1 * 1024 * 1024,
  /** 仓库合并正文总字符护栏（≈localStorage 安全线）。 */
  githubTotalChars: 1_500_000,
} as const;

/** 统一中间产物：来源归一化后进入共享管道的「一份资料」。 */
export interface ImportUnit {
  /** 资料标题（文件名去扩展名 / 仓库名 / 粘贴标题）。 */
  title: string;
  /** SourceDocument.format：pdf | markdown | txt。 */
  format: DocumentFormat;
  /** 交给 splitDocument 的格式：md 合并文本 → "markdown"；PDF 抽取 → "txt"。 */
  splitFormat: SplitFormat;
  /** 归一化正文（本地 md 原文 / PDF 抽取文本 / GitHub 合并 Markdown）。 */
  text: string;
  /** 出处：GitHub 仓库 URL / 本地文件名（写入 SourceDocument.source）。 */
  source?: string;
}

/** 单份导入成功结果。 */
export interface UnitResult {
  unit: ImportUnit;
  docId: string;
  /** 切出的章节 id；0 章 = 仅保存（内容过短/无结构）。 */
  chapterIds: string[];
  /** 章标题列表（与 chapterIds 平行，供单份结果卡直接渲染；0 章为空）。 */
  chapterTitles: string[];
  /** 全资料要点总数（各章 keyPoints 之和，结果卡统计用）。 */
  totalPoints: number;
  /** 是否经过 AI 精修（标题/要点/过碎合并）。 */
  refined: boolean;
  /** AI 自动合并的过碎小节数（结构修正）。 */
  merged: number;
}

/** 批量导入汇总。 */
export interface ImportSummary {
  ok: UnitResult[];
  failed: { title: string; reason: string }[];
}

/** 本地文件类型判定（仅 .md / .pdf 两类被支持）。 */
export type LocalFileKind = "md" | "pdf";

export interface LocalFileClassified {
  kind: LocalFileKind;
  /** 是否超大小护栏（超限文件在导入前即标红）。 */
  overLimit: boolean;
}

export interface LocalFileRejected {
  error: "unsupported" | "unknown";
}

/** 纯函数：按扩展名 + 大小判定本地文件可导入性。 */
export function classifyLocalFile(file: { name: string; size: number }): LocalFileClassified | LocalFileRejected {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdown")) {
    return { kind: "md", overLimit: file.size > LIMITS.localMdBytes };
  }
  if (lower.endsWith(".pdf")) {
    return { kind: "pdf", overLimit: file.size > LIMITS.localPdfBytes };
  }
  return { error: "unsupported" };
}

/** 去掉文件扩展名作为默认资料标题。 */
export function stripExtension(name: string): string {
  return name.replace(/\.(md|markdown|mdown|pdf)$/i, "");
}

/** 文件大小格式化（B/KB/MB，无小数）。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
