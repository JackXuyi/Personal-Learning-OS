import { useState } from 'react';
import { useI18n } from '../../../i18n';
import { storage } from '../../../stores/useLoopStore';
import { Button } from '../../../components/ui/button';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import { notifyDocsChanged } from '../../../components/layout/AppShell';
import { buildActiveProvider } from '../../../ai/active';
import { splitDocumentNow, SplitServiceError } from '../split-service';
import { analyzeChaptersNow } from '../analyze-service';
import { ChapterRow } from './ChapterRow';
import type { SourceDocument, Chapter, LearnerState } from '../../../domain';

interface SplitTabProps {
  doc: SourceDocument;
  chapters: Chapter[];
  learner: LearnerState | null;
  onChanged: () => Promise<void>;
}

export default function SplitTab({ doc, chapters, learner, onChanged }: SplitTabProps) {
  const t = useI18n();
  const [busy, setBusy] = useState<'split' | 'analyze' | undefined>();
  const [notice, setNotice] = useState<string>();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const aiReady = buildActiveProvider()?.isConfigured() ?? false;
  const firstChapter = chapters[0];
  const totalKeyPoints = chapters.reduce((sum, c) => sum + (c.keyPoints?.length ?? 0), 0);

  const strategyLabel = useMemo(() => {
    if (!firstChapter) return undefined;
    return t.learn.detail.split.strategyHeadings;
  }, [firstChapter, t]);

  const refinedLabel = useMemo(() => {
    if (!firstChapter) return undefined;
    return t.learn.detail.split.refinedYes;
  }, [firstChapter, t]);

  const runSplit = async () => {
    setBusy('split');
    setNotice(undefined);
    try {
      const result = await splitDocumentNow(doc, { storage });
      setNotice(
        t.learn.detail.split.result(
          result.chapters.length,
          result.carriedMastery,
          result.droppedMastery,
          result.refined
        )
      );
      notifyDocsChanged();
      await onChanged();
    } catch (e) {
      const err = e instanceof SplitServiceError ? e : new Error(String(e));
      if (err.message.includes('no-body')) {
        setNotice(t.learn.detail.split.noBody);
      } else if (err.message.includes('no-chapters')) {
        setNotice(t.learn.detail.split.noChapters);
      } else {
        setNotice(err.message || t.common.loading);
      }
    } finally {
      setBusy(undefined);
    }
  };

  const runAnalyze = async () => {
    if (chapters.length === 0 || !aiReady) {
      setNotice(t.learn.detail.split.noChapters);
      return;
    }
    setBusy('analyze');
    setNotice(undefined);
    try {
      await analyzeChaptersNow(doc, { storage });
      setNotice(
        t.learn.detail.split.result(
          chapters.length,
          0,
          0,
          true
        )
      );
      notifyDocsChanged();
      await onChanged();
    } catch (e) {
      setNotice((e instanceof Error ? e.message : String(e)) || 'AI 分析失败');
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="space-y-4">
      {/* 元信息条 */}
      {firstChapter && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3">
          <div className="flex items-center gap-1.5 text-xs text-ink-2">
            {strategyLabel && <span>{strategyLabel}</span>}
            {refinedLabel && (
              <>
                <span>·</span>
                <span>{refinedLabel}</span>
              </>
            )}
            <span>·</span>
            <span>
              {chapters.length} {t.learn.detail.split.chapters}
            </span>
            {totalKeyPoints > 0 && (
              <>
                <span>·</span>
                <span>
                  {totalKeyPoints} {t.learn.detail.split.keyPoints}
                </span>
              </>
            )}
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => (chapters.length > 0 ? setConfirmOpen(true) : runSplit())}
              disabled={!!busy}
            >
              {chapters.length > 0
                ? t.learn.detail.split.resplit
                : t.learn.detail.split.split}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={runAnalyze}
              disabled={!!busy || !aiReady || chapters.length === 0}
            >
              {t.learn.detail.split.analyzeOnly}
            </Button>
            {!aiReady && chapters.length > 0 && (
              <a href="/settings" className="inline-flex items-center text-xs text-primary hover:underline">
                {t.learn.detail.split.goConfigure}
              </a>
            )}
          </div>
        </div>
      )}

      {/* 通知条 */}
      {notice && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-xs text-ink-2">{notice}</p>
        </div>
      )}

      {/* 章行列表或空态 */}
      {chapters.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
          <p className="text-sm font-medium text-ink-1">{t.learn.detail.split.emptyTitle}</p>
          <p className="mt-1 text-xs text-ink-3">{t.learn.detail.split.emptyDesc}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {chapters.map((ch, idx) => (
            <ChapterRow
              key={ch.id}
              chapter={ch}
              index={idx + 1}
              mastery={learner?.byUnit[ch.id]?.mastery ?? 0}
            />
          ))}
        </div>
      )}

      {/* 重新切分确认弹窗 */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t.learn.detail.split.confirmTitle}
        description={t.learn.detail.split.confirmDesc(chapters.length)}
        confirmLabel={t.learn.detail.split.confirmOk}
        cancelLabel={t.common.cancel}
        onConfirm={runSplit}
      />
    </div>
  );
}
