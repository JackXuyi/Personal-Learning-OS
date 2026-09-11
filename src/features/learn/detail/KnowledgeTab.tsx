/**
 * 「关键知识点」Tab —— 章要点（带原文引用）+ 概念图谱。
 *
 * 三处关键改动（docs/library-detail-page-design-2026-09.md §8.15）：
 * - **B2**：AI 就绪判定从恒 null 的 stub 换成 `useAiReady()`（响应式订阅全局配置）；
 * - 要点带**原文出处**：优先渲染 `chapter.keyPointRefs`（point + quote + 跳转），
 *   老数据无 refs 时回退 `keyPoints` 纯文本（TC-EDGE-01 不报错）；
 * - 新增「AI 分析要点」入口（analyzeKeyPointsNow），与既有「AI 分析概念」并列。
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../../i18n';
import { storage } from '../../../stores/useLoopStore';
import { Button } from '../../../components/ui/button';
import { Section } from '../../../components/primitives';
import { notifyDocsChanged } from '../../../components/layout/AppShell';
import { buildActiveProvider } from '../../../stores/useSettingsStore';
import { useAiReady } from '../../../hooks/useAiReady';
import { analyzeConceptsNow, analyzeKeyPointsNow } from '../analyze-service';
import { MarkdownInline } from '../render/markdown-core';
import GraphView from '../../knowledge/GraphView';
import { subgraphOf } from '../../../engine/graph-engine';
import type { SourceDocument, Chapter, KnowledgeGraph, LearnerState } from '../../../domain';

interface KnowledgeTabProps {
  doc: SourceDocument;
  chapters: Chapter[];
  graph: KnowledgeGraph | null;
  learner: LearnerState | null;
  onChanged: () => Promise<void>;
}

/** 汇总区的失败项：对齐 analyze-service 的 { chapterId, title, reason }（此处不保留 chapterId）。 */
interface FailedItem {
  title: string;
  reason: string;
}

/** 概念 / 要点两路径共用：service 已逐章采集 reason，此前被 UI 丢弃（只渲染标题）。 */
const toFailedItems = (failed: readonly { title: string; reason: string }[]): FailedItem[] =>
  failed.map((f) => ({ title: f.title, reason: f.reason }));

export default function KnowledgeTab({ doc, chapters, graph, learner, onChanged }: KnowledgeTabProps) {
  const { m: t } = useI18n();
  const navigate = useNavigate();
  const [busyTick, setBusyTick] = useState<{ i: number; n: number; title: string }>();
  const [summary, setSummary] = useState<{ ok: number; failed: FailedItem[]; extra?: string }>();
  const [pointsBusy, setPointsBusy] = useState(false);

  // 全局 AI 配置（响应式）：替代原 ai/active 的恒 null stub（B2 修复）
  const aiReady = useAiReady();

  const allUnitIds = useMemo(() => chapters.flatMap((c) => c.unitIds ?? []), [chapters]);
  const subgraph = useMemo(() => {
    if (!graph) return { units: [], relations: [] };
    return subgraphOf(graph, allUnitIds);
  }, [graph, allUnitIds]);

  const extracted = chapters.filter((c) => (c.unitIds?.length ?? 0) > 0).length;
  const withRefs = chapters.filter((c) => (c.keyPointRefs?.length ?? 0) > 0).length;

  const masteryMap = useMemo(() => {
    if (!learner) return {};
    const m: Record<string, number> = {};
    for (const [unitId, state] of Object.entries(learner.byUnit)) {
      m[unitId] = state.mastery ?? 0;
    }
    return m;
  }, [learner]);

  /** 跳「资料内容」Tab 并定位到原文区间（DocumentDetailPage 消费 ?at=）。 */
  const goSource = (start: number) => {
    navigate(`/learn/doc/${doc.id}?tab=content&at=${start}`);
  };

  const analyzePoints = async () => {
    if (chapters.length === 0 || !aiReady) return;
    const provider = buildActiveProvider();
    setPointsBusy(true);
    setSummary(undefined);
    setBusyTick({ i: 0, n: chapters.length, title: '' });
    try {
      const result = await analyzeKeyPointsNow(doc, chapters, {
        storage,
        provider,
        onProgress: (i, n, ch) => setBusyTick({ i, n, title: ch.title }),
      });
      setSummary({
        ok: result.ok,
        failed: toFailedItems(result.failed),
        extra:
          result.unanchored > 0
            ? t.learn.detail.knowledge.pointsUnanchored(result.unanchored)
            : undefined,
      });
      notifyDocsChanged();
      await onChanged();
    } catch (e) {
      // 分析恒由 AI 执行：失败如实抛出，不静默降级（E2）
      setSummary({
        ok: 0,
        failed: chapters.map((c) => ({ title: c.title, reason: t.learn.detail.knowledge.failedUnknown })),
        extra: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPointsBusy(false);
      setBusyTick(undefined);
    }
  };

  const extractAll = async () => {
    if (chapters.length === 0 || !aiReady) return;
    const provider = buildActiveProvider();
    setBusyTick({ i: 0, n: chapters.length, title: '' });
    setSummary(undefined);

    try {
      const result = await analyzeConceptsNow(doc, chapters, {
        storage,
        provider,
        onProgress: (i, n, ch) => setBusyTick({ i, n, title: ch.title }),
      });
      setSummary({
        ok: result.ok,
        failed: toFailedItems(result.failed),
      });
      notifyDocsChanged();
      await onChanged();
    } catch (e) {
      // 原实现只 console.error → 用户只看到「失败 N 章」却不知为何；现补总体原因 + 逐章占位
      console.error('Failed to analyze concepts:', e);
      setSummary({
        ok: 0,
        failed: chapters.map((c) => ({ title: c.title, reason: t.learn.detail.knowledge.failedUnknown })),
        extra: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyTick(undefined);
    }
  };

  return (
    <div className="space-y-6">
      {/* 章要点 */}
      <div>
        <Section
          title={t.learn.detail.knowledge.pointsHead}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={analyzePoints}
              disabled={pointsBusy || !!busyTick || !aiReady || chapters.length === 0}
            >
              {withRefs > 0
                ? t.learn.detail.knowledge.reExtractPoints
                : t.learn.detail.knowledge.extractPoints}
            </Button>
          }
        />
        {!aiReady && (
          <p className="mt-2 text-xs text-ink-3">
            {t.learn.detail.knowledge.pointsNoAi}{' '}
            <Link to="/settings" className="text-primary hover:underline">
              {t.learn.detail.split.goConfigure}
            </Link>
          </p>
        )}
        <p className="mt-2 text-xs text-ink-3">
          {t.learn.detail.knowledge.pointsDone(withRefs, chapters.length)}
        </p>
      </div>

      {chapters.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
          <p className="text-xs text-ink-3">{t.learn.detail.knowledge.pointsEmpty}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {chapters.map((ch, idx) => (
            <div key={ch.id} className="rounded-lg border border-line bg-surface p-3">
              <Link
                to={`/learn/chapter/${ch.id}`}
                className="text-sm font-medium text-ink-1 hover:text-primary"
              >
                {idx + 1}  {ch.title}
              </Link>

              {ch.keyPointRefs && ch.keyPointRefs.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {ch.keyPointRefs.map((ref, i) => (
                    <li key={i} className="text-xs text-ink-2">
                      <p>
                        <span className="mr-1">•</span>
                        <MarkdownInline text={ref.point} />
                      </p>
                      <div className="mt-1 border-l-2 border-line pl-2">
                        <p className="text-ink-3">
                          {t.learn.detail.knowledge.refLabel}：
                          <MarkdownInline text={ref.quote} className="text-ink-3" />
                        </p>
                        <button
                          type="button"
                          onClick={() => goSource(ref.start)}
                          className="mt-0.5 text-primary hover:underline"
                        >
                          {t.learn.detail.knowledge.goSource}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : ch.keyPoints && ch.keyPoints.length > 0 ? (
                /* 老数据回退：无 keyPointRefs → 仅要点文本（TC-EDGE-01） */
                <ul className="mt-2 space-y-1 text-xs text-ink-2">
                  {ch.keyPoints.map((kp, i) => (
                    <li key={i}>
                      <span className="mr-1">•</span>
                      <MarkdownInline text={kp} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-ink-3">{t.learn.detail.knowledge.pointsEmpty}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 概念图谱 */}
      <Section
        title={t.learn.detail.knowledge.graphHead}
        className="mt-8"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={extractAll}
            disabled={!!busyTick || !aiReady || chapters.length === 0}
          >
            {extracted > 0
              ? t.learn.detail.knowledge.reExtract
              : t.learn.detail.knowledge.extractAll}
          </Button>
        }
      />
      <p className="text-xs text-ink-3">
        {t.learn.detail.knowledge.graphStats(
          extracted,
          chapters.length,
          subgraph.units.length,
          subgraph.relations.length
        )}
      </p>

      {subgraph.units.length > 0 ? (
        <div className="rounded-xl border border-line bg-surface p-2">
          <GraphView
            graph={subgraph}
            masteryByUnit={masteryMap}
            requiredUnitIds={allUnitIds}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
          <p className="text-sm font-medium text-ink-1">
            {t.learn.detail.knowledge.graphEmptyTitle}
          </p>
          <p className="mt-1 text-xs text-ink-3">
            {aiReady
              ? t.learn.detail.knowledge.graphEmptyDesc
              : t.learn.detail.knowledge.graphNoAi}
          </p>
        </div>
      )}

      {/* 进度提示 */}
      {busyTick && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-xs text-ink-2">
            {t.learn.detail.knowledge.extracting(busyTick.i, busyTick.n, busyTick.title)}
          </p>
        </div>
      )}

      {/* 完成汇总 */}
      {summary && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-xs text-ink-2">
            {t.learn.detail.knowledge.extractDone(summary.ok, summary.failed.length)}
          </p>
          {summary.extra && <p className="mt-1 text-xs text-ink-3">{summary.extra}</p>}
          {summary.failed.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-ink-3">
              {summary.failed.map((f, i) => (
                <li key={i}>• {t.learn.detail.knowledge.failedItem(f.title, f.reason)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
