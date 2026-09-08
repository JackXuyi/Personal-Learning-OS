import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LangMode } from "../i18n/types";

/**
 * 界面语言偏好（D4：独立于 settings store）。
 *
 * 独立原因（docs/i18n-design-2026-09.md D4）：
 * - settings store 现为 v2（active 复合结构 + 自定义 merge 白名单归一化），
 *   并入语言字段需同步改 SavedSettings/partialize/normalize 三处，易丢字段；
 * - 语言与 AI 模型配置正交，单字段独立 store 零迁移成本。
 *
 * mode 三态：auto（跟随系统）/ zh / en。
 */
interface LangState {
  mode: LangMode;
  setMode: (mode: LangMode) => void;
}

export const useLangStore = create<LangState>()(
  persist(
    (set) => ({
      mode: "auto",
      setMode: (mode) => set({ mode }),
    }),
    {
      name: "plos:lang:v1",
      partialize: (s) => ({ mode: s.mode }),
    },
  ),
);
