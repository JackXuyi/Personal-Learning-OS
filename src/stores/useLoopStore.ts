import { create } from "zustand";
import { createStorage, type StorageAdapter } from "../storage";
import { runLearningLoop, type LoopSnapshot } from "../engine";

/**
 * 整个应用唯一的存储实例。默认由 localStorage 支撑
 * （见 src/storage）——后续可在此处切换为 SQLite 适配器。
 */
export const storage: StorageAdapter = createStorage();

interface LoopStoreState {
  snapshot: LoopSnapshot | undefined;
  loading: boolean;
  error: string | undefined;
  refresh: () => Promise<void>;
}

export const useLoopStore = create<LoopStoreState>((set) => ({
  snapshot: undefined,
  loading: false,
  error: undefined,
  refresh: async () => {
    set({ loading: true, error: undefined });
    try {
      const snapshot = await runLearningLoop(storage);
      set({ snapshot, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },
}));
