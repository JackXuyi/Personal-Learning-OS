/**
 * OCR 桌面桥 —— Rust `ocr::ocr_image` 的薄封装（F8 范围 2，方案 §6.3）。
 *
 * 与 `desktop-fetch.ts` 完全同构：`isTauri()` 守卫 + 镜像类型 + 令牌转译，
 * **不含任何判定逻辑**（页数上限、拼接、体量这些都归 `pdf-ocr.ts` 的纯函数，
 * 那样 node 单测才能直跑）。
 *
 * 契约（对应 `src-tauri/src/ocr.rs::OcrText`，camelCase 由 Tauri 自动转换）：
 * 两边**同改** —— Rust 字段名改了这里没跟，表现是运行时 `undefined`（静默）。
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { OcrError, ocrErrorKindOf } from "./ocr-error";

/** `ocr.rs::OcrText` 的镜像（camelCase）。 */
export interface OcrText {
  /** 识别出的文本行（`\n` 连接）。 */
  text: string;
  /** 非空行数。 */
  lineCount: number;
}

/** Vision 的「这一页没识别出文字」令牌 —— 是**正常结果**，不是失败。 */
const NO_TEXT_TOKEN = "no-text";

/** `String.fromCharCode(...chunk)` 的安全分块大小（V8 参数上限 65535）。 */
const BASE64_CHUNK = 0x8000;

/**
 * 字节 → base64。
 *
 * ⚠️ 不能写 `btoa(String.fromCharCode(...bytes))`：单页 JPEG 约 300–500KB，
 * 一次性展开会直接爆栈（`RangeError: Maximum call stack size exceeded`）。
 * 分块后每块 32KB，稳。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

/**
 * OCR 能力是否可用（**仅桌面端**）。
 *
 * 只判 `isTauri()`，不判系统版本：Vision 是否存在、有无 `zh-Hans` 只有 Rust
 * 侧运行时才知道（`tauri.conf.json` 没写 `minimumSystemVersion`）。系统过旧
 * 时开关仍是可点的，点了会拿到 `unavailable` 的**可行动**文案 —— 比一个
 * 「灰着但不说为什么」的按钮好。
 */
export function isOcrAvailable(): boolean {
  return isTauri();
}

/**
 * 识别一张图片里的文字。
 *
 * 空页返回**空字符串**而不是抛错：扫描书里夹一页插图是常态，那不该算失败，
 * 更不该中断整篇（`pdf-ocr.ts` 只在全篇都空时才报错）。
 */
export async function recognizeImage(bytes: Uint8Array): Promise<string> {
  if (!isTauri()) throw new OcrError("unavailable");
  let bytesBase64: string;
  try {
    bytesBase64 = bytesToBase64(bytes);
  } catch (err) {
    throw new OcrError("failed", err instanceof Error ? err.message : String(err));
  }
  try {
    const out = await invoke<OcrText>("ocr_image", { bytesBase64 });
    return out.text;
  } catch (err) {
    // Rust 侧一律回机器令牌字符串；非字符串（理论上不会）也兜住不崩。
    const token = typeof err === "string" ? err : String(err);
    if (token === NO_TEXT_TOKEN) return "";
    throw new OcrError(ocrErrorKindOf(token), token);
  }
}
