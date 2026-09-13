/**
 * 全局 AI 任务注册表（zustand，**不持久化**）。
 *
 * 设计要点（docs/ai-loading-unify-design-2026-09.md §4.4）：
 * - AI 调用是进程内 async promise，应用重启后任务必然消亡 —— 持久化只会产生
 *   「假 loading」脏状态，故与 useIndexStore 同理由不 persist。
 * - 终态（done/error）保留至同 id 下次 start 或显式 clear：任务后台跑完、用户
 *   切页后返回时仍能看到终态反馈（消除「完成但用户不知道」盲区）。
 * - setPhase / finish 对非 running 记录一律忽略（迟到回调防护）。
 */
import { create } from "zustand";
import { useCallback, useRef } from "react";
import type { AiTaskId, AiTaskRecord } from "./ai-task-types";

interface AiTaskState {
  tasks: Record<string, AiTaskRecord>;
  /** 同步创建 running 记录（覆盖旧终态，重新进入 running）。 */
  start: (id: AiTaskId) => void;
  /** 更新进度文案/数值；记录不存在或已终态时忽略。 */
  setPhase: (id: AiTaskId, phase: string, progress?: number) => void;
  /** 置终态并保留；记录不存在或已终态时忽略。 */
  finish: (id: AiTaskId, status: "done" | "error", message?: string) => void;
  /** 显式清除记录（终态提示消费后或测试用）。 */
  clear: (id: AiTaskId) => void;
}

export const useAiTaskStore = create<AiTaskState>((set) => ({
  tasks: {},
  start: (id) =>
    set((s) => ({
      tasks: { ...s.tasks, [id]: { status: "running", startedAt: Date.now() } },
    })),
  setPhase: (id, phase, progress) =>
    set((s) => {
      const cur = s.tasks[id];
      if (!cur || cur.status !== "running") return s; // 终态后忽略迟到 onProgress
      return { tasks: { ...s.tasks, [id]: { ...cur, phase, progress } } };
    }),
  finish: (id, status, message) =>
    set((s) => {
      const cur = s.tasks[id];
      if (!cur || cur.status !== "running") return s; // 终态后忽略迟到 finish
      return {
        tasks: {
          ...s.tasks,
          [id]: { ...cur, status, message, endedAt: Date.now() },
        },
      };
    }),
  clear: (id) =>
    set((s) => {
      if (!s.tasks[id]) return s;
      const next = { ...s.tasks };
      delete next[id];
      return { tasks: next };
    }),
}));

/**
 * 组件侧桥接 hook：读状态 + 拿受管 run 执行器。
 *
 * run(fn) 语义：
 * - 同帧防重入（runningRef）；store 中已 running 同样拦截。
 * - fn 抛错 → finish("error") 并把错误 rethrow（调用方既有 catch 渲染）。
 * - fn 正常返回但未显式 finish（静默回退型，如出卷 AI 未就绪走本地卷）
 *   → finally 补 finish("done")。
 */
export function useAiTask(id: AiTaskId) {
  const record = useAiTaskStore((s) => s.tasks[id]);
  const start = useAiTaskStore((s) => s.start);
  const setPhase = useAiTaskStore((s) => s.setPhase);
  const finish = useAiTaskStore((s) => s.finish);
  const clear = useAiTaskStore((s) => s.clear);
  const clearBound = useCallback(() => clear(id), [clear, id]);
  const runningRef = useRef(false); // 防同帧双触发

  const run = useCallback(
    async <T,>(
      fn: (
        report: (phase: string, progress?: number) => void,
        /** 显式以「done + 结果文案」终结任务（静默回退/结果摘要场景）。 */
        done: (message?: string) => void,
      ) => Promise<T>,
    ): Promise<T> => {
      if (runningRef.current) throw new Error("task-already-running");
      if (useAiTaskStore.getState().tasks[id]?.status === "running") {
        throw new Error("task-already-running");
      }
      runningRef.current = true;
      start(id);
      try {
        const result = await fn(
          (phase, progress) => setPhase(id, phase, progress),
          (message) => finish(id, "done", message),
        );
        // 静默回退语义：fn 内部未显式 finish 时补 done（正常任务在 fn 内
        // finish 后此处在 store 层为 no-op，见 finish 的 running 守卫）。
        const cur = useAiTaskStore.getState().tasks[id];
        if (cur?.status === "running") finish(id, "done");
        return result;
      } catch (e) {
        finish(id, "error", e instanceof Error ? e.message : String(e));
        throw e; // 交由调用方既有 catch 渲染页面级错误
      } finally {
        runningRef.current = false;
      }
    },
    [id, start, setPhase, finish],
  );

  return {
    running: record?.status === "running",
    status: record?.status,
    phase: record?.phase,
    progress: record?.progress,
    message: record?.message,
    /** 编程式幂等判断（判卷页自动批改等 effect 入口用）：已 running 或已 done 时跳过重跑。 */
    skipIfFinished: record?.status === "running" || record?.status === "done",
    run,
    clear: clearBound,
  };
}

/**
 * 非 React 环境执行器（node 单测 / 未来 service 层编排用）：
 * 与 useAiTask(id).run 同语义，但不经 hook。
 */
export async function runAiTask<T>(
  id: AiTaskId,
  fn: (
    report: (phase: string, progress?: number) => void,
    done: (message?: string) => void,
  ) => Promise<T>,
): Promise<T> {
  const { start, setPhase, finish } = useAiTaskStore.getState();
  if (useAiTaskStore.getState().tasks[id]?.status === "running") {
    throw new Error("task-already-running");
  }
  start(id);
  try {
    const result = await fn(
      (phase, progress) => setPhase(id, phase, progress),
      (message) => finish(id, "done", message),
    );
    const cur = useAiTaskStore.getState().tasks[id];
    if (cur?.status === "running") finish(id, "done");
    return result;
  } catch (e) {
    finish(id, "error", e instanceof Error ? e.message : String(e));
    throw e;
  }
}
