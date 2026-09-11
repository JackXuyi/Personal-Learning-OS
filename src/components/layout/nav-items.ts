/**
 * 侧栏导航清单（单一事实源）。
 *
 * 原实现在 `AppShell.tsx` 中运行时按字典拼出「五分组 + 双行」结构；本轮改为平铺
 * 单列 + 图标后，图标（代码资产）与文案（运行时资产）生命周期不同，拆成模块常量
 * 更合适：结构在这里固定，文案仍从 i18n 取。
 *
 * 详见 docs/nav-sidebar-redesign-design-2026-09.md §8.1。
 */
import {
  CalendarDays,
  ClipboardCheck,
  House,
  Library,
  Network,
  Settings,
  Target,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Messages } from "../../i18n";

/** 导航条目字典形态（label 主行 + hint 浮层文案）。 */
export interface NavEntry {
  label: string;
  hint: string;
}

/**
 * 可用键 = `nav` 命名空间中同时含 label/hint 的条目键。
 *
 * 字典增删改会在编译期同步候选集，`NAV_ITEMS.navKey` 写错立即报错（方案 §11-R4）。
 */
export type NavKey = {
  [K in keyof Messages["nav"]]: Messages["nav"][K] extends NavEntry ? K : never;
}[keyof Messages["nav"]];

export interface NavItemSpec {
  to: string;
  icon: LucideIcon;
  /** 字典键（`Messages["nav"]` 下），label 与 hint 同源。 */
  navKey: NavKey;
  /** 精确匹配：仅根路由需要，避免任意子路径时「首页」同时高亮。 */
  end?: boolean;
  /** 右侧展示 AI Provider 就绪状态点。 */
  readyDot?: boolean;
}

/**
 * 平铺顺序 = 学习闭环，而非模块归类：
 * 今日（现在做什么）→ 计划（接下来学什么）→ 资料库（看什么）→ 测评（检验）
 * → 目标（为何而学）→ 我的画像（我是谁）→ 设置（系统）。
 */
export const NAV_ITEMS: NavItemSpec[] = [
  { to: "/", navKey: "home", icon: House, end: true },
  { to: "/plan", navKey: "plan", icon: CalendarDays },
  { to: "/learn", navKey: "library", icon: Library },
  { to: "/quiz", navKey: "quiz", icon: ClipboardCheck },
  { to: "/goals", navKey: "goals", icon: Target },
  { to: "/learner", navKey: "learner", icon: UserRound },
  { to: "/settings", navKey: "settings", icon: Settings, readyDot: true },
];

export interface NavComingSpec {
  navKey: NavKey;
  icon: LucideIcon;
  /** 右侧里程碑徽标。 */
  badge: string;
}

/** 占位项：概念图谱（N5 上线前不可点）；渲染为 `<div aria-disabled>`，不进 Tab 序列。 */
export const NAV_COMING: NavComingSpec = { navKey: "graph", icon: Network, badge: "N5" };
