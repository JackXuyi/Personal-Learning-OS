/**
 * 索引任务状态（useIndexStore）—— 只存状态，不含编排逻辑。
 *
 * 分层约束：stores 不得反向依赖 features，因此「调 provider → 写 storage」的编排
 * 放在 `features/learn/index-service.ts`，由它调用本 store 的 `begin/setProgress/
 * finish/fail` 推进状态；UI（设置页索引卡）读 `running` / `progress` / `coverage`。
 *
 * 生命周期：会话级、**不持久化**。重启后据 `listEmbeddings` 重新派生真实覆盖率
 * （不持久化的好处：不会出现「进度 92%」这种重启后无法续算的假状态）。
 */
import { create } from "zustand";
import type { IndexCoverage, IndexProgress } from "../features/learn/index-service";

interface IndexState {
  /** 任务是否在跑（UI 门闩 + 按钮禁用态）。 */
  running: boolean;
  /** 进度：已完成 / 总数 / 失败数。 */
  progress: IndexProgress;
  /** 最近一次失败原因（成功后清空）。 */
  error: string | undefined;
  /** 当前模型的向量覆盖率。 */
  coverage: IndexCoverage;
  /** 覆盖率是否已加载过（避免 UI 首帧闪 0%）。 */
  coverageLoaded: boolean;

  // ---- 以下为 index-service 驱动的状态迁移，UI 不直接调用 ----
  begin: () => void;
  setProgress: (p: IndexProgress) => void;
  finish: () => void;
  fail: (message: string) => void;

  /** 重新统计覆盖率（进入设置页 / 索引完成后调用）。 */
  refreshCoverage: () => Promise<void>;
}

const EMPTY_PROGRESS: IndexProgress = { total: 0, done: 0, failed: 0 };

export const useIndexStore = create<IndexState>()((set) => ({
  running: false,
  progress: EMPTY_PROGRESS,
  error: undefined,
  coverage: { total: 0, indexed: 0 },
  coverageLoaded: false,

  begin: () => set({ running: true, progress: EMPTY_PROGRESS, error: undefined }),
  setProgress: (progress) => set({ progress }),
  finish: () => set({ running: false }),
  fail: (message) => set({ running: false, error: message }),

  refreshCoverage: async () => {
    // 动态 import 打断「store → features → store」的静态循环依赖：
    // index-service 需要读本 store 的状态，本 store 又需要它的统计函数。
    // 静态 import 会形成 ESM 循环，用 await import 让依赖在运行时按需解析。
    const { embeddingCoverage, activeEmbeddingModel } = await import(
      "../features/learn/index-service"
    );
    const coverage = await embeddingCoverage(activeEmbeddingModel());
    set({ coverage, coverageLoaded: true });
  },
}));

/**
 * 覆盖率派生的百分比（0–100，四舍五入）。
 * 总数 0 时返回 0（而不是 NaN / 100）——「没有可索引内容」不该显示成「全部索引完毕」。
 */
export function coveragePercent(coverage: IndexCoverage): number {
  if (coverage.total <= 0) return 0;
  return Math.round((coverage.indexed / coverage.total) * 100);
}
