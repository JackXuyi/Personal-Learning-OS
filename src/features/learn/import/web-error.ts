/**
 * 网页抓取错误类别 + **Rust 机器令牌 → 类别的唯一解析点**（F8 范围 5）。
 *
 * ⚠️ 刻意独立成一个模块（方案 §8.3）：`web-page.ts`（纯逻辑，单测要直接 import）
 *    与 `desktop-fetch.ts`（依赖 `@tauri-apps/api/core`）若互相 import 就会成环，
 *    且会让纯逻辑层间接依赖桌面桥 —— 那正是 `TC-EDGE-18` 要守住的线。
 *
 * 契约：Rust 侧 `net.rs::token()` 生成令牌、本模块解析令牌（D9-A）。
 * 两端各有自己的单测锁格式：`cargo test --lib` 锁生成端、`test:web` 锁解析端。
 * **令牌里绝不带用户可见文案**（导入层纪律 G2），文案由 `error-text.ts` 按 kind 查 i18n。
 */

/**
 * 用户可见语义的错误类别（`error-text.ts` 按 kind 取 i18n）。
 *
 * ⚠️ 「网络失败」刻意把 Rust 侧的 `network` / `timeout` / `too-many-redirects`
 *    三种令牌合并成一类：对用户而言三种都只有「检查网络后重试」一个动作，
 *    拆成三句会把可行动信息稀释成技术细节。原始令牌仍保留在 `detail` 里供排障。
 */
export type WebErrorKind =
  /** 非法链接 / 非 http(s)。 */
  | "invalid"
  /** 网络失败（含超时、重定向过多）。 */
  | "network"
  /** 站点返回非 2xx。 */
  | "http-error"
  /** 传输超 5MiB，或提取出的正文超 `LIMITS.webMaxChars`。 */
  | "too-large"
  /** Content-Type 是二进制类（PDF / 图片 / 压缩包…）。 */
  | "not-html"
  /** 抓到了，但提取不到正文（SPA / 反爬 / 纯图）。 */
  | "no-text"
  /** 非桌面端（浏览器预览）。 */
  | "desktop-only";

/**
 * 网页导入错误。
 * **不携带用户可见文案**：只带 `kind` + 语言中立的 `detail`（HTTP 状态 / 上限值 / 原始令牌），
 * `message` 仅供排障、不应直接展示（与 `GithubImportError` 同口径）。
 */
export class WebImportError extends Error {
  readonly kind: WebErrorKind;
  /** 排障细节；**不直接展示**。 */
  readonly detail?: string;

  constructor(kind: WebErrorKind, detail?: string) {
    super(detail === undefined ? kind : `${kind}: ${detail}`);
    this.name = "WebImportError";
    this.kind = kind;
    if (detail !== undefined) this.detail = detail;
  }
}

/**
 * Rust 机器令牌 → 用户可见语义类别。
 *
 * 令牌形态：`"network"`（无 detail）或 `"http-error:404"`（`kind:detail`）。
 * ⚠️ 未知令牌**不抛错**、归入 `network`（同时把原令牌留在 `detail`）——
 *    前端比 Rust 新的场景下不能因为多一个令牌就白屏。
 */
export function webErrorKindOf(token: string): { kind: WebErrorKind; detail?: string } {
  const idx = token.indexOf(":");
  const head = idx === -1 ? token : token.slice(0, idx);
  const rest = idx === -1 ? "" : token.slice(idx + 1);
  const detail = rest.length > 0 ? rest : undefined;
  switch (head) {
    case "invalid-url":
      return { kind: "invalid", ...(detail !== undefined ? { detail } : {}) };
    case "network":
    case "timeout":
    case "too-many-redirects":
      return { kind: "network", detail: token };
    case "http-error":
      return { kind: "http-error", ...(detail !== undefined ? { detail } : {}) };
    case "too-large":
      return { kind: "too-large", ...(detail !== undefined ? { detail } : {}) };
    default:
      // `build-client:<detail>` 与任何未来新增令牌都落这里，不崩。
      return { kind: "network", detail: token };
  }
}
