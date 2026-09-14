/**
 * 编辑态章行 —— 拖拽手柄 + 多选 + 行内重命名（资料详情页「章节列表」Tab 的编辑模式）。
 *
 * 为什么与浏览态 ChapterRow 分离（docs/chapter-edit-design-2026-09.md §8.5）：
 * 两者交互完全不同（拖拽 / 勾选 / 输入 vs 跳转 / 展开），且 ChapterRow 有独立的
 * 展开预览逻辑与既有回归面 —— 分开可让编辑态零风险上线。
 *
 * 提交语义（操作即保存）：Enter 提交、Esc 取消、blur 提交；用 ref 去重，
 * 避免「Enter 提交后 blur 再提交一次」的双写。
 */
import { useEffect, useRef } from 'react';
import { GripVertical, Pencil } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useI18n } from '../../../i18n';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/utils';
import { chapterBadge } from '../chapter-badge';
import type { Chapter, LearnerState } from '../../../domain';

interface ChapterEditRowProps {
  chapter: Chapter;
  /** 展示序号（1-based）。 */
  index: number;
  learner?: LearnerState | null;
  selected: boolean;
  /** 该行是否处于行内重命名态（同时只允许一行）。 */
  renaming: boolean;
  /** 落库中：禁用本行全部交互。 */
  busy: boolean;
  onToggleSelect: () => void;
  onStartRename: () => void;
  onCommitRename: (title: string) => void;
  onCancelRename: () => void;
}

export function ChapterEditRow({
  chapter,
  index,
  learner,
  selected,
  renaming,
  busy,
  onToggleSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: ChapterEditRowProps) {
  const { m } = useI18n();
  const t = m.learn.detail.chaptersEdit;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: chapter.id,
    disabled: busy,
  });

  const unit = learner?.byUnit[chapter.id];
  const mastery = unit?.mastery ?? 0;
  const badge = chapterBadge(chapter.status, mastery, m);
  const pct = Math.round(mastery * 100);

  // 每次进入重命名态重置「已提交」标记（组件保持挂载，不会自然重置）。
  const submittedRef = useRef(false);
  useEffect(() => {
    if (renaming) submittedRef.current = false;
  }, [renaming]);

  const submit = (value: string) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onCommitRename(value);
  };
  const cancel = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onCancelRename();
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="chapter-edit-row"
      className={cn(
        'rounded-lg border border-line bg-surface transition-colors',
        isDragging && 'opacity-60 shadow-md',
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={busy}
          aria-label={t.dragHandle}
          data-testid="chapter-drag-handle"
          className="shrink-0 cursor-grab text-ink-3 transition-colors hover:text-ink-1 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <Checkbox
          checked={selected}
          disabled={busy}
          onCheckedChange={() => onToggleSelect()}
          aria-label={t.select}
          data-testid="chapter-select"
        />

        <div className="min-w-6 text-center text-xs font-medium text-ink-3">{index}</div>

        {renaming ? (
          <Input
            autoFocus
            defaultValue={chapter.title}
            disabled={busy}
            aria-label={t.rename}
            data-testid="chapter-rename-input"
            className="min-w-0 flex-1"
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit(e.currentTarget.value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            onBlur={(e) => submit(e.currentTarget.value)}
          />
        ) : (
          <>
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink-1">
              {chapter.title}
            </p>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label={t.rename}
              data-testid="chapter-rename-btn"
              className="size-7 shrink-0"
              onClick={onStartRename}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </>
        )}

        {/* 状态徽标与掌握度保留：判断「哪几章值得合并」时需要 */}
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}
        >
          {badge.label}
        </span>

        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
          <div className="min-w-8 text-right text-xs font-semibold text-ink-3">{pct}%</div>
        </div>
      </div>
    </div>
  );
}
