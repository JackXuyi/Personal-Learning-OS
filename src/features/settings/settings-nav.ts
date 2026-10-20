import { isDesktopLogAvailable } from "../../lib/desktop-log";

/**
 * 设置分区单一事实源（docs/settings-left-menu-layout-design-2026-10.md §8.1）。
 *
 * 分区键同时是 URL 段（`/settings/<key>`）⇒ 追加/改名分区必须同批改路由与文案。
 * 文案不在此处：`settings.sections.<key>` 由 UI 直接取（服务层不产文案）。
 */

/** 设置分区键（= URL 段，小写字面量联合，大小写敏感）。 */
export type SectionKey = "ai" | "storage" | "learning" | "appearance" | "shortcuts" | "logs" | "about";

/** 展示顺序 = 唯一真源；左栏渲染与 URL 校验都读它。 */
export const SECTION_ORDER: readonly SectionKey[] = [
  "ai",
  "storage",
  "learning",
  "appearance",
  "shortcuts",
  "logs",
  "about",
];

/** URL 段是否合法分区键。 */
export function isSectionKey(v: string | undefined): v is SectionKey {
  return !!v && (SECTION_ORDER as readonly string[]).includes(v);
}

/**
 * 当前环境可见的分区：日志分区仅桌面端存在（`isDesktopLogAvailable()`）。
 *
 * ⚠️ 不可见分区既不出现在左栏，也不接受深链（见 SettingsPage 的 `<Navigate replace>`）。
 */
export function visibleSections(): SectionKey[] {
  return SECTION_ORDER.filter((k) => k !== "logs" || isDesktopLogAvailable());
}
