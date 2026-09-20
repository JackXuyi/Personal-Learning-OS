/**
 * 「关键知识点」Tab —— 章要点（带原文引用）+ 概念图谱。
 *
 * 三处关键改动（docs/library-detail-page-design-2026-09.md §8.15）：
 * - **B2**：AI 就绪判定从恒 null 的 stub 换成 `useAiReady()`（响应式订阅全局配置）；
 * - 要点带**原文出处**：优先渲染 `chapter.keyPointRefs`（point + quote + 跳转），
 *   老数据无 refs 时回退 `keyPoints` 纯文本（TC-EDGE-01 不报错）；
 * - 新增「AI 分析要点」入口（analyzeKeyPointsNow），与既有「AI 分析概念」并列；
 * - 新增**资料级自测卡入口**（F5 第 4 条：由带原文出处的要点派生卡片，零 AI，
 *   计数只读；见 docs/learn-flashcard-design-2026-09.md）—— 与要点分析按钮并列，
 *   无卡时禁用（不编造计数）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../../i18n';
import { storage } from '../../../stores/useLoopStore';
import { useAiTask } from '../../../stores/useAiTaskStore';
import { Button } from '../../../components/ui/button';
import { Section } from '../../../components/primitives';
import { AiTaskStatusLine } from '../../../components/ai-task-status-line';
import { isUsefulKeyPoint } from '../../../lib/text-quality';
import { notifyDocsChanged } from '../../../components/layout/AppShell';
import { buildActiveProvider } from '../../../stores/useSettingsStore';
import { useAiReady } from '../../../hooks/useAiReady';
import { analyzeConceptsNow, analyzeKeyPointsNow } from '../analyze-service';
import { keyPointCoverage } from '../keypoint-coverage';
import { peekCardStats } from '../flashcard-service';
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

/**
 * 完成汇总的状态。要点与概念**两条管道共用这一块 UI**，故 `kind` 是必需字段
 * （完成文案是分键的：`pointsAnalysisDone` / `conceptsAnalysisDone`，见 §汇总渲染）。
 */
interface AnalysisSummary {
  kind: 'points' | 'concepts';
  ok: number;
  failed: FailedItem[];
  extra?: string;
}

/** 概念 / 要点两路径共用：service 已逐章采集 reason，此前被 UI 丢弃（只渲染标题）。 */
const toFailedItems = (failed: readonly { title: string; reason: string }[]): FailedItem[] =>
  failed.map((f) => ({ title: f.title, reason: f.reason }));

export default function KnowledgeTab({ doc, chapters, graph, learner, onChanged }: KnowledgeTabProps) {
  const { m: t } = useI18n();
  const navigate = useNavigate();
  // 要点/概念两条 AI 任务走全局注册表（切页/切 Tab 重挂后按同 id 恢复 loading 与进度）。
  const pointsTask = useAiTask(`keypoints:${doc.id}`);
  const conceptsTask = useAiTask(`concepts:${doc.id}`);
  /**
   * 完成汇总（富结构，组件内渲染）；重挂后的简化终态经 task.message 展示。
   *
   * ⚠️ `kind` 是**必需**字段，不是显示细节：要点与概念两条管道共用这一块汇总 UI，
   * 而完成文案是**按管道分键**的。原先不记来源、一律渲染同一个键，
   * 导致要点分析跑完也报「概念分析完成」。
   */
  const [summary, setSummary] = useState<AnalysisSummary>();

  /** 汇总主句 —— 按 `kind` 选主语，两条管道各报各的，绝不互相借用文案。 */
  const summaryHeadline = (s: AnalysisSummary): string => {
    return s.kind === 'points'
      ? t.learn.detail.knowledge.pointsAnalysisDone(s.ok, s.failed.length)
      : t.learn.detail.knowledge.conceptsAnalysisDone(s.ok, s.failed.length);
  };

  // 全局 AI 配置（响应式）：替代原 ai/active 的恒 null stub（B2 修复）
  const aiReady = useAiReady();

  const allUnitIds = useMemo(() => chapters.flatMap((c) => c.unitIds ?? []), [chapters]);
  const subgraph = useMemo(() => {
    if (!graph) return { units: [], relations: [] };
    return subgraphOf(graph, allUnitIds);
  }, [graph, allUnitIds]);

  const extracted = chapters.filter((c) => (c.unitIds?.length ?? 0) > 0).length;
  /**
   * 要点原文引用的覆盖度 —— 派生自章节数据本身（`M/N 章`）。
   *
   * 要点落库改成**逐章增量**后，「跑到哪了」只能从章节读出来；而「仅补齐缺失」的
   * 选目标用的是**同一个判据**，故统一走 `keypoint-coverage.ts`（一把尺子，方案 D3）。
   * 此前这里是一段内联 `filter`，与服务层各数一遍同一条件。
   */
  const coverage = useMemo(() => keyPointCoverage(chapters), [chapters]);

  /**
   * 资料级自测卡计数（F5 第 4 条）—— 只读（`peekCardStats` 零写入），
   * 无卡时按钮禁用；计数真实来自「带原文出处的要点」，不编造。
   */
  const [cardStats, setCardStats] = useState<{ total: number; due: number } | undefined>();
  useEffect(() => {
    let alive = true;
    void peekCardStats({ documentId: doc.id }, Date.now()).then((st) => {
      if (alive) setCardStats({ total: st.total, due: st.due });
    });
    return () => {
      alive = false;
    };
  }, [doc.id, chapters.length, coverage.withRefs]);

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

  /** onProgress(i, n, ch, blk) → 已翻译进度文案（存入 store，重挂后原样恢复）。 */
  const progressText = (
    i: number,
    n: number,
    ch: { title: string },
    blk?: { block?: number; blocks?: number },
  ): string =>
    blk?.block !== undefined && (blk.blocks ?? 1) > 1
      ? t.learn.detail.analyze.busyBlock(i, n, blk.block, blk.blocks ?? 1)
      : t.learn.detail.knowledge.extracting(i, n, ch.title);

  /**
   * 要点分析。`onlyMissing=true` 即「仅补齐缺失」：只对尚无原文引用的章发起调用，
   * 已完成的章不重复消耗 AI。服务层同一开关见 `AnalyzeKeyPointsOptions.onlyMissing`。
   *
   * ⚠️ 调用方必须**显式传参** —— `onClick={analyzePoints}` 会把 MouseEvent 当
   * `onlyMissing`（恒真）传进去，等于悄悄换成了「仅补齐」。
   */
  const analyzePoints = (onlyMissing: boolean) => {
    if (chapters.length === 0 || !aiReady || pointsTask.running || conceptsTask.running) return;
    // 双保险：按钮已按 `coverage.incomplete` 置灰，这里再挡一道（无缺失时零成本返回）
    if (onlyMissing && !coverage.incomplete) return;
    const provider = buildActiveProvider();
    setSummary(undefined);
    void pointsTask.run(async (report, done) => {
      const result = await analyzeKeyPointsNow(doc, chapters, {
        storage,
        provider,
        onlyMissing,
        onProgress: (i, n, ch, blk) =>
          // 数值进度随文案一并进任务记录（F7），重挂后微进度条可恢复
          report(progressText(i, n, ch, blk), n > 0 ? i / n : undefined),
      });
      const extra =
        [
          result.skippedBlocks > 0
            ? t.learn.detail.analyze.skippedBlocks(result.skippedBlocks)
            : "",
          result.unanchored > 0
            ? t.learn.detail.knowledge.pointsUnanchored(result.unanchored)
            : "",
        ]
          .filter(Boolean)
          .join(" ") || undefined;
      // `kind: 'points'` —— 汇总 UI 与任务终态都必须报「要点分析完成」
      const head = t.learn.detail.knowledge.pointsAnalysisDone(result.ok, result.failed.length);
      setSummary({ kind: 'points', ok: result.ok, failed: toFailedItems(result.failed), extra });
      // 终态摘要同步进任务记录（重挂后仍可见简化版）
      done(
        [head, extra]
          .filter(Boolean)
          .join(" "),
      );
      notifyDocsChanged();
      await onChanged();
    }).catch((e) => {
      // 分析恒由 AI 执行：失败如实抛出，不静默降级（E2）
      setSummary({
        kind: 'points',
        ok: 0,
        failed: chapters.map((c) => ({ title: c.title, reason: t.learn.detail.knowledge.failedUnknown })),
        extra: e instanceof Error ? e.message : String(e),
      });
    });
  };

  const extractAll = () => {
    if (chapters.length === 0 || !aiReady || pointsTask.running || conceptsTask.running) return;
    const provider = buildActiveProvider();
    setSummary(undefined);

    void conceptsTask.run(async (report, done) => {
      const result = await analyzeConceptsNow(doc, chapters, {
        storage,
        provider,
        onProgress: (i, n, ch, blk) =>
          report(progressText(i, n, ch, blk), n > 0 ? i / n : undefined),
      });
      const extra =
        result.skippedBlocks > 0
          ? t.learn.detail.analyze.skippedBlocks(result.skippedBlocks)
          : undefined;
      // `kind: 'concepts'` —— 与要点路径**分键**，两条管道各报各的
      const head = t.learn.detail.knowledge.conceptsAnalysisDone(result.ok, result.failed.length);
      setSummary({ kind: 'concepts', ok: result.ok, failed: toFailedItems(result.failed), extra });
      done([head, extra].filter(Boolean).join(" "));
      notifyDocsChanged();
      await onChanged();
    }).catch((e) => {
      // 原实现只 console.error → 用户只看到「失败 N 章」却不知为何；现补总体原因 + 逐章占位
      console.error('Failed to analyze concepts:', e);
      setSummary({
        kind: 'concepts',
        ok: 0,
        failed: chapters.map((c) => ({ title: c.title, reason: t.learn.detail.knowledge.failedUnknown })),
        extra: e instanceof Error ? e.message : String(e),
      });
    });
  };

  // 状态行任务择一：优先 running 中的；否则取结束更近的（终态由新鲜度门过滤）。
  const statusTask =
    pointsTask.running || conceptsTask.running
      ? pointsTask.running
        ? pointsTask
        : conceptsTask
      : (pointsTask.endedAt ?? 0) >= (conceptsTask.endedAt ?? 0)
        ? pointsTask
        : conceptsTask;

  /**
   * 渲染前过质量门（2026-09-16 缺陷修复）：存量的脏要点（PDF 抽取把编号标题糊进
   * 正文 → 断句切出碎片 `"4."`）不再渲染成「一个孤立圆点」的空行。
   *
   * 判据与生成侧 `cleanKeyPoints` 共用 `isUsefulKeyPoint`（单一真源）——
   * 生成侧负责不再产出，这里负责已落库的存量不再显示，两侧标准不会漂移。
   */
  const pointViews = useMemo(
    () =>
      chapters.map((ch) => ({
        refs: (ch.keyPointRefs ?? []).filter((r) => isUsefulKeyPoint(r.point)),
        points: (ch.keyPoints ?? []).filter(isUsefulKeyPoint),
      })),
    [chapters],
  );

  return (
    <div className="space-y-6">
      {/* 章要点 */}
      <div>
        <Section
          title={t.learn.detail.knowledge.pointsHead}
          action={
          <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/study/session?mode=cards&documentId=${doc.id}`)}
            disabled={!cardStats || cardStats.total === 0}
            data-testid="knowledge-cards-cta"
          >
            {t.learn.reader.cards.startAll(cardStats?.total ?? 0, cardStats?.due ?? 0)}
          </Button>
          {/* 续跑入口（方案 D2）：只对尚无原文引用的章发起调用，可分多次会话补齐。
              仓库第 2 处 onlyMissing 入口（第 1 处 features/settings/VectorIndexCard.tsx）——
              未达「≥10 行 × ≥3 处」的强制抽取线，本次不抽，按 AGENTS.md 声明「待抽」：
              出现第 3 处时必须抽成公共组件。 */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => analyzePoints(true)}
            disabled={!aiReady || pointsTask.running || conceptsTask.running || !coverage.incomplete}
            data-testid="keypoints-backfill"
          >
            {t.learn.detail.knowledge.onlyMissingPoints}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => analyzePoints(false)}
            loading={pointsTask.running}
            disabled={conceptsTask.running || !aiReady || chapters.length === 0}
            data-testid="keypoints-analyze"
          >
            {coverage.withRefs > 0
              ? t.learn.detail.knowledge.reExtractPoints
              : t.learn.detail.knowledge.extractPoints}
          </Button>
          </div>
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
          {t.learn.detail.knowledge.pointsDone(coverage.withRefs, coverage.total)}
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

              {pointViews[idx].refs.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {pointViews[idx].refs.map((ref, i) => (
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
              ) : pointViews[idx].points.length > 0 ? (
                /* 老数据回退：无 keyPointRefs → 仅要点文本（TC-EDGE-01） */
                <ul className="mt-2 space-y-1 text-xs text-ink-2">
                  {pointViews[idx].points.map((kp, i) => (
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
            loading={conceptsTask.running}
            disabled={pointsTask.running || !aiReady || chapters.length === 0}
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

      {/* 进行中 / 重挂后的简化终态：统一状态行（新鲜度门 + dismiss） */}
      {!summary && (
        <AiTaskStatusLine
          task={statusTask}
          runningFallback={t.aiTask.running}
          onDismiss={statusTask.clear}
        />
      )}

      {/* 完成汇总（本次会话富结构渲染） */}
      {summary && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-xs text-ink-2">{summaryHeadline(summary)}</p>
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
