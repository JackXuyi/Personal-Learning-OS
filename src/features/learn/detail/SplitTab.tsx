/**
 * 「章节列表」Tab（原「切分结果」）—— 工具条**常显** + 结构化章列表。
 *
 * P0 修复（B1）：旧实现的整条工具条被 `{firstChapter && …}` 包住，
 * 于是「还没有章节」时「立即切分」按钮根本不渲染 —— 用户永远无法完成首次
 * 切分，功能死锁。现在工具条无条件渲染，空态卡里也给一个切分入口。
 *
 * 分工（docs/library-module-design-2026-09.md v2 硬契约）：
 * - 切分 = 代码（splitDocumentNow，确定性、无重试）；
 * - 精修 = AI（analyzeChaptersNow，可重跑，读全局配置 useAiReady）。
 */
import { useMemo, useState } from 'react';
import { useI18n } from '../../../i18n';
import { storage } from '../../../stores/useLoopStore';
import { buildActiveProvider } from '../../../stores/useSettingsStore';
import { useAiReady } from '../../../hooks/useAiReady';
import { Button } from '../../../components/ui/button';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import { notifyDocsChanged } from '../../../components/layout/AppShell';
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
  const { m: t } = useI18n();
  const [busy, setBusy] = useState<'split' | 'analyze' | undefined>();
  const [notice, setNotice] = useState<string>();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // 全局 AI 配置（响应式）：替代原 ai/active 的恒 null stub（B2 修复）
  const aiReady = useAiReady();

  const hasChapters = chapters.length > 0;
  const totalKeyPoints = useMemo(
    () =>
      chapters.reduce(
        (sum, c) => sum + (c.keyPointRefs?.length ?? c.keyPoints?.length ?? 0),
        0,
      ),
    [chapters],
  );
  const totalChars = useMemo(
    () => chapters.reduce((sum, c) => sum + Math.max(0, c.contentRef.end - c.contentRef.start), 0),
    [chapters],
  );
  /** 切分由代码完成，故恒为「本地启发式」；AI 是否精修过看 analysis.chaptersAt。 */
  const refined = Boolean(doc.analysis?.chaptersAt);

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
          false,
        ),
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
    if (!aiReady) return;
    const provider = buildActiveProvider();
    setBusy('analyze');
    setNotice(undefined);
    try {
      const result = await analyzeChaptersNow(doc, chapters, { storage, provider });
      setNotice(
        t.learn.detail.analyze.result(result.changed, result.merged),
      );
      notifyDocsChanged();
      await onChanged();
    } catch (e) {
      setNotice(
        t.learn.detail.analyze.failed(e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setBusy(undefined);
    }
  };

  const onSplitClick = () => {
    if (hasChapters) setConfirmOpen(true);
    else void runSplit();
  };

  return (
    <div className="space-y-4">
      {/* 工具条：常显 —— 无章节时也必须能触发首次切分（B1） */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
          <span>{t.learn.detail.split.strategyHeadings}</span>
          <span>·</span>
          <span>{refined ? t.learn.detail.split.refinedYes : t.learn.detail.split.refinedNo}</span>
          <span>·</span>
          <span>{t.learn.detail.split.stats(chapters.length, totalKeyPoints)}</span>
          {totalChars > 0 && (
            <>
              <span>·</span>
              <span>{t.learn.detail.chapters.totalChars(totalChars)}</span>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant={hasChapters ? 'outline' : 'default'}
            onClick={onSplitClick}
            disabled={!!busy}
          >
            {hasChapters ? t.learn.detail.split.resplit : t.learn.detail.split.split}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={runAnalyze}
            disabled={!!busy || !aiReady || !hasChapters}
          >
            {t.learn.detail.split.analyzeOnly}
          </Button>
          {!aiReady && (
            <a
              href="#/settings"
              className="inline-flex items-center text-xs text-primary hover:underline"
            >
              {t.learn.detail.split.goConfigure}
            </a>
          )}
        </div>
      </div>

      {/* 通知条 */}
      {notice && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-xs text-ink-2">{notice}</p>
        </div>
      )}

      {/* 章行列表或空态（空态内置切分入口，双重保险） */}
      {!hasChapters ? (
        <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
          <p className="text-sm font-medium text-ink-1">{t.learn.detail.chapters.emptyTitle}</p>
          <p className="mt-1 text-xs text-ink-3">{t.learn.detail.chapters.emptyDesc}</p>
          <Button
            size="sm"
            variant="default"
            className="mt-3"
            onClick={() => void runSplit()}
            disabled={!!busy}
          >
            {t.learn.detail.chapters.split}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {chapters.map((ch, idx) => (
            <ChapterRow
              key={ch.id}
              chapter={ch}
              index={idx + 1}
              learner={learner}
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
