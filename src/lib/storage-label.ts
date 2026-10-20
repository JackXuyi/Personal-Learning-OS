/**
 * 保存位置判定唯一真源（docs/settings-left-menu-layout-design-2026-10.md §9.2-B）。
 *
 * 三个适配器的 `name`：`"local"`（浏览器 localStorage）/ `"memory"`（临时内存）/ `"tauri"`（桌面 SQLite）。
 *
 * ⚠️ 判据必须是「是否 memory」，而不是 `includes("local")`——后者会把 `"tauri"` 判成内存，
 * 桌面端于是显示「临时（关掉就清空）」，让用户以为数据会丢。
 * ⚠️ 只返回 enum，不返回文案（i18n 无 React 外访问器；文案由 UI 映射）。
 */

/** 数据落在哪：`device` = 这台设备（local / tauri）；`temporary` = 关掉就清空（memory）。 */
export type StoragePlacement = "device" | "temporary";

export function storagePlacementOf(name: string): StoragePlacement {
  return name === "memory" ? "temporary" : "device";
}
