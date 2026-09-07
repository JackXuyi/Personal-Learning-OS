/**
 * Core Object #1 — SourceDocument.
 *
 * The user's own knowledge source. The principle is simple:
 * "Your raw material always belongs to you."
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
  /** Optional plain-text snapshot used by the Knowledge Engine while parsing is unsupported. */
  textPreview?: string;
}
