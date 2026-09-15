/**
 * 能力报告展示（F6）——「我够格了吗」的结论页（`CapabilityPage` 复用）。
 *
 * 三条展示契约（docs/goal-capability-assessment-design-2026-09.md §7.4）：
 * 1. **只读快照**：能力项名称 / 达标线一律取自 run 的 `items` 快照（`snapshot`
 *    入参），**绝不回读当前清单** —— 否则改一次 label，历史报告就会「改名」；
 * 2. **unknown 显式警示**：未被任务覆盖的项显示琥珀色「未覆盖」而非红「未达标」
 *    —— 把「没测」显示成「没做出来」是在制造假结论（决策 D5）；
 * 3. **零伪造引用**：只展示能锚回作答原文的引文；一条都没锚上时显式提示
 *    「引用无法定位」，分数与理由仍保留（诚实降级）。
 */
import { useState } from "react";
import type { CapabilityItemSnapshot, CapabilityReport } from "../../../domain";
import { capabilityStatsOf } from "../../../engine";
import type { Messages } from "../../../i18n";
import type { ObjectiveStage } from "../capability-service";

/** verdict → 语义色（pass 绿 / fail 红 / unknown 琥珀）。 */
const VERDICT_TONE: Record<CapabilityReport["items"][number]["verdict"], string> = {
  pass: "text-state-mastered",
  fail: "text-state-failed",
  unknown: "text-state-weak",
};

/** 加权总分 / 达标度 → 百分比文本（`undefined` → `—`）。 */
function pctText(v: number | undefined): string {
  return v === undefined ? "—" : `${Math.round(v * 100)}%`;
}

export function CapabilityReportView({
  report,
  snapshot,
  m,
  objectiveStage,
  testId,
}: {
  report: CapabilityReport;
  /** run 的能力项快照（唯一渲染依据）。 */
  snapshot: readonly CapabilityItemSnapshot[];
  m: Messages;
  /** 阶段 1 状态（缺省 = 不渲染客观分块）。 */
  objectiveStage?: ObjectiveStage;
  testId?: string;
}) {
  const c = m.capability;
  const stats = capabilityStatsOf(report);
  const snapOf = (itemId: string) => snapshot.find((s) => s.id === itemId);

  return (
    <div data-testid={testId} className="rounded-xl border border-line bg-surface">
      {/* 头部：达标度 + 加权总分 */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            {c.rate}
          </span>
          <span className="text-lg font-semibold tabular-nums text-ink-1">
            {pctText(stats.rate)}
          </span>
          <span className="text-xs text-ink-3">{c.rateOf(stats.passed, stats.total)}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-ink-3">{c.overall}</span>
          <span className="text-base font-semibold tabular-nums text-ink-1">
            {pctText(report.overall)}
          </span>
          <span
            className={`rounded border border-line px-1.5 py-0.5 text-[10px] font-medium ${
              report.approved ? "text-state-mastered" : "text-state-weak"
            }`}
          >
            {report.approved ? c.approved : c.notApproved}
          </span>
        </div>
      </div>

      {/* 覆盖缺口警示（不阻断判定，但必须显式） */}
      {stats.uncovered > 0 ? (
        <p
          data-testid="cap-uncovered"
          className="border-b border-line px-4 py-2 text-xs text-state-weak"
        >
          {c.uncovered(stats.uncovered)}
        </p>
      ) : null}

      {/* 逐项 */}
      <ul className="divide-y divide-line">
        {report.items.map((s) => {
          const snap = snapOf(s.itemId);
          return (
            <ReportRow
              key={s.itemId}
              label={snap?.label ?? s.itemId}
              threshold={snap?.threshold ?? 0}
              score={s.score}
              verdict={s.verdict}
              rationale={s.rationale}
              evidence={s.evidence}
              unanchored={s.unanchored === true}
              taskCount={s.fromTaskIds.length}
              m={m}
            />
          );
        })}
      </ul>

      {/* 阶段 1 参考分（独立成块：不加权、不合成 —— 决策 D9-A） */}
      {objectiveStage ? (
        <div
          data-testid="cap-objective"
          className="border-t border-line px-4 py-3"
        >
          <p className="text-xs font-semibold text-ink-2">{c.objectiveTitle}</p>
          <p className="mt-1 text-xs text-ink-3">
            {report.objective
              ? c.objectiveDone(report.objective.totalScore)
              : objectiveStage.status === "skipped"
                ? c.objectiveSkipped
                : c.objectivePending}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">{c.objectiveHint}</p>
        </div>
      ) : null}
    </div>
  );
}

/** 单项行（引用可展开）。 */
function ReportRow({
  label,
  threshold,
  score,
  verdict,
  rationale,
  evidence,
  unanchored,
  taskCount,
  m,
}: {
  label: string;
  threshold: number;
  score: number | undefined;
  verdict: CapabilityReport["items"][number]["verdict"];
  rationale: string | undefined;
  evidence: CapabilityReport["items"][number]["evidence"];
  unanchored: boolean;
  taskCount: number;
  m: Messages;
}) {
  const c = m.capability;
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-1">{label}</p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {c.thresholdOf(pctText(score), pctText(threshold))}
            {taskCount > 0 ? ` · ${c.fromTasks(taskCount)}` : ""}
          </p>
        </div>
        <span className={`shrink-0 text-xs font-semibold ${VERDICT_TONE[verdict]}`}>
          {c.verdict[verdict]}
        </span>
      </div>
      {rationale ? <p className="mt-1 text-xs leading-relaxed text-ink-2">{rationale}</p> : null}
      {unanchored ? (
        <p data-testid="cap-unanchored" className="mt-1 text-[11px] text-state-weak">
          {c.unanchored}
        </p>
      ) : null}
      {evidence.length > 0 ? (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            {c.quoteToggle(evidence.length)}
          </button>
          {open ? (
            <ul className="mt-1.5 space-y-1">
              {evidence.map((q) => (
                <li
                  key={`${q.start}-${q.end}`}
                  className="rounded border-l-2 border-line bg-subtle/60 px-2 py-1 text-xs leading-relaxed text-ink-2"
                >
                  {q.quote}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
