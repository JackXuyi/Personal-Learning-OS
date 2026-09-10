/**
 * 核心对象 #1 —— SourceDocument（源文档）。
 *
 * 用户自己的知识来源。原则很简单：
 * 「你的原始素材永远属于你。」
 */
export type DocumentFormat =
  | "pdf"
  | "markdown"
  | "txt"
  | "docx"
  | "epub"
  | "web"
  | "note"
  | "code"
  | "image"
  | "custom";

export type DocumentStatus = "imported" | "parsing" | "ready" | "failed";

export interface SourceDocument {
  id: string;
  title: string;
  format: DocumentFormat;
  /** Local file path (when the document lives on this machine). */
  path?: string;
  /** Remote/web URI (when imported from the web). */
  uri?: string;
  /** Free-form source citation, kept for Evidence-based learning. */
  source?: string;
  importedAt: number;
  status: DocumentStatus;
  rawSizeBytes?: number;
  /** 可选的纯文本快照，在解析尚未支持时由 Knowledge Engine 使用。 */
  textPreview?: string;
  /**
   * AI 分析状态（切分由代码完成，不计入本字段）。
   * 全部可选：老数据无此字段 → 视为「未分析」，天然兼容。
   */
  analysis?: {
    /** 章节分析（标题 / 要点 / 过碎合并）最近一次完成时间。 */
    chaptersAt?: number;
    /** 概念分析（知识概念抽取）最近一次完成时间。 */
    conceptsAt?: number;
    /**
     * 要点分析（要点 ↔ 原文引用抽取）最近一次完成时间。
     * 与 chaptersAt 分开记：两者入口不同（「AI 精修」vs「AI 分析要点」），
     * 用户可能只跑其中一个。
     */
    keyPointsAt?: number;
    /** 分析所用模型标识（展示用，可缺省）。 */
    model?: string;
  };
  /**
   * 整篇概览（AI 生成；老数据无此字段 → UI 显示空态，零迁移）。
   *
   * 时间戳**只**放 `overview.generatedAt` —— 不另设 `analysis.overviewAt`：
   * 同一事实不在两处记录。
   */
  overview?: DocumentOverview;
}

/** 概览生成方式（展示用；决定 UI 文案与成本提示）。 */
export type OverviewMode = "single" | "map-reduce";

/**
 * 资料概览（AI 生成，整篇级）。
 *
 * 设计（docs/library-detail-page-overview-tab-design-2026-09.md §4.3.1）：
 * 与逐章的 analysis 字段并列、互不覆盖；全部字段随 `SourceDocument.overview?`
 * 可选挂载 → 无需数据迁移。
 */
export interface DocumentOverview {
  /** 一句话定位：这份资料在讲什么（≤60 字）。 */
  gist: string;
  /** 主干脉络：1–6 段（按资料原有顺序）。 */
  sections: { heading: string; detail: string }[];
  /** 读前需知 / 适合谁：0–3 条（≤40 字）。空数组 → UI 隐藏该区块。 */
  prerequisites: string[];
  /** 关键词：0–6 个（≤12 字）。空数组 → UI 隐藏该区块。 */
  keywords: string[];
  /** 生成时间（唯一真源）。 */
  generatedAt: number;
  /** 生成时依据的正文长度（字符）——与当前 textPreview.length 不等即「可能过期」。 */
  sourceChars: number;
  mode: OverviewMode;
  /** map-reduce 的分块数（single 时省略）。 */
  chunks?: number;
  /** 生成所用模型标识（展示用，可缺省）。 */
  model?: string;
}

/**
 * 概览是否因正文变化而可能过期（纯谓词）。
 *
 * 无概览 → false：不制造「你该重新生成了」的焦虑（正文没被替换过时恒 false）。
 * 对齐口径见 v2 的 `sourceChars` 设计——用长度比对而非哈希，成本为零。
 */
export function isOverviewStale(
  doc: Pick<SourceDocument, "overview" | "textPreview">,
): boolean {
  const o = doc.overview;
  if (!o) return false;
  return o.sourceChars !== (doc.textPreview?.length ?? 0);
}
