/**
 * 资料卡（列表页网格单元；docs/library-module-design-2026-09.md §8.12）。
 * 卡面（2026-09-11 样式优化 S1–S6，见 docs/library-module-review-2026-09.md §卡片样式）：
 * 状态点 + 弱化类型 + 标题（视觉锚点）+ 来源/导入单行 + 统计与进度（含百分比、下次复习徽标）
 * + 整行主行动条；整卡点击进详情，右上「⋯」菜单承载资料级操作（弹窗编排归 LibraryPage）。
 */
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Bar } from "../../../components/primitives";
import { buttonVariants } from "../../../components/ui/button";
import { MASTERY_THRESHOLD } from "../../../domain";
import type { Chapter, LearnerState, SourceDocument } from "../../../domain";
import { useI18n } from "../../../i18n";
import { cn } from "../../../lib/utils";
import DocActionsMenu from "./DocActionsMenu";
import type { DocActionKind } from "./DocActionsMenu";
import { docStatus, formatLabel, isDocMastered, nextReviewOf, nextStudyChapter, shortDate } from "./shared";
import type { DocStatus } from "./shared";

/** 状态点色（state-* 语义色只作用于 dot/徽标，不染块，见 rules/react.mdc）。 */
const STATUS_DOT: Record<DocStatus, string> = {
  unsplit: "bg-state-idle",
  reviewDue: "bg-state-failed",
  mastered: "bg-state-mastered",
  learning: "bg-state-learning",
};

export default function DocumentCard({
  doc,
  chapters,
  learner,
  busy,
  onAction,
}: {
  doc: SourceDocument;
  chapters: Chapter[];
  learner: LearnerState | undefined;
  /** 该卡正在进行就地切分（禁用重复触发并切换按钮文案）。 */
  busy?: boolean;
  onAction: (kind: DocActionKind) => void;
}) {
  const { m, lang } = useI18n();
  const lib = m.learn.library;

  const mastered = chapters.filter(
    (c) => (learner?.byUnit[c.id]?.mastery ?? 0) >= MASTERY_THRESHOLD,
  ).length;
  const points = chapters.reduce((n, c) => n + c.keyPoints.length, 0);
  const unsplit = chapters.length === 0;
  /** 「继续学习」落点：第一个未达标章；全达标 → 第一章（复习）。 */
  const nextChapter = nextStudyChapter(chapters, learner);
  const allMastered = isDocMastered(chapters, learner);

  const now = Date.now();
  const status = docStatus(chapters, learner, now);
  const reviewAt = nextReviewOf(chapters, learner);
  const reviewDue = reviewAt !== undefined && reviewAt <= now;
  const percent = chapters.length ? Math.round((mastered / chapters.length) * 100) : 0;

  return (
    <div className="group relative rounded-xl border border-line bg-surface p-4 transition hover:border-ink-3/40 hover:shadow-sm">
      <Link to={`/learn/doc/${doc.id}`} data-testid={`doc-card-${doc.id}`} className="block">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            {/* S2 状态点：未切分=灰 / 到期待复习=红 / 已达标=绿 / 进行中=主色 */}
            <span
              role="img"
              aria-label={lib.status[status]}
              title={lib.status[status]}
              className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[status])}
            />
            {/* S1 类型徽标降权：去描边框与底色，退为弱化小字，把视觉重量让给标题 */}
            <span className="truncate text-[10px] font-medium uppercase tracking-wide text-ink-3">
              {formatLabel(doc.format, m)}
            </span>
          </span>
          {/* 占位：给右上菜单留出空间，避免标题压到菜单下 */}
          <span className="h-6 w-6 shrink-0" aria-hidden />
        </div>
        <p className="mt-2 truncate text-base font-semibold text-ink-1">{doc.title}</p>
        {/* S4 来源与导入时间合并为单行并截断，信息密度降一档 */}
        <p className="mt-1 truncate text-xs text-ink-3">
          {doc.source ?? lib.noSource} · {lib.importedAt(shortDate(doc.importedAt, lang))}
        </p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-ink-2">
            {lib.cardMeta(chapters.length, points, mastered)}
          </p>
          {/* S5 复习提醒：琥珀=未到期，红=已到期；无排期则不显示（不编造日期） */}
          {reviewAt !== undefined ? (
            <span
              data-testid={`doc-card-review-${doc.id}`}
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                reviewDue ? "text-state-failed" : "text-state-weak",
              )}
            >
              {lib.nextReviewOn(shortDate(reviewAt, lang))}
            </span>
          ) : null}
        </div>
        {/* S4 进度条与百分比同排（Bar 的 className 作用于填充色，故外层再包一层 flex） */}
        <div className="mt-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Bar
              value={chapters.length ? mastered / chapters.length : 0}
              target={MASTERY_THRESHOLD}
              targetLabel={lib.targetLine}
            />
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-ink-3">{percent}%</span>
        </div>
      </Link>
      {/* S3 主行动条：整行按钮，实底=强引导（继续学习 / 立即切分），描边=常规（去复习） */}
      {unsplit && hasBody(doc) ? (
        <button
          type="button"
          onClick={() => onAction("split")}
          disabled={!doc.textPreview || busy}
          data-testid={`doc-card-split-${doc.id}`}
          className={cn(buttonVariants({ variant: "default", size: "sm" }), "mt-3 w-full justify-between")}
        >
          <span className="min-w-0 truncate">{busy ? m.learn.detail.split.splitting : lib.splitNow}</span>
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        </button>
      ) : nextChapter ? (
        /* 已切分：给一个直达「下一步该学哪章」的入口，让列表页驱动行动而非只做陈列 */
        <Link
          to={`/learn/chapter/${nextChapter.id}`}
          data-testid={`doc-card-continue-${doc.id}`}
          className={cn(
            buttonVariants({ variant: allMastered ? "outline" : "default", size: "sm" }),
            "mt-3 w-full justify-between",
          )}
        >
          <span className="min-w-0 truncate">
            {allMastered
              ? lib.reviewAt(nextChapter.order, nextChapter.title)
              : lib.continueAt(nextChapter.order, nextChapter.title)}
          </span>
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        </Link>
      ) : null}
      <DocActionsMenu docId={doc.id} unsplit={unsplit} hasBody={hasBody(doc)} onAction={onAction} />
    </div>
  );
}

function hasBody(doc: SourceDocument): boolean {
  return Boolean(doc.textPreview && doc.textPreview.trim().length > 0);
}
