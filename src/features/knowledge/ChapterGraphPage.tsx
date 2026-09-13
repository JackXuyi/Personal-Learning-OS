/**
 * 章概念图谱页（/learn/:chapterId/graph）—— N5 概念层回归（T14）。
 *
 * V2 主链路以「章」为单位；本章图谱把概念层以「章为边界」挂回数据流：
 *   - 图 = 章概念子图（Chapter.unitIds ∩ 全局 graph，graph-engine.subgraphOf）；
 *   - 概念由 AI 从章正文提炼（pipelines.extractChapterConceptsWithAi，Provider
 *     就绪时），替换写 Chapter.unitIds + 全局 graph（graph-engine.replaceChapterConcepts）；
 *   - 节点掌握度来自 learnerState.byUnit（概念层无卷面，自评即证据源，
 *     与 ReviewSession.submitAnswer 同一写方）；缺口（<80%）indigo 脉冲；
 *   - 「去复习」带章上下文跳 ReviewSession（?chapterId=&unit=）；
 *   - 未配置 / 未提炼 → 空态引导（P0-3：无 AI 不伪造概念）。
 *
 * 布局与 ChapterReaderPage 一致（裸容器 + Card），图谱复用 GraphView 组件。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Card } from "../../components/primitives";
import type {
  Chapter,
  KnowledgeGraph,
  LearnerState,
  SourceDocument,
} from "../../domain";
import { extractChapterConceptsWithAi } from "../../ai";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { replaceChapterConcepts, subgraphOf } from "../../engine/graph-engine";
import { storage } from "../../stores/useLoopStore";
import { useAiTask } from "../../stores/useAiTaskStore";
import { isTerminalFresh } from "../../stores/ai-task-types";
import { Button } from "../../components/ui/button";
import { useI18n } from "../../i18n";
import GraphView from "./GraphView";

export default function ChapterGraphPage() {
  const { m } = useI18n();
  const t = m.knowledge.chapterGraph;
  const { chapterId = "" } = useParams();
  const navigate = useNavigate();

  const [chapter, setChapter] = useState<Chapter | undefined>();
  const [doc, setDoc] = useState<SourceDocument | undefined>();
  const [graph, setGraph] = useState<KnowledgeGraph | undefined>();
  const [learner, setLearner] = useState<LearnerState | undefined>();
  const [missing, setMissing] = useState(false);
  // 概念抽取走全局任务注册表（graph-extract:{docId}:{chapterId}，切页重挂可恢复）；
  // 终态消息（成功/失败）从任务记录读回。本地 error 仅存「未配置/无正文」预检失败。
  const task = useAiTask(`graph-extract:${doc?.id ?? "?"}:${chapterId}`);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    void (async () => {
      const [docs, g, ls] = await Promise.all([
        storage.listDocuments(),
        storage.getGraph(),
        storage.getLearnerState(),
      ]);
      setGraph(g);
      setLearner(ls);
      for (const d of docs) {
        const chapters = await storage.listChapters(d.id);
        const found = chapters.find((c) => c.id === chapterId);
        if (found) {
          setChapter(found);
          setDoc(d);
          return;
        }
      }
      setMissing(true);
    })();
  }, [chapterId]);

  const masteryByUnit = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, mm] of Object.entries(learner?.byUnit ?? {})) {
      out[id] = mm.mastery;
    }
    return out;
  }, [learner]);

  const chapterUnits = useMemo(() => {
    if (!graph) return { units: [], relations: [] } as KnowledgeGraph;
    return subgraphOf(graph, chapter?.unitIds ?? []);
  }, [graph, chapter]);

  /** AI 提炼本章概念：替换写 Chapter.unitIds + 全局 graph（幂等 replace）。 */
  const extractConcepts = () => {
    if (!chapter || !doc || task.running) return;
    setError(undefined);
    const provider = buildActiveProvider();
    if (!provider.isConfigured()) {
      setError(t.notReady);
      return;
    }
    const body = doc.textPreview?.slice(chapter.contentRef.start, chapter.contentRef.end) ?? "";
    if (body.trim().length === 0) {
      setError(t.noBody);
      return;
    }
    void task
      .run(async (_report, done) => {
        const next = await extractChapterConceptsWithAi(provider, {
          chapterTitle: chapter.title || m.chapter.ordinal(chapter.order),
          text: body,
        });
        // 落库：以最新 storage 为准做 replace（图）→ 更新章 unitIds。
        const g = await storage.getGraph();
        const ng = replaceChapterConcepts(g, chapter.unitIds, next);
        await storage.saveGraph(ng);
        const chapters = await storage.listChapters(doc.id);
        const updated = chapters.map((c) =>
          c.id === chapter.id
            ? { ...c, unitIds: next.units.map((u) => u.id) }
            : c,
        );
        await storage.saveChapters(doc.id, updated);
        setGraph(ng);
        setChapter(updated.find((c) => c.id === chapter.id));
        done(t.doneMsg(next.units.length, next.relations.length));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-base font-semibold text-slate-900">{t.missingTitle}</p>
        <p className="mt-1 text-sm text-slate-500">{t.missingDesc}</p>
        <Link to="/learn" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          {t.backToCatalog}
        </Link>
      </div>
    );
  }

  if (!chapter || !graph || !doc) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-sm text-slate-500">{t.opening}</p>
      </div>
    );
  }

  const hasConcepts = chapterUnits.units.length > 0;

  return (
    <div className="mx-auto max-w-6xl px-8 py-6">
      {/* 面包屑 + 工具栏 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/learn/${chapter.id}`} className="text-xs text-slate-400 hover:text-indigo-600">
            {t.backToReader}
          </Link>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {doc.title} · {m.chapter.ordinal(chapter.order)} · {t.crumbSuffix}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* 终态 pill 带新鲜度门（R2）：同 id 记录跨页面残留的陈旧终态不再展示 */}
          {task.status === "done" && task.message && isTerminalFresh(task) ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              {task.message}
            </span>
          ) : null}
          {(error || (task.status === "error" && task.message && isTerminalFresh(task))) ? (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              {error ?? task.message}
            </span>
          ) : null}
          <Button onClick={extractConcepts} loading={task.running}>
            {hasConcepts ? t.reExtract : t.extract}
          </Button>
        </div>
      </div>

      {hasConcepts ? (
        <>
          <p className="mb-3 text-xs text-slate-400">{t.hint}</p>
          <GraphView
            graph={chapterUnits}
            masteryByUnit={masteryByUnit}
            requiredUnitIds={chapter.unitIds}
            onOpenDocument={() => navigate(`/learn/${chapter.id}`)}
            onReviewUnit={(unitId) =>
              navigate(`/study/session?chapterId=${chapter.id}&unit=${unitId}`)
            }
          />
        </>
      ) : (
        <Card className="p-10 text-center">
          <p className="text-base font-semibold text-slate-800">{t.emptyTitle}</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            {t.emptyDesc}
          </p>
          {buildActiveProvider().isConfigured() ? null : (
            <Link
              to="/settings"
              className="mt-4 inline-block rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
            >
              {t.goConfigure}
            </Link>
          )}
        </Card>
      )}
    </div>
  );
}
