/**
 * 桌面备份通道 —— Rust `backup` 模块 5 条命令的薄封装 + 浏览器落盘兜底
 * （方案 §4.3.5 / §8.11）。
 *
 * 与 `src/lib/desktop-log.ts` 完全同构：`isTauri()` 守卫 + 一层薄封装。
 * 纯浏览器预览（`isTauri()` 为 false）一律走 `downloadText` / `<input type="file">`，
 * 不报错、不出现「点了没反应的死按钮」。
 *
 * 契约（与 `src-tauri/src/backup.rs` 对应，camelCase 由 Tauri 自动转换）：
 * - backup_dir    → 备份目录绝对路径（不存在则创建）
 * - backup_save   → 落盘并返回绝对路径（文件名走白名单校验，`..`/子路径一律拒）
 * - backup_list   → 备份列表（时间倒序）
 * - backup_read   → 按名读取内容
 * - backup_reveal → 在系统文件管理器中显示
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

/** `backup_list` 返回元素（Rust `BackupEntry` 的镜像）。 */
export interface BackupEntry {
  name: string;
  path: string;
  bytes: number;
  /** 修改时间 epoch ms。 */
  modifiedAt: number;
  /**
   * 条目类型（F10）。⚠️ **可选**：旧版本 Rust 不带该字段，此时前端按后缀兜底推断
   * （`kindOf()`）—— 声明成必填会让旧版本直接反序列化失败。
   */
  kind?: "backup" | "pack";
}

/** `kind` 的兜底推断（旧 Rust 无该字段时按后缀判）。 */
function kindOf(entry: BackupEntry): "backup" | "pack" {
  if (entry.kind !== undefined) return entry.kind;
  return entry.name.endsWith(".ploskp.json") ? "pack" : "backup";
}

/** 备份落盘能力是否可用（仅桌面端）。 */
export function isDesktopBackupAvailable(): boolean {
  return isTauri();
}

/** 备份目录绝对路径（桌面端才会真正 invoke）。 */
export async function backupDir(): Promise<string> {
  return invoke<string>("backup_dir");
}

/** 写入备份，返回绝对路径。 */
export async function backupSave(name: string, contents: string): Promise<string> {
  return invoke<string>("backup_save", { name, contents });
}

/**
 * 备份列表（**只含备份**，过滤掉知识包条目）；非桌面端返回空数组
 * （调用方据此走文件选择器路径）。
 *
 * ⚠️ `backup_list` 这一条命令同时返回备份与知识包（同一个固定目录），过滤必须在
 * **通道层**做一次 —— 让各页面自己 `filter` 就是「同一规则散在多处」，备份卡与
 * 包卡迟早会看到对方的东西（方案 §143「列表可分流 / 互为反向白名单」）。
 */
export async function backupList(): Promise<BackupEntry[]> {
  if (!isTauri()) return [];
  const all = await invoke<BackupEntry[]>("backup_list");
  return all.filter((e) => kindOf(e) === "backup");
}

/** 知识包列表（**只含包**）；非桌面端返回空数组。 */
export async function packList(): Promise<BackupEntry[]> {
  if (!isTauri()) return [];
  const all = await invoke<BackupEntry[]>("backup_list");
  return all.filter((e) => kindOf(e) === "pack");
}

/** 按名读取备份内容。 */
export async function backupRead(name: string): Promise<string> {
  return invoke<string>("backup_read", { name });
}

/** 在系统文件管理器中显示该文件。 */
export async function backupReveal(path: string): Promise<void> {
  await invoke("backup_reveal", { path });
}

/**
 * 浏览器落盘兜底：Blob + `<a download>`。
 *
 * ⚠️ 刻意**不**尝试用 Tauri webview 的下载行为：那条路在本仓库无法验证
 * （见 `rules/no-headless-browser-validation.mdc`），失败模式是「用户以为导出
 * 成功了其实没落盘」。桌面端一律走 `backupSave`，这里只服务纯浏览器预览。
 */
export function downloadText(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // 立即回收：下载已交给浏览器，句柄不能长留（否则就是内存泄漏）。
    URL.revokeObjectURL(url);
  }
}
