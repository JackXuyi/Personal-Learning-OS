/**
 * Goals（/goals）—— 多目标管理首页（UI Workbench U6，docs §20）。
 *
 * 回答「为什么学」：把目标分成 进行中 / 已完成 两组，每张卡展示
 * 类型徽标 + 就绪度 Bar + 达标/缺口计数 + [打开 →]。行 = 卡片（非 KnowledgeRow）。
 *
 * 就绪度语义与 Today/Plan 一致：目标章范围（requiredChapterIds）内掌握度 ≥ 0.8
 * 的章占比；无范围 → 全库章回退。activeGoal（当前上下文）在卡上高亮，
 * 切换 / 删除都经 store（removeGoal 自动回退首个剩余目标）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, Card, SectionTitle } from "../../components/primitives";
import { buttonVariants } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { PageContainer } from "../../components/layout/AppShell";
import { MASTERY_THRESHOLD } from "../../domain";
import type { LearnerState, LearningGoal } from "../../domain";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { useI18n, type Messages } from "../../i18n";
import {
  type ChapterRow,
  goalStatsOf,
  loadChapterRows,
  scopeOf,
} from "./goal-util";

/** 格式展示日期（本地化 yyyy-MM-dd）。 */
export function fmtDate(ts: number, lang: "zh" | "en"): string {
  const d = new Date(ts);
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
}

interface RowData {
  goal: LearningGoal;
  rows: ChapterRow[];
  active: boolean;
}

export default function GoalsPage() {
  const { m, lang } = useI18n();
  const g = m.goals;
  const switchGoal = useLoopStore((s) => s.switchGoal);
  const [rowsData, setRowsData] = useState<RowData[] | undefined>();
  const [learner, setLearner] = useState<LearnerState | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const [goals, activeGoal, allRows, ls] = await Promise.all([
        storage.listGoals(),
        storage.getActiveGoal(),
        loadChapterRows(storage),
        storage.getLearnerState(),
      ]);
      setLearner(ls);
      setRowsData(
        goals.map((goal) => ({
          goal,
          rows: scopeOf(goal, allRows),
          active: activeGoal?.id === goal.id,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSwitch = async (goalId: string) => {
    if (busyId) return;
    setBusyId(goalId);
    try {
      await switchGoal(goalId, m);
      await load();
    } finally {
      setBusyId(undefined);
    }
  };

  // 分组：进行中 / 已完成（范围非空且全达标）。
  const { active, completed } = useMemo(() => {
    if (!rowsData || !learner) return { active: [], completed: [] };
    const a: RowData[] = [];
    const c: RowData[] = [];
    for (const rd of rowsData) {
      const stats = goalStatsOf(rd.goal, rd.rows, learner);
      (stats.completed ? c : a).push(rd);
    }
    return { active: a, completed: c };
  }, [rowsData, learner]);

  return (
    <PageContainer>
      <SectionTitle
        title={g.title}
        subtitle={g.subtitle}
        action={
          <Link
            to="/goals/new"
            className={cn(buttonVariants({ size: "sm" }), "shrink-0 px-3.5 text-sm")}
          >
            {g.newGoal}
          </Link>
        }
      />

      {error ? (
        <Card className="mt-4">
          <p className="text-sm text-state-failed">{error}</p>
        </Card>
      ) : null}

      {rowsData === undefined ? (
        <Card className="mt-6">
          <p className="text-sm text-ink-3">{g.listLoading}</p>
        </Card>
      ) : rowsData.length === 0 ? (
        <Card className="mt-6 border-dashed">
          <p className="text-lg font-semibold text-ink-1">{g.noGoalsTitle}</p>
          <p className="mt-1 text-sm text-ink-2">{g.noGoalsDesc}</p>
          <div className="mt-4">
            <Link
              to="/goals/new"
              className={cn(buttonVariants(), "rounded-lg")}
            >
              {g.newGoal}
            </Link>
          </div>
        </Card>
      ) : (
        <div className="mt-4 space-y-8">
          <GoalGroup
            title={g.sectionActive}
            rows={active}
            learner={learner!}
            m={m}
            lang={lang}
            busyId={busyId}
            onSwitch={onSwitch}
          />
          {completed.length > 0 ? (
            <GoalGroup
              title={g.sectionCompleted}
              rows={completed}
              learner={learner!}
              m={m}
              lang={lang}
              busyId={busyId}
              onSwitch={onSwitch}
            />
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}

/** 一组目标（进行中 / 已完成）。 */
function GoalGroup({
  title,
  rows,
  learner,
  m,
  lang,
  busyId,
  onSwitch,
}: {
  title: string;
  rows: RowData[];
  learner: LearnerState;
  m: Messages;
  lang: "zh" | "en";
  busyId?: string;
  onSwitch: (goalId: string) => Promise<void>;
}) {
  const g = m.goals;
  return (
    <section>
      <h3 className="text-xs font-semibold tracking-wide text-ink-2">{title}</h3>
      <div className="mt-2 grid gap-3 lg:grid-cols-2">
        {rows.map((rd) => {
          const stats = goalStatsOf(rd.goal, rd.rows, learner);
          return (
            <div
              key={rd.goal.id}
              className="rounded-xl border border-line bg-surface p-4 transition-colors hover:border-ink-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
                      {m.units.goalType[rd.goal.type]}
                    </span>
                    {rd.active ? (
                      <span className="flex items-center gap-1 rounded-full border border-line bg-subtle px-2 py-0.5 text-[10px] font-medium text-ink-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        {g.activeTag}
                      </span>
                    ) : null}
                    <span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink-3">
                      {m.units.importance[rd.goal.importance]}
                    </span>
                    <span className="truncate text-xs text-ink-3">
                      {rd.goal.deadlineAt
                        ? g.deadline(fmtDate(rd.goal.deadlineAt, lang))
                        : g.noDeadline}
                    </span>
                  </div>
                  <h4 className="mt-1.5 truncate text-[15px] font-semibold text-ink-1">
                    {rd.goal.title}
                  </h4>
                  {rd.goal.description ? (
                    <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">
                      {rd.goal.description}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-2xl font-semibold tabular-nums text-ink-1">
                    {Math.round(stats.readiness * 100)}%
                  </p>
                  <p className="text-xs text-ink-3">{g.readyOf(stats.mastered, stats.total)}</p>
                </div>
              </div>

              {stats.total > 0 ? (
                <div className="mt-3">
                  <Bar
                    value={stats.readiness}
                    target={MASTERY_THRESHOLD}
                    targetLabel={m.common.targetLine(Math.round(MASTERY_THRESHOLD * 100))}
                  />
                </div>
              ) : (
                <p className="mt-2 text-xs text-ink-3">{g.scopeEmptyHint}</p>
              )}

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {!rd.active ? (
                    <button
                      type="button"
                      disabled={busyId !== undefined}
                      onClick={() => void onSwitch(rd.goal.id)}
                      className="text-xs font-medium text-ink-2 transition-colors hover:text-primary disabled:opacity-40"
                    >
                      {busyId === rd.goal.id ? "…" : g.setActive}
                    </button>
                  ) : (
                    <span className="text-xs text-ink-3">{g.createdOn(fmtDate(rd.goal.createdAt, lang))}</span>
                  )}
                  <Link
                    to={`/goals/${rd.goal.id}`}
                    className="text-xs font-medium text-ink-2 transition-colors hover:text-primary"
                  >
                    {g.edit}
                  </Link>
                </div>
                <Link
                  to={`/goals/${rd.goal.id}`}
                  className={cn(buttonVariants({ size: "sm" }), "text-sm")}
                >
                  {g.open}
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
