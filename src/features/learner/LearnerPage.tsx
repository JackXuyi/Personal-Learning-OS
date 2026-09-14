/**
 * My Learner（/learner）—— 两段式：**我声明的**（F1 画像，可编辑）+
 * **系统观测的**（由学习记录推导，纯只读）。
 *
 * 全部数字来自 domain 字段（U6 验收抽查）：
 * - KNOWLEDGE 计数 / 平均掌握度  ← aggregateLearner(learner.byUnit)；
 * - STRENGTHS / GAPS            ← 掌握度 ≥0.8 / <0.6（MASTERY_FLOOR）；
 * - MISCONCEPTIONS              ← UnitMastery.misconceptions 聚合；
 * - LEARNING PATTERNS           ← 会话记录（useSessionStore.records）汇总，标注启发式。
 *
 * 主体标题解析：章 → 「docTitle · 章序章题」（章节库）；概念 → 图谱概念名。
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, Section, Stat } from "../../components/primitives";
import { buttonVariants } from "../../components/ui/button";
import { PageContainer } from "../../components/layout/AppShell";
import { cn } from "../../lib/utils";
import type { LearnerLevel, LearnerState } from "../../domain";
import { MASTERY_FLOOR } from "../../domain";
import { applyForgetting } from "../../engine";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useI18n } from "../../i18n";
import LearnerProfileCard from "../profile/LearnerProfileCard";
import ResumeImportDialog from "../profile/ResumeImportDialog";
import {
  aggregateLearner,
  gapsOf,
  patternsFromRecords,
  strengthsOf,
} from "./aggregate";
import type { ChapterRow } from "../goals/goal-util";
import { loadChapterRows } from "../goals/goal-util";

/** 档位序（自评 vs 实测冲突提示用；越戒越好只有 4 档，硬编码秩即可）。 */
const LEVEL_RANK: Record<LearnerLevel, number> = {
  beginner: 0,
  basic: 1,
  intermediate: 2,
  advanced: 3,
};

export default function LearnerPage() {
  const { m } = useI18n();
  const lr = m.learner;
  const records = useSessionStore((s) => s.records);
  const profile = useLoopStore((s) => s.profile);
  const refresh = useLoopStore((s) => s.refresh);
  const [rows, setRows] = useState<ChapterRow[] | undefined>();
  const [learner, setLearner] = useState<LearnerState | undefined>();
  /** 概念标题索引（graph.units；供 byUnit 中概念主体解析）。 */
  const [conceptTitles, setConceptTitles] = useState<Map<string, string>>(new Map());
  const [resumeOpen, setResumeOpen] = useState(false);

  // 画像随 store 快照（runChapterLoop 读 storage.getProfile()）——/learner 可能是
  // 冷启动首个页面，故这里主动 refresh 一次，保证声明区拿到真实画像。
  useEffect(() => {
    void refresh(m);
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      const [chapterRows, ls, graph] = await Promise.all([
        loadChapterRows(storage),
        storage.getLearnerState(),
        storage.getGraph(),
      ]);
      setRows(chapterRows);
      // 读时遗忘衰减视图（幂等不写回），与 Today/Plan 同口径。
      setLearner(applyForgetting(ls, Date.now()));
      setConceptTitles(new Map(graph.units.map((u) => [u.id, u.title])));
    })();
  }, []);

  const aggregate = useMemo(() => {
    if (!learner || !rows) return undefined;
    const chapterIndex = new Map(rows.map((r) => [r.chapter.id, r]));
    return aggregateLearner(learner, (id) => {
      const ch = chapterIndex.get(id);
      if (ch) return `${ch.docTitle} · ${ch.chapter.title?.trim() || m.chapter.ordinal(ch.chapter.order)}`;
      return conceptTitles.get(id);
    });
  }, [learner, rows, conceptTitles, m]);

  const patterns = useMemo(() => patternsFromRecords(records), [records]);

  if (!learner || !rows || !aggregate) {
    return (
      <PageContainer>
        <Card>
          <p className="text-sm text-ink-3">{lr.loading}</p>
        </Card>
      </PageContainer>
    );
  }

  const strengths = strengthsOf(aggregate, 6);
  const gaps = gapsOf(aggregate, 6);
  // 自评高于实测：仅在**有实测样本**时提示，避免新用户被误告警。
  const mismatch =
    profile !== undefined &&
    aggregate.counts.total > 0 &&
    LEVEL_RANK[profile.level] >= LEVEL_RANK.intermediate &&
    aggregate.avgMastery < MASTERY_FLOOR;

  return (
    <PageContainer>
      <header>
        <h1 className="text-xl font-semibold text-ink-1">{lr.title}</h1>
        <p className="mt-0.5 text-sm text-ink-2">{lr.subtitle}</p>
      </header>

      {/* 我声明的（F1） */}
      <LearnerProfileCard profile={profile} onOpenResume={() => setResumeOpen(true)} />

      <Section title={lr.observedSection} className="mt-8" />
      {mismatch && profile ? (
        <p className="mt-2 rounded-md border border-line bg-subtle p-2 text-xs leading-relaxed text-ink-2">
          ⓘ {lr.profile.mismatch(lr.profile.level[profile.level], Math.round(aggregate.avgMastery * 100))}
        </p>
      ) : null}

      {aggregate.counts.total === 0 ? (
        <Card className="mt-6 border-dashed">
          <p className="text-lg font-semibold text-ink-1">{lr.noRecordTitle}</p>
          <p className="mt-1 text-sm text-ink-2">{lr.noRecordDesc}</p>
          <Link
            to="/plan"
            className={cn(buttonVariants({ variant: "default" }), "mt-4 rounded-lg")}
          >
            {lr.goPlan}
          </Link>
        </Card>
      ) : (
        <div className="mt-5">
          {/* KNOWLEDGE 计数 */}
          <Section title={lr.knowledgeSection} className="mt-6" />
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={lr.labelTotal}
              value={String(aggregate.counts.total)}
              hint={lr.avgMastery(Math.round(aggregate.avgMastery * 100))}
            />
            <Stat label={lr.labelMastered} value={String(aggregate.counts.mastered)} />
            <Stat label={lr.labelProficient} value={String(aggregate.counts.proficient)} />
            <Stat
              label={lr.labelAccuracy}
              value={aggregate.accuracy === undefined ? "—" : `${Math.round(aggregate.accuracy * 100)}%`}
              hint={
                aggregate.dueCount > 0
                  ? lr.dueReview(aggregate.dueCount)
                  : undefined
              }
            />
          </div>

          {/* STRENGTHS / GAPS 两列 */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <Section title={lr.strengthsSection} className="mt-6" />
              <div className="mt-1">
                {strengths.length === 0 ? (
                  <p className="py-1 text-sm text-ink-3">{lr.none}</p>
                ) : (
                  strengths.map((s) => (
                    <ChapterLine key={s.id} id={s.id} title={s.title} mastery={s.unit.mastery} tone="mastered" />
                  ))
                )}
              </div>
            </div>
            <div>
              <Section title={lr.gapsSection} className="mt-6" />
              <div className="mt-1">
                {gaps.length === 0 ? (
                  <p className="py-1 text-sm text-ink-3">{lr.none}</p>
                ) : (
                  gaps.map((s) => (
                    <ChapterLine key={s.id} id={s.id} title={s.title} mastery={s.unit.mastery} tone="weak" />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* MISCONCEPTIONS */}
          <Section title={lr.misconceptionsSection} className="mt-8" />
          {aggregate.misconceptions.length === 0 ? (
            <p className="mt-1 text-sm text-ink-2">{lr.misconceptionsEmpty}</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {aggregate.misconceptions.map((mc, i) => (
                <li
                  key={`${mc}-${i}`}
                  className="rounded-full border border-line bg-subtle px-3 py-1 text-xs text-ink-2"
                >
                  {mc}
                </li>
              ))}
            </ul>
          )}

          {/* LEARNING PATTERNS（启发式标注） */}
          <Section
            title={lr.patternsSection}
            className="mt-8"
            action={<span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] text-ink-3">{lr.patternsHeuristic}</span>}
          />
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={lr.labelTotal}
              value={String(patterns.submissions)}
              hint={`${lr.patternAssess(patterns.byMode.assessment)} · ${lr.patternReview(patterns.byMode.review)}`}
            />
            <Stat
              label={lr.labelAccuracy}
              value={
                patterns.assessAccuracy === undefined
                  ? "—"
                  : `${Math.round(patterns.assessAccuracy * 100)}%`
              }
              hint={
                patterns.assessAccuracy === undefined
                  ? lr.patternAccuracyNone
                  : undefined
              }
            />
            <Stat
              label="Δ"
              value={
                patterns.avgDelta === 0
                  ? "0.00"
                  : `${patterns.avgDelta > 0 ? "+" : ""}${(patterns.avgDelta * 100).toFixed(1)}%`
              }
              hint={
                patterns.avgDelta === 0
                  ? lr.patternDeltaNone
                  : patterns.avgDelta > 0
                    ? lr.patternDeltaUp(Number((patterns.avgDelta * 100).toFixed(1)))
                    : lr.patternDeltaDown(Number((patterns.avgDelta * 100).toFixed(1)))
              }
            />
            <Stat
              label={lr.labelLearning}
              value={String(aggregate.counts.learning + aggregate.counts.notStarted)}
              hint={`${lr.countLearning(aggregate.counts.learning)} · ${lr.countNotStarted(aggregate.counts.notStarted)}`}
            />
          </div>
        </div>
      )}

      {/* 导入简历（D6-A：页内弹窗，不新增路由） */}
      <ResumeImportDialog
        open={resumeOpen}
        onClose={() => setResumeOpen(false)}
        profile={profile}
      />
    </PageContainer>
  );
}

/** 章/概念一行：强弱两列里的细行（KnowledgeRow 同形态，去边框简化）。 */
function ChapterLine({
  id,
  title,
  mastery,
  tone,
}: {
  id: string;
  title: string;
  mastery: number;
  tone: "mastered" | "weak";
}) {
  const dot =
    tone === "mastered" ? "bg-state-mastered" : "bg-state-weak";
  return (
    <Link to={chapterPath(id)} className="group flex items-center justify-between gap-3 border-b border-line py-2 text-sm last:border-b-0">
      <span className="flex min-w-0 items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate text-ink-1 group-hover:text-primary">{title}</span>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-ink-2">
        {Math.round(mastery * 100)}%
      </span>
    </Link>
  );
}

/** 章 id 直达阅读；概念 id（章内概念）去章图谱（N5 入口保留）。 */
function chapterPath(id: string): string {
  return `/learn/${id}`;
}
