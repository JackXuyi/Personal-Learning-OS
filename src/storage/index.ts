/**
 * 存储工厂。
 *
 * 三档后端，按运行环境自动选择（也可显式指定，单测/迁移工具用）：
 * - `tauri` —— 桌面端：RAG 五类实体（Section/Chunk/Knowledge/Relation/Embedding）
 *   **与 Document / Chapter（schema v5 起）** 落 SQLite（`db_*` 命令），
 *   其余实体沿用 localStorage；
 * - `local`  —— 浏览器预览：全量落 localStorage，跨刷新保留；
 * - `memory` —— 无 localStorage 的环境（单测/SSR）：进程内 Map。
 *
 * 降级策略**按实体分档**（RAG Spec §45 + F10 D12 / D14）：
 * - RAG 五类：`tauri` 档下 SQLite 命令失败时**静默**回退到 localStorage 同名方法，
 *   不阻塞主流程；
 * - Document / Chapter：**不静默回退** —— 失败直接抛 `StorageUnavailableError`。
 *   理由：这两类已下沉，localStorage 侧只剩一份**冻结的迁移快照**；静默写回它，
 *   下次启动的迁移就会拿旧快照**反向覆盖** SQLite 里的新数据（用户看到「刚存的东西没了」），
 *   比直接报错严重得多。
 */
import { isTauri } from "@tauri-apps/api/core";
import { LocalStorageAdapter } from "./local";
import { InMemoryStorage } from "./memory";
import { TauriStorage } from "./tauri";
import type { StorageAdapter } from "./types";

export type StorageBackend = "tauri" | "local" | "memory";

export function createStorage(
  backend: StorageBackend = detectBestBackend(),
): StorageAdapter {
  switch (backend) {
    case "memory":
      return new InMemoryStorage();
    case "tauri":
      return new TauriStorage();
    case "local":
      return new LocalStorageAdapter();
  }
}

function detectBestBackend(): StorageBackend {
  // 桌面壳优先：SQLite 是生产后端，localStorage 只是降级兜底。
  if (isTauri()) return "tauri";
  try {
    const probe = "__plos_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return "local";
  } catch {
    return "memory"; // 例如没有 localStorage 的非浏览器环境
  }
}

export { InMemoryStorage, LocalStorageAdapter, TauriStorage };
export * from "./types";
