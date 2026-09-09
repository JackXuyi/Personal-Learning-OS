import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ActionCard,
  Bar,
  Card,
  EvidenceRow,
  KnowledgeRow,
  Section,
  type StatusTone,
} from "../../components/primitives";
import { PageContainer, openImportModal } from "../../components/layout/AppShell";
import { Select } from "../../components/ui/select";
import { MASTERY_THRESHOLD } from "../../domain";
import type { Chapter, EvidenceEntry, NextAction } from "../../domain";
import { bandOf, type ChapterLoopSnapshot } from "../../engine";
import { useI18n, type Messages } from "../../i18n";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { chapterActionMeta, chapterDisplayTitle } from "../plan/chapter-action";
import { useChapterIndex, useRunChapterAction } from "../plan/run-action";

/**
 * 首页 —— Today 启动器（UI Workbench U1，docs/ui-workbench-plan-2026-09.md §U1）。
 *
 * 设计：第一屏只回答「现在最值得做什么，为什么」。
 *  1) 页头：今日 + 日期；目标上下文（goal 下拉切换 activeGoal）+ 章就绪度（目标刻度线）。
 *  2) NEXT BEST ACTION：唯一主行动 ActionCard（reasons = why-now 证据链）。
 *  3) 今日清单：NBA 之外的高优动作（KnowledgeRow 压缩行）+ 查看完整计划。
 *  4) RECENT EVIDENCE：折叠区，展示最近测评的证据行（§7.1 落地前的临时组装）。
 *
 * 数据来源：useLoopStore.chapterPlan（按 activeGoal 范围，§7.3）+ goal repo（activeGoal）
 * + 最近试卷结果（evidence 临时组装）。零引擎算法改动。
 */
export default function HomePage() {
  const plan = useLoopStore((s) => s.chapterPlan);
  const loading = useLoopStore((s) => s.loading);
  const error = useLoopStore((s) => s.error);
  const refresh = useLoopStore((s) => s.refresh);
  const { m, lang } = useI18n();
  /** 首帧前不闪空态。 */
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    void (async () => {
      await refresh(m);
      setChecked(true);
    })();
  }, [refresh]);

  return (
    <PageContainer>
      <header className="flex items-end justify-between gap-4">
        <h1 className="text-xl font-semibold text-ink-1">{m.home.title}</h1>
        <span className="text-xs text-ink-3">{dateHead(lang)}</span>
      </header>

      {error ? (
        <Card className="mt-4">
          <p className="text-sm text-state-failed">{error}</p>
        </Card>
      ) : null}

      {!checked || (loading && !plan) ? (
        <Card className="mt-6">
          <p className="text-sm text-ink-3">{m.home.running}</p>
        </Card>
      ) : null}

      {/* 空库：无资料无章节 */}
      {plan && plan.docs.length === 0 ? <EmptyState /> : null}

      {/* 有资料但还没章节（如旧数据未切分） */}
      {plan && plan.docs.length > 0 && plan.total === 0 ? (
        <NoChapterCard />
      ) : null}

      {/* 章级 Today 主视图 */}
      {plan && plan.total > 0 ? (
        plan.actions.length === 0 ? (
          <AllDoneCard />
        ) : (
          <TodayView />
        )
      ) : null}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Today 视图                                                          */
/* ------------------------------------------------------------------ */

/** 章级 Today 主视图：目标上下文 → NBA → 今日清单 → 最近证据。 */
function TodayView() {
  const plan = useLoopStore((s) => s.chapterPlan);
  const index = useChapterIndex();
  const { run, busyId } = useRunChapterAction();
  const { m } = useI18n();
  const [evidence, setEvidence] = useState<EvidenceView[] | undefined>(undefined);

  useEffect(() => {
    if (!plan || plan.total === 0) return;
    let alive = true;
    void loadRecentEvidence(plan, m).then((rows) => {
      if (alive) setEvidence(rows);
    });
    return () => {
      alive = false;
    };
  }, [plan, m]);

  if (!plan) return null;
  const readiness = plan.total > 0 ? plan.mastered / plan.total : 0;
  const items = plan.actions.slice(1, 4);
  const gaps = plan.actions.length;

  return (
    <div className="mt-5">
      {/* 目标上下文 + 章就绪度 */}
      <GoalContext />

      <div className="mt-1 flex items-baseline justify-between gap-4">
        <p className="text-sm text-ink-2">
          {m.home.masteredOf(plan.mastered, plan.total)}
          {gaps > 0 ? <span className="text-ink-3"> · {m.home.pendingOf(gaps)}</span> : null}
        </p>
        <p className="text-sm font-medium tabular-nums text-ink-1">
          {Math.round(readiness * 100)}%{" "}
          <span className="text-xs font-normal text-ink-3">
            {m.home.targetOf(Math.round(MASTERY_THRESHOLD * 100))}
          </span>
        </p>
      </div>
      <div className="mt-2">
        <Bar
          value={readiness}
          target={MASTERY_THRESHOLD}
          targetLabel={m.home.targetOf(Math.round(MASTERY_THRESHOLD * 100))}
          className="bg-primary"
        />
      </div>

      {/* NEXT BEST ACTION —— 一屏一个主决策 */}
      <Section title={m.home.nextBestAction} className="mt-6" />
      <div className="mt-2">
        <NextActionCard run={run} busyId={busyId} />
      </div>

      {/* 今日清单（NBA 之外的高优动作） */}
      {items.length > 0 ? (
        <>
          <Section
            title={m.home.todayTitle(items.length)}
            className="mt-6"
            action={
              <Link to="/plan" className="text-xs font-medium text-primary hover:text-primary/70">
                {m.home.viewPlan} →
              </Link>
            }
          />
          <div className="mt-1">
            {items.map((action) => {
              const chapter = index.get(action.unitId);
              const mastery = chapter ? (plan.learner.byUnit[chapter.id]?.mastery ?? 0) : 0;
              const meta = chapterActionMeta(action.kind, m);
              const busy = busyId === chapter?.id;
              return (
                <KnowledgeRow
                  key={action.id}
                  tone={toneOfMastery(mastery)}
                  title={
                    chapter
                      ? chapterDisplayTitle(chapter, plan.docTitleOf[chapter.id], m)
                      : action.unitId
                  }
                  bandLabel={m.units.action[action.kind]}
                  mastery={mastery}
                  actionLabel={busy ? "…" : meta.verb}
                  onAction={busy ? undefined : () => void run(action)}
                />
              );
            })}
          </div>
        </>
      ) : (
        <div className="mt-5 flex justify-end">
          <Link to="/plan" className="text-xs font-medium text-primary hover:text-primary/70">
            {m.home.viewPlan} →
          </Link>
        </div>
      )}

      {/* RECENT EVIDENCE（折叠区；§7.1 log 落地前由最近试卷结果临时组装） */}
      {evidence !== undefined ? (
        <details className="group mt-6">
          <summary className="flex cursor-pointer list-none items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-ink-2">
              {m.home.recentEvidence}
            </span>
            <span className="text-xs text-ink-3 transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="mt-1">
            {evidence.length > 0 ? (
              evidence.map((row, i) => (
                <EvidenceRow
                  key={`${row.at}-${i}`}
                  time={timeAgo(row.at, m)}
                  title={row.title}
                  delta={row.delta}
                  deltaTone={row.tone}
                />
              ))
            ) : (
              <p className="py-1 text-xs text-ink-3">{m.home.evidenceEmpty}</p>
            )}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** 主行动卡（唯一「抬升」主卡 = ActionCard；why-now = reasons 证据链）。 */
function NextActionCard({
  run,
  busyId,
}: {
  run: (action: NextAction) => Promise<void>;
  busyId?: string;
}) {
  const plan = useLoopStore((s) => s.chapterPlan);
  const index = useChapterIndex();
  const { m } = useI18n();
  const next = plan?.next;
  if (!next || !plan) return null;
  const chapter = index.get(next.unitId);
  const mastery = chapter ? (plan.learner.byUnit[chapter.id]?.mastery ?? 0) : 0;
  const meta = chapterActionMeta(next.kind, m);
  const busy = busyId === chapter?.id;

  return (
    <ActionCard
      eyebrow={m.units.action[next.kind]}
      title={
        chapter ? chapterDisplayTitle(chapter, plan.docTitleOf[chapter.id], m) : next.unitId
      }
      mastery={mastery}
      reasons={next.reasons.length > 0 ? next.reasons : undefined}
      ctaLabel={busy ? m.home.generating : `${meta.cta} →`}
      onCta={() => void run(next)}
    />
  );
}

/** 目标上下文行：goal 下拉（切换 activeGoal）+ 管理入口。 */
function GoalContext() {
  const goals = useLoopStore((s) => s.goals);
  const activeGoal = useLoopStore((s) => s.activeGoal);
  const switchGoal = useLoopStore((s) => s.switchGoal);
  const loading = useLoopStore((s) => s.loading);
  const { m } = useI18n();
  const [pickId, setPickId] = useState<string | undefined>();

  // store 追上所选 id 后清空本地暂存，避免 select 被旧值短暂拉回。
  useEffect(() => {
    if (activeGoal && pickId === activeGoal.id) setPickId(undefined);
  }, [activeGoal, pickId]);

  if (goals.length === 0) return null;
  const value = pickId ?? activeGoal?.id ?? "";

  return (
    <div className="flex items-center gap-3">
      <Select
        ariaLabel={m.home.goalSelectAria}
        value={value}
        disabled={loading}
        onValueChange={(v) => {
          if (!v || v === activeGoal?.id) return;
          setPickId(v);
          void switchGoal(v, m);
        }}
        options={goals.map((g) => ({ value: g.id, label: g.title }))}
        className="h-8 max-w-64"
      />
      <Link
        to="/goals"
        className="text-xs font-medium text-ink-3 transition-colors hover:text-primary"
      >
        {m.home.manageGoals}
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 工具                                                               */
/* ------------------------------------------------------------------ */

/** 掌握度 → 行首状态点语义（与 bandOf 同源，避免重复阈值）。 */
function toneOfMastery(mastery: number): StatusTone {
  switch (bandOf(mastery)) {
    case "mastered":
      return "mastered";
    case "proficient":
      return "learning";
    case "learning":
      return "weak";
    default:
      return "idle";
  }
}

/** 页面日期头：「周二 · 9月8日」/「Tue · Sep 8」（随界面语言）。 */
function dateHead(lang: "zh" | "en"): string {
  const now = new Date();
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(now);
  if (lang === "zh") {
    return `${weekday} · ${now.getMonth() + 1}月${now.getDate()}日`;
  }
  return `${weekday} · ${new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(now)}`;
}

/** 相对时间（今天/昨天/N 天前）。 */
function timeAgo(at: number, m: Messages): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return m.home.time.today;
  if (days === 1) return m.home.time.yesterday;
  return m.home.time.daysAgo(days);
}

/** 章查找（跨文档）。 */
function chapterIndexOf(plan: ChapterLoopSnapshot, chapterId: string): Chapter | undefined {
  for (const list of Object.values(plan.chaptersByDoc)) {
    const found = list.find((c) => c.id === chapterId);
    if (found) return found;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Recent Evidence（§7.1 evidence log 优先；无记录回退旧组装）         */
/* ------------------------------------------------------------------ */

/** 展示行（由 log / 旧组装映射而来）。 */
interface EvidenceView {
  at: number;
  title: string;
  delta: string;
  tone: "up" | "down" | "neutral";
}

/** log kind → 行内动作前缀（不随存储，界面语言映射）。 */
function evidenceActionLabel(kind: "assessment" | "review", m: Messages): string {
  return kind === "assessment" ? m.units.action.assessment : m.units.action.review;
}

/** log 行 → 展示行（章标题经 plan 索引；找不到章回退 subjectId）。 */
function logToView(
  entry: EvidenceEntry,
  plan: ChapterLoopSnapshot,
  m: Messages,
): EvidenceView {
  const chapter = chapterIndexOf(plan, entry.subjectId);
  const baseTitle = chapter
    ? chapterDisplayTitle(chapter, plan.docTitleOf[chapter.id], m)
    : entry.subjectId;
  const { text, tone } = fmtDelta(entry.delta);
  return {
    at: entry.at,
    title: `${evidenceActionLabel(entry.kind, m)} · ${baseTitle}`,
    delta: text,
    tone,
  };
}

/** 最近证据：读 §7.1 evidence log（≤6 行）；log 为空（旧数据）→ 回退从试卷结果组装。 */
async function loadRecentEvidence(
  plan: ChapterLoopSnapshot,
  m: Messages,
): Promise<EvidenceView[]> {
  try {
    const log = await storage.listEvidence();
    if (log.length > 0) return log.slice(0, 6).map((e) => logToView(e, plan, m));
  } catch {
    /* log 读取失败 → 走旧组装兜底。 */
  }
  return assembleLegacyEvidence(plan, m);
}

/** 旧组装兜底：从最近试卷结果组装证据行（U1 期实现，兼容无 log 的旧数据）。 */
async function assembleLegacyEvidence(
  plan: ChapterLoopSnapshot,
  m: Messages,
): Promise<EvidenceView[]> {
  const [results, papers] = await Promise.all([
    storage.listPaperResults(),
    storage.listPapers(),
  ]);
  if (results.length === 0) return [];
  const paperById = new Map(papers.map((p) => [p.id, p]));
  const out: EvidenceView[] = [];
  for (const r of results.slice(0, 5)) {
    // 主章 = 卷内掌握度变化 |Δ| 最大的一章。
    let bestId: string | undefined;
    let bestDelta = 0;
    for (const [cid, info] of Object.entries(r.perChapter)) {
      const d = info.mastery - info.previousMastery;
      if (bestId === undefined || Math.abs(d) > Math.abs(bestDelta)) {
        bestId = cid;
        bestDelta = d;
      }
    }
    const chapter = bestId ? chapterIndexOf(plan, bestId) : undefined;
    const baseTitle = chapter
      ? chapterDisplayTitle(chapter, plan.docTitleOf[chapter.id], m)
      : (paperById.get(r.paperId)?.title ?? r.paperId);
    const { text, tone } = fmtDelta(bestDelta);
    out.push({
      at: r.createdAt,
      title: `${m.units.action.assessment} · ${baseTitle}`,
      delta: text,
      tone,
    });
  }
  return out;
}

/** 掌握度变化量 → 显示文本与语义色（±0.05 精确到 0.01）。 */
function fmtDelta(v: number): { text: string; tone: "up" | "down" | "neutral" } {
  if (Math.abs(v) < 0.005) return { text: "0.00", tone: "neutral" };
  return { text: `${v > 0 ? "+" : ""}${v.toFixed(2)}`, tone: v > 0 ? "up" : "down" };
}

/* ------------------------------------------------------------------ */
/* 空态 / 兜底                                                         */
/* ------------------------------------------------------------------ */

/** 全部达标态（当前 activeGoal 章范围）。 */
function AllDoneCard() {
  const { m } = useI18n();
  return (
    <Card className="mt-6 border-emerald-200 bg-emerald-50/40">
      <p className="text-lg font-semibold text-ink-1">{m.home.allDoneTitle}</p>
      <p className="mt-1 text-sm text-ink-2">{m.home.allDoneDesc}</p>
      <div className="mt-4 flex gap-3">
        <Link
          to="/quiz"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
        >
          {m.home.goQuizReinforce}
        </Link>
        <Link
          to="/learn"
          className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-1 transition-colors hover:bg-subtle"
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
    <Card className="mt-6">
      <p className="text-lg font-semibold text-ink-1">{m.home.emptyTitle}</p>
      <p className="mt-1 text-sm text-ink-2">{m.home.emptyDesc}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={openImportModal}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
        >
          {m.common.import}
        </button>
        <Link
          to="/plan"
          className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-1 transition-colors hover:bg-subtle"
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
    <Card className="mt-6 border-dashed">
      <p className="text-lg font-semibold text-ink-1">{m.home.noChapterTitle}</p>
      <p className="mt-1 text-sm text-ink-2">{m.home.noChapterDesc}</p>
      <div className="mt-4 flex gap-3">
        <Link
          to="/learn"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
        >
          {m.home.goCatalog}
        </Link>
        <button
          type="button"
          onClick={openImportModal}
          className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-1 transition-colors hover:bg-subtle"
        >
          {m.common.import}
        </button>
      </div>
    </Card>
  );
}
