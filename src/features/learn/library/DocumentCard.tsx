/**
 * 资料卡（列表页网格单元；docs/library-module-design-2026-09.md §8.12）。
 * 卡面：类型徽标 + 标题 + 来源 + 导入时间 + 统计 + 就绪 Bar；整卡点击进详情，
 * 右上「⋯」菜单承载资料级操作（弹窗编排归 LibraryPage）。
 */
import { Link } from "react-router-dom";
import { Bar } from "../../../components/primitives";
import { MASTERY_THRESHOLD } from "../../../domain";
import type { Chapter, LearnerState, SourceDocument } from "../../../domain";
import { useI18n } from "../../../i18n";
import DocActionsMenu from "./DocActionsMenu";
import type { DocActionKind } from "./DocActionsMenu";
import { formatLabel, shortDate } from "./shared";

export default function DocumentCard({
  doc,
  chapters,
  learner,
  onAction,
}: {
  doc: SourceDocument;
  chapters: Chapter[];
  learner: LearnerState | undefined;
  onAction: (kind: DocActionKind) => void;
}) {
  const { m, lang } = useI18n();
  const lib = m.learn.library;

  const mastered = chapters.filter(
    (c) => (learner?.byUnit[c.id]?.mastery ?? 0) >= MASTERY_THRESHOLD,
  ).length;
  const points = chapters.reduce((n, c) => n + c.keyPoints.length, 0);
  const unsplit = chapters.length === 0;

  return (
    <div className="group relative rounded-xl border border-line bg-surface p-4 transition hover:border-ink-3/40 hover:shadow-sm">
      <Link to={`/learn/doc/${doc.id}`} data-testid={`doc-card-${doc.id}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
            {formatLabel(doc.format, m)}
          </span>
          {/* 占位：给右上菜单留出空间，避免标题压到菜单下 */}
          <span className="h-6 w-6 shrink-0" aria-hidden />
        </div>
        <p className="mt-2 truncate text-[15px] font-semibold text-ink-1">{doc.title}</p>
        <p className="mt-0.5 truncate text-xs text-ink-3">{doc.source ?? lib.noSource}</p>
        <p className="mt-0.5 text-xs text-ink-3">{lib.importedAt(shortDate(doc.importedAt, lang))}</p>
        <p className="mt-2 text-xs text-ink-2">{lib.cardMeta(chapters.length, points, mastered)}</p>
        <Bar
          value={chapters.length ? mastered / chapters.length : 0}
          target={MASTERY_THRESHOLD}
          targetLabel={lib.targetLine}
          className="mt-2"
        />
      </Link>
      {unsplit && hasBody(doc) ? (
        <button
          type="button"
          onClick={() => onAction("split")}
          disabled={!doc.textPreview}
          data-testid={`doc-card-split-${doc.id}`}
          className="mt-2 rounded-md border border-line px-2 py-0.5 text-xs text-primary hover:bg-subtle disabled:opacity-40"
        >
          {lib.splitNow}
        </button>
      ) : null}
      <DocActionsMenu docId={doc.id} unsplit={unsplit} hasBody={hasBody(doc)} onAction={onAction} />
    </div>
  );
}

function hasBody(doc: SourceDocument): boolean {
  return Boolean(doc.textPreview && doc.textPreview.trim().length > 0);
}
