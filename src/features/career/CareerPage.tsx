import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { BandBadge, Bar, Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { bandOf } from "../../engine";
import { useLoopStore } from "../../stores/useLoopStore";
import {
  actionKindLabel,
  GOAL_TARGET,
  goalTypeLabel,
  importanceLabel,
  unitTitle,
} from "../units";

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

  useEffect(() => {
    void refresh();
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
          <p className="text-sm text-slate-500">正在计算目标就绪度…</p>
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
      <SectionTitle
        title="职业 · 目标就绪度"
        subtitle="把岗位拆成可练习的单元，达标一个少一个缺口。"
      />

      <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/60 to-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              当前目标 · {goalTypeLabel(goal.type)}
            </p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">{goal.title}</h3>
            {goal.description ? (
              <p className="mt-1 text-sm text-slate-500">{goal.description}</p>
            ) : null}
            <p className="mt-1 text-xs text-slate-400">
              重要性 {importanceLabel(goal.importance)} · 共 {goal.requiredUnitIds.length} 个单元
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold text-slate-900">
              {Math.round(readiness * 100)}%
            </p>
            <p className="text-xs text-slate-500">
              已达标 {masteredCount}/{goal.requiredUnitIds.length} 个单元
            </p>
          </div>
        </div>
        <div className="mt-5">
          <Bar value={readiness} target={GOAL_TARGET} targetLabel={`目标 ${Math.round(GOAL_TARGET * 100)}%`} />
        </div>
      </Card>

      {actions.length === 0 ? (
        <Card className="mt-6 border-emerald-200 bg-emerald-50/40">
          <p className="text-lg font-semibold text-slate-900">🎉 当前目标所有单元已达标</p>
          <p className="mt-1 text-sm text-slate-500">
            就绪度 {Math.round(readiness * 100)}% · 没有待补缺口。
          </p>
        </Card>
      ) : (
        <Card className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            待补缺口（{actions.length} · 依赖序）
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
                      {actionKindLabel(action.kind)}
                    </span>
                    <span className="truncate text-sm font-medium text-slate-800">
                      {unitTitle(action.unitId)}
                    </span>
                    <span className="text-xs text-slate-400">
                      掌握度 {Math.round(mastery * 100)}%
                    </span>
                    <span className="text-xs text-indigo-600">还差 {gap}%</span>
                    <BandBadge band={bandOf(mastery)} />
                  </div>
                  <button
                    onClick={() => navigate(to)}
                    className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
                  >
                    {action.kind === "assessment" ? "去测评" : "去学习"} →
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
