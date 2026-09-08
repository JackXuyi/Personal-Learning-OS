import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BandBadge, Bar, Card, SectionTitle, Stat } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { MASTERY_THRESHOLD } from "../../domain";
import type { Chapter, NextAction } from "../../domain";
import { bandOf } from "../../engine";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { useI18n } from "../../i18n";
import {
  actionPath,
  chapterActionMeta,
  chapterDisplayTitle,
  makeRetakePaper,
} from "../plan/chapter-action";

/**
 * 首页 —— 每日启动器（范式 A · V2 章级语义，T8）。
 *
 * 设计（docs §2 融合矩阵 #7）：保留「一屏一主行动」，语义换为
 * 「章就绪度条 + 今日主行动 = 计划头项（去学 / 去测 / 去补考 / 复习要点）」。
 * 数据源：useLoopStore.chapterPlan（runChapterLoop → buildChapterPlan）。
 */
export default function HomePage() {
  const plan = useLoopStore((s) => s.chapterPlan);
  const loading = useLoopStore((s) => s.loading);
  const error = useLoopStore((s) => s.error);
  const refresh = useLoopStore((s) => s.refresh);
  const { m } = useI18n();
  /** 首帧前不闪空态。 */
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    void (async () => {
      await refresh();
      setChecked(true);
    })();
  }, [refresh]);

  return (
    <PageContainer>
      <SectionTitle title={m.home.title} subtitle={m.home.subtitle} />

      {error ? (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      ) : null}

      {!checked || (loading && !plan) ? (
        <Card>
          <p className="text-sm text-slate-500">{m.home.running}</p>
        </Card>
      ) : null}

      {/* 空库：无资料无章节 */}
      {plan && plan.docs.length === 0 ? <EmptyState /> : null}

      {/* 有资料但还没章节（如旧数据未切分） */}
      {plan && plan.docs.length > 0 && plan.total === 0 ? (
        <NoChapterCard />
      ) : null}

      {/* 章级主视图 */}
      {plan && plan.total > 0 ? (
        plan.actions.length === 0 ? (
          <AllDoneCard />
        ) : (
          <div className="space-y-6">
            {plan.next ? <MainCtaCard /> : null}
            <ReadinessCard />
            <PlanPreview />
          </div>
        )
      ) : null}
    </PageContainer>
  );
}

/** 章索引（chapterId → Chapter；主 CTA 与计划预览共用）。 */
function useChapterIndex(): Map<string, Chapter> {
  const plan = useLoopStore((s) => s.chapterPlan);
  return useMemo(() => {
    const index = new Map<string, Chapter>();
    for (const list of Object.values(plan?.chaptersByDoc ?? {})) {
      for (const c of list) index.set(c.id, c);
    }
    return index;
  }, [plan]);
}

/** 执行章级动作：阅读/复习/测验直达；补考就地生成补考卷。返回后由调用方决定跳转。 */
function useRunAction() {
  const navigate = useNavigate();
  const plan = useLoopStore((s) => s.chapterPlan);
  const index = useChapterIndex();
  const [busyId, setBusyId] = useState<string | undefined>();
  const run = async (action: NextAction) => {
    if (busyId) return;
    const chapter = index.get(action.unitId);
    const path = actionPath(action, chapter);
    if (path) {
      navigate(path);
      return;
    }
    if (chapter && plan) {
      setBusyId(chapter.id);
      try {
        const paper = makeRetakePaper(
          chapter,
          plan.chaptersByDoc[chapter.documentId] ?? [chapter],
          plan.learner,
        );
        await storage.savePaper(paper);
        navigate(`/quiz/${paper.id}`);
      } finally {
        setBusyId(undefined);
      }
    }
  };
  return { run, busyId };
}

/**
 * 主 CTA —— 计划头项（章级「最佳下一步」）：去学 / 去测 / 去补考 / 复习要点。
 */
function MainCtaCard() {
  const plan = useLoopStore((s) => s.chapterPlan);
  const index = useChapterIndex();
  const { run, busyId } = useRunAction();
  const { m } = useI18n();
  const next = plan?.next;
  if (!next || !plan) return null;
  const chapter = index.get(next.unitId);
  const mastery = chapter ? (plan.learner.byUnit[chapter.id]?.mastery ?? 0) : 0;
  const meta = chapterActionMeta(next.kind, m);
  const busy = busyId === chapter?.id;

  return (
    <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-white">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-400">
            {m.home.todayActionEyebrow} · {m.units.action[next.kind]}
          </p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {chapter
              ? chapterDisplayTitle(chapter, plan.docTitleOf[chapter.id], m)
              : next.unitId}
            <span className="ml-2 text-sm font-normal text-slate-500">
              {m.home.masteryAt(Math.round(mastery * 100))}
            </span>
          </p>
        </div>
        <button
          onClick={() => void run(next)}
          disabled={busy}
          className="rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? m.home.generating : `${meta.cta} →`}
        </button>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-indigo-500 hover:text-indigo-700">
          {m.home.why}
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

/** 章就绪度卡：达标章 / 总章 + 待补缺口 + 前两项优先级预览。 */
function ReadinessCard() {
  const plan = useLoopStore((s) => s.chapterPlan);
  const index = useChapterIndex();
  const { m } = useI18n();
  if (!plan || plan.total === 0) return null;
  const ratio = plan.mastered / plan.total;
  const lead = plan.actions.slice(0, 2);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {plan.goal ? m.home.goalOf(plan.goal.title) : m.home.goalFallback}
          </p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {m.home.chaptersMastered(plan.mastered, plan.total)}
          </p>
          <p className="text-sm text-slate-500">
            {m.home.readyLine(
              Math.round(MASTERY_THRESHOLD * 100),
              plan.actions.length,
            )}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8">
          <Stat
            label={m.home.statReady}
            value={`${Math.round(ratio * 100)}%`}
            hint={m.common.targetLine(Math.round(MASTERY_THRESHOLD * 100))}
          />
          <Stat
            label={m.home.statPending}
            value={`${plan.actions.length}`}
            hint={m.home.statPendingHint}
          />
        </div>
      </div>
      <div className="mt-5">
        <Bar
          value={ratio}
          target={MASTERY_THRESHOLD}
          targetLabel={m.common.targetLine(Math.round(MASTERY_THRESHOLD * 100))}
        />
        {lead.length > 0 ? (
          <ul className="mt-2 space-y-0.5">
            {lead.map((a) => {
              const ch = index.get(a.unitId);
              return (
                <li key={a.id} className="text-xs text-slate-500">
                  {m.home.priorityFill}{" "}
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                    {m.units.action[a.kind]}
                  </span>{" "}
                  <span className="font-medium text-slate-700">
                    {ch
                      ? chapterDisplayTitle(ch, plan.docTitleOf[ch.id], m)
                      : a.unitId}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

/** 学习计划前 3 项 + 入口（完整队列在 /plan）。 */
function PlanPreview() {
  const plan = useLoopStore((s) => s.chapterPlan);
  const index = useChapterIndex();
  const { run, busyId } = useRunAction();
  const { m } = useI18n();
  if (!plan || plan.actions.length === 0) return null;
  const items = plan.actions.slice(0, 3);
  return (
    <Card>
      <SectionTitle
        title={m.home.planTitle}
        subtitle={m.home.planSubtitle}
        action={
          <Link to="/plan" className="text-sm font-medium text-indigo-600 hover:underline">
            {m.home.viewAll}
          </Link>
        }
      />
      <ol className="space-y-2">
        {items.map((action, i) => {
          const chapter = index.get(action.unitId);
          const mastery = chapter ? (plan.learner.byUnit[chapter.id]?.mastery ?? 0) : 0;
          const meta = chapterActionMeta(action.kind, m);
          const busy = busyId === chapter?.id;
          return (
            <li
              key={action.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-6 shrink-0 text-sm font-medium text-slate-400">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}
                >
                  {m.units.action[action.kind]}
                </span>
                <span className="truncate text-sm font-medium text-slate-800">
                  {chapter
                    ? chapterDisplayTitle(chapter, plan.docTitleOf[chapter.id], m)
                    : action.unitId}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-slate-400">
                  {m.home.masteryAt(Math.round(mastery * 100))}
                </span>
                <BandBadge band={bandOf(mastery)} />
                <button
                  onClick={() => void run(action)}
                  disabled={busy}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                >
                  {busy ? "…" : meta.verb}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** 全部达标态。 */
function AllDoneCard() {
  const { m } = useI18n();
  return (
    <Card className="border-emerald-200 bg-emerald-50/40">
      <p className="text-lg font-semibold text-slate-900">{m.home.allDoneTitle}</p>
      <p className="mt-1 text-sm text-slate-500">{m.home.allDoneDesc}</p>
      <div className="mt-4 flex gap-3">
        <Link
          to="/quiz"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {m.home.goQuizReinforce}
        </Link>
        <Link
          to="/learn"
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {m.home.viewCatalog}
        </Link>
      </div>
    </Card>
  );
}

/** 空库引导（导入第一份资料）。 */
function EmptyState() {
  const { m } = useI18n();
  return (
    <Card>
      <p className="text-lg font-semibold text-slate-900">{m.home.emptyTitle}</p>
      <p className="mt-1 text-sm text-slate-500">{m.home.emptyDesc}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          to="/learn?import=1"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {m.common.import}
        </Link>
        <Link
          to="/plan"
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {m.home.viewPlan}
        </Link>
      </div>
    </Card>
  );
}

/** 有资料但未切分章节（旧数据兜底，引导去 /learn 处理）。 */
function NoChapterCard() {
  const { m } = useI18n();
  return (
    <Card className="border-dashed">
      <p className="text-lg font-semibold text-slate-900">{m.home.noChapterTitle}</p>
      <p className="mt-1 text-sm text-slate-500">{m.home.noChapterDesc}</p>
      <div className="mt-4 flex gap-3">
        <Link
          to="/learn"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {m.home.goCatalog}
        </Link>
        <Link
          to="/learn?import=1"
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {m.common.import}
        </Link>
      </div>
    </Card>
  );
}
