/**
 * PDF 页面栅格化（OCR 前置）—— 全仓**唯一**接触 `<canvas>` 的地方。
 *
 * 为什么栅格化留在前端而不是 Rust：pdfjs 已在依赖里且能处理加密/畸形 PDF；
 * 页循环、页数上限、进度回调都落在 TS ⇒ 编排逻辑能用假渲染器单测覆盖。
 * Rust 只收「图片字节 → 文字」（`src-tauri/src/ocr.rs`），与 `net.rs` 的
 * 「只做一件事」保持同构。
 *
 * ⚠️ 本模块**不进单测**：`document.createElement("canvas")` 在 node 下不存在。
 *    `import/pdf-ocr.ts` 通过依赖注入使用它（测试注入假渲染器），
 *    本文件只在真实桌面/浏览器环境执行。
 */
import { LIMITS } from "./types";
import { loadPdfjs } from "./pdf";
import type { RenderedPage } from "./pdf-ocr";

/** JPEG 质量：扫描件 PNG 常 1–3MB/页，JPEG 约 1/5，OCR 精度无可测差异。 */
const JPEG_QUALITY = 0.85;

/**
 * 逐页渲染为 JPEG 字节（异步迭代，与 `pdf-ocr.ts` 的 `PdfOcrDeps` 对齐）。
 *
 * `scale = min(2, maxEdge / max(w, h))`：
 * - 上限 2 倍 —— 小页面（如 200×300 的票据）放大到 2 倍足够，再放大只是插值噪声；
 * - 大页面按长边收敛到 `maxEdge`（默认 2400px ≈ 200 DPI 的 A4）。
 *
 * ⚠️ 逐页串行、渲染完即 `cleanup` + 清零 canvas 尺寸：2400px 的一页位图约
 *    10MB。yield 出去后消费方（识别）在下一次 `next()` 之前完成，因此
 *    任一时刻只有一页位图存活 —— 并发渲染 50 页会直接把 webview 撑爆。
 */
export async function* renderPdfPages(
  buffer: ArrayBuffer,
  pages: number[],
  opts?: { maxEdge?: number },
): AsyncGenerator<RenderedPage, void, void> {
  const maxEdge = opts?.maxEdge ?? LIMITS.ocrMaxEdge;
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  try {
    for (const pageNumber of pages) {
      const page = await doc.getPage(pageNumber);
      let rendered: RenderedPage;
      try {
        const base = page.getViewport({ scale: 1 });
        const longest = Math.max(base.width, base.height);
        // 兜底 1：极端畸形页（宽高为 0）会让 scale 变成 Infinity/NaN。
        const scale = longest > 0 ? Math.min(2, maxEdge / longest) : 1;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas 2d context unavailable");

        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
        );
        if (!blob) throw new Error("canvas.toBlob returned null");
        rendered = { page: pageNumber, bytes: new Uint8Array(await blob.arrayBuffer()) };

        // 主动释放位图：不依赖 GC 在 50 页循环里及时回收。
        canvas.width = 0;
        canvas.height = 0;
      } finally {
        page.cleanup();
      }
      // ⚠️ yield 放在 try/finally **之后**：消费方拿到的字节已经脱离 page，
      //    即便它中途抛错，page 也已经 cleanup。
      yield rendered;
    }
  } finally {
    await doc.destroy();
  }
}
