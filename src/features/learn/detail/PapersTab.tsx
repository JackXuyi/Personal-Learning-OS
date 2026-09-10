import { Link } from 'react-router-dom';
import { useI18n } from '../../../i18n';
import type { Chapter, LearnerState } from '../../../domain';

interface PapersTabProps {
  chapters: Chapter[];
  learner: LearnerState | null;
}

export default function PapersTab({ chapters }: PapersTabProps) {
  const t = useI18n();

  if (chapters.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
        <p className="text-sm font-medium text-ink-1">{t.learn.detail.papers.emptyTitle}</p>
        <p className="mt-1 text-xs text-ink-3">{t.learn.detail.papers.emptyDesc}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {chapters.map((ch, idx) => (
        <div key={ch.id} className="rounded-lg border border-line bg-surface p-4">
          <Link
            to={`/learn/chapter/${ch.id}`}
            className="text-sm font-medium text-ink-1 hover:text-primary"
          >
            {idx + 1}  {ch.title}
          </Link>
          <p className="mt-3 text-xs text-ink-3">{t.learn.detail.papers.noPapers}</p>
        </div>
      ))}
    </div>
  );
}
