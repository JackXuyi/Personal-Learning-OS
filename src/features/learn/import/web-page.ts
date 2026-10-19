/**
 * 网页来源适配器（F8 范围 5）—— URL 规范化 → 编码判定 → 正文提取 → 编排成 ImportUnit。
 *
 * 链路：`parseWebUrl` → `fetchPage`（桌面桥，注入）→ `isBinaryContentType` 预筛 →
 * `decodeHtml`（复用 `decode.ts` 嗅探链）→ `Readability.parse` → `htmlNodesToMarkdown`
 * → `ImportUnit`（交共享管道 `runUnitImport`）。
 *
 * ⚠️ **纯逻辑层**：不 import React、不 import `@tauri-apps/**` 的运行时值
 *    （`FetchedPage` 只作 `import type`）⇒ node 单测可直接 import 本模块，
 *    抓取能力由调用方以 `fetchPage` 注入（与 `github.ts` 的 `FetchLike` 同思路）。
 *
 * ⚠️ 与 `github.ts` 的一处刻意差异：那条走 webview `fetch`（GitHub 主动发 CORS 头），
 *    这条必须落 Rust（任意站点不发 CORS 头，webview 读不到响应体）——
 *    所以这里的「网络」是注入的薄封装，而不是全局 `fetch`。
 *
 * 设计依据：docs/url-import-design-2026-10.md §8.6（D3-A / D4-A / D6-A / D7-A）。
 */
import { Readability } from "@mozilla/readability";
import { LIMITS } from "./types";
import type { ImportUnit } from "./types";
import { decodeBytes } from "./decode";
import { htmlNodesToMarkdown } from "./html-markdown";
import { WebImportError } from "./web-error";
import type { FetchedPage } from "./desktop-fetch";

/**
 * HTML 解析器：定义搬到 `html-parse.ts`（EPUB 导入共用同一对类型与实现）。
 * 此处 re-export 保持既有消费方（`WebPanel.tsx`）零改动。
 */
import type { HtmlParser } from "./html-parse";
export type { HtmlParser } from "./html-parse";
export { browserHtmlParser } from "./html-parse";

/** 正文入库字符护栏（与 `LIMITS.webMaxChars` 同一把尺子；测试可注入小值）。 */
export interface WebUnitLimits {
  webMaxChars: number;
}

/**
 * 规范化用户输入的链接。
 *
 * - 空串 / 无法解析 / 非 `http(s)` / 无 host ⇒ `invalid`（**不发请求**）；
 * - 无 scheme（用户从移动端复制的常见形态 `example.com/post`）⇒ 自动补 `https://`。
 *
 * ⚠️ 白名单在 TS 侧**先拦一道**（给出可行动的「无法解析该链接」文案），
 *    Rust 侧 `net.rs::scheme_allowed` 是第二道（防御纵深；UI 被绕过时仍拒 `file:`）。
 */
export function parseWebUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new WebImportError("invalid");
  const withScheme = /^[a-zA-Z][\w+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new WebImportError("invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebImportError("invalid", url.protocol);
  }
  if (!url.hostname) throw new WebImportError("invalid");
  return url.toString();
}

/**
 * charset 判定，优先级 = **HTTP 头 > `<meta charset>`**（WHATWG：传输层优先）。
 * 大小写不敏感；两者都没有 ⇒ `undefined`，交给 `decodeBytes` 的 BOM/UTF-8/GB18030 链。
 *
 * `headAscii` 是文档**头部字节的 ASCII 视图** —— charset 声明本身是 ASCII，
 * 故无需先解码即可嗅探（这也是「GBK 页能不能救回来」的关键：先解码再嗅探就晚了）。
 */
export function htmlCharsetOf(contentType: string | undefined, headAscii: string): string | undefined {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(headAscii)?.[1];
  return fromMeta?.toLowerCase();
}

/** 嗅探用的头部字节数（覆盖 `<head>` 里的 charset 声明绰绰有余）。 */
const HEAD_SNIFF_BYTES = 2048;

/**
 * base64 字节 → `{ html, encoding }`。
 *
 * ⚠️ `encoding` 必须回传给结果卡（`extract.encoding` → `encodingHint`）：
 *    仓库纪律「不做静默兜底」—— 用户要能看到「已按 gb18030 解码」，
 *    否则中文乱码时无从判断是站点问题还是本机解码问题。
 *
 * 拿到 charset 标签后**先信它**（传输层 / 页面自述是比启发式更强的证据）；
 * 标签本机不支持（`TextDecoder` 抛 `RangeError`）才落回嗅探链。
 */
export function decodeHtml(
  bytesBase64: string,
  contentType?: string,
): { html: string; encoding: string } {
  const bin = atob(bytesBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);

  const headAscii = new TextDecoder("latin1").decode(bytes.subarray(0, HEAD_SNIFF_BYTES));
  const label = htmlCharsetOf(contentType, headAscii);
  if (label) {
    try {
      return { html: new TextDecoder(label).decode(bytes), encoding: label };
    } catch {
      // 运行时缺该标签 → 落回嗅探链（不阻断导入）。
    }
  }
  const sniffed = decodeBytes(bytes.buffer as ArrayBuffer);
  return { html: sniffed.text, encoding: sniffed.encoding };
}

/**
 * Content-Type 是否明显是二进制类 ⇒ **不送进提取器**。
 *
 * 否则会把 PDF 字节当 HTML 解析出一道 `no-text`（「未能提取正文」），
 * 而用户真正该看到的是「这不是网页，请改用本地文件导入」—— 两种失败的动作不同。
 *
 * ⚠️ Content-Type 缺失**不判死**：不少站点不发该头，此时照常走提取（提取失败还有 `no-text` 兜底）。
 */
export function isBinaryContentType(contentType?: string): boolean {
  if (!contentType) return false;
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === "text/html" || mime === "application/xhtml+xml") return false;
  return /^(application\/(pdf|zip|json|octet-stream|msword)|image\/|audio\/|video\/)/.test(mime);
}

export interface WebUnitDeps {
  /** 抓取实现（生产＝`desktop-fetch.ts::fetchUrl`；单测注入假实现，**不联网**）。 */
  fetchPage: (url: string) => Promise<FetchedPage>;
  /** HTML 解析器（生产＝`browserHtmlParser`；单测＝`linkedom`）。 */
  parseHtml: HtmlParser;
  /** 用户原始输入（用于解析与排障；`source` 用**终址**）。 */
  sourceUrl: string;
}

/**
 * 抓取 + 提取，产出「一份资料」的 ImportUnit。
 *
 * 失败一律抛 `WebImportError`（只带 kind）：
 * - `not-html` 二进制内容；`no-text` 提不到正文；`too-large` 正文超护栏；
 * - 网络 / HTTP 类错误由 `fetchPage` 抛（令牌已在桥层转译成 kind）。
 *
 * ⚠️ 正文超护栏**不静默截断**（与 GitHub / 粘贴同口径）：截断会让用户以为导全了。
 */
export async function buildWebUnit(
  deps: WebUnitDeps,
  limits: WebUnitLimits = LIMITS,
): Promise<ImportUnit> {
  const url = parseWebUrl(deps.sourceUrl);
  const page = await deps.fetchPage(url);

  if (isBinaryContentType(page.contentType)) {
    throw new WebImportError("not-html", page.contentType);
  }

  const { html, encoding } = decodeHtml(page.bytesBase64, page.contentType);

  // `charThreshold: 0`：默认值会把短文章判成「不值得提取」而回 null，
  // 但用户明确贴了这个链接 ⇒ 提取与不提取交给下面的 `no-text` 判据，而不是长度阈值。
  const article = new Readability(deps.parseHtml(html), { charThreshold: 0 }).parse();
  if (!article || !(article.content ?? "").trim()) throw new WebImportError("no-text");

  // ⚠️ 必须自带 `<body>` 包裹：`linkedom` 对片段解析会给出**空的 body**
  //    （内容落在 `documentElement.children`，实测）；浏览器侧包一层也无害。
  const wrapped = deps.parseHtml(
    `<!doctype html><html><body>${article.content ?? ""}</body></html>`,
  );
  const root = wrapped.body ?? wrapped.documentElement;
  const markdown = htmlNodesToMarkdown(root);
  if (!markdown.text.trim()) throw new WebImportError("no-text");
  if (markdown.text.length > limits.webMaxChars) {
    throw new WebImportError("too-large", String(markdown.text.length));
  }

  const hostname = new URL(page.finalUrl).hostname;
  return {
    title: (article.title ?? "").trim() || hostname,
    titleSource: "derived",
    format: "web",
    splitFormat: "markdown",
    text: markdown.text,
    // 用**终址**：同一篇文章的短链 / 带 `?utm=` 的变体归一到同一 source ⇒ 查重面板自然生效。
    source: page.finalUrl,
    extract: { encoding, headings: markdown.headings },
  };
}
