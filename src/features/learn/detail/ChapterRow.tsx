import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Chapter } from '../../../domain';

interface ChapterRowProps {
  chapter: Chapter;
  index: number;
  mastery?: number;
}

/** 章行：展示章标题、要点数、掌握度 */
export function ChapterRow({ chapter, index, mastery = 0 }: ChapterRowProps) {
  const keyPointCount = chapter.keyPoints?.length ?? 0;

  const masteryLabel = mastery === 0
    ? '未学'
    : mastery < 50
    ? '学习中'
    : mastery < 80
    ? '待测验'
    : '已掌握';

  const masteryColor = mastery === 0
    ? 'text-ink-3'
    : mastery < 50
    ? 'text-yellow-600'
    : mastery < 80
    ? 'text-blue-600'
    : 'text-green-600';

  return (
    <Link
      to={`/learn/chapter/${chapter.id}`}
      className="group flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 transition-colors hover:bg-subtle"
    >
      <div className="min-w-6 text-center text-xs font-medium text-ink-3">●</div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-ink-1">{index}  {chapter.title}</p>
        <p className="mt-0.5 text-xs text-ink-3">
          {keyPointCount > 0 && `${keyPointCount} 要点`}
        </p>
      </div>
      <div className={`text-xs font-medium ${masteryColor}`}>{masteryLabel}</div>
      <div className="text-xs text-ink-3 font-semibold min-w-8 text-right">{Math.round(mastery)}%</div>
      <ChevronRight className="h-4 w-4 text-ink-3 group-hover:translate-x-0.5 transition-transform" />
    </Link>
  );
}
