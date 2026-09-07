/**
 * Storage factory.
 *
 * The persisted localStorage adapter is the default so the scaffold behaves
 * like a real local-first app even in the browser. When the Tauri SQLite
 * backend lands, switch this factory to return it and nothing else changes.
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
    return "memory"; // e.g. non-browser environments without localStorage
  }
}

export * from "./types";
