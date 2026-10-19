/**
 * 本地文件 → ImportUnit（md / txt 直读，pdf / docx / epub 抽取）。
 *
 * UI 层在「预校验」（classifyLocalFile：扩展名 + 大小即时标红）之后调用本模块，
 * 把用户选中的 File 归一化为可入管道的 ImportUnit。
 *
 * 说明：
 * - md 经 `decodeBytes`（BOM/UTF-8/GB18030 嗅探，G4）读为文本，不再是恒 UTF-8；
 * - pdf 经 pdf.ts 内存抽取文本（含版式后处理，G5），不落盘；
 * - docx 经 docx.ts 内存抽取（mammoth 取 AST + 自写 Markdown 输出层），不落盘；
 * - epub 经 epub.ts 内存抽取（jszip 解归档 + spine 遍历 + 复用网页输出层），不落盘；
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
import {
  extractEpubMarkdown,
  EpubNoTextError,
  EpubTooLargeError,
} from "./epub";
import { EpubBadArchiveError, EpubDrmError } from "./epub-archive";
import { browserHtmlParser } from "./html-parse";
import type { HtmlParser } from "./html-parse";

export type LocalFileErrorKind =
  | "unsupported"
  | "too-large"
  | "pdf-no-text"
  | "pdf-too-large"
  | "read-failed"
  | "docx-legacy"
  | "docx-bad-zip"
  | "docx-no-text"
  | "epub-drm"
  | "epub-bad-zip"
  | "epub-no-text";

/**
 * 各类型的**文件字节线**（映射式：新增 kind 时 typecheck 强制补齐，不会静默套用别人的尺子）。
 * ⚠️ 这里只管「文件字节」；「入库正文」是另一把尺子（`LIMITS.docxMaxChars` / `epubMaxChars` 等）。
 * ⚠️ `epub` 的**解压总量**是第三把尺子（`LIMITS.epubUnzippedBytes`），在 `epub.ts` 里判，
 *    因为这里还没有归档对象、无从得知解压后多大。
 */
const FILE_BYTE_LIMITS: Record<LocalFileKind, number> = {
  md: LIMITS.localMdBytes,
  txt: LIMITS.localMdBytes,
  pdf: LIMITS.localPdfBytes,
  docx: LIMITS.localDocxBytes,
  epub: LIMITS.localEpubBytes,
};

/** 本地文件转换失败：只带 kind + 语言中立的技术 detail（不直接展示）。 */
export interface LocalFileError {
  error: LocalFileErrorKind;
  /** 排障细节（文件名 / 上限 / 原始异常文本）。 */
  detail?: string;
}

/**
 * 可选注入（仅测试用）。
 * ⚠️ EPUB 需要 DOM 解析器，而 node 下没有 `DOMParser` 全局 ⇒ 单测必须能换掉它。
 *    生产不传，缺省走 `browserHtmlParser`（Tauri WebView / 浏览器）。
 */
export interface LocalFileDeps {
  parseHtml?: HtmlParser;
}

function err(kind: LocalFileErrorKind, detail?: string): LocalFileError {
  return detail === undefined ? { error: kind } : { error: kind, detail };
}

/** 单个 File → ImportUnit；失败返回可读错误（不抛）。 */
export async function fileToUnit(file: File, deps?: LocalFileDeps): Promise<ImportUnit | LocalFileError> {
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
    if (cls.kind === "epub") {
      const out = await extractEpubMarkdown(await file.arrayBuffer(), {
        parseHtml: deps?.parseHtml ?? browserHtmlParser,
      });
      return {
        // 文件名优先（用户认识的是文件名）；`dc:title` 只在文件名退化时兜底（D8）。
        title: title || out.bookTitle || file.name,
        // ⚠️ 写 `epub` 而非 `markdown`：README 已承诺 EPUB 是独立格式，
        //    且 `PlainTextRenderer` 已按纯文本处理它；写成 markdown 会让资料卡显示错类型。
        format: "epub",
        splitFormat: out.headings > 0 ? "markdown" : "txt",
        text: out.text,
        source,
        extract: {
          headings: out.headings,
          tables: out.tables,
          // 仅当全书只出现一种非 utf-8 编码时才回报（多编码混排时单值会说谎）。
          ...(out.encodings?.length === 1 ? { encoding: out.encodings[0] } : {}),
        },
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
    if (e instanceof EpubDrmError) return err("epub-drm", file.name);
    if (e instanceof EpubBadArchiveError) return err("epub-bad-zip", file.name);
    if (e instanceof EpubNoTextError) return err("epub-no-text", file.name);
    if (e instanceof EpubTooLargeError) return err("too-large", `${file.name}: ${e.message}`);
    return err("read-failed", `${file.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
