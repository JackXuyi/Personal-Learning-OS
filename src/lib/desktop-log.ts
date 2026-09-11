/**
 * desktop-log —— 文件日志命令封装（docs/tauri-log-config-design-2026-09.md）。
 *
 * 职责：把 Rust `logging` 模块的 5 条命令包成类型安全 API；纯浏览器预览
 * （isTauri 为 false）一律短路：读取类返回 null / 空数组，写转发为 no-op。
 *
 * 契约（与 src-tauri/src/logging.rs 对应，camelCase 由 Tauri 自动转换）：
 * - log_get_config  → LogConfigView | null
 * - log_set_config  → 落地目录（目录立即创建；失败抛人类可读错误）
 * - log_open_dir    → 系统文件管理器打开
 * - log_read_recent → 当日文件尾部行（默认 200）
 * - log_write       → fire-and-forget 转发（aiLog 用，失败静默）
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** `log_get_config` 返回视图（dir 为落地绝对路径）。 */
export interface LogConfigView {
  enabled: boolean;
  level: LogLevel;
  dir: string;
  /** 最近一次写文件失败摘要；null = 正常。 */
  lastError: string | null;
}

/** `log_set_config` 入参；dir 传 undefined = 恢复默认目录。 */
export interface LogConfigInput {
  enabled: boolean;
  level: LogLevel;
  dir?: string | null;
}

/** 文件日志是否可用（仅桌面端）。 */
export function isDesktopLogAvailable(): boolean {
  return isTauri();
}

export async function logGetConfig(): Promise<LogConfigView> {
  return invoke<LogConfigView>("log_get_config");
}

/** 更新配置（即时生效 + 持久化），返回落地目录绝对路径。 */
export async function logSetConfig(config: LogConfigInput): Promise<string> {
  return invoke<string>("log_set_config", { config });
}

export async function logOpenDir(): Promise<void> {
  await invoke("log_open_dir");
}

export async function logReadRecent(maxLines = 200): Promise<string[]> {
  return invoke<string[]>("log_read_recent", { maxLines });
}

/** aiLog 转发：fire-and-forget，失败静默（日志绝不能拖垮主流程）。 */
export function logWriteForward(level: LogLevel, scope: string, message: string): void {
  if (!isTauri()) return;
  void invoke("log_write", { level, scope, message }).catch(() => {});
}
