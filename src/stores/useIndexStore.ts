/**
 * 索引任务状态（useIndexStore）—— 只存状态，不含编排逻辑。
 *
 * ⚠️ 本模块**不得** import `features/` 或 `services/`。它曾经用 `await import()`
 * 「打断环」，实测无效：`index-service` 被 6 处静态引用 ⇒ 不可能拆成独立 chunk，
 * `npm run build` 报 `INEFFECTIVE_DYNAMIC_IMPORT`。统计与编排现在归
 * `services/learn/index-service`，本 store 只提供 `setCoverage` 这个纯 setter。
 * 判据：`npm run layer:check`。
 *
 * 生命周期：会话级、**不持久化**。重启后据 `listEmbeddings` 重新派生真实覆盖率
 * （不持久化的好处：不会出现「进度 92%」这种重启后无法续算的假状态）。
 */
import { create } from "zustand";
import type { IndexCoverage, IndexProgress } from "../domain";

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
  /** 写入覆盖率快照（**纯 setter**：统计在 `services/learn/index-service`，本 store 不认识它）。 */
  setCoverage: (coverage: IndexCoverage) => void;
  finish: () => void;
  fail: (message: string) => void;
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
  setCoverage: (coverage) => set({ coverage, coverageLoaded: true }),
  finish: () => set({ running: false }),
  fail: (message) => set({ running: false, error: message }),
}));

/**
 * 覆盖率派生的百分比（0–100，四舍五入）。
 * 总数 0 时返回 0（而不是 NaN / 100）——「没有可索引内容」不该显示成「全部索引完毕」。
 */
export function coveragePercent(coverage: IndexCoverage): number {
  if (coverage.total <= 0) return 0;
  return Math.round((coverage.indexed / coverage.total) * 100);
}
