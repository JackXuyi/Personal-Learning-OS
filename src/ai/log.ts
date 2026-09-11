/**
 * AI 链路排查日志 —— 统一 `[ai:<scope>]` 前缀 + 键值对单行输出。
 *
 * 背景（docs/ai-analysis-summary-fix-runbook.md）：AI 分析失败后用户只能看到
 * 「成功 0 章」，无法归因。修复层之外再补可观测性：整条链路（传输 → 管道 →
 * 编排）在应用控制台输出结构化元数据日志，配合 Rust 侧 eprintln（终端）双端排查。
 *
 * 硬约束：
 * - 只输出元数据（字符数 / 耗时 / 参数 / 错误摘要），**绝不输出 API Key 与完整正文**；
 * - 单行键值对，肉眼可扫；错误 message 截断到 200 字符防刷屏。
 */
export type AiLogLevel = "info" | "warn" | "error";

const WRITE: Record<AiLogLevel, (msg: string) => void> = {
  info: (m) => console.info(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

/** 错误 message 收进日志前截断（长 JSON 报错可能带 160+ 字符片段）。 */
export function aiErrPreview(err: unknown, max = 200): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length <= max ? message : `${message.slice(0, max)}…`;
}

/** 单行结构化日志：`[ai:<scope>] <message> k1=v1 k2=v2`。 */
export function aiLog(
  level: AiLogLevel,
  scope: string,
  message: string,
  kv?: Record<string, string | number | boolean | undefined>,
): void {
  const fields = Object.entries(kv ?? {})
    .map(([k, v]) => `${k}=${v === undefined ? "-" : String(v)}`)
    .join(" ");
  WRITE[level](`[ai:${scope}] ${message}${fields ? ` ${fields}` : ""}`);
}
