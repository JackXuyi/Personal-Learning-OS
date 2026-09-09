/**
 * 本地文件 → ImportUnit（md 直读 / pdf 抽取）。
 *
 * UI 层在「预校验」（classifyLocalFile：扩展名 + 大小即时标红）之后调用本模块，
 * 把用户选中的 File 归一化为可入管道的 ImportUnit。
 *
 * 说明：md 经 File.text()（UTF-8）；pdf 经 pdf.ts 内存抽取文本；均不落盘。
 */
import { classifyLocalFile, stripExtension, type ImportUnit } from "./types";
import { extractPdfText, PdfNoTextError, PdfTooLargeError } from "./pdf";

export type LocalFileErrorKind = "unsupported" | "too-large" | "pdf-no-text" | "pdf-too-large" | "read-failed";

export interface LocalFileError {
  error: LocalFileErrorKind;
  message: string;
}

function err(kind: LocalFileErrorKind, message: string): LocalFileError {
  return { error: kind, message };
}

/** 单个 File → ImportUnit；失败返回可读错误（不抛）。 */
export async function fileToUnit(file: File): Promise<ImportUnit | LocalFileError> {
  const cls = classifyLocalFile(file);
  if ("error" in cls) {
    return err("unsupported", `不支持的文件类型：${file.name}（仅 .md / .pdf）。`);
  }
  if (cls.overLimit) {
    const limit = cls.kind === "md" ? "1MB" : "30MB";
    return err("too-large", `文件超出大小限制（${limit}）：${file.name}。`);
  }
  const title = stripExtension(file.name);
  const source = `本地文件 · ${file.name}`;
  try {
    if (cls.kind === "md") {
      const text = await file.text();
      return { title, format: "markdown", splitFormat: "markdown", text, source };
    }
    const buffer = await file.arrayBuffer();
    const text = await extractPdfText(buffer);
    return { title, format: "pdf", splitFormat: "txt", text, source };
  } catch (e) {
    if (e instanceof PdfNoTextError) return err("pdf-no-text", e.message);
    if (e instanceof PdfTooLargeError) return err("pdf-too-large", e.message);
    return err("read-failed", `读取文件失败：${file.name}（${e instanceof Error ? e.message : String(e)}）。`);
  }
}
