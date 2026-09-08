/**
 * P3a 试卷中心（/quiz）—— V2 三步闭环「考一卷」的总入口（T6）。
 *
 * 内容：
 * - 主行动「＋ 新建试卷」→ /quiz/new 三步向导（范围 → 模式 → 生成）；
 * - 历史试卷列表（storage.listPapers，createdAt 倒序）：模式徽标 + 范围/
 *   题量/时间；open（有草稿）→「继续作答」，grading →「完成判卷」，
 *   done →「查看报告」（/report/:paperId）；
 * - 空态：无章节时引导去 /learn 导入资料。
 *
 * 判卷流与报告页见 QuizGradingPage（P5）/ QuizReportPage（P6，T7）。
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import type { Chapter, Paper, PaperResult, SourceDocument } from "../../domain";
import { storage } from "../../stores/useLoopStore";
import { useI18n, type Messages } from "../../i18n";
import { ago, modeLabel, orderRange } from "./meta";

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
    void load();
  }, [load]);

  const openPaper = rows?.find((r) => r.paper.status === "open");
  const gradingPapers = rows?.filter((r) => r.paper.status === "grading") ?? [];
  const donePapers = rows?.filter((r) => r.paper.status === "done") ?? [];

  return (
    <PageContainer>
      <SectionTitle
        title={c.title}
        subtitle={
          rows && rows.length > 0
            ? c.subtitleCount(rows.length)
            : c.subtitleEmpty
        }
        action={
          <button
            onClick={() => navigate("/quiz/new")}
            className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {c.newPaper}
          </button>
        }
      />

      {rows === undefined ? (
        <p className="text-sm text-slate-400">{c.loading}</p>
      ) : rows.length === 0 ? (
        hasAnyChapter ? (
          <Card className="border-dashed">
            <p className="text-base font-semibold text-slate-900">{c.noPaperTitle}</p>
            <p className="mt-1 text-sm text-slate-500">{c.noPaperDesc}</p>
            <button
              onClick={() => navigate("/quiz/new")}
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              {c.firstPaper}
            </button>
          </Card>
        ) : (
          <Card className="border-dashed">
            <p className="text-base font-semibold text-slate-900">{c.needImportTitle}</p>
            <p className="mt-1 text-sm text-slate-500">{c.needImportDesc}</p>
            <button
              onClick={() => navigate("/learn?import=1")}
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              {c.goImport}
            </button>
          </Card>
        )
      ) : (
        <div className="space-y-3">
          {openPaper ? (
            <PaperRowCard
              row={openPaper}
              highlight
              m={m}
              primaryAction={
                <button
                  onClick={() => navigate(`/quiz/${openPaper.paper.id}`)}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  {openPaper.hasDraft ? c.continueAnswer : c.startAnswer}
                </button>
              }
            />
          ) : null}

          {gradingPapers.length > 0 ? (
            <>
              <p className="pt-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                {c.sectionGrading}
              </p>
              {gradingPapers.map((row) => (
                <PaperRowCard
                  key={row.paper.id}
                  row={row}
                  m={m}
                  primaryAction={
                    <button
                      onClick={() => navigate(`/quiz/${row.paper.id}/grading`)}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
                    >
                      {c.finishGrading}
                    </button>
                  }
                />
              ))}
            </>
          ) : null}

          {donePapers.length > 0 ? (
            <>
              <p className="pt-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                {c.sectionHistory}
              </p>
              {donePapers.map((row) => (
                <PaperRowCard
                  key={row.paper.id}
                  row={row}
                  m={m}
                  primaryAction={
                    <button
                      onClick={() =>
                        navigate(row.result ? `/report/${row.paper.id}` : `/quiz/${row.paper.id}`)
                      }
                      className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                    >
                      {row.result ? c.viewReport : c.viewPaper}
                    </button>
                  }
                />
              ))}
            </>
          ) : null}

          {openPaper === undefined && gradingPapers.length === 0 && donePapers.length === 0 ? (
            <p className="py-2 text-center text-xs text-slate-400">{c.noHistory}</p>
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}

function PaperRowCard({
  row,
  primaryAction,
  m,
  highlight = false,
}: {
  row: PaperRow;
  primaryAction: ReactNode;
  m: Messages;
  highlight?: boolean;
}) {
  const { paper, context } = row;
  const q = m.quiz;
  const mode = modeLabel(paper.scope.mode, m);
  const score = row.result ? Math.round(row.result.totalScore * 100) : undefined;
  const statusLabel = q.status[paper.status];
  return (
    <Card
      className={`flex items-center gap-4 p-4 ${highlight ? "border-indigo-200 ring-1 ring-indigo-100" : ""}`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${
          highlight ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-600"
        }`}
      >
        {paper.questions.length}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-900">
            {paper.title}
          </span>
          {score !== undefined ? (
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                score >= 80
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : score >= 60
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-red-200 bg-red-50 text-red-600"
              }`}
            >
              {q.center.scoreOf(score)}
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
              {mode}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {statusLabel} · {context} · {m.quiz.itemUnit(paper.questions.length)} ·{" "}
          {ago(paper.createdAt, m)}
        </p>
      </div>
      {primaryAction}
    </Card>
  );
}
