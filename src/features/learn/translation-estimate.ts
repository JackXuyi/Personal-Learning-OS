/**
 * 翻译耗时的**唯一估算口径** —— 阅读页（单章）与设置页（整库）共用。
 *
 * ⚠️ 刻意只放 UI 层，不进 `domain`：吞吐是**本机实测值**（换机器 / 换模型就变），
 * 写进领域层会被后来的人当契约读。这里给的只是「量级提示」，不是产品承诺。
 *
 * 为什么值得单独成文件：`LOCAL_CHARS_PER_SEC` 曾在设置卡片里就地定义，阅读页
 * 又需要同一个数 —— 两处各写一份，换模型后必然一处改一处不改，于是设置页说
 * 「约 5 小时」而阅读页说「约 20 分钟」。
 */
import type { ProviderKind } from "../../ai/types";

/**
 * 本地模型翻译吞吐（字符/秒）。
 *
 * 取自 2026-10-22 应用日志：682 字 / 24.8s、715 字 / 20.5s ⇒ ≈30 字/秒。
 */
export const LOCAL_CHARS_PER_SEC = 30;

/**
 * 估算耗时（分钟）；`undefined` = **不估**。
 *
 * 只估本地模型：云 API 的速度取决于模型、RPM 与网络，编一个数字比不显示更糟
 * （用户会拿它当承诺）。`undefined` 与 `0` 刻意区分 —— 0 会被 `.toFixed()` 渲染成
 * 「约 0.0 小时」这种噪音。
 */
export function estimatedMinutesOf(chars: number, kind: ProviderKind): number | undefined {
  if (kind !== "builtin" || chars <= 0) return undefined;
  return chars / LOCAL_CHARS_PER_SEC / 60;
}
