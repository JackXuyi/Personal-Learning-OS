/**
 * AI 任务注册表类型（useAiTaskStore 的类型层，独立成文件）。
 *
 * 独立原因：node 单测（tests/ai-task.test.ts）与 UI 层都只依赖类型与纯函数时，
 * 不应连带把 React/zustand 拉进无 React 环境（tests/register-loader.mjs 直跑约定）。
 */

/** 任务状态：running 进行中；done 成功（含诚实回退）；error 失败。 */
export type AiTaskStatus = "running" | "done" | "error";

/** 单个 AI 任务的记录（内存态，**不持久化** —— 重启后进程内 promise 必亡）。 */
export interface AiTaskRecord {
  status: AiTaskStatus;
  /**
   * 阶段标记或已翻译的进度文案，由调用方保证展示安全：
   * - 标记型（如 `"ai"`）：供页面区分 loading 文案；
   * - 文案型：onProgress 时直接存渲染文本，重挂后可原样展示。
   */
  phase?: string;
  /** 可选数值进度 0..1。 */
  progress?: number;
  /** 终态消息：error=失败原因；done=结果摘要（已翻译文案）。 */
  message?: string;
  startedAt: number;
  endedAt?: number;
}

/**
 * 任务 id —— 必须是「从路由/数据可稳定重导出的纯函数」结果（如
 * `overview:${docId}`）。这是「切页再回来恢复 loading」的关键：组件卸载重挂后
 * 用同一输入算出同一 id，即可从全局 store 读回 running 态，无需 keep-alive。
 */
export type AiTaskId =
  | "import"
  | `overview:${string}`
  | `paper:${string}`
  | `grade:${string}`
  | `refine:${string}`
  | `keypoints:${string}`
  | `concepts:${string}`
  | `graph-extract:${string}`;
