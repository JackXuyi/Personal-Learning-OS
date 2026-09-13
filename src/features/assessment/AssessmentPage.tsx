import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BandBadge, Card, SectionTitle } from "../../components/primitives";
import { Button } from "../../components/ui/button";
import { PageContainer } from "../../components/layout/AppShell";
import { applyForgetting, bandOf } from "../../engine";
import { sortChaptersByOrder } from "../../domain";
import type { Chapter, KnowledgeGraph, KnowledgeUnit, LearnerState, SourceDocument } from "../../domain";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { useAiTaskStore, runAiTask } from "../../stores/useAiTaskStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useI18n } from "../../i18n";
import AssessmentSession from "./AssessmentSession";
import { unitTitle } from "../units";
import { createPaperAndSave } from "../quiz/paper-flow";

/** 资料作用域测评的行模型（评审 M2-7：以资料章集合为作用域出卷）。 */
interface DocScopeRow {
  doc: SourceDocument;
  chapters: Chapter[];
}

/**
 * 测评 —— 自适应题目（从回忆到应用）。
 *
 * 首页：选单元 → 会话作答（AssessmentSession）。支持 ?unit= 直达会话。
 */
export default function AssessmentPage() {
  const { m } = useI18n();
  const a = m.assessment;
  const navigate = useNavigate();
  const snapshot = useLoopStore((s) => s.snapshot);
  const refresh = useLoopStore((s) => s.refresh);
  const records = useSessionStore((s) => s.records);
  const [params, setParams] = useSearchParams();
  const directUnitId = params.get("unit");

  const [graph, setGraph] = useState<KnowledgeGraph | undefined>();
  const [active, setActive] = useState<KnowledgeUnit | undefined>();
  /** 资料作用域（有章的资料 + 章 + 衰减后学习态）。 */
  const [docRows, setDocRows] = useState<DocScopeRow[]>([]);
  const [learner, setLearner] = useState<LearnerState | undefined>();
  // 出卷 busy 全局化：paper:{docId}（与 PapersTab/NewQuizPage 同 id 共享互斥）。
  // 行数动态，不能 per-row 挂 hook → 直接订阅 tasks map + runAiTask 执行器。
  const tasks = useAiTaskStore((s) => s.tasks);
  /** 本轮点击的章 id（loading 指示在哪个章按钮上；纯 UI）。 */
  const [busyChapter, setBusyChapter] = useState<string>();
  /** 出卷失败原因（空串 = 无错；F8：不再吞掉失败细节）。 */
  const [scopeError, setScopeError] = useState("");

  /** 该资料当前是否有出卷任务在跑（含从其它页面触发的）。 */
  const isPaperRunning = (docId: string) =>
    tasks[`paper:${docId}`]?.status === "running";

  useEffect(() => {
    void (async () => {
      if (!useLoopStore.getState().snapshot) await refresh(m);
      setGraph(await storage.getGraph());
      // 资料作用域数据：与概念层区块并行存在，失败只隐藏本区块，不影响上面。
      try {
        const [docs, ls] = await Promise.all([
          storage.listDocuments(),
          storage.getLearnerState(),
        ]);
        const learnerNow = applyForgetting(ls, Date.now());
        const rows = await Promise.all(
          docs.map(async (doc) => ({
            doc,
            chapters: sortChaptersByOrder(await storage.listChapters(doc.id)),
          })),
        );
        setDocRows(rows.filter((r) => r.chapters.length > 0));
        setLearner(learnerNow);
      } catch {
        setDocRows([]);
      }
    })();
  }, [refresh]);

  /** 单章测评：出一张单章单元测卷 → 跳答题页（掌握度写入与出卷向导同源）。 */
  const startChapterPaper = async (row: DocScopeRow, chapter: Chapter) => {
    if (busyChapter || isPaperRunning(row.doc.id)) return;
    setBusyChapter(chapter.id);
    setScopeError("");
    try {
      const paper = await runAiTask(`paper:${row.doc.id}`, async () => {
        const { paper } = await createPaperAndSave({
          chapters: [chapter],
          allChapters: row.chapters,
          mode: "unit-test",
          learnerState: learner,
          text: row.doc.textPreview,
        });
        return paper;
      });
      navigate(`/quiz/${paper.id}`);
    } catch (e) {
      // 失败原因透出（F8）：错误终态也已在 paper:{docId} 任务记录里
      setScopeError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyChapter(undefined);
    }
  };

  // ?unit=xxx 直达会话
  useEffect(() => {
    if (!graph || !directUnitId) return;
    const unit = graph.units.find((u) => u.id === directUnitId);
    if (unit) {
      setActive(unit);
      setParams({}, { replace: true }); // 清掉 query，避免刷新时复选
    }
  }, [graph, directUnitId, setParams]);

  const units = graph?.units ?? [];
  const recommended =
    snapshot?.next && units.some((u) => u.id === snapshot.next!.unitId)
      ? units.find((u) => u.id === snapshot.next!.unitId)
      : units[0];

  const exitSession = () => setActive(undefined);

  if (active) {
    return <AssessmentSession unit={active} onExit={exitSession} />;
  }

  const todayAssessments = records.filter((r) => r.mode === "assessment");

  return (
    <PageContainer>
      <SectionTitle
        title={a.title}
        subtitle={a.subtitle}
      />

      {/* 建议先测 */}
      {recommended ? (
        <Card className="border-primary/20 bg-primary/5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                {a.recommendEyebrow}
              </p>
              <p className="mt-1 text-lg font-semibold text-ink-1">
                {unitTitle(recommended.id)}
              </p>
            </div>
            <Button
              onClick={() => setActive(recommended)}
              size="lg"
              className="rounded-xl text-base"
            >
              {a.start}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* 选单元 */}
      <Card className="mt-6">
        <p className="mb-3 text-sm font-semibold text-ink-2">{a.pickAny}</p>
        {units.length === 0 ? (
          <p className="text-sm text-ink-3">
            {a.emptyLead}{" "}
            <Link to="/study" className="text-primary hover:underline">
              {a.goStudy}
            </Link>{" "}
            {a.emptyTail}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {units.map((u) => {
              const mastery = snapshot?.masteryByUnit[u.id] ?? 0;
              return (
                <button
                  key={u.id}
                  onClick={() => setActive(u)}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 transition hover:border-primary/50 hover:bg-primary/5"
                >
                  {unitTitle(u.id)}
                  <BandBadge band={bandOf(mastery)} />
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* 资料作用域测评：单章单元测 → 章掌握度（学习闭环的真实写方） */}
      {docRows.length > 0 ? (
        <Card className="mt-6">
          <p className="text-sm font-semibold text-ink-2">{a.docScopeTitle}</p>
          <p className="mt-1 text-xs text-ink-3">{a.docScopeHint}</p>
          <div className="mt-3 space-y-3">
            {docRows.map(({ doc, chapters }) => (
              <div key={doc.id} className="rounded-lg border border-line bg-subtle/40 p-2.5">
                <p className="text-xs font-medium text-ink-1">
                  {doc.title}
                  <span className="ml-2 text-ink-3">{a.docChapters(chapters.length)}</span>
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {chapters.map((c) => {
                    const mastery = learner?.byUnit[c.id]?.mastery ?? 0;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={!!busyChapter || isPaperRunning(doc.id)}
                        onClick={() => void startChapterPaper({ doc, chapters }, c)}
                        data-testid={`assess-chapter-${c.id}`}
                        className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink-2 transition hover:border-primary/50 hover:bg-primary/5 disabled:opacity-40"
                      >
                        <span className="max-w-[12rem] truncate">
                          {c.title?.trim() || m.chapter.ordinal(c.order)}
                        </span>
                        <BandBadge band={bandOf(mastery)} />
                        <span className="font-medium text-primary">
                          {/* busy 指示双源：本轮点击（组件 state）+ 全局任务记录（重挂后仍可派生，F5） */}
                          {busyChapter === c.id || isPaperRunning(doc.id) ? a.testing : a.testChapter}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {scopeError ? (
            <p className="mt-2 text-xs text-state-failed">
              {a.docScopeFailed}：{scopeError}
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* 今日已测 */}
      {todayAssessments.length > 0 ? (
        <Card className="mt-6">
          <SectionTitle title={a.todayTitle} subtitle={a.todayCount(todayAssessments.length)} />
          <ul className="space-y-1 text-sm text-ink-2">
            {todayAssessments.map((r) => (
              <li key={`${r.unitId}-${r.at}`}>
                {unitTitle(r.unitId)} · {r.correct ? a.correct : a.wrong} ·{" "}
                {r.correct ? "+" : ""}
                {Math.round((r.masteryDelta ?? 0) * 100)}%
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </PageContainer>
  );
}
