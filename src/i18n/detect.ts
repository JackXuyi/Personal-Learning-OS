/**
 * 系统语言探测（D3：auto 模式 = 跟随系统 locale）。
 * zh-*（含 zh-CN/zh-TW/zh-Hans…）→ zh，其余（en/ja/…）→ en。
 */

import type { ResolvedLang } from "./types";

export function detectSystemLang(): ResolvedLang {
  if (typeof navigator === "undefined") return "zh";
  const lang = (navigator.language ?? "").toLowerCase();
  return lang.startsWith("zh") ? "zh" : "en";
}
