import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useLangStore } from "../stores/useLangStore";
import { detectSystemLang } from "./detect";
import type { Messages, ResolvedLang } from "./types";
import { zh } from "./messages/zh";
import { en } from "./messages/en";

interface I18nContextValue {
  /** 实际生效语言（auto 已解析）。 */
  lang: ResolvedLang;
  /** 当前语言的文案对象。 */
  m: Messages;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const TABLE: Record<ResolvedLang, Messages> = { zh, en };

const HTML_LANG: Record<ResolvedLang, string> = { zh: "zh-CN", en: "en" };

/**
 * 界面语言 Provider（D2/D3）：
 * - 订阅 useLangStore.mode，auto 时用 detectSystemLang() 解析；
 * - 切语言 = 换 messages 对象 → Context 变化 → 全树重渲染，无刷新；
 * - 副作用：同步 <html lang> 与 document.title / meta description。
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const mode = useLangStore((s) => s.mode);
  const lang: ResolvedLang = mode === "auto" ? detectSystemLang() : mode;
  const m = TABLE[lang];

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang];
    document.title = m.app.title;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    if (meta) meta.content = m.app.metaDescription;
  }, [lang, m]);

  const value = useMemo(() => ({ lang, m }), [lang, m]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** 读取当前语言与文案对象（Provider 外调用兜底中文，仅测试/静态场景）。 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  return { lang: "zh", m: zh };
}
