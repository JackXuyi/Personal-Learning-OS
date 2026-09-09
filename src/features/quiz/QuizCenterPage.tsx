/**
 * 试卷中心（/quiz）—— Assessment Center 收口（UI Workbench U4，
 * docs/ui-workbench-plan-2026-09.md §6-U4）。V2 三步闭环「考一卷」的总入口。
 *
 * 内容（U4 升级后）：
 * - RECOMMENDED（顶部）：按 activeGoal 范围 plan 的测评类高优动作直推弱章
 *   （retake-quiz 弱章补考 / chapter-quiz 本章测验）→ ActionCard 一键直出卷；
 *   无到期测评弱章时显示空态 + 去计划。数据 = chapterPlan（零新引擎）。
 * - RECENT（下方）：历史试卷 divider 行流（open → grading → done 三态），
 *   行 = 语义点 + 模式徽标 + 得分 + 范围/题量/时间；open 高优置顶。
 * - 空态：无章节引导导入；有章节无试卷引导出第一张。
 *
 * 判卷流与报告页见 QuizGradingPage / QuizReportPage（报告 → /plan 回流）。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ActionCard,
  Card,
  Section,
  SectionTitle,
  type StatusTone,
} from "../../components/primitives";
import { PageContainer, openImportModal } from "../../components/layout/AppShell";
import { MASTERY_FLOOR, MASTERY_THRESHOLD } from "../../domain";
import type { Chapter, Paper, PaperResult, SourceDocument } from "../../domain";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { useI18n, type Messages } from "../../i18n";
import { ago, modeLabel, orderRange } from "./meta";
import {
  chapterActionMeta,
  chapterDisplayTitle,
  estimateEtaMin,
} from "../plan/chapter-action";
import { useChapterIndex, useRunChapterAction } from "../plan/run-action";

interface PaperRow {
  paper: Paper;
  /** 所属文档标题 + 章范围标签（如「RAG 指南 · 第 1–3 章」）。 */
  context: string;
  result?: PaperResult;
  hasDraft: boolean;
}

/** 一次取回全部文档+章节，建立 id → 章 的查找表（用于试卷范围标签）。 */
interface Lookup {
  docOf: Map<string, SourceDocument>;
  chapterOf: Map<string, Chapter>;
}

async function buildLookup(): Promise<Lookup> {
  const docOf = new Map<string, SourceDocument>();
  const chapterOf = new Map<string, Chapter>();
  const docs = await storage.listDocuments();
  for (const d of docs) {
    docOf.set(d.id, d);
    const chapters = await storage.listChapters(d.id);
    for (const c of chapters) chapterOf.set(c.id, c);
  }
  return { docOf, chapterOf };
}

/** 由章 id 列表推导展示语境：文档标题 + 「第 x 章」/「第 x–y 章」。 */
function contextLabel(chapterIds: string[], lookup: Lookup, m: Messages): string {
  const chapters = chapterIds
    .map((id) => lookup.chapterOf.get(id))
    .filter((c): c is Chapter => Boolean(c));
  if (chapters.length === 0) return m.quiz.center.removedDoc;
  const doc = lookup.docOf.get(chapters[0].documentId);
  const sorted = [...chapters].sort((a, b) => a.order - b.order);
  const range = orderRange(sorted[0].order, sorted[sorted.length - 1].order, m);
  return `${doc?.title ?? m.quiz.center.unknownDoc} · ${range}`;
}

export default function QuizCenterPage() {
  const { m } = useI18n();
  const navigate = useNavigate();
  const c = m.quiz.center;
  const plan = useLoopStore((s) => s.chapterPlan);
  const refresh = useLoopStore((s) => s.refresh);
  const index = useChapterIndex();
  const { run, busyId } = useRunChapterAction();
  const [rows, setRows] = useState<PaperRow[] | undefined>();
  const [hasAnyChapter, setHasAnyChapter] = useState(false);

  const load = useCallback(async () => {
    const [papers, results, lookup, allDocs] = await Promise.all([
      storage.listPapers(),
      storage.listPaperResults(),
      buildLookup(),
      storage.listDocuments(),
    ]);
    const resultByPaper = new Map(results.map((r) => [r.paperId, r]));
    const chapterCounts = await Promise.all(
      allDocs.map((d) => storage.listChapters(d.id)),
    );
    setHasAnyChapter(chapterCounts.some((cs) => cs.length > 0));

    const drafts = await Promise.all(
      papers.map((p) => storage.getPaperDraft(p.id)),
    );
    setRows(
      papers.map((paper, i) => ({
        paper,
        context: contextLabel(paper.scope.chapterIds, lookup, m),
        result: resultByPaper.get(paper.id),
        hasDraft: Boolean(drafts[i] && Object.keys(drafts[i] ?? {}).length > 0),
      })),
    );
  }, [m]);

  useEffect(() => {
    void (async () => {
      await Promise.all([refresh(m), load()]);
    })();
  }, [refresh, load]);

  // 推荐测评章：activeGoal 范围 plan 里第一个测评类高优动作（补考 > 单元测）。
  const quizAction = plan?.actions.find(
    (a) => a.kind === "retake-quiz" || a.kind === "chapter-quiz",
  );
  const recChapter = quizAction ? index.get(quizAction.unitId) : undefined;

  const openPaper = rows?.find((r) => r.paper.status === "open");
  const gradingPapers = rows?.filter((r) => r.paper.status === "grading") ?? [];
  const donePapers = rows?.filter((r) => r.paper.status === "done") ?? [];

  return (
    <PageContainer>
      <SectionTitle
        title={c.title}
        subtitle={
          rows && rows.length > 0 ? c.subtitleCount(rows.length) : c.subtitleEmpty
        }
        action={
          <Link
            to="/quiz/new"
            className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/90"
          >
            {c.newPaper}
          </Link>
        }
      />

      {rows === undefined ? (
        <p className="text-sm text-ink-3">{c.loading}</p>
      ) : (
        <>
          {/* RECOMMENDED —— 最该测的弱章直推 */}
          {plan && plan.total > 0 ? (
            <section className="mt-2">
              <Section title={c.recommended} />
              <p className="mt-1 text-xs text-ink-3">{c.recommendedSub}</p>
              {quizAction && recChapter ? (
                <div className="mt-2">
                  <RecommendedCard
                    busy={busyId === recChapter.id}
                    onRun={() => void run(quizAction)}
                  />
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-between gap-3 border-b border-line py-2">
                  <p className="text-sm text-ink-2">{c.recommendedNone}</p>
                  <Link
                    to="/plan"
                    className="shrink-0 text-xs font-medium text-primary hover:text-primary/70"
                  >
                    {c.recommendedGoPlan}
                  </Link>
                </div>
              )}
            </section>
          ) : null}

          {/* RECENT —— 历史试卷（open / grading / done 三态） */}
          {rows.length === 0 ? (
            hasAnyChapter ? (
              <Card className="mt-6 border-dashed">
                <p className="text-base font-semibold text-ink-1">{c.noPaperTitle}</p>
                <p className="mt-1 text-sm text-ink-2">{c.noPaperDesc}</p>
                <button
                  onClick={() => navigate("/quiz/new")}
                  className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
                >
                  {c.firstPaper}
                </button>
              </Card>
            ) : (
              <Card className="mt-6 border-dashed">
                <p className="text-base font-semibold text-ink-1">
                  {c.needImportTitle}
                </p>
                <p className="mt-1 text-sm text-ink-2">{c.needImportDesc}</p>
                <button
                  onClick={openImportModal}
                  className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
                >
                  {c.goImport}
                </button>
              </Card>
            )
          ) : (
            <section className="mt-6">
              <Section title={c.recent} />
              <div className="mt-1">
                {openPaper ? (
                  <PaperRowLine
                    row={openPaper}
                    m={m}
                    actionLabel={openPaper.hasDraft ? c.continueAnswer : c.startAnswer}
                    onAction={() => navigate(`/quiz/${openPaper.paper.id}`)}
                  />
                ) : null}

                {gradingPapers.map((row) => (
                  <PaperRowLine
                    key={row.paper.id}
                    row={row}
                    m={m}
                    actionLabel={c.finishGrading}
                    onAction={() => navigate(`/quiz/${row.paper.id}/grading`)}
                  />
                ))}

                {donePapers.map((row) => (
                  <PaperRowLine
                    key={row.paper.id}
                    row={row}
                    m={m}
                    actionLabel={row.result ? c.viewReport : c.viewPaper}
                    onAction={() =>
                      navigate(
                        row.result ? `/report/${row.paper.id}` : `/quiz/${row.paper.id}`,
                      )
                    }
                  />
                ))}

                {openPaper === undefined &&
                gradingPapers.length === 0 &&
                donePapers.length === 0 ? (
                  <p className="py-2 text-center text-xs text-ink-3">{c.noHistory}</p>
                ) : null}
              </div>
            </section>
          )}
        </>
      )}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Recommended 直推卡                                                  */
/* ------------------------------------------------------------------ */

/** Recommended 主卡：复用 plan 高优动作（含 why-now reasons + 耗时预估）。 */
function RecommendedCard({ busy, onRun }: { busy: boolean; onRun: () => void }) {
  const plan = useLoopStore((s) => s.chapterPlan);
  const index = useChapterIndex();
  const { m } = useI18n();
  const action = plan?.actions.find(
    (a) => a.kind === "retake-quiz" || a.kind === "chapter-quiz",
  );
  if (!action || !plan) return null;
  const chapter = index.get(action.unitId);
  const mastery = chapter ? (plan.learner.byUnit[chapter.id]?.mastery ?? 0) : 0;
  const meta = chapterActionMeta(action.kind, m);
  const eta = chapter
    ? m.plan.etaOf(estimateEtaMin(action, chapter))
    : undefined;
  return (
    <ActionCard
      eyebrow={m.units.action[action.kind]}
      title={
        chapter ? chapterDisplayTitle(chapter, plan.docTitleOf[chapter.id], m) : action.unitId
      }
      mastery={chapter ? mastery : undefined}
      reasons={action.reasons.length > 0 ? action.reasons : undefined}
      ctaLabel={busy ? m.quiz.center.loading : `${meta.cta} →`}
      onCta={onRun}
      eta={eta}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Recent 试卷行                                                       */
/* ------------------------------------------------------------------ */

/** 试卷 divider 行：语义点 + 模式徽标 + 得分 + 语境/时间 + 主动作链接。 */
function PaperRowLine({
  row,
  m,
  actionLabel,
  onAction,
}: {
  row: PaperRow;
  m: Messages;
  actionLabel: string;
  onAction: () => void;
}) {
  const q = m.quiz;
  const { paper, context } = row;
  const score = row.result ? Math.round(row.result.totalScore * 100) : undefined;
  const scoreTone = toneOfScore(score);
  const statusLabel = q.status[paper.status];
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <span className="flex min-w-0 items-center gap-2.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotOfPaper(paper.status, score)}`} />
        <span className="truncate text-sm text-ink-1">{paper.title}</span>
        <span className="shrink-0 rounded border border-line bg-subtle px-1.5 py-0.5 text-[11px] text-ink-2">
          {modeLabel(paper.scope.mode, m)}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <span className="text-right text-xs leading-4 text-ink-3">
          {score !== undefined ? (
            <span className={`block text-sm font-semibold tabular-nums ${scoreTone}`}>
              {q.center.scoreOf(score)}
            </span>
          ) : null}
          <span className="block">
            {statusLabel} · {context} · {q.itemUnit(paper.questions.length)} ·{" "}
            {ago(paper.createdAt, m)}
          </span>
        </span>
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 text-xs font-medium text-primary transition-colors hover:text-primary/70"
        >
          {actionLabel}
        </button>
      </span>
    </div>
  );
}

/** 试卷得分 → 语义色文字（达标绿 / 及格前黄 / 未及格红 / 无分灰）。 */
function toneOfScore(score: number | undefined): string {
  if (score === undefined) return "text-ink-3";
  if (score >= Math.round(MASTERY_THRESHOLD * 100)) return "text-state-mastered";
  if (score >= Math.round(MASTERY_FLOOR * 100)) return "text-state-weak";
  return "text-state-failed";
}

/** 行首语义点：open=进行中(learning)；grading=待处理(weak)；done 按得分。 */
function dotOfPaper(
  status: Paper["status"],
  score: number | undefined,
): string {
  if (status === "open") return "bg-state-learning";
  if (status === "grading") return "bg-state-weak";
  const tone: StatusTone =
    score === undefined
      ? "idle"
      : score >= Math.round(MASTERY_THRESHOLD * 100)
        ? "mastered"
        : score >= Math.round(MASTERY_FLOOR * 100)
          ? "weak"
          : "failed";
  return toneDotClass(tone);
}

/** StatusTone → 圆点类（primitives 内部映射的轻量副本，避免引入私有依赖）。 */
const DOT_CLS: Record<StatusTone, string> = {
  mastered: "bg-state-mastered",
  learning: "bg-state-learning",
  weak: "bg-state-weak",
  idle: "bg-state-idle",
  failed: "bg-state-failed",
};
function toneDotClass(tone: StatusTone): string {
  return DOT_CLS[tone];
}
