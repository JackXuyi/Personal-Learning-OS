/**
 * 网页抓取桌面桥 —— Rust `net::fetch_url` 的薄封装（F8 范围 5，方案 §8.4）。
 *
 * 与 `features/data/portability/desktop-backup.ts` 完全同构：`isTauri()` 守卫 +
 * 镜像类型 + 异常转译，**不含任何判定逻辑**（判定在 `web-page.ts` 的纯函数里，
 * 那样 node 单测才能直跑）。
 *
 * 契约（与 `src-tauri/src/net.rs::FetchedPage` 对应，camelCase 由 Tauri 自动转换）：
 * 两边**同改** —— Rust 字段名改动而这里未跟，表现是运行时字段为 `undefined`（静默）。
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { WebImportError, webErrorKindOf } from "./web-error";

/** `net.rs::FetchedPage` 的镜像（camelCase）。 */
export interface FetchedPage {
  /** 跟随重定向后的最终地址（写入 `SourceDocument.source`）。 */
  finalUrl: string;
  /** HTTP 状态码。 */
  status: number;
  /** 原始 `Content-Type`（可能含 charset）。 */
  contentType?: string;
  /** 原始响应字节的 base64（**未解码**）。 */
  bytesBase64: string;
  /** base64 解码前的字节数。 */
  byteLen: number;
}

/**
 * 抓取能力是否可用（**仅桌面端**）。
 *
 * 浏览器预览下无法跨站读取网页（CORS），故 UI 据此禁用整块能力并说明原因 ——
 * 与 `VectorIndexCard` 的处理同构：不做「点了没反应的死按钮」，也不直接隐藏
 * （隐藏会让用户根本不知道有这个能力）。
 */
export function isWebImportAvailable(): boolean {
  return isTauri();
}

/** 抓取一个网页（仅桌面端；非桌面端抛 `desktop-only`，防御纵深）。 */
export async function fetchUrl(url: string): Promise<FetchedPage> {
  if (!isTauri()) throw new WebImportError("desktop-only");
  try {
    return await invoke<FetchedPage>("fetch_url", { url });
  } catch (err) {
    // Rust 侧一律回机器令牌字符串；非字符串（理论上不会）也兜住不崩。
    const { kind, detail } = webErrorKindOf(typeof err === "string" ? err : String(err));
    throw new WebImportError(kind, detail);
  }
}
