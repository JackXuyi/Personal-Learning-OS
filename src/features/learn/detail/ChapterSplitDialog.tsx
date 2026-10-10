/**
 * 拆分选点对话框（F7-b）—— 从章内的**候选切点**里选一处，把一章拆成两章。
 *
 * 为什么用对话框而不是行内直接拆：拆分位置必须是正文里的一个**具体偏移**，
 * 用户需要先看到「从这里之后的文本将成为新章」才好判断；行内放不下这个信息。
 *
 * 候选切点由引擎 `splitCandidatesOf` 给出（空行分段处优先 → 单个换行 → 区间中点）。
 * 本组件只负责呈现与选择，**不做切分逻辑** —— 落库统一走 `applyChapterEdit`，
 * 与重命名 / 合并 / 排序同一个出口（单一真源）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../i18n';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { cn } from '../../../lib/utils';
import { splitCandidatesOf } from '../../../engine/chapter-edit-engine';
import type { Chapter, SourceDocument } from '../../../domain';

interface ChapterSplitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 待拆分的章。 */
  chapter: Chapter;
  /** 提供正文（`textPreview`）用于计算候选与预览。 */
  doc: Pick<SourceDocument, 'textPreview'>;
  /** 落库中：禁用选择与确认。 */
  busy: boolean;
  /** 确认拆分：绝对偏移 + 下半章标题。 */
  onConfirm: (offset: number, newTitle: string) => void;
}

/** 每个候选展示的「新章开头」预览字符数。 */
const PREVIEW_CHARS = 48;

export function ChapterSplitDialog({
  open,
  onOpenChange,
  chapter,
  doc,
  busy,
  onConfirm,
}: ChapterSplitDialogProps) {
  const { m: t } = useI18n();
  const text = doc.textPreview ?? '';
  const candidates = useMemo(
    () => splitCandidatesOf(text, chapter.contentRef),
    [text, chapter],
  );
  const [selected, setSelected] = useState<number | null>(null);

  // 打开 / 换章时重置选择（组件保持挂载，不会自然重置）。
  useEffect(() => {
    setSelected(null);
  }, [open, chapter.id]);

  /** 新章开头的单行预览。 */
  const snippetAt = (offset: number) =>
    text.slice(offset, offset + PREVIEW_CHARS).replace(/\s+/g, ' ').trim();

  const confirm = () => {
    if (selected === null || busy) return;
    onConfirm(selected, t.learn.detail.chaptersEdit.splitNewTitle(chapter.title));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="chapter-split-dialog">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-ink-1">
            {t.learn.detail.chaptersEdit.splitChapterTitle}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-ink-2">
            {t.learn.detail.chaptersEdit.splitChapterDesc(chapter.title)}
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-ink-2">{t.learn.detail.chaptersEdit.splitPickBoundary}</p>

        {/* 候选切点列表：单选。数字是候选序号，右侧是该位置起的新章开头。 */}
        <div
          role="radiogroup"
          aria-label={t.learn.detail.chaptersEdit.splitPickBoundary}
          className="max-h-[45vh] space-y-1 overflow-y-auto rounded-lg border border-line p-1"
        >
          {candidates.map((offset, idx) => {
            const active = selected === offset;
            return (
              <button
                key={offset}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                data-testid="chapter-split-candidate"
                onClick={() => setSelected(offset)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors',
                  active ? 'bg-subtle text-ink-1' : 'text-ink-2 hover:bg-subtle',
                )}
              >
                <span className="shrink-0 tabular-nums text-ink-3">{idx + 1}</span>
                <span className="min-w-0 flex-1 truncate">{snippetAt(offset)}</span>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-ink-3">{t.learn.detail.chaptersEdit.splitConfirmNote}</p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            disabled={selected === null || busy}
            onClick={confirm}
            data-testid="chapter-split-confirm"
          >
            {t.learn.detail.chaptersEdit.splitOk}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
