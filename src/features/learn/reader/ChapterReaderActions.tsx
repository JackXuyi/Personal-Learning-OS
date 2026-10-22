/**
 * 阅读页底部主行动条（sticky）—— 章状态推进与复习到期的唯一出口。
 *
 * ⚠️ sticky 底栏内容随章节 / 复习态变化 → **key 重挂载**防 WKWebView 残影瓦片
 * （与 `QuizAnswerPage` 底栏同一条口径：内容变化时整块换新，而不是复用 DOM）。
 *
 * 本组件零 storage / 零 AI：动作全部由容器注入（读页组件不直接写 storage）。
 */
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../../components/ui/button";
import { MASTERY_THRESHOLD, isDueReview } from "../../../domain";
import type { Chapter, LearnerState, SourceDocument } from "../../../domain";
import { useI18n } from "../../../i18n";

interface Props {
  doc: SourceDocument;
  chapter: Chapter;
  learner: LearnerState | undefined;
  onMarkReady: () => void;
  onMarkReviewed: () => void;
}

export default function ChapterReaderActions({
  doc,
  chapter,
  learner,
  onMarkReady,
  onMarkReviewed,
}: Props) {
  const { m } = useI18n();
  const t = m.learn.reader;
  const navigate = useNavigate();
  const mastery = learner?.byUnit[chapter.id]?.mastery ?? 0;
  /** 到期复习（T9）：已达标且 nextReviewAt 已过 → 引导「复习完成」顺延。 */
  const dueReview = !!learner && isDueReview(learner.byUnit[chapter.id], Date.now());

  return (
    <div
      key={`${chapter.id}:${chapter.status}:${dueReview ? "due" : "ok"}`}
      className="sticky bottom-4 z-10 mt-6 flex transform-gpu flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-lg sm:px-5"
    >
      <div className="min-w-0">
        <p className="hidden text-xs text-ink-3 sm:block">
          {dueReview ? t.dueHint : chapter.status === "ready" ? t.readyHint : t.readingHint}
        </p>
        {chapter.status === "ready" && !dueReview ? (
          <Link
            to="/plan"
            className="hidden text-xs font-medium text-ink-3 transition-colors hover:text-primary sm:inline-block"
          >
            {t.toPlan} →
          </Link>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {mastery >= MASTERY_THRESHOLD && !dueReview ? (
          <span className="rounded-lg border border-line bg-subtle px-3 py-2 text-sm font-medium text-state-mastered">
            {t.directQuiz(Math.round(MASTERY_THRESHOLD * 100))}
          </span>
        ) : null}
        {dueReview ? (
          <Button onClick={onMarkReviewed} className="rounded-lg px-5 font-semibold">
            {t.markReviewed}
          </Button>
        ) : chapter.status === "ready" ? (
          <Button
            onClick={() => navigate(`/quiz/new?doc=${doc.id}&chapters=${chapter.id}&mode=unit-test`)}
            className="rounded-lg px-5 font-semibold"
          >
            {t.goQuiz}
          </Button>
        ) : (
          <Button
            onClick={onMarkReady}
            disabled={chapter.status === "mastered" || chapter.status === "retake"}
            className="rounded-lg px-5 font-semibold"
          >
            {chapter.status === "not-started" || chapter.status === "learning"
              ? t.markDone
              : t.doneLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
