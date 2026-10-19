/**
 * OCR 错误类别 + **Rust 机器令牌 → 类别的唯一解析点**（F8 范围 2）。
 *
 * 与 `web-error.ts` 同构、同理由独立成模块：`pdf-ocr.ts`（纯逻辑，单测直接
 * import）若反过来依赖 `desktop-ocr.ts`，就会把 `@tauri-apps/api/core` 拖进
 * 纯逻辑层 —— 那是一条架构上不该有的边。
 *
 * 契约：Rust 侧 `ocr.rs::token()` 生成令牌、本模块解析令牌。
 * 两端各有单测锁格式：`cargo test --lib` 锁生成端、`test:ocr` 锁解析端。
 * **令牌里绝不带用户可见文案**（导入层纪律 G2），文案由 `error-text.ts` 查 i18n。
 */

/**
 * 用户可见语义的 OCR 错误类别。
 *
 * 只有两类：Vision 的六种令牌对用户而言只区分「这台机器做不了」与
 * 「这次识别失败了」—— 拆成六句会把可行动信息稀释成技术细节。
 * 原始令牌保留在 `detail` 里供排障。
 *
 * ⚠️ 页数超限（`pdf-ocr-too-many-pages`）**不在这里** —— 它是 TS 侧
 * `ocrPdf` 在渲染前就判掉的产品约束，不是桥失败。
 */
export type OcrErrorKind =
  /** 非桌面端，或系统没有 Vision 文字识别 / 缺目标语言（macOS 10.15）。 */
  | "unavailable"
  /** Vision 报错 / IPC 失败 / 图片字节损坏。 */
  | "failed";

/** OCR 调用错误（不携带用户可见文案）。 */
export class OcrError extends Error {
  readonly kind: OcrErrorKind;
  /** 排障细节（原始令牌）；**不直接展示**。 */
  readonly detail?: string;

  constructor(kind: OcrErrorKind, detail?: string) {
    super(detail === undefined ? kind : `${kind}: ${detail}`);
    this.name = "OcrError";
    this.kind = kind;
    if (detail !== undefined) this.detail = detail;
  }
}

/**
 * Rust 机器令牌 → 类别。
 *
 * ⚠️ 未知令牌**不抛错**、归入 `failed`（前端比 Rust 新的场景下不能白屏）。
 */
export function ocrErrorKindOf(token: string): OcrErrorKind {
  const head = token.includes(":") ? token.slice(0, token.indexOf(":")) : token;
  switch (head) {
    case "unsupported-os":
    case "unsupported-language":
      return "unavailable";
    default:
      return "failed";
  }
}
