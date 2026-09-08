import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { BandBadge, Bar, Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { bandOf } from "../../engine";
import { useLoopStore } from "../../stores/useLoopStore";
import { GOAL_TARGET, unitTitle } from "../units";
import { useI18n } from "../../i18n";

/**
 * 职业页 —— 目标就绪度视图（S6：信息与首页重叠，收敛为快照的另一种读法，
 * 不做双份维护）。展示当前目标的达标进度 + 缺口清单，每个缺口可直接开练。
 */
export default function CareerPage() {
  const snapshot = useLoopStore((s) => s.snapshot);
  const loading = useLoopStore((s) => s.loading);
  const error = useLoopStore((s) => s.error);
  const refresh = useLoopStore((s) => s.refresh);
  const navigate = useNavigate();
  const { m } = useI18n();

  useEffect(() => {
    void refresh(m);
  }, [refresh]);

  if (error) {
    return (
      <PageContainer>
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      </PageContainer>
    );
  }

  if (loading && !snapshot) {
    return (
      <PageContainer>
        <Card>
          <p className="text-sm text-slate-500">{m.career.loading}</p>
        </Card>
      </PageContainer>
    );
  }

  if (!snapshot) return null;

  const { goal, readiness, actions } = snapshot;
  const masteredCount = goal.requiredUnitIds.filter(
    (id) => (snapshot.masteryByUnit[id] ?? 0) >= GOAL_TARGET,
  ).length;

  return (
    <PageContainer>
      <SectionTitle title={m.career.title} subtitle={m.career.subtitle} />

      <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/60 to-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {m.career.currentGoal} · {m.units.goalType[goal.type]}
            </p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">{goal.title}</h3>
            {goal.description ? (
              <p className="mt-1 text-sm text-slate-500">{goal.description}</p>
            ) : null}
            <p className="mt-1 text-xs text-slate-400">
              {m.career.importanceLine(
                m.units.importance[goal.importance],
                goal.requiredUnitIds.length,
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold text-slate-900">
              {Math.round(readiness * 100)}%
            </p>
            <p className="text-xs text-slate-500">
              {m.career.readyOf(masteredCount, goal.requiredUnitIds.length)}
            </p>
          </div>
        </div>
        <div className="mt-5">
          <Bar
            value={readiness}
            target={GOAL_TARGET}
            targetLabel={m.common.targetLine(Math.round(GOAL_TARGET * 100))}
          />
        </div>
      </Card>

      {actions.length === 0 ? (
        <Card className="mt-6 border-emerald-200 bg-emerald-50/40">
          <p className="text-lg font-semibold text-slate-900">{m.career.allDoneTitle}</p>
          <p className="mt-1 text-sm text-slate-500">
            {m.career.allDoneDesc(Math.round(readiness * 100))}
          </p>
        </Card>
      ) : (
        <Card className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            {m.career.gapList(actions.length)}
          </h3>
          <ul className="divide-y divide-slate-100">
            {actions.map((action) => {
              const mastery = snapshot.masteryByUnit[action.unitId] ?? 0;
              const gap = Math.max(0, Math.round((GOAL_TARGET - mastery) * 100));
              const to =
                action.kind === "assessment"
                  ? `/assessment?unit=${action.unitId}`
                  : `/study/session?unit=${action.unitId}`;
              return (
                <li
                  key={action.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {m.units.action[action.kind]}
                    </span>
                    <span className="truncate text-sm font-medium text-slate-800">
                      {unitTitle(action.unitId)}
                    </span>
                    <span className="text-xs text-slate-400">
                      {m.career.masteryAt(Math.round(mastery * 100))}
                    </span>
                    <span className="text-xs text-indigo-600">
                      {m.career.remainingGap(gap)}
                    </span>
                    <BandBadge band={bandOf(mastery)} />
                  </div>
                  <button
                    onClick={() => navigate(to)}
                    className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
                  >
                    {m.units.actionVerb[action.kind]} →
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </PageContainer>
  );
}
