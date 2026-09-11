/**
 * PDF 文本抽取（文本型 PDF → 纯文本）。
 *
 * 基于 pdfjs-dist 在前端逐页 getTextContent 抽取——WebView（Tauri）与
 * 浏览器预览同一条代码路径；Worker 以 asset URL 运行时解析（Vite 自动打包），
 * 无需额外构建插件。
 *
 * 版式处理（G5 修复）：抽取结果先经 `pdf-layout.ts` 做
 * **y 聚类成行 → 分栏重排 → 行内补空格 → 跨页页眉/页码去噪 → 折行/连字符修复**，
 * 再交给切分器。此前只按 `str + hasEOL` 顺序拼接，双栏论文阅读顺序错乱、
 * 中文段落被逐视觉行硬换行。
 *
 * 范围护栏（docs/knowledge-import-design-2026-09.md §3.3）：
 * - 仅文本型 PDF；扫描件（抽不出文本）抛 PdfNoTextError，由 UI 提示，不做 OCR；
 * - 页数超过 LIMITS.pdfMaxPages 拒绝（内存/耗时护栏）。
 *
 * 错误对象**不携带用户可见文案**（G2）：UI 按 `kind` 取 i18n，`message` 只作排障。
 */
import * as pdfjs from "pdfjs-dist";
import { LIMITS } from "./types";
import { joinPageLines, reflowPageItems, stripRunningHeads } from "./pdf-layout";
import type { PdfTextItem } from "./pdf-layout";

// Vite：worker 以 asset URL 形式随构建产物发布。
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/** 扫描件 / 无法抽取文本。 */
export class PdfNoTextError extends Error {
  constructor(message = "no extractable text (scanned or image-only PDF?)") {
    super(message);
    this.name = "PdfNoTextError";
  }
}

/** PDF 页数超出护栏。 */
export class PdfTooLargeError extends Error {
  constructor() {
    super(`pdf pages exceed limit (${LIMITS.pdfMaxPages})`);
    this.name = "PdfTooLargeError";
  }
}

/** 抽取结果：正文 + 页数统计（供结果卡展示「抽全了吗」，G6）。 */
export interface PdfExtractResult {
  text: string;
  /** 总页数。 */
  pageCount: number;
  /** 抽到非空文本的页数（远小于总页数 → 疑似扫描件/图片页）。 */
  nonEmptyPages: number;
}

/** 抽取 PDF 全文为纯文本（不落盘；内存解析）。失败抛 PdfNoTextError / PdfTooLargeError。 */
export async function extractPdfText(buffer: ArrayBuffer): Promise<PdfExtractResult> {
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    if (doc.numPages > LIMITS.pdfMaxPages) throw new PdfTooLargeError();
    const pages: string[][] = [];
    let nonEmptyPages = 0;
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      try {
        const content = await page.getTextContent();
        const pageWidth = page.getViewport({ scale: 1 }).width;
        const lines = reflowPageItems(content.items as unknown as PdfTextItem[], { pageWidth });
        if (lines.some((line) => line.trim())) nonEmptyPages += 1;
        pages.push(lines);
      } finally {
        page.cleanup();
      }
    }
    // 页眉/页脚去噪需要跨页证据，故先收集每页行数组、再统一过滤。
    const cleaned = stripRunningHeads(pages);
    const text = cleaned
      .map(joinPageLines)
      .filter((s) => s.trim())
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text) throw new PdfNoTextError();
    return { text, pageCount: doc.numPages, nonEmptyPages };
  } finally {
    await doc.destroy();
  }
}
