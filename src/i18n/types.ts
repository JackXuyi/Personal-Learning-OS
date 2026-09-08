/**
 * i18n 公共类型。
 *
 * `Messages = typeof zh`：zh 是唯一事实源（未加 as const，
 * 字符串叶子保持 string 宽类型），en.ts 以 Messages 同构约束。
 */

export type { Messages } from "./messages/zh";

/** 用户可选语言模式（跟随系统 / 强制中文 / 强制英文）。 */
export type LangMode = "auto" | "zh" | "en";

/** 解析后的实际生效语言（auto 由系统探测决定）。 */
export type ResolvedLang = "zh" | "en";
