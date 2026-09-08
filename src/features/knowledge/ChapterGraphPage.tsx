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
import GraphView from "./GraphView";

export default function ChapterGraphPage() {
  const { chapterId = "" } = useParams();
  const navigate = useNavigate();

  const [chapter, setChapter] = useState<Chapter | undefined>();
  const [doc, setDoc] = useState<SourceDocument | undefined>();
  const [graph, setGraph] = useState<KnowledgeGraph | undefined>();
  const [learner, setLearner] = useState<LearnerState | undefined>();
  const [missing, setMissing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
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
    for (const [id, m] of Object.entries(learner?.byUnit ?? {})) {
      out[id] = m.mastery;
    }
    return out;
  }, [learner]);

  const chapterUnits = useMemo(() => {
    if (!graph) return { units: [], relations: [] } as KnowledgeGraph;
    return subgraphOf(graph, chapter?.unitIds ?? []);
  }, [graph, chapter]);

  /** AI 提炼本章概念：替换写 Chapter.unitIds + 全局 graph（幂等 replace）。 */
  const extractConcepts = async () => {
    if (!chapter || !doc) return;
    setMessage(undefined);
    setError(undefined);
    const provider = buildActiveProvider();
    if (!provider.isConfigured()) {
      setError("AI 未就绪——请先到「设置 → AI 模型中心」配置模型后再提炼概念。");
      return;
    }
    const body = doc.textPreview?.slice(chapter.contentRef.start, chapter.contentRef.end) ?? "";
    if (body.trim().length === 0) {
      setError("这份资料没有保存正文快照，无法提炼本章概念。");
      return;
    }
    setExtracting(true);
    try {
      const next = await extractChapterConceptsWithAi(provider, {
        chapterTitle: chapter.title || `第 ${chapter.order} 章`,
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
      setMessage(`本章提炼出 ${next.units.length} 个概念 · ${next.relations.length} 条关系`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
    }
  };

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-base font-semibold text-slate-900">章节不存在</p>
        <p className="mt-1 text-sm text-slate-500">它可能已被移除，或来自另一份资料。</p>
        <Link to="/learn" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          ← 返回章节目录
        </Link>
      </div>
    );
  }

  if (!chapter || !graph || !doc) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-sm text-slate-500">正在打开概念图谱…</p>
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
            ← 返回本章阅读
          </Link>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {doc.title} · 第 {chapter.order} 章 · 概念图谱
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {message ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              {message}
            </span>
          ) : null}
          {error ? (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              {error}
            </span>
          ) : null}
          <button
            onClick={() => void extractConcepts()}
            disabled={extracting}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {extracting
              ? "提炼中…"
              : hasConcepts
                ? "重新提炼概念"
                : "提炼本章概念"}
          </button>
        </div>
      </div>

      {hasConcepts ? (
        <>
          <p className="mb-3 text-xs text-slate-400">
            概念由 AI 从本章正文提炼，自评复习即掌握度证据（概念层无卷面）。
            单击节点聚焦 · 双击看本章原文 · 缺口概念（&lt;80%）带 indigo 脉冲。
          </p>
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
          <p className="text-base font-semibold text-slate-800">
            本章还没有概念图谱
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            AI 就绪后点击右上角「提炼本章概念」，把这一章拆成可单独记忆与复习的
            知识概念（含前置/相关关系）。未配置 AI 时概念层保持空白，不凭空生成。
          </p>
          {buildActiveProvider().isConfigured() ? null : (
            <Link
              to="/settings"
              className="mt-4 inline-block rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
            >
              去配置 AI →
            </Link>
          )}
        </Card>
      )}
    </div>
  );
}
