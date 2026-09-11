/**
 * 「概览」Tab —— AI 整篇总结 + 本地统计（资料详情页首个 Tab）。
 *
 * 设计（docs/library-detail-page-overview-tab-design-2026-09.md §8.5）：
 * - **AI 区块**：四态（空 / 进行中 / 已生成 / 错误）+ 过期提示。手动触发（D1），
 *   mount 时**不**发起任何 AI 调用；
 * - **统计面板**：始终渲染、与 AI 状态解耦 —— 首屏立刻有内容，回答「我学到哪了」；
 * - 写入面收窄：本组件唯一写动作是经 `generateOverviewNow` 落 `doc.overview`；
 *   `listPapers()` 为只读（与 PapersTab 同源，读失败只丢试卷数，不阻断概览）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../../i18n';
import { storage } from '../../../stores/useLoopStore';
import { Button } from '../../../components/ui/button';
import { Bar, Section, Stat } from '../../../components/primitives';
import { notifyDocsChanged } from '../../../components/layout/AppShell';
import { buildActiveProvider } from '../../../stores/useSettingsStore';
import { useAiReady } from '../../../hooks/useAiReady';
import { generateOverviewNow } from '../analyze-service';
import { MarkdownBlock, MarkdownInline } from '../render/markdown-core';
import { MASTERY_THRESHOLD } from '../../../domain';
import type { OverviewPhase } from '../../../ai/overview-pipeline';
import type {
  Chapter,
  DocumentOverview,
  LearnerState,
  Paper,
  SourceDocument,
} from '../../../domain';

interface OverviewTabProps {
  doc: SourceDocument;
  chapters: Chapter[];
  learner: LearnerState | null;
  onChanged: () => Promise<void>;
}

export default function OverviewTab({ doc, chapters, learner, onChanged }: OverviewTabProps) {
  const { lang, m: t } = useI18n();
  const navigate = useNavigate();
  const aiReady = useAiReady();

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    i: number;
    n: number;
    label: string;
    phase: OverviewPhase;
  }>();
  const [error, setError] = useState<string>();
  const [skipped, setSkipped] = useState(0);
  const [papers, setPapers] = useState<Paper[]>([]);
  /**
   * 生成成功的「本地兜底」概览（与 docId 绑在一起存）。
   *
   * 为什么需要它：原先视图**只**依赖 `onChanged()`（父组件回读 storage）拿新
   * `doc`，而那一跳是**静默失败**的——`DocumentDetailPage.handleRefresh` 里
   * `if (d) setDoc(d)`（d 为假直接跳过）且整段包在 try/catch 中只
   * `console.error`。于是会出现「日志显示生成完成、页面仍是空态、且无任何报错」。
   * 概览已经成功落库，展示就不该再赌一次回读：这里直接用管道返回值渲染，
   * `onChanged()` 退化为后台同步（失败只影响列表，不影响已生成内容）。
   *
   * 带 `docId` 一起存：本组件切资料时不卸载，用它判定归属，避免把上一份
   * 资料的概览显示到这一份上。
   */
  const [fresh, setFresh] = useState<{ docId: string; overview: DocumentOverview }>();

  // mount 只读：与 PapersTab 同源。失败不影响概览（只是统计少一项）。
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const ps = await storage.listPapers();
        if (alive) setPapers(ps);
      } catch (e) {
        console.error('[OverviewTab] 加载试卷失败：', e);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 单一真源：优先父组件回读的最新 doc；回读未生效时退回本次生成的产物（同 docId 才认）。
  const overview = doc.overview ?? (fresh?.docId === doc.id ? fresh.overview : undefined);
  const stale = overview ? overview.sourceChars !== (doc.textPreview?.length ?? 0) : false;
  const hasBody = (doc.textPreview ?? '').trim().length > 0;

  /** 本地统计（零成本，不依赖 AI）；口径全部复用既有定义。 */
  const stats = useMemo(() => {
    const chapterIds = new Set(chapters.map((c) => c.id));
    const unitIds = new Set(chapters.flatMap((c) => c.unitIds ?? []));
    const paperCount = papers.filter((p) =>
      p.scope.chapterIds.some((id) => chapterIds.has(id)),
    ).length;
    // 掌握度按章 id 取（与 paper-advice 同源）；注意不是按 unitId。
    const mastered = chapters.filter(
      (c) => (learner?.byUnit[c.id]?.mastery ?? 0) >= MASTERY_THRESHOLD,
    ).length;
    return {
      chapters: chapters.length,
      chars: doc.textPreview?.length ?? 0,
      units: unitIds.size,
      papers: paperCount,
      mastered,
      total: chapters.length,
    };
  }, [doc, chapters, learner, papers]);

  const nf = useMemo(
    () => new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US'),
    [lang],
  );

  const generate = async () => {
    if (busy || !aiReady || !hasBody) return;
    setBusy(true);
    setError(undefined);
    setSkipped(0);
    setProgress(undefined);
    try {
      const r = await generateOverviewNow(doc, chapters, {
        storage,
        provider: buildActiveProvider(),
        ...(doc.analysis?.model ? { model: doc.analysis.model } : {}),
        onProgress: (i, n, label, phase) => setProgress({ i, n, label, phase }),
      });
      setSkipped(r.skipped);
      // 先落本地兜底：视图不再等父组件回读，回读失败也照常展示已生成的概览。
      setFresh({ docId: doc.id, overview: r.overview });
      notifyDocsChanged();
      await onChanged(); // 后台同步详情页 props（doc.overview）与列表
    } catch (e) {
      // 分析恒由 AI 执行：失败如实展示，不静默降级（E2）
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  };

  const o = t.learn.detail.overview;
  const dateText = overview
    ? new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
        month: 'short',
        day: 'numeric',
      }).format(new Date(overview.generatedAt))
    : '';
  const modeText = overview
    ? overview.mode === 'map-reduce'
      ? o.modeMapReduce(overview.chunks ?? 0)
      : o.modeSingle
    : '';
  const progressText = progress
    ? progress.phase === 'single'
      ? o.progressSingle
      : progress.phase === 'merge'
        ? o.progressMerge
        : o.progressMap(progress.i, progress.n, progress.label)
    : '';

  return (
    <div className="space-y-6">
      {/* AI 概览 */}
      <div>
        <Section
          title={o.head}
          action={
            <Button
              size="sm"
              variant={overview ? 'outline' : 'default'}
              onClick={generate}
              disabled={busy || !aiReady || !hasBody}
            >
              {busy ? o.generating : overview ? o.regenerate : o.generate}
            </Button>
          }
        />

        {overview && (
          <p className="mt-1 text-xs text-ink-3">{o.at(dateText, modeText)}</p>
        )}
        {skipped > 0 && (
          <p className="mt-1 text-xs text-ink-3">{o.skippedChunks(skipped)}</p>
        )}
        {!aiReady && hasBody && (
          <p className="mt-1 text-xs text-ink-3">
            {o.noAi}{' '}
            <Link to="/settings" className="text-primary hover:underline">
              {o.goConfigure}
            </Link>
          </p>
        )}
        {stale && <p className="mt-1 text-xs text-state-weak">{o.stale}</p>}
      </div>

      {/* 进行中 / 错误：aria-live 让读屏用户感知长任务与失败 */}
      {progress && (
        <p aria-live="polite" className="text-xs text-ink-2">
          {progressText}
        </p>
      )}
      {error && (
        <p
          aria-live="polite"
          className="rounded-lg border border-line bg-surface p-3 text-xs text-ink-2"
        >
          {o.failed(error)}
        </p>
      )}

      {/* 主体：已生成 → 内容；未生成 → 空态卡。重新生成时保留旧内容，避免闪屏。 */}
      {overview ? (
        <div className="space-y-5 rounded-xl border border-line bg-surface px-5 py-5 sm:px-6">
          <div className="max-w-[68ch]">
            <p className="text-xs font-semibold tracking-wide text-ink-2">{o.gistLabel}</p>
            <MarkdownBlock text={overview.gist} className="mt-1 text-base text-ink-1" />
          </div>

          {overview.sections.length > 0 && (
            <div>
              <p className="text-xs font-semibold tracking-wide text-ink-2">{o.sectionsLabel}</p>
              <ol className="mt-2 max-w-[68ch] space-y-2">
                {overview.sections.map((s, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-ink-1">
                      {i + 1}. {s.heading}
                    </span>
                    <span className="ml-2 text-ink-2">
                      <MarkdownInline text={s.detail} />
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {overview.keywords.length > 0 && (
            <div>
              <p className="text-xs font-semibold tracking-wide text-ink-2">{o.keywordsLabel}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {overview.keywords.map((k, i) => (
                  <span
                    key={i}
                    className="rounded-full border border-line bg-subtle px-2 py-0.5 text-xs text-ink-1"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {overview.prerequisites.length > 0 && (
            <div>
              <p className="text-xs font-semibold tracking-wide text-ink-2">{o.prereqLabel}</p>
              <ul className="mt-2 max-w-[68ch] space-y-1 text-sm text-ink-2">
                {overview.prerequisites.map((p, i) => (
                  <li key={i}>
                    <span className="mr-1">•</span>
                    <MarkdownInline text={p} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
          <p className="text-sm font-medium text-ink-1">
            {hasBody ? o.emptyTitle : o.noBody}
          </p>
          {hasBody && <p className="mt-1 text-xs text-ink-3">{o.emptyDesc}</p>}
        </div>
      )}

      {/* 本地统计面板：始终渲染，与 AI 状态解耦 */}
      <div>
        <Section title={o.statsLabel} />
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
          <Stat label={o.statChapters} value={String(stats.chapters)} />
          <Stat label={o.statChars} value={nf.format(stats.chars)} />
          <Stat label={o.statUnits} value={String(stats.units)} />
          <Stat label={o.statPapers} value={String(stats.papers)} />
          <Stat label={o.statMastery} value={`${stats.mastered}/${stats.total}`} />
        </div>
        {stats.total > 0 ? (
          <div className="mt-3 max-w-md">
            <Bar value={stats.mastered / stats.total} />
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink-3">{o.masteryEmpty}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate(`/learn/doc/${doc.id}?tab=content`)}>
            {o.goRead}
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/learn/doc/${doc.id}?tab=split`)}>
            {o.goSplit}
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/learn/doc/${doc.id}?tab=knowledge`)}>
            {o.goKnowledge}
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/learn/doc/${doc.id}?tab=papers`)}>
            {o.goPapers}
          </Button>
        </div>
      </div>
    </div>
  );
}
