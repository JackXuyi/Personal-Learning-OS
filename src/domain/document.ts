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
    /** 分析所用模型标识（展示用，可缺省）。 */
    model?: string;
  };
}
