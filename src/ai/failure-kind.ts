/**
 * AI 调用失败的**原因分类** —— 服务层只产分类，文案由 UI 走 i18n 映射
 * （`domain/qa.ts` / `domain/restatement.ts` / `domain/capability.ts` 三处同款约定的**唯一出处**）。
 *
 * 为什么收在这里：`features/learn/chapter-qa-service`、`features/learn/restatement-service`、
 * `features/goals/capability-service` 曾各自持有一份**逐字相同**的 `classify*Error`
 * （注释自称「照抄 / 同口径」）—— 同一条规则散在 ≥3 处，改一处必然漂移。
 * 归并到本函数后，三个 domain 的 kind 联合**已包含**下面 4 个字面量，调用点直接赋值即可
 * （它们各自还另有 `invalid-question` / `too-short` / `no-ai` 等**本函数不产生**的分类）。
 *
 * ⚠️ 三个 domain 联合**刻意**继续写自己的字面量，不 import 本模块 ——
 * `domain` 是叶子层（`npm run layer:check` 的 A1）。
 *
 * 口径：
 * - `not-configured` —— 未配置 / 密钥失效（在阻断门通过后出现即竞态）；
 * - `request-failed` —— 主要是模型输出不可解析（`chatJson` / `extractJson`），
 *   本地小模型最常见的失败模式，故归入 `parse`；
 * - 其它 `AiProviderError` code（如 `not-implemented`）→ `generic`；
 * - 非 AI 异常（storage / 检索链路）→ `fetch`。
 */
import { AiProviderError } from "./types";

/** 失败原因分类（`parse` 是「模型输出不可解析」的通用名，非仅 JSON 解析失败）。 */
export type AiFailureKind = "not-configured" | "parse" | "generic" | "fetch";

/** 异常 → 稳定分类（不把异常栈丢给用户；文案由 UI 按 kind 取 i18n）。 */
export function aiFailureKindOf(err: unknown): AiFailureKind {
  if (err instanceof AiProviderError) {
    if (err.code === "not-configured") return "not-configured";
    if (err.code === "request-failed") return "parse";
    return "generic";
  }
  return "fetch";
}
