/**
 * 存储工厂。
 *
 * 三档后端，按运行环境自动选择（也可显式指定，单测/迁移工具用）：
 * - `tauri` —— 桌面端：RAG 五类实体（Section/Chunk/Knowledge/Relation/Embedding）
 *   落 SQLite（`db_*` 命令），其余实体沿用 localStorage；
 * - `local`  —— 浏览器预览：全量落 localStorage，跨刷新保留；
 * - `memory` —— 无 localStorage 的环境（单测/SSR）：进程内 Map。
 *
 * RAG 后端分级降级（RAG Spec §45）：`tauri` 档下 SQLite 命令失败时，
 * TauriStorage 会静默回退到 localStorage 同名方法，不阻塞主流程。
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
