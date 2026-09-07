/**
 * 存储工厂。
 *
 * 默认使用可持久化的 localStorage 适配器，让脚手架即使在浏览器里
 * 也表现得像真正的本地优先应用。Tauri SQLite 后端就绪后，只需让
 * 本工厂改返回它即可，其余一切不变。
 */
import { LocalStorageAdapter } from "./local";
import { InMemoryStorage } from "./memory";
import type { StorageAdapter } from "./types";

export type StorageBackend = "local" | "memory";

export function createStorage(
  backend: StorageBackend = detectBestBackend(),
): StorageAdapter {
  switch (backend) {
    case "memory":
      return new InMemoryStorage();
    case "local":
      return new LocalStorageAdapter();
  }
}

function detectBestBackend(): StorageBackend {
  try {
    const probe = "__plos_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return "local";
  } catch {
    return "memory"; // 例如没有 localStorage 的非浏览器环境
  }
}

export * from "./types";
