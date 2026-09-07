import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BandBadge, Bar, Card, SectionTitle, Stat } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { bandOf } from "../../engine";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { actionKindLabel, GOAL_TARGET, goalTypeLabel, importanceLabel, unitTitle } from "../units";

/**
 * 首页 —— 每日启动器（范式 A）。
 *
 * 首屏唯一任务 = 看到今天该做的一件事并点下去：
 *  主 CTA（今日最佳下一步）→ 复习会话 / 测评
 * 次级 = 就绪度目标梯度 + 学习计划入口
 */
export default function HomePage() {
  const snapshot = useLoopStore((s) => s.snapshot);
  const loading = useLoopStore((s) => s.loading);
  const error = useLoopStore((s) => s.error);
  const refresh = useLoopStore((s) => s.refresh);
  /** 存储中无任何目标 → 展示空态引导（不自动播种，把决定权交给用户）。 */
  const [noGoal, setNoGoal] = useState(false);
  const [checkedGoal, setCheckedGoal] = useState(false);

  useEffect(() => {
    void (async () => {
      await refresh();
      const goals = await storage.listGoals();
      if (goals.length === 0) setNoGoal(true);
      setCheckedGoal(true);
    })();
  }, [refresh]);

  /** 闭环快照就绪后清掉空态标记（点「载入演示数据」后会触发 refresh）。 */
  useEffect(() => {
    if (snapshot) setNoGoal(false);
  }, [snapshot]);

  return (
    <PageContainer>
      <SectionTitle
        title="学习闭环"
        subtitle="今天只做一件事——系统已经替你算好。"
      />

      {error ? (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      ) : null}

      {!checkedGoal || (loading && !snapshot) ? (
        <Card>
          <p className="text-sm text-slate-500">正在运行学习闭环…</p>
        </Card>
      ) : null}

      {checkedGoal && noGoal ? (
        <EmptyState onLoadDemo={() => void refresh()} />
      ) : null}

      {snapshot && snapshot.actions.length === 0 ? (
        <AllDoneCard />
      ) : null}

      {snapshot && snapshot.actions.length > 0 ? (
        <div className="space-y-6">
          {/* 主 CTA —— 首屏视觉第一优先 */}
          {snapshot.next ? (
            <MainCtaCard />
          ) : null}

          {/* 目标就绪度（含 80% 刻度与缺口拆解） */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  当前目标
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {snapshot.goal.title}
                </p>
                <p className="text-sm text-slate-500">
                  {goalTypeLabel(snapshot.goal.type)} · 重要性{" "}
                  {importanceLabel(snapshot.goal.importance)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <Stat
                  label="就绪度"
                  value={`${Math.round(snapshot.readiness * 100)}%`}
                  hint={`目标 ${Math.round(GOAL_TARGET * 100)}%`}
                />
                <Stat
                  label="待补缺口"
                  value={`${snapshot.actions.length}`}
                  hint="按依赖优先级排序"
                />
              </div>
            </div>
            <div className="mt-5">
              <Bar value={snapshot.readiness} target={GOAL_TARGET} targetLabel={`目标 ${Math.round(GOAL_TARGET * 100)}%`} />
              <GapBreakdown actions={snapshot.actions.slice(0, 2)} />
            </div>
          </Card>

          {/* 学习计划（前 3 项 + 入口） */}
          <Card>
            <SectionTitle
              title="学习计划"
              subtitle="学习规划器按依赖优先级排序。"
              action={
                <Link
                  to="/study"
                  className="text-sm font-medium text-indigo-600 hover:underline"
                >
                  查看全部
                </Link>
              }
            />
            <PlanList limit={3} />
          </Card>
        </div>
      ) : null}
    </PageContainer>
  );
}

/**
 * 主 CTA —— 「最佳下一步」从静态卡升级为可执行动作。
 */
function MainCtaCard() {
  const navigate = useNavigate();
  const snapshot = useLoopStore((s) => s.snapshot);
  const next = snapshot?.next;
  if (!next) return null;
  const mastery = snapshot.masteryByUnit[next.unitId] ?? 0;

  const verbByKind: Record<string, string> = {
    learn: "开始学习",
    review: "开始今天的下一步",
    practice: "继续练习",
    remediation: "开始补救复习",
    assessment: "开始测评",
    explore: "去探索",
  };
  const verb = verbByKind[next.kind] ?? "开始";
  const to = next.kind === "assessment" ? `/assessment?unit=${next.unitId}` : `/study/session?unit=${next.unitId}`;

  return (
    <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-white">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-400">
            最佳下一步 · {actionKindLabel(next.kind)}
          </p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {unitTitle(next.unitId)}
            <span className="ml-2 text-sm font-normal text-slate-500">
              当前掌握度 {Math.round(mastery * 100)}%
            </span>
          </p>
        </div>
        <button
          onClick={() => navigate(to)}
          className="rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.99]"
        >
          {verb} →
        </button>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-indigo-500 hover:text-indigo-700">
          为什么是它？（可解释）
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {next.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

/** 目标梯度：还差哪些单元到 80%（范式 F 克制版）。 */
function GapBreakdown({ actions }: { actions: { unitId: string }[] }) {
  const snapshot = useLoopStore((s) => s.snapshot);
  if (!snapshot || actions.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5">
      {actions.map((a) => {
        const mastery = snapshot.masteryByUnit[a.unitId] ?? 0;
        const gap = Math.max(0, Math.round((GOAL_TARGET - mastery) * 100));
        return (
          <li key={a.unitId} className="text-xs text-slate-500">
            还差 <span className="font-medium text-slate-700">{unitTitle(a.unitId)}</span>
            <span className="text-indigo-600"> +{gap}%</span> 达标
          </li>
        );
      })}
    </ul>
  );
}

/** 全部达标态。 */
function AllDoneCard() {
  return (
    <Card className="border-emerald-200 bg-emerald-50/40">
      <p className="text-lg font-semibold text-slate-900">🎉 当前目标所有单元已达标</p>
      <p className="mt-1 text-sm text-slate-500">复习已排入计划，可继续测评巩固。</p>
      <div className="mt-4 flex gap-3">
        <Link
          to="/assessment"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          去测评巩固
        </Link>
        <Link
          to="/knowledge"
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          查看知识图谱
        </Link>
      </div>
    </Card>
  );
}

/** 无任何目标/数据的空态引导（M4）。 */
function EmptyState({ onLoadDemo }: { onLoadDemo: () => void }) {
  return (
    <Card>
      <p className="text-lg font-semibold text-slate-900">📥 还没有学习目标</p>
      <p className="mt-1 text-sm text-slate-500">
        导入第一份资料，系统会自动为你生成学习闭环。
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          to="/knowledge?import=1"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          导入资料
        </Link>
        <button
          onClick={onLoadDemo}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          载入演示数据
        </button>
      </div>
    </Card>
  );
}

function PlanList({ limit }: { limit?: number }) {
  const snapshot = useLoopStore((s) => s.snapshot);
  if (!snapshot || snapshot.actions.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        没有待补缺口——目标进展正常。{" "}
        <Link to="/knowledge" className="text-indigo-600 hover:underline">
          查看你的知识图谱
        </Link>
        。
      </p>
    );
  }
  const items = limit ? snapshot.actions.slice(0, limit) : snapshot.actions;
  return (
    <ol className="space-y-2">
      {items.map((action, i) => {
        const mastery = snapshot.masteryByUnit[action.unitId] ?? 0;
        return (
          <li
            key={action.id}
            className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="w-6 shrink-0 text-sm font-medium text-slate-400">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {actionKindLabel(action.kind)}
              </span>
              <span className="truncate text-sm font-medium text-slate-800">
                {unitTitle(action.unitId)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-slate-400">掌握度 {Math.round(mastery * 100)}%</span>
              <BandBadge band={bandOf(mastery)} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
