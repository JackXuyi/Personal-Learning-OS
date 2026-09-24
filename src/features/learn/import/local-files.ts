/**
 * 本地文件 → ImportUnit（md / txt 直读，pdf / docx 抽取）。
 *
 * UI 层在「预校验」（classifyLocalFile：扩展名 + 大小即时标红）之后调用本模块，
 * 把用户选中的 File 归一化为可入管道的 ImportUnit。
 *
 * 说明：
 * - md 经 `decodeBytes`（BOM/UTF-8/GB18030 嗅探，G4）读为文本，不再是恒 UTF-8；
 * - pdf 经 pdf.ts 内存抽取文本（含版式后处理，G5），不落盘；
 * - docx 经 docx.ts 内存抽取（mammoth 取 AST + 自写 Markdown 输出层），不落盘；
 * - 本模块**不产出用户可见文案**（G2）：失败只回 `kind`，由 UI 经 error-text 取 i18n。
 */
import { classifyLocalFile, stripExtension, LIMITS } from "./types";
import type { ImportUnit, LocalFileKind } from "./types";
import { decodeBytes } from "./decode";
import { extractPdfText, PdfNoTextError, PdfTooLargeError } from "./pdf";
import { promotePdfHeadings } from "./pdf-layout";
import {
  extractDocxMarkdown,
  DocxBadArchiveError,
  DocxLegacyError,
  DocxNoTextError,
  DocxTooLargeError,
} from "./docx";

export type LocalFileErrorKind =
  | "unsupported"
  | "too-large"
  | "pdf-no-text"
  | "pdf-too-large"
  | "read-failed"
  | "docx-legacy"
  | "docx-bad-zip"
  | "docx-no-text";

/**
 * 各类型的**文件字节线**（映射式：新增 kind 时 typecheck 强制补齐，不会静默套用别人的尺子）。
 * ⚠️ 这里只管「文件字节」；「入库正文」是另一把尺子（`LIMITS.docxMaxChars` 等）。
 */
const FILE_BYTE_LIMITS: Record<LocalFileKind, number> = {
  md: LIMITS.localMdBytes,
  txt: LIMITS.localMdBytes,
  pdf: LIMITS.localPdfBytes,
  docx: LIMITS.localDocxBytes,
};

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
    return err("too-large", `${file.name} size>${FILE_BYTE_LIMITS[cls.kind]}`);
  }
  const title = stripExtension(file.name);
  const source = `本地文件 · ${file.name}`;
  try {
    if (cls.kind === "md" || cls.kind === "txt") {
      const decoded = decodeBytes(await file.arrayBuffer());
      const asMarkdown = cls.kind === "md";
      return {
        title,
        format: asMarkdown ? "markdown" : "txt",
        // .txt 按纯文本切分（空行聚类）；.md 走标题切分。
        splitFormat: asMarkdown ? "markdown" : "txt",
        text: decoded.text,
        source,
        extract: { encoding: decoded.encoding },
      };
    }
    if (cls.kind === "docx") {
      const out = await extractDocxMarkdown(await file.arrayBuffer());
      return {
        title,
        // DOCX 产出标准 ATX 标题，与 md 来源同路入库。
        format: "markdown",
        // 有标题证据 → 按 md 标题切章；否则退化为段落聚类（与 PDF 的 promote 策略同构，不报错）。
        splitFormat: out.headings > 0 ? "markdown" : "txt",
        text: out.text,
        source,
        extract: { headings: out.headings, tables: out.tables },
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
    // 单一错误漏斗：各抽取器的语义化错误在此映射为 kind（顺序无关，类型互斥）。
    if (e instanceof PdfNoTextError) return err("pdf-no-text", e.message);
    if (e instanceof PdfTooLargeError) return err("pdf-too-large", e.message);
    if (e instanceof DocxLegacyError) return err("docx-legacy", file.name);
    if (e instanceof DocxBadArchiveError) return err("docx-bad-zip", file.name);
    if (e instanceof DocxNoTextError) return err("docx-no-text", file.name);
    if (e instanceof DocxTooLargeError) return err("too-large", `${file.name} chars>${LIMITS.docxMaxChars}`);
    return err("read-failed", `${file.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
