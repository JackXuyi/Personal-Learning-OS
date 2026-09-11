/**
 * 本地文件 → ImportUnit（md 直读 / pdf 抽取）。
 *
 * UI 层在「预校验」（classifyLocalFile：扩展名 + 大小即时标红）之后调用本模块，
 * 把用户选中的 File 归一化为可入管道的 ImportUnit。
 *
 * 说明：
 * - md 经 `decodeBytes`（BOM/UTF-8/GB18030 嗅探，G4）读为文本，不再是恒 UTF-8；
 * - pdf 经 pdf.ts 内存抽取文本（含版式后处理，G5），不落盘；
 * - 本模块**不产出用户可见文案**（G2）：失败只回 `kind`，由 UI 经 error-text 取 i18n。
 */
import { classifyLocalFile, stripExtension, LIMITS } from "./types";
import type { ImportUnit } from "./types";
import { decodeBytes } from "./decode";
import { extractPdfText, PdfNoTextError, PdfTooLargeError } from "./pdf";
import { promotePdfHeadings } from "./pdf-layout";

export type LocalFileErrorKind =
  | "unsupported"
  | "too-large"
  | "pdf-no-text"
  | "pdf-too-large"
  | "read-failed";

/** 本地文件转换失败：只带 kind + 语言中立的技术 detail（不直接展示）。 */
export interface LocalFileError {
  error: LocalFileErrorKind;
  /** 排障细节（文件名 / 上限 / 原始异常文本）。 */
  detail?: string;
}

function err(kind: LocalFileErrorKind, detail?: string): LocalFileError {
  return detail === undefined ? { error: kind } : { error: kind, detail };
}

/** 单个 File → ImportUnit；失败返回可读错误（不抛）。 */
export async function fileToUnit(file: File): Promise<ImportUnit | LocalFileError> {
  const cls = classifyLocalFile(file);
  if ("error" in cls) {
    return err("unsupported", file.name);
  }
  if (cls.overLimit) {
    const limit = cls.kind === "md" ? LIMITS.localMdBytes : LIMITS.localPdfBytes;
    return err("too-large", `${file.name} size>${limit}`);
  }
  const title = stripExtension(file.name);
  const source = `本地文件 · ${file.name}`;
  try {
    if (cls.kind === "md") {
      const decoded = decodeBytes(await file.arrayBuffer());
      return {
        title,
        format: "markdown",
        splitFormat: "markdown",
        text: decoded.text,
        source,
        extract: { encoding: decoded.encoding },
      };
    }
    const out = await extractPdfText(await file.arrayBuffer());
    // PDF 无结构标记：识别出疑似标题行时提升为 md 标题，切分器才能识别出「第 X 章」（G5）。
    const promoted = promotePdfHeadings(out.text);
    return {
      title,
      format: "pdf",
      splitFormat: promoted.promoted > 0 ? "markdown" : "txt",
      text: promoted.text,
      source,
      extract: { pages: out.pageCount, nonEmptyPages: out.nonEmptyPages },
    };
  } catch (e) {
    if (e instanceof PdfNoTextError) return err("pdf-no-text", e.message);
    if (e instanceof PdfTooLargeError) return err("pdf-too-large", e.message);
    return err("read-failed", `${file.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
