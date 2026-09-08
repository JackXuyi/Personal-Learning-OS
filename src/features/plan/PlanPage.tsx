/**
 * /plan 学习计划执行页（V2 章级）—— 取代概念层 /study 今日队列（docs §2 融合矩阵 #5）。
 *
 * 数据：useLoopStore.chapterPlan（runChapterLoop 章级快照；buildChapterPlan 决策队列：
 * 重学弱章 > 补考 > 复习要点 > 测已学章 > 推进未学章）。
 * 内容：
 * - 章就绪度卡：达标章数 / 章总数 + 目标 + 待补缺口；
 * - 计划队列：每项 = kind 徽标 · doc·第 x 章 · title · 掌握度 + reasons（可解释）
 *   + 直达入口（去学习 / 去测验 / 去复习 / 生成补考卷）；
 * - 空态：无章节 → 引导导入；全部达标 → 庆祝 + 去巩固。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BandBadge, Bar, Card, SectionTitle } from "../../components/primitives";
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
} from "./chapter-action";

export default function PlanPage() {
  const { m } = useI18n();
  const navigate = useNavigate();
  const plan = useLoopStore((s) => s.chapterPlan);
  const loading = useLoopStore((s) => s.loading);
  const refresh = useLoopStore((s) => s.refresh);
  const [busyId, setBusyId] = useState<string | undefined>();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const chapterById = useMemo(() => {
    const index = new Map<string, Chapter>();
    for (const list of Object.values(plan?.chaptersByDoc ?? {})) {
      for (const c of list) index.set(c.id, c);
    }
    return index;
  }, [plan]);

  /** 执行计划项：阅读/复习/测验 → 直达；补考 → 生成补考卷（降一档）后进入作答。 */
  const runAction = async (action: NextAction) => {
    if (busyId) return;
    const chapter = chapterById.get(action.unitId);
    const path = actionPath(action, chapter);
    if (path) {
      navigate(path);
      return;
    }
    // retake-quiz：就地生成补考卷。
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

  const readyRatio = plan && plan.total > 0 ? plan.mastered / plan.total : 0;

  return (
    <PageContainer>
      <SectionTitle
        title={m.plan.title}
        subtitle={
          plan
            ? m.plan.subtitle(
                plan.goal?.title ?? m.spaces.title,
                plan.mastered,
                plan.total,
                plan.actions.length,
              )
            : m.plan.loadingSubtitle
        }
        action={
          <Link
            to="/quiz/new"
            className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {m.plan.newPaper}
          </Link>
        }
      />

      {loading && !plan ? (
        <Card>
          <p className="text-sm text-slate-500">{m.plan.running}</p>
        </Card>
      ) : null}

      {plan && plan.total === 0 ? (
        <Card className="border-dashed">
          <p className="text-base font-semibold text-slate-900">{m.plan.emptyTitle}</p>
          <p className="mt-1 text-sm text-slate-500">{m.plan.emptyDesc}</p>
          <div className="mt-4 flex gap-3">
            <Link
              to="/learn?import=1"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              {m.common.import}
            </Link>
            <Link
              to="/learn"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {m.plan.goCatalog}
            </Link>
          </div>
        </Card>
      ) : null}

      {plan && plan.total > 0 ? (
        <div className="space-y-6">
          {/* 章就绪度概览 */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {m.plan.readinessEyebrow}
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {m.plan.masteredOf(plan.mastered, plan.total)}
                </p>
                <p className="text-sm text-slate-500">
                  {plan.actions.length > 0
                    ? m.plan.remaining(plan.actions.length)
                    : m.plan.allReadyDesc}
                </p>
              </div>
              <div className="w-44 shrink-0">
                <Bar value={readyRatio} target={MASTERY_THRESHOLD} />
              </div>
            </div>
          </Card>

          {/* 计划队列 */}
          {plan.actions.length === 0 ? (
            <Card className="border-emerald-200 bg-emerald-50/40">
              <p className="text-lg font-semibold text-slate-900">{m.plan.allDoneTitle}</p>
              <p className="mt-1 text-sm text-slate-500">{m.plan.allDoneDesc}</p>
              <div className="mt-4 flex gap-3">
                <Link
                  to="/quiz/new"
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  {m.plan.quizAll}
                </Link>
                <Link
                  to="/learn?import=1"
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {m.plan.importMore}
                </Link>
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {plan.actions.map((action, i) => {
                const chapter = chapterById.get(action.unitId);
                const mastery = chapter
                  ? (plan.learner.byUnit[chapter.id]?.mastery ?? 0)
                  : 0;
                const meta = chapterActionMeta(action.kind, m);
                const busy = busyId === chapter?.id;
                return (
                  <div
                    key={action.id}
                    className="flex flex-wrap items-start gap-3 rounded-xl border border-slate-100 bg-white p-3.5 shadow-sm transition hover:border-indigo-100"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta.chip}`}
                        >
                          {m.units.action[action.kind]}
                        </span>
                        <span className="text-sm font-medium text-slate-800">
                          {chapter
                            ? chapterDisplayTitle(chapter, plan.docTitleOf[chapter.id], m)
                            : action.unitId}
                        </span>
                        {chapter ? (
                          <span className="text-xs tabular-nums text-slate-400">
                            {m.plan.masteryAt(Math.round(mastery * 100))}
                          </span>
                        ) : null}
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {action.reasons.map((r, ri) => (
                          <li key={ri} className="text-xs leading-5 text-slate-500">
                            · {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {chapter ? <BandBadge band={bandOf(mastery)} /> : null}
                      <button
                        onClick={() => void runAction(action)}
                        disabled={Boolean(busy)}
                        className="shrink-0 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {busy ? m.plan.generating : `${meta.verb} →`}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </PageContainer>
  );
}
