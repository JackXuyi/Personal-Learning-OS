/**
 * 资料库共享小工具（列表页卡片 / 详情页页头共用）。
 * 遵循 engineering-code-style：纯函数 + i18n 字典，不硬编码文案。
 */
import type { DocumentFormat } from "../../../domain";
import type { Messages } from "../../../i18n";

/** 格式徽标文案（DocumentFormat → 字典，缺失回退）。 */
export function formatLabel(format: DocumentFormat, m: Messages): string {
  const table = m.learn.format as unknown as Record<string, string>;
  return table[format] ?? table.fallback ?? format;
}

/** 短日期（随界面语言）：9/8 或 Sep 8。 */
export function shortDate(at: number, lang: "zh" | "en"): string {
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    month: lang === "zh" ? "numeric" : "short",
    day: "numeric",
  }).format(new Date(at));
}
