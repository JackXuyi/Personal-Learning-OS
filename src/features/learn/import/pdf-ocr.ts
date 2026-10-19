/**
 * 扫描件 PDF 的 OCR 编排（F8 范围 2）—— **纯逻辑，零 DOM / 零 IPC**。
 *
 * 三件事：按页数护栏 → 逐页「渲染 + 识别」→ 拼接并卡字符上限。
 * 渲染器与识别器都由调用方注入（`PdfOcrDeps`），故 node 单测能用假实现
 * 覆盖全部分支，不需要 canvas、不需要 macOS、不需要真实 PDF。
 *
 * ⚠️ 为什么 `renderPages` 是**异步迭代**而不是「返回数组」：
 * 一次渲染 50 页并全部留在内存里，峰值是 50 × ~10MB 位图（2400px 位图，
 * 不是 JPEG 字节）。改成交错迭代后，任一时刻只有**一页**在被识别，
 * 位图在 yield 后即被渲染层释放，且进度天然跟着页走。
 * （方案 §6.1 写的是返回数组，此处按内存与进度实况调整，见方案实施偏差。）
 *
 * 兜底口径（D4）：**只在整篇 0 字符时**由调用方进来，因此这里不做
 * 「哪些页有文字」的判断 —— 混合文档的逐页补齐是另一个设计。
 */
import { LIMITS } from "./types";
import { OcrError } from "./ocr-error";

/** 一页的渲染结果（`page` 从 1 开始，与 PDF 页号一致）。 */
export interface RenderedPage {
  page: number;
  bytes: Uint8Array;
}

/** OCR 依赖（生产实现见 `pdf-render.ts` / `desktop-ocr.ts`；单测注入假实现）。 */
export interface PdfOcrDeps {
  /** 逐页渲染；**同一份 PDF 只解析一次**，逐页 yield、逐页释放位图。 */
  renderPages: (buffer: ArrayBuffer, pages: number[]) => AsyncIterable<RenderedPage>;
  /** 单页图片 → 文本行（`\n` 连接）。失败抛错，由本模块吞掉并跳过该页。 */
  recognize: (bytes: Uint8Array) => Promise<string>;
  /** 每处理完一页回调一次（渲染与识别交错，故它就是真实进度）。 */
  onProgress?: (done: number, total: number) => void;
}

/** 页数超过 OCR 上限（D5：**报错不截断**）。 */
export class PdfOcrTooManyPagesError extends Error {
  constructor(limit: number = LIMITS.ocrMaxPages) {
    super(`ocr pages exceed limit (${limit})`);
    this.name = "PdfOcrTooManyPagesError";
  }
}

/** 识别完仍是空文本（整页是图表 / 扫描质量太差）。 */
export class PdfOcrNoTextError extends Error {
  constructor(message = "no text recognized in any page") {
    super(message);
    this.name = "PdfOcrNoTextError";
  }
}

/** 识别出的正文超过入库体量上限。 */
export class PdfOcrTooLargeError extends Error {
  constructor(limit: number = LIMITS.pdfOcrMaxChars) {
    super(`ocr text exceeds limit (${limit} chars)`);
    this.name = "PdfOcrTooLargeError";
  }
}

/** OCR 结果。 */
export interface PdfOcrResult {
  text: string;
  /** 实际走完「渲染 + 识别」的页数（单页失败也算处理过，只是没产出文字）。 */
  ocrPages: number;
}

/** 只取需要的两条线，便于测试传小值而不必造 1.5M 字符。 */
export interface PdfOcrLimits {
  ocrMaxPages: number;
  pdfOcrMaxChars: number;
}

/**
 * 逐页 OCR 整篇 PDF。
 *
 * 单页识别失败**不中断整篇**：扫描书里夹一页插图是常态，一页失败就丢掉整本
 * 是本末倒置。全部页都没文字时才抛 `PdfOcrNoTextError`。
 */
export async function ocrPdf(
  buffer: ArrayBuffer,
  pageCount: number,
  deps: PdfOcrDeps,
  limits: PdfOcrLimits = {
    ocrMaxPages: LIMITS.ocrMaxPages,
    pdfOcrMaxChars: LIMITS.pdfOcrMaxChars,
  },
): Promise<PdfOcrResult> {
  if (!Number.isFinite(pageCount) || pageCount <= 0) throw new PdfOcrNoTextError();
  if (pageCount > limits.ocrMaxPages) throw new PdfOcrTooManyPagesError(limits.ocrMaxPages);

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const blocks: string[] = [];
  let processed = 0;
  let chars = 0;

  for await (const rendered of deps.renderPages(buffer, pages)) {
    let raw = "";
    try {
      raw = await deps.recognize(rendered.bytes);
    } catch (err) {
      // ⚠️ 「这台机器做不了 OCR」是**系统性**失败：重试下一页也不会有不同结果，
      //    且用户最该看到的是它（而不是「整篇没识别出文字」）。
      //    其它错误按单页失败处理 —— 扫描书夹一页插图是常态。
      if (err instanceof OcrError && err.kind === "unavailable") throw err;
      raw = "";
    }
    processed += 1;
    deps.onProgress?.(processed, pageCount);
    const block = raw.trim();
    if (!block) continue;
    // 逐页累加并卡上限：等全文拼完再判会把 3M 字符先驻留进内存。
    chars += block.length;
    if (chars > limits.pdfOcrMaxChars) throw new PdfOcrTooLargeError(limits.pdfOcrMaxChars);
    blocks.push(block);
  }

  // 页间空行分段（与 pdf.ts 的口径一致），再把 3 连换行折回 2 连。
  const text = blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new PdfOcrNoTextError();
  return { text, ocrPages: processed };
}
