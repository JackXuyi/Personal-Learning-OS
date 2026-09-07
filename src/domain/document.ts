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
}
