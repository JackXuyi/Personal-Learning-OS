/**
 * 能力评测「服务层状态 → UI 文案」的**单一映射点**（F6）。
 *
 * 为什么单独成文件：`CapabilityPage`（提炼 / 发起 / 保存）与 `CapabilityRunPage`
 * （提交 / 重评）都要把同一批状态翻成同一批文案 —— 两处各写一遍必然漂移。
 * 服务层只产分类（`CapabilityStatus` / `CapabilityErrorKind`），中文/英文一律在此映射
 * （`rules/engineering-code-style.mdc`：服务层不抛中文）。
 */
import type { CapabilityErrorKind, CapabilityStatus } from "../../../domain";
import type { Messages } from "../../../i18n";

/** 非 `ok` 状态（含服务层细分的错误分类）→ 面向用户的一句话。 */
export function capabilityStatusText(
  status: Exclude<CapabilityStatus, "ok"> | CapabilityErrorKind,
  c: Messages["capability"],
): string {
  switch (status) {
    case "no-ai":
    case "not-configured":
      return c.err.noAi;
    case "no-scope":
      return c.err.noScope;
    case "no-material":
      return c.err.noMaterial;
    case "no-items":
      return c.err.noItems;
    case "parse":
      return c.err.parse;
    case "fetch":
      return c.err.fetch;
    default:
      return c.err.generic;
  }
}

/** 该状态是否值得给「去设置 AI」入口（只有 AI 缺失类才给）。 */
export function wantsAiSettings(
  status: Exclude<CapabilityStatus, "ok"> | CapabilityErrorKind,
): boolean {
  return status === "no-ai" || status === "not-configured";
}

/** 该状态是否值得给「编辑目标」入口（范围类才给）。 */
export function wantsScopeEdit(
  status: Exclude<CapabilityStatus, "ok"> | CapabilityErrorKind,
): boolean {
  return status === "no-scope" || status === "no-material";
}
