/**
 * PDF 文本抽取（文本型 PDF → 纯文本）。
 *
 * 基于 pdfjs-dist 在前端逐页 getTextContent 抽取——WebView（Tauri）与
 * 浏览器预览同一条代码路径；Worker 以 asset URL 运行时解析（Vite 自动打包），
 * 无需额外构建插件。
 *
 * 范围护栏（docs/knowledge-import-design-2026-09.md §3.3）：
 * - 仅文本型 PDF；扫描件（抽不出文本）抛 PdfNoTextError，由 UI 提示，不做 OCR；
 * - 页数超过 LIMITS.pdfMaxPages 拒绝（内存/耗时护栏）。
 */
import * as pdfjs from "pdfjs-dist";
import { LIMITS } from "./types";

// Vite：worker 以 asset URL 形式随构建产物发布。
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/** 扫描件 / 无法抽取文本。 */
export class PdfNoTextError extends Error {
  constructor(message = "未抽取到文本（PDF 可能为扫描件或图片型）。") {
    super(message);
    this.name = "PdfNoTextError";
  }
}

/** PDF 页数超出护栏。 */
export class PdfTooLargeError extends Error {
  constructor() {
    super(`PDF 页数超过上限（${LIMITS.pdfMaxPages} 页）。`);
    this.name = "PdfTooLargeError";
  }
}

/** 把一页的文本项组装为行（近似换行：利用 item.hasEOL）。 */
function pageToText(items: readonly { str?: string; hasEOL?: boolean }[]): string {
  let out = "";
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    out += item.str;
    if (item.hasEOL) out += "\n";
  }
  return out;
}

/** 抽取 PDF 全文为纯文本（不落盘；内存解析）。失败抛 PdfNoTextError / PdfTooLargeError。 */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    if (doc.numPages > LIMITS.pdfMaxPages) throw new PdfTooLargeError();
    const lines: string[] = [];
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      try {
        const content = await page.getTextContent();
        const text = pageToText(content.items as { str?: string; hasEOL?: boolean }[]);
        if (text.trim()) lines.push(text);
      } finally {
        page.cleanup();
      }
    }
    const full = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!full) throw new PdfNoTextError();
    return full;
  } finally {
    await doc.destroy();
  }
}
