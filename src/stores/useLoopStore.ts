import { create } from "zustand";
import { createStorage, type StorageAdapter } from "../storage";
import { runLearningLoop, type LoopSnapshot } from "../engine";

/**
 * The single storage instance for the whole app. localStorage-backed by
 * default (see src/storage) — swap to the SQLite adapter here later.
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
