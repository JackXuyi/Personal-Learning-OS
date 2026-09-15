/**
 * /plan 学习计划执行页（V2 章级，UI Workbench U2；F2 时间维度）——
 * 计划 = 决策队列（Knowledge State → Action → Reason），不是 todo list。
 *
 * 数据：useLoopStore.chapterPlan（runChapterLoop 章级快照；已按 activeGoal 范围裁剪 §7.3；
 * buildChapterPlan 决策队列：重学弱章 > 补考 > 复习要点 > 测已学章 > 推进未学章）。
 * 内容：
 * - 章就绪度卡：达标章数 / 章总数 + 目标 + 待补缺口（activeGoal 范围）
 *   + 完成日期估算（F1）+ 今日配额（F2，**仅设了截止日时**）；
 * - 有截止日（F2）→ 按时间三段：今天必做（ActionCard）/ 本周完成 / 之后（KnowledgeRow）；
 * - 无截止日（D3）→ 逐字节退回两段：NEXT（前 3 项）/ UP NEXT（其余）；
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
import type { LearnerState, NextAction } from "../../domain";
import { bandOf } from "../../engine";
import { useLoopStore } from "../../stores/useLoopStore";
import { useI18n } from "../../i18n";
import {
  chapterActionMeta,
  chapterDisplayTitle,
  estimateEtaMin,
  estimatePlanEta,
} from "./chapter-action";
import { planQuota } from "./plan-quota";
import { useChapterIndex, useRunChapterAction } from "./run-action";
import { fmtDate } from "../goals/GoalsPage";

/** NEXT 高优段条数（其余进 UP NEXT）—— 仅无 deadline 的现状两段用。 */
const NEXT_LIMIT = 3;

export default function PlanPage() {
  const { m, lang } = useI18n();
  const plan = useLoopStore((s) => s.chapterPlan);
  const loading = useLoopStore((s) => s.loading);
  const refresh = useLoopStore((s) => s.refresh);
  const chapterById = useChapterIndex();
  const { run: runAction, busyId } = useRunChapterAction();

  useEffect(() => {
    void refresh(m);
  }, [refresh]);

  const readyRatio = plan && plan.total > 0 ? plan.mastered / plan.total : 0;

  // F1：完成日期估算（条件句）。未声明每周预算 → finishAt 为 undefined → 整行不渲染。
  const eta = plan
    ? estimatePlanEta({
        actions: plan.actions,
        chapterOf: (id) => chapterById.get(id),
        ...(plan.profile ? { profile: plan.profile } : {}),
        ...(plan.goal?.deadlineAt !== undefined ? { deadlineAt: plan.goal.deadlineAt } : {}),
      })
    : undefined;

  // F2：今日配额与时间分组（纯派生）。无 deadline → groups 缺失 → 退回现状两段。
  const quota = plan
    ? planQuota({
        actions: plan.actions,
        chapterOf: (id) => chapterById.get(id),
        ...(plan.profile ? { profile: plan.profile } : {}),
        ...(plan.goal?.deadlineAt !== undefined ? { deadlineAt: plan.goal.deadlineAt } : {}),
      })
    : undefined;

  const actions = plan?.actions ?? [];
  const groups = quota?.groups;
  // 三段（F2）与两段（现状）唯一的差别就是取值与标题；渲染逻辑共用下面两个函数。
  const next = groups?.today ?? actions.slice(0, NEXT_LIMIT);
  const second = groups?.week ?? actions.slice(NEXT_LIMIT);
  const third = groups?.later ?? [];

  /** 配额行数据（F2）：**有截止日且队列非空**才成立 —— 否则整行不渲染（D3）。 */
  const quotaLine =
    quota && groups && quota.dueTodayMin !== undefined && quota.daysLeft !== undefined
      ? {
          min: quota.dueTodayMin,
          count: groups.today.length,
          overdue: quota.overdue,
          days: quota.overdue ? (quota.overdueDays ?? 1) : quota.daysLeft,
        }
      : undefined;

  // 提取为局部常量：让下面两个渲染函数不必对 plan 做非空断言。
  const learnerByUnit: LearnerState["byUnit"] = plan?.learner.byUnit ?? {};
  const docTitleOf: Record<string, string> = plan?.docTitleOf ?? {};

  /** 行首语义点：补考必弱；未达标标 weak；达标 mastered；0 掌握 idle。 */
  const toneOf = (action: NextAction, mastery: number): StatusTone => {
    if (action.kind === "retake-quiz") return "weak";
    if (mastery >= MASTERY_THRESHOLD) return "mastered";
    return mastery > 0 ? "weak" : "idle";
  };

  /** 高优动作卡（今天必做 / NEXT 共用）—— 避免三段复制同一套映射。 */
  const renderCard = (action: NextAction, i: number) => {
    const chapter = chapterById.get(action.unitId);
    const mastery = chapter ? (learnerByUnit[chapter.id]?.mastery ?? 0) : 0;
    const meta = chapterActionMeta(action.kind, m);
    const busy = busyId === chapter?.id;
    return (
      <ActionCard
        key={action.id}
        eyebrow={`${String(i + 1).padStart(2, "0")} · ${m.units.action[action.kind]}`}
        title={chapter ? chapterDisplayTitle(chapter, docTitleOf[chapter.id], m) : action.unitId}
        mastery={chapter ? mastery : undefined}
        reasons={action.reasons.length > 0 ? action.reasons : undefined}
        ctaLabel={busy ? m.plan.generating : `${meta.cta} →`}
        onCta={() => void runAction(action)}
        eta={chapter ? m.plan.etaOf(estimateEtaMin(action, chapter)) : undefined}
      />
    );
  };

  /** 压缩行（本周完成 / 之后 / UP NEXT 共用）。 */
  const renderRow = (action: NextAction) => {
    const chapter = chapterById.get(action.unitId);
    const mastery = chapter ? (learnerByUnit[chapter.id]?.mastery ?? 0) : 0;
    const meta = chapterActionMeta(action.kind, m);
    const busy = busyId === chapter?.id;
    return (
      <KnowledgeRow
        key={action.id}
        tone={toneOf(action, mastery)}
        title={chapter ? chapterDisplayTitle(chapter, docTitleOf[chapter.id], m) : action.unitId}
        bandLabel={chapter ? m.units.band[bandOf(mastery)] : undefined}
        mastery={chapter ? mastery : undefined}
        meta={chapter ? m.plan.etaOf(estimateEtaMin(action, chapter)) : undefined}
        actionLabel={busy ? "…" : meta.verb}
        onAction={() => void runAction(action)}
      />
    );
  };

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
                {eta?.finishAt !== undefined ? (
                  <p className="mt-0.5 text-sm text-ink-2" data-testid="plan-eta-finish">
                    {m.plan.etaFinish(fmtDate(eta.finishAt, lang))}
                    {eta.deadline
                      ? ` · ${
                          eta.deadline.behind
                            ? m.plan.etaBehind(eta.deadline.days)
                            : m.plan.etaAhead(eta.deadline.days)
                        }`
                      : ""}
                  </p>
                ) : null}
                {/* F2：今天该做多少（与上面的「来不来得及」并列，两个问题分开答） */}
                {quotaLine ? (
                  <p className="mt-0.5 text-sm text-ink-2" data-testid="plan-quota">
                    {m.plan.quotaToday(quotaLine.min, quotaLine.count)}
                    {" · "}
                    <span className={quotaLine.overdue ? "text-amber-700" : undefined}>
                      {quotaLine.overdue
                        ? m.plan.quotaOverdue(quotaLine.days)
                        : m.plan.quotaDaysLeft(quotaLine.days)}
                    </span>
                  </p>
                ) : null}
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
              {/* 第一段 —— 今天必做（F2）/ NEXT · 今天做（现状）：ActionCard 纵排 */}
              {next.length > 0 ? (
                <section className="space-y-3">
                  <Section title={groups ? m.plan.groupToday : m.plan.next} />
                  {next.map(renderCard)}
                </section>
              ) : null}

              {/* 第二段 —— 本周完成（F2）/ UP NEXT · 排队做（现状）：压缩行 */}
              {second.length > 0 ? (
                <section>
                  <Section title={groups ? m.plan.groupWeek : m.plan.upNext} />
                  <div className="mt-1">{second.map(renderRow)}</div>
                </section>
              ) : null}

              {/* 第三段 —— 仅 F2 三段时有（「之后」） */}
              {third.length > 0 ? (
                <section>
                  <Section title={m.plan.groupLater} />
                  <div className="mt-1">{third.map(renderRow)}</div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </PageContainer>
  );
}
