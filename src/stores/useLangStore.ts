import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LangMode } from "../i18n/types";
import type { TranslationTarget } from "../domain/translation";

/**
 * 界面语言偏好（D4：独立于 settings store）。
 *
 * 独立原因（docs/i18n-design-2026-09.md D4）：
 * - settings store 现为 v2（active 复合结构 + 自定义 merge 白名单归一化），
 *   并入语言字段需同步改 SavedSettings/partialize/normalize 三处，易丢字段；
 * - 语言与 AI 模型配置正交，单字段独立 store 零迁移成本。
 *
 * mode 三态：auto（跟随系统）/ zh / en。
 *
 * 翻译目标语言也放这里（docs/learn-ai-translation-design-2026-10.md D1/§8.5）：
 * 它与界面语言同属「读东西时用哪种语言文字」，且**沿用同一个持久化键**
 * `plos:lang:v1` ⇒ 不新增 localStorage key ⇒ 不动导出白名单、不动 `clearAll`。
 * 旧版本读不到该字段直接忽略（无损），新版本读旧数据由 zustand 浅合并补默认
 * `auto`（`persist` 默认 merge 行为，见 §8.5 注释）。
 */
interface LangState {
  mode: LangMode;
  /** 翻译目标语言（`auto` = 跟随界面语言）。 */
  translationTarget: TranslationTarget;
  setMode: (mode: LangMode) => void;
  setTranslationTarget: (t: TranslationTarget) => void;
}

export const useLangStore = create<LangState>()(
  persist(
    (set) => ({
      mode: "auto",
      translationTarget: "auto",
      setMode: (mode) => set({ mode }),
      setTranslationTarget: (translationTarget) => set({ translationTarget }),
    }),
    {
      name: "plos:lang:v1",
      partialize: (s) => ({ mode: s.mode, translationTarget: s.translationTarget }),
    },
  ),
);
