/**
 * AiTaskStatusLine —— AI 任务状态行（PLOS 领域原语；第二轮收敛件）。
 *
 * 统一第一轮在 OverviewTab / SplitTab / KnowledgeTab / NewQuizPage 各自手写的
 * 「running 进度行 + 终态消息卡」模式（docs/ai-loading-interaction-fix-runbook-2026-09.md F3）：
 * - running：渲染 phase 文案（缺失时回退 runningFallback），aria-live="polite"；
 * - 终态（done/error）：**仅在新鲜度窗口内**渲染消息卡（R2 防跨页面串台），
 *   error 统一 `aiTask.failed` 前缀（可经 formatError 做页面级 kind 映射）；
 * - dismiss：右侧「知道了」→ 调用方传入的 clear（终态提示消费后即清）。
 *
 * task 入参为 useAiTask 返回值的结构子集（AiTaskView），页面现有 task 对象直接传。
 */
import { useI18n } from "../i18n";
import { cn } from "../lib/utils";
import { isTerminalFresh } from "../stores/ai-task-types";
import type { AiTaskStatus } from "../stores/ai-task-types";

/** useAiTask 返回值的展示子集（便于页面直接传 task 对象 / 单测构造）。 */
export interface AiTaskView {
  running: boolean;
  status?: AiTaskStatus;
  phase?: string;
  progress?: number;
  message?: string;
  endedAt?: number;
}

interface AiTaskStatusLineProps {
  task: AiTaskView;
  /** running 且尚无 phase 文案时的回退（如「生成中…」）。 */
  runningFallback: string;
  /** error 消息的页面级映射（如 PaperFlowError kind → 可读文案）；缺省原样展示。 */
  formatError?: (raw: string) => string;
  /** 传入则渲染 dismiss 按钮（通常为 task.clear）。 */
  onDismiss?: () => void;
  className?: string;
}

export function AiTaskStatusLine({
  task,
  runningFallback,
  formatError,
  onDismiss,
  className,
}: AiTaskStatusLineProps) {
  const { m } = useI18n();
  const t = m.aiTask;

  // running 行：进度文案实时来自全局任务记录（切页重挂后可恢复）；
  // progress（0..1）存在时追加微进度条（F7：map-reduce 长任务的数值进度）。
  if (task.running) {
    const pct =
      typeof task.progress === "number"
        ? Math.min(100, Math.max(0, Math.round(task.progress * 100)))
        : undefined;
    return (
      <div className={className}>
        <p aria-live="polite" className="text-xs text-ink-2">
          {task.phase ?? runningFallback}
          {pct !== undefined ? ` ${pct}%` : ""}
        </p>
        {pct !== undefined && (
          <div className="mt-1.5 h-1 w-full max-w-xs overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  // 终态卡：新鲜度门内才展示（R2）；无消息的静默 done 不渲染。
  if (task.status === "running" || !task.status || !task.message) return null;
  if (!isTerminalFresh(task)) return null;

  const isError = task.status === "error";
  return (
    <div
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3",
        className,
      )}
    >
      <p className="min-w-0 flex-1 text-xs text-ink-2">
        {isError ? `${t.failed}：${formatError ? formatError(task.message) : task.message}` : task.message}
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-xs text-ink-3 hover:text-ink-1"
        >
          {t.dismiss}
        </button>
      )}
    </div>
  );
}
