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
import { Button, buttonVariants } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { Select } from "../../components/ui/select";
import { MASTERY_THRESHOLD } from "../../domain";
import type {
  Chapter,
  EvidenceEntry,
  EvidenceKind,
  NextAction,
  SourceDocument,
} from "../../domain";
import { bandOf, type ChapterLoopSnapshot } from "../../engine";
import { useI18n, type Messages } from "../../i18n";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { evidenceActionKey } from "../evidence-label";
import { chapterActionMeta, chapterDisplayTitle, estimateEtaMin } from "../plan/chapter-action";
import { planQuota } from "../plan/plan-quota";
import { useChapterIndex, useRunChapterAction } from "../plan/run-action";

/**
 * 首页 —— Today 启动器（UI Workbench U1，docs/ui-workbench-plan-2026-09.md §U1）。
 *
 * 设计：第一屏只回答「现在最值得做什么，为什么」。
 *  1) 页头：今日 + 日期。
 *  2) 目标上下文组（U1 §334 同组呈现）：goal 下拉 + 管理/新建入口 + 就绪度（目标刻度线）
 *     + 达成统计（含截止日锚点）+ F2 落后警示（带行动出口）。
 *  3) NEXT BEST ACTION：唯一主行动 ActionCard（reasons = why-now 证据链）。
 *  4) 今日清单：NBA 之外的高优动作（KnowledgeRow 压缩行）+ 查看完整计划（位置恒定）。
 *  5) RECENT EVIDENCE：折叠区，展示最近测评的证据行；无证据整段隐藏（空态不占位）。
 *
 * 2026-09-24 首屏收口：目标组由两行合并为一组；去掉 checked 竞态（以 plan 就绪为判据）；
 * 错误卡补重试；「查看完整计划」固定挂 Section action 位。
 *
 * 数据来源：useLoopStore.chapterPlan（按 activeGoal 范围，§7.3）+ goal repo（activeGoal）
 * + 最近试卷结果（evidence 临时组装）。零引擎算法改动。
 */
export default function HomePage() {
  const plan = useLoopStore((s) => s.chapterPlan);
  const error = useLoopStore((s) => s.error);
  const refresh = useLoopStore((s) => s.refresh);
  const { m, lang } = useI18n();

  useEffect(() => {
    void refresh(m);
  }, [refresh]);

  // 就绪判据（2026-09-24 收口）：plan 已加载即渲染。不再用独立 checked 标记——
  // refresh 抛错时 checked 照样置位会闪现空态；且首帧「正在同步」卡会夸大
  // localStorage 读的成本。loading 不再参与首屏判定（GoalContext 内自取）。
  const ready = plan !== undefined;

  return (
    <PageContainer>
      <header className="flex items-end justify-between gap-4">
        <h1 className="text-xl font-semibold text-ink-1">{m.home.title}</h1>
        <span className="text-xs text-ink-3">{dateHead(lang)}</span>
      </header>

      {/* 错误卡：有旧数据时与内容同现（不打断）；带重试出口。 */}
      {error ? (
        <Card className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-sm text-state-failed">{error}</p>
            <button
              type="button"
              onClick={() => void refresh(m)}
              className="shrink-0 text-xs font-medium text-primary transition-colors hover:text-primary/70"
            >
              {m.home.retry}
            </button>
          </div>
        </Card>
      ) : null}

      {/* 加载卡：仅在「无数据且未报错」时出现，不与错误卡同现。 */}
      {!error && !ready ? (
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

  // F2：时间维度（纯派生）。无截止日 → dueTodayMin/pace 均缺失 → 首页与改动前一致（D3/D4）。
  const quota = planQuota({
    actions: plan.actions,
    chapterOf: (id) => index.get(id),
    ...(plan.profile ? { profile: plan.profile } : {}),
    ...(plan.goal?.deadlineAt !== undefined ? { deadlineAt: plan.goal.deadlineAt } : {}),
  });
  // 标题里的分钟数取**本清单口径**（`items` 的时长和）—— 与「N 项」同口径，
  // 否则会出现「3 项 · 建议 12 分钟（那其实是主行动的时长）」的自相矛盾。
  const itemsMinutes = items.reduce((n, a) => n + estimateEtaMin(a, index.get(a.unitId)), 0);
  const showQuota = quota.dueTodayMin !== undefined;

  return (
    <div className="mt-5">
      {/* 目标上下文组（U1 §334）：goal 下拉 + 就绪度 + Bar + 达成统计 + 落后警示 同组呈现。 */}
      <GoalContext
        mastered={plan.mastered}
        total={plan.total}
        gaps={gaps}
        readiness={readiness}
        daysLeft={quota.daysLeft}
        behindDays={quota.pace?.behind ? quota.pace.days : undefined}
      />

      {/* NEXT BEST ACTION —— 一屏一个主决策 */}
      <Section title={m.home.nextBestAction} className="mt-6" />
      <div className="mt-2">
        <NextActionCard run={run} busyId={busyId} />
      </div>

      {/* 今日清单（NBA 之外的高优动作）—— Section 恒渲染，「查看完整计划」固定挂
          action 位，不随 items 是否为空漂移（2026-09-24 收口）。 */}
      <Section
        title={
          items.length > 0 && showQuota
            ? m.home.quotaTitle(items.length, itemsMinutes)
            : m.home.todayTitle(items.length)
        }
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

      {/* RECENT EVIDENCE（折叠区；§7.1 log 落地前由最近试卷结果临时组装）。
          无证据时整段隐藏（2026-09-24 收口：空态文案不占首屏位，与「空/失败隐藏 Section」
          的克制口径一致）。 */}
      {evidence !== undefined && evidence.length > 0 ? (
        <details className="group mt-6">
          <summary className="flex cursor-pointer list-none items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-ink-2">
              {m.home.recentEvidence}
            </span>
            <span className="text-xs text-ink-3 transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="mt-1">
            {evidence.map((row, i) => (
              <EvidenceRow
                key={`${row.at}-${i}`}
                time={timeAgo(row.at, m)}
                title={row.title}
                verdict={row.verdict}
                delta={row.delta}
                deltaTone={row.tone}
              />
            ))}
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

/**
 * 目标上下文组（2026-09-24 收口，对齐 U1 设计稿 §334 的同组呈现）：
 * 单行 = goal 下拉 +「管理目标」+「＋ 新建目标」快捷入口（U1 承诺补齐）+ 右侧就绪度；
 * 下接 Bar 与达成统计（含截止日锚点）、F2 落后警示。无目标时仍渲染创建入口
 * （此前 `goals.length === 0` 直接 return null，首页缺创建目标的引导）。
 */
function GoalContext({
  mastered,
  total,
  gaps,
  readiness,
  daysLeft,
  behindDays,
}: {
  mastered: number;
  total: number;
  gaps: number;
  readiness: number;
  /** 距截止天数（`quota.daysLeft` 唯一口径，下限 1）；无 deadline → undefined。 */
  daysLeft?: number;
  /** F2 落后天数（`quota.pace.days`）；未落后 → undefined（超前不显示，不制造暗示）。 */
  behindDays?: number;
}) {
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

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {goals.length > 0 ? (
            <Select
              ariaLabel={m.home.goalSelectAria}
              value={pickId ?? activeGoal?.id ?? ""}
              disabled={loading}
              onValueChange={(v) => {
                if (!v || v === activeGoal?.id) return;
                setPickId(v);
                void switchGoal(v, m);
              }}
              options={goals.map((g) => ({ value: g.id, label: g.title }))}
              className="h-8 max-w-64"
            />
          ) : null}
          {goals.length > 0 ? (
            <Link
              to="/goals"
              className="shrink-0 text-xs font-medium text-ink-3 transition-colors hover:text-primary"
            >
              {m.home.manageGoals}
            </Link>
          ) : null}
          <Link
            to="/goals/new"
            className="shrink-0 text-xs font-medium text-ink-3 transition-colors hover:text-primary"
          >
            {m.goals.newGoal}
          </Link>
        </div>
        <p className="shrink-0 text-sm font-medium tabular-nums text-ink-1">
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

      <p className="mt-1.5 text-xs text-ink-3">
        {m.home.masteredOf(mastered, total)}
        {gaps > 0 ? <span> · {m.home.pendingOf(gaps)}</span> : null}
        {daysLeft !== undefined ? (
          <span> · {m.home.daysToDeadline(daysLeft)}</span>
        ) : null}
      </p>

      {/* F2 落后警示（D4）：仅「有截止日 + 已声明预算 + 落后」时出现；带行动出口（P5）。
          警示色复用 state-weak（琥珀系语义 token），不再硬编码 amber-700。 */}
      {behindDays !== undefined ? (
        <p className="mt-1 text-xs text-state-weak" data-testid="home-behind-warning">
          ⚠ {m.home.behindWarning(behindDays)} ·{" "}
          <Link to="/plan" className="font-medium underline-offset-2 hover:underline">
            {m.home.behindAction}
          </Link>
        </p>
      ) : null}
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

/**
 * 全量章索引（跨文档，**不经目标范围裁剪**）。
 *
 * ⚠️ 证据行**不能**用 `ChapterLoopSnapshot` 的 `chaptersByDoc` / `docTitleOf` 解析主体：
 * `runChapterLoop` 在目标带 `requiredChapterIds` 时会**按范围裁剪**这两者
 * （`engine/loop.ts:270` 的 `const kept = scopeIds ? chapters.filter(…) : chapters`）。
 * 主体章只要落在范围外就会被误判为「不存在」—— 而它其实活得好好的。
 * 故这里按 `plan.docs`（全量文档，未裁剪）重读一次章表，用同一把尺子同时覆盖
 * 「范围外的活章」与「真被删的章」两种情形。
 */
interface ChapterIndex {
  byId: Map<string, Chapter>;
  docTitleOf: Record<string, string>;
}

async function loadChapterIndex(docs: readonly SourceDocument[]): Promise<ChapterIndex> {
  const byId = new Map<string, Chapter>();
  const docTitleOf: Record<string, string> = {};
  for (const d of docs) {
    for (const c of await storage.listChapters(d.id)) {
      byId.set(c.id, c);
      docTitleOf[c.id] = d.title;
    }
  }
  return { byId, docTitleOf };
}

/* ------------------------------------------------------------------ */
/* Recent Evidence（§7.1 evidence log 优先；无记录回退旧组装）         */
/* ------------------------------------------------------------------ */

/** 展示行（由 log / 旧组装映射而来）。 */
interface EvidenceView {
  at: number;
  title: string;
  /**
   * 掌握度变化量。**能力评测行不给**（F6）：`kind:"capability"` 的 `delta` 恒 0
   * —— 它不改 mastery，显示「0.00」会让人以为「白学了」。
   */
  delta?: string;
  tone: "up" | "down" | "neutral";
  /** 结论（能力评测行用「达标 / 未达标」代替变化量）。 */
  verdict?: string;
}

/**
 * log kind → 行内动作前缀（不随存储，界面语言映射）。
 * 映射单一真源 = `features/evidence-label.ts::evidenceActionKey`（两页共用）。
 */
function evidenceActionLabel(kind: EvidenceKind, m: Messages): string {
  return m.units.action[evidenceActionKey(kind)];
}

/**
 * log 行 → 展示行。**解析不到主体时返回 `undefined`（该行不渲染）**。
 *
 * **主体解析（F6 / 决策 D7-A）**：
 * - `subjectKind === "goal"` → 主体是**目标**：标题走 `capability.evidenceSubject(goalTitle)`；
 *   目标已被删 → `capability.evidenceFallback`（**绝不显示裸 goalId**，行**保留** ——
 *   这一行自带 verdict，且不引用已删内容）。
 * - 其余（缺省 = chapter）→ 主体是**章**：从 `index`（全量章索引）取标题；
 *   章已被删 → **整行不渲染**（`undefined`），由调用方 `filter` 掉。
 *
 * ⚠️ 两个历史时点，读代码前先知道（本文件踩过一次「结论对、但只对了一半」）：
 *
 * 1. **2026-09-21**：章侧此前**没有兜底** —— 解析不到就直落 `entry.subjectId`，
 *    于是资料被删后首页显示 `chp-1e79433b` 这种裸 id（本机实测最近 6 行里 4 行如此）。
 *    当时的处置是**保留该行**、标题回落 `units.subjectGone`（「章节已不存在」）。
 * 2. ~~保留该行 + `units.subjectGone` 兜底~~ → **2026-09-22 改为跳过整行**。
 *    理由：`plos.evidence` 是**行为历史**（热力图按 `at` 计数、F9 记忆按 `kind` 分布），
 *    刻意不随资料级联删除（见 `features/learn/document-cascade.ts` 文件头）；
 *    而「最近证据」是**当前资产**的视图 —— 让一条指不到任何章节的旧行占位，
 *    既挤掉了真实行，也没有信息量。**库存历史不变，只是不再渲染。**
 *    注意分辨：`/progress` 趋势下拉**仍然**保留已删章的序列并回落 `units.subjectGone`
 *    （`TC-RAWID-01/03` 锁的正是「历史序列不因解析失败而剔除」）——
 *    首页证据行与趋势序列是**两种不同**的展示，别把这条改动搬过去。
 *
 * **零回归（TC-REG-04）**：旧数据没有 `subjectKind`（缺省 = chapter），一律走下方
 * 章分支，行为不变。
 */
function logToView(
  entry: EvidenceEntry,
  index: ChapterIndex,
  m: Messages,
  goalTitleOf: ReadonlyMap<string, string>,
): EvidenceView | undefined {
  if (entry.kind === "capability" && entry.subjectKind === "goal") {
    const goalTitle = goalTitleOf.get(entry.subjectId);
    return {
      at: entry.at,
      title: goalTitle
        ? m.capability.evidenceSubject(goalTitle)
        : m.capability.evidenceFallback,
      tone: "neutral",
      verdict:
        entry.verdict === "fail" ? m.capability.verdict.fail : m.capability.verdict.pass,
    };
  }
  const chapter = index.byId.get(entry.subjectId);
  // 章已不存在（资料被删 / 章被重切分掉）→ 不渲染。绝不回落裸 id，也不再占位。
  if (!chapter) return undefined;
  const baseTitle = chapterDisplayTitle(chapter, index.docTitleOf[chapter.id], m);
  const { text, tone } = fmtDelta(entry.delta);
  return {
    at: entry.at,
    title: `${evidenceActionLabel(entry.kind, m)} · ${baseTitle}`,
    delta: text,
    tone,
  };
}

/**
 * 最近证据：读 §7.1 evidence log（≤6 行）；log 为空（旧数据）→ 回退从试卷结果组装。
 *
 * 章主体一律经 `loadChapterIndex(plan.docs)` 解析 —— 用 `plan.docs`（全量）而非
 * `plan.chaptersByDoc`（按目标范围裁剪），理由见 `ChapterIndex` 的注释。
 *
 * ⚠️ **先过滤再截断**（顺序不可颠倒）：`logToView` 对「章已不存在」的行返回
 * `undefined`，若先 `slice(0, 6)` 再过滤，一条幽灵行就会白白挤掉一条真实行 ——
 * 用户看到「最近证据只有 2 条」却不知道另外 4 条被谁占了。
 */
async function loadRecentEvidence(
  plan: ChapterLoopSnapshot,
  m: Messages,
): Promise<EvidenceView[]> {
  try {
    const log = await storage.listEvidence();
    if (log.length > 0) {
      // 目标标题索引（能力评测行需要）：读失败 → 空索引 → 行内回退通用文案。
      const goals = await storage.listGoals().catch(() => []);
      const goalTitleOf = new Map(goals.map((g) => [g.id, g.title] as const));
      const index = await loadChapterIndex(plan.docs);
      return log
        .map((e) => logToView(e, index, m, goalTitleOf))
        .filter((v): v is EvidenceView => v !== undefined)
        .slice(0, 6);
    }
  } catch {
    /* log 读取失败 → 走旧组装兜底。 */
  }
  return assembleLegacyEvidence(plan.docs, m);
}

/** 旧组装兜底：从最近试卷结果组装证据行（U1 期实现，兼容无 log 的旧数据）。 */
async function assembleLegacyEvidence(
  docs: readonly SourceDocument[],
  m: Messages,
): Promise<EvidenceView[]> {
  const [results, papers] = await Promise.all([
    storage.listPaperResults(),
    storage.listPapers(),
  ]);
  if (results.length === 0) return [];
  const paperById = new Map(papers.map((p) => [p.id, p]));
  const index = await loadChapterIndex(docs);
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
    const chapter = bestId ? index.byId.get(bestId) : undefined;
    // 章解析不到 → 退到试卷标题；试卷也没了 → 兜底文案（**不落裸 paperId**）。
    const baseTitle = chapter
      ? chapterDisplayTitle(chapter, index.docTitleOf[chapter.id], m)
      : (paperById.get(r.paperId)?.title ?? m.units.subjectGone);
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
          className={cn(buttonVariants(), "rounded-lg")}
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
        <Button
          type="button"
          onClick={openImportModal}
          className="rounded-lg"
        >
          {m.common.import}
        </Button>
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
          className={cn(buttonVariants(), "rounded-lg")}
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
