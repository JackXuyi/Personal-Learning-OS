/**
 * /plan 学习计划执行页（V2 章级，UI Workbench U2）——
 * 计划 = 决策队列（Knowledge State → Action → Reason），不是 todo list。
 *
 * 数据：useLoopStore.chapterPlan（runChapterLoop 章级快照；已按 activeGoal 范围裁剪 §7.3；
 * buildChapterPlan 决策队列：重学弱章 > 补考 > 复习要点 > 测已学章 > 推进未学章）。
 * 内容：
 * - 章就绪度卡：达标章数 / 章总数 + 目标 + 待补缺口（activeGoal 范围）；
 * - NEXT（高优 1–3）：ActionCard 纵排 —— 每项带 kind 徽标 + 掌握度 + why-now reasons
 *   + 时间预估（etaOf，启发式）+ 直达入口；
 * - UP NEXT（其余）：KnowledgeRow 压缩行 —— 一眼区分「今天做 vs 排队做」；
 * - 空态：无章节 → 引导导入；全部达标 → 庆祝 + 去巩固。
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ActionCard,
  Bar,
  Card,
  KnowledgeRow,
  Section,
  SectionTitle,
  type StatusTone,
} from "../../components/primitives";
import { PageContainer, openImportModal } from "../../components/layout/AppShell";
import { Button, buttonVariants } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { MASTERY_THRESHOLD } from "../../domain";
import type { NextAction } from "../../domain";
import { bandOf } from "../../engine";
import { useLoopStore } from "../../stores/useLoopStore";
import { useI18n } from "../../i18n";
import {
  chapterActionMeta,
  chapterDisplayTitle,
  estimateEtaMin,
} from "./chapter-action";
import { useChapterIndex, useRunChapterAction } from "./run-action";

/** NEXT 高优段条数（其余进 UP NEXT）。 */
const NEXT_LIMIT = 3;

export default function PlanPage() {
  const { m } = useI18n();
  const plan = useLoopStore((s) => s.chapterPlan);
  const loading = useLoopStore((s) => s.loading);
  const refresh = useLoopStore((s) => s.refresh);
  const chapterById = useChapterIndex();
  const { run: runAction, busyId } = useRunChapterAction();

  useEffect(() => {
    void refresh(m);
  }, [refresh]);

  const readyRatio = plan && plan.total > 0 ? plan.mastered / plan.total : 0;

  /** 行首语义点：补考必弱；未达标标 weak；达标 mastered；0 掌握 idle。 */
  const toneOf = (action: NextAction, mastery: number): StatusTone => {
    if (action.kind === "retake-quiz") return "weak";
    if (mastery >= MASTERY_THRESHOLD) return "mastered";
    return mastery > 0 ? "weak" : "idle";
  };

  const actions = plan?.actions ?? [];
  const next = actions.slice(0, NEXT_LIMIT);
  const upNext = actions.slice(NEXT_LIMIT);

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
            className={cn(buttonVariants({ size: "sm" }), "px-3.5 text-sm")}
          >
            {m.plan.newPaper}
          </Link>
        }
      />

      {loading && !plan ? (
        <Card>
          <p className="text-sm text-ink-2">{m.plan.running}</p>
        </Card>
      ) : null}

      {plan && plan.total === 0 ? (
        <Card className="border-dashed">
          <p className="text-base font-semibold text-ink-1">{m.plan.emptyTitle}</p>
          <p className="mt-1 text-sm text-ink-2">{m.plan.emptyDesc}</p>
          <div className="mt-4 flex gap-3">
            <Button
              type="button"
              onClick={openImportModal}
            >
              {m.common.import}
            </Button>
            <Link
              to="/learn"
              className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-subtle"
            >
              {m.plan.goCatalog}
            </Link>
          </div>
        </Card>
      ) : null}

      {plan && plan.total > 0 ? (
        <div className="space-y-6">
          {/* 章就绪度概览（activeGoal 范围） */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
                  {m.plan.readinessEyebrow}
                </p>
                <p className="mt-1 text-lg font-semibold text-ink-1">
                  {m.plan.masteredOf(plan.mastered, plan.total)}
                </p>
                <p className="text-sm text-ink-2">
                  {actions.length > 0
                    ? m.plan.remaining(actions.length)
                    : m.plan.allReadyDesc}
                </p>
              </div>
              <div className="w-44 shrink-0">
                <Bar value={readyRatio} target={MASTERY_THRESHOLD} />
              </div>
            </div>
          </Card>

          {actions.length === 0 ? (
            <Card>
              <p className="text-lg font-semibold text-ink-1">{m.plan.allDoneTitle}</p>
              <p className="mt-1 text-sm text-ink-2">{m.plan.allDoneDesc}</p>
              <div className="mt-4 flex gap-3">
                <Link
                  to="/quiz/new"
                  className={cn(buttonVariants())}
                >
                  {m.plan.quizAll}
                </Link>
                <button
                  type="button"
                  onClick={openImportModal}
                  className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-subtle"
                >
                  {m.plan.importMore}
                </button>
              </div>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* NEXT —— 今天做（高优 1–3，ActionCard 纵排） */}
              {next.length > 0 ? (
                <section className="space-y-3">
                  <Section title={m.plan.next} />
                  {next.map((action, i) => {
                    const chapter = chapterById.get(action.unitId);
                    const mastery = chapter
                      ? (plan.learner.byUnit[chapter.id]?.mastery ?? 0)
                      : 0;
                    const meta = chapterActionMeta(action.kind, m);
                    const busy = busyId === chapter?.id;
                    const eta = chapter
                      ? m.plan.etaOf(estimateEtaMin(action, chapter))
                      : undefined;
                    return (
                      <ActionCard
                        key={action.id}
                        eyebrow={`${String(i + 1).padStart(2, "0")} · ${m.units.action[action.kind]}`}
                        title={
                          chapter
                            ? chapterDisplayTitle(chapter, plan.docTitleOf[chapter.id], m)
                            : action.unitId
                        }
                        mastery={chapter ? mastery : undefined}
                        reasons={action.reasons.length > 0 ? action.reasons : undefined}
                        ctaLabel={busy ? m.plan.generating : `${meta.cta} →`}
                        onCta={() => void runAction(action)}
                        eta={eta}
                      />
                    );
                  })}
                </section>
              ) : null}

              {/* UP NEXT —— 排队做（其余，KnowledgeRow 压缩行） */}
              {upNext.length > 0 ? (
                <section>
                  <Section title={m.plan.upNext} />
                  <div className="mt-1">
                    {upNext.map((action) => {
                      const chapter = chapterById.get(action.unitId);
                      const mastery = chapter
                        ? (plan.learner.byUnit[chapter.id]?.mastery ?? 0)
                        : 0;
                      const meta = chapterActionMeta(action.kind, m);
                      const busy = busyId === chapter?.id;
                      return (
                        <KnowledgeRow
                          key={action.id}
                          tone={toneOf(action, mastery)}
                          title={
                            chapter
                              ? chapterDisplayTitle(chapter, plan.docTitleOf[chapter.id], m)
                              : action.unitId
                          }
                          bandLabel={chapter ? m.units.band[bandOf(mastery)] : undefined}
                          mastery={chapter ? mastery : undefined}
                          meta={
                            chapter ? m.plan.etaOf(estimateEtaMin(action, chapter)) : undefined
                          }
                          actionLabel={busy ? "…" : meta.verb}
                          onAction={() => void runAction(action)}
                        />
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </PageContainer>
  );
}
