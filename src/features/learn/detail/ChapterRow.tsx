/**
 * 章行 —— 章节列表的一行（资料详情页「章节列表」Tab）。
 *
 * 相比初版的三处修正：
 * - **状态文案硬编码中文** → 复用 `chapter-badge`（内含状态机 + 掌握度派生规则），
 *   文案走 i18n，切换语言无中文残留（TC-UC02-02）；
 * - **掌握度口径错误**：旧代码把 0..1 的 mastery 当百分数比较（`< 50`），
 *   导致永远显示「未学」。此处统一按 0..1 处理，仅在展示时 ×100；
 * - 新增字数 / 要点数 / 掌握度进度条，让列表可直接判断「哪一章值得先看」。
 */
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../../i18n';
import { chapterBadge } from '../chapter-badge';
import type { Chapter, LearnerState } from '../../../domain';

interface ChapterRowProps {
  chapter: Chapter;
  index: number;
  learner?: LearnerState | null;
}

export function ChapterRow({ chapter, index, learner }: ChapterRowProps) {
  const { m } = useI18n();
  const t = m.learn.detail;

  const unit = learner?.byUnit[chapter.id];
  const mastery = unit?.mastery ?? 0;
  const chars = Math.max(0, chapter.contentRef.end - chapter.contentRef.start);
  // 有 AI 引用时以引用条数为准（与 keyPoints 同步），否则回退朴素要点数。
  const pointCount = chapter.keyPointRefs?.length ?? chapter.keyPoints?.length ?? 0;
  const badge = chapterBadge(chapter.status, mastery, m);
  const pct = Math.round(mastery * 100);

  return (
    <Link
      to={`/learn/chapter/${chapter.id}`}
      className="group flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 transition-colors hover:bg-subtle"
    >
      <div className="min-w-6 text-center text-xs font-medium text-ink-3">{index}</div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-1">{chapter.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
          <span>{t.chapters.chars(chars)}</span>
          {pointCount > 0 && <span>{t.chapters.keyPoints(pointCount)}</span>}
        </p>
      </div>

      {/* 状态徽标（状态色只出现在徽标上，不染正文 —— rules/react.mdc） */}
      <span
        className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}
      >
        {badge.label}
      </span>

      <div className="flex shrink-0 items-center gap-2">
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-subtle">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
        <div className="min-w-8 text-right text-xs font-semibold text-ink-3">{pct}%</div>
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
