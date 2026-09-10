/**
 * 章行 —— 章节列表的一行（资料详情页「章节列表」Tab）。
 *
 * 初版三处修正（docs/library-detail-page-design-2026-09.md §8.16）：
 * - **状态文案硬编码中文** → 复用 `chapter-badge`（内含状态机 + 掌握度派生规则），
 *   文案走 i18n，切换语言无中文残留；
 * - **掌握度口径错误**：旧代码把 0..1 的 mastery 当百分数比较（`< 50`），
 *   导致永远显示「未学」。此处统一按 0..1 处理，仅在展示时 ×100；
 * - 新增字数 / 要点数 / 掌握度进度条，让列表可直接判断「哪一章值得先看」。
 *
 * v2 优化（docs/library-detail-page-v2-design-2026-09.md §8.9）：
 * - 新增**可展开正文预览**（按 `doc.format` 渲染，markdown 走 GFM）。为此整行
 *   `<Link>` 改为「容器 + 标题 Link + 展开按钮」—— `<button>` 不能嵌在 `<a>` 内；
 * - 进度条与百分比 `hidden sm:flex`：960 窄窗下不再挤压标题；
 * - 字数口径改走 `chapterCharCount`（与 `SplitTab` 的「共 N 字」单一真源）。
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../../i18n';
import { Button } from '../../../components/ui/button';
import { chapterBadge } from '../chapter-badge';
import { chapterCharCount, chapterPreviewOf } from '../chapter-preview';
import { pickRenderer } from '../render/renderer-registry';
import PlainTextRenderer from '../render/PlainTextRenderer';
import RenderErrorBoundary from '../render/RenderErrorBoundary';
import type { Chapter, LearnerState, SourceDocument } from '../../../domain';

interface ChapterRowProps {
  chapter: Chapter;
  index: number;
  learner?: LearnerState | null;
  /**
   * 展开预览需要 `format`（选渲染器）与 `textPreview`（取正文）。
   * 缺省则不渲染展开按钮 —— 例如没有正文资料的调用方无需感知本功能。
   */
  doc?: SourceDocument;
}

export function ChapterRow({ chapter, index, learner, doc }: ChapterRowProps) {
  const { m } = useI18n();
  const t = m.learn.detail;
  const [open, setOpen] = useState(false);

  const unit = learner?.byUnit[chapter.id];
  const mastery = unit?.mastery ?? 0;
  const chars = chapterCharCount(chapter);
  // 有 AI 引用时以引用条数为准（与 keyPoints 同步），否则回退朴素要点数。
  const pointCount = chapter.keyPointRefs?.length ?? chapter.keyPoints?.length ?? 0;
  const badge = chapterBadge(chapter.status, mastery, m);
  const pct = Math.round(mastery * 100);

  const preview = doc ? chapterPreviewOf(doc, chapter) : undefined;
  const Renderer = doc ? pickRenderer(doc.format) : undefined;
  const canExpand = Boolean(doc && preview);

  return (
    <div className="rounded-lg border border-line bg-surface transition-colors hover:bg-subtle">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-6 text-center text-xs font-medium text-ink-3">{index}</div>

        {/* 标题区仍是链接（跳章节阅读页）；与展开按钮平级，不再互相嵌套 */}
        <Link to={`/learn/chapter/${chapter.id}`} className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-1 transition-colors hover:text-primary">
            {chapter.title}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
            <span>{t.chapters.chars(chars)}</span>
            {pointCount > 0 && <span>{t.chapters.keyPoints(pointCount)}</span>}
          </p>
        </Link>

        {/* 状态徽标（状态色只出现在徽标上，不染正文 —— rules/react.mdc） */}
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}
        >
          {badge.label}
        </span>

        {/* 掌握度进度条：窄屏隐藏，避免与标题争宽（TC-UC05-03） */}
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
          <div className="min-w-8 text-right text-xs font-semibold text-ink-3">{pct}%</div>
        </div>

        {canExpand ? (
          <Button
            variant="ghost"
            size="icon"
            aria-expanded={open}
            aria-label={open ? t.chapters.collapse : t.chapters.expand}
            onClick={() => setOpen((v) => !v)}
            className="size-7 shrink-0"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        ) : null}
      </div>

      {open && preview && Renderer && doc ? (
        <div className="border-t border-line px-4 py-3">
          <RenderErrorBoundary
            resetKey={`${doc.id}:${chapter.id}:${doc.format}`}
            fallback={<PlainTextRenderer text={preview.text} doc={doc} />}
          >
            <Renderer text={preview.text} doc={doc} />
          </RenderErrorBoundary>
          {preview.truncated ? (
            <Link
              to={`/learn/chapter/${chapter.id}`}
              className="mt-3 inline-block text-xs text-primary hover:underline"
            >
              {t.chapters.openFull}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
