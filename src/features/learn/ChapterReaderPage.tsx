/**
 * P2 章节阅读（/learn/:chapterId）—— 三步闭环「步骤 1」的逐章学习页（T5）。
 *
 * 布局：左 = 章正文（doc.textPreview 的 contentRef 切片）；右 = 章状态卡 +
 * 要点卡（keyPoints，AI 提炼 / 本地首句摘要兜底）。
 * 状态机写回：打开阅读（not-started → learning）与「标记学完」（→ ready）
 * 直接整批写 storage（listChapters/saveChapters 契约，docs §5.1）。
 *
 * 「去测本章」CTA：出卷答题（/quiz/new，T6）接入前显示为下一步占位——
 * ready 章不会出现死链，T6 打开同一位置即可。
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bar, Card } from "../../components/primitives";
import { MASTERY_THRESHOLD, isDueReview } from "../../domain";
import type { Chapter, LearnerState, SourceDocument } from "../../domain";
import { applyKeyPointRating } from "../../engine";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { useI18n } from "../../i18n";
import { chapterBadge } from "./chapter-badge";

export default function ChapterReaderPage() {
  const { m } = useI18n();
  const t = m.learn.reader;
  const { chapterId = "" } = useParams();
  const navigate = useNavigate();
  const [chapter, setChapter] = useState<Chapter | undefined>();
  const [doc, setDoc] = useState<SourceDocument | undefined>();
  const [learner, setLearner] = useState<LearnerState | undefined>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void (async () => {
      const [ds, ls] = await Promise.all([
        storage.listDocuments(),
        storage.getLearnerState(),
      ]);
      setLearner(ls);
      for (const d of ds) {
        const chapters = await storage.listChapters(d.id);
        const found = chapters.find((c) => c.id === chapterId);
        if (found) {
          // 打开阅读即推进状态机：not-started → learning（幂等：仅首次）。
          if (found.status === "not-started") {
            const updated = chapters.map((c) =>
              c.id === found.id ? { ...c, status: "learning" as const } : c,
            );
            await storage.saveChapters(d.id, updated);
            setChapter(updated.find((c) => c.id === found.id));
          } else {
            setChapter(found);
          }
          setDoc(d);
          return;
        }
      }
      setMissing(true);
    })();
  }, [chapterId]);

  const mastery = chapter ? (learner?.byUnit[chapter.id]?.mastery ?? 0) : 0;
  const badge = chapter ? chapterBadge(chapter.status, mastery, m) : undefined;
  /** 到期复习（T9）：已达标且 nextReviewAt 已过 → 引导「复习完成」顺延。 */
  const dueReview = !!chapter && !!learner && isDueReview(learner.byUnit[chapter.id], Date.now());

  /** 标记学完：learning / not-started → ready。 */
  const markReady = async () => {
    if (!chapter || !doc) return;
    const chapters = await storage.listChapters(doc.id);
    const updated = chapters.map((c) =>
      c.id === chapter.id ? { ...c, status: "ready" as const } : c,
    );
    await storage.saveChapters(doc.id, updated);
    setChapter(updated.find((c) => c.id === chapter.id));
  };

  /** 复习完成：按「good」自评顺延下次复习（T9 到期动作闭环；只做调度不改掌握度）。 */
  const markReviewed = async () => {
    if (!chapter) return;
    const ls = await storage.getLearnerState();
    const next = applyKeyPointRating(ls, chapter.id, "good", Date.now());
    await storage.saveLearnerState(next);
    setLearner(next);
    await useLoopStore.getState().refresh(m);
  };

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-base font-semibold text-slate-900">{t.missingTitle}</p>
        <p className="mt-1 text-sm text-slate-500">{t.missingDesc}</p>
        <Link to="/learn" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          {t.backToCatalog}
        </Link>
      </div>
    );
  }

  if (!chapter || !doc) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-sm text-slate-500">{t.opening}</p>
      </div>
    );
  }

  const body = doc.textPreview?.slice(chapter.contentRef.start, chapter.contentRef.end) ?? "";

  return (
    <div className="mx-auto max-w-6xl px-8 py-6">
      {/* 面包屑 */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link to="/learn" className="text-xs text-slate-400 hover:text-indigo-600">
            {t.backCatalogShort}
          </Link>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {doc.title} · {m.chapter.ordinal(chapter.order)}
          </p>
        </div>
        {badge ? (
          <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
            {badge.label}
          </span>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* 左：章正文 */}
        <Card className="px-8 py-7">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {chapter.title || m.chapter.ordinal(chapter.order)}
          </h1>
          <div className="mt-4 border-t border-slate-100 pt-5">
            {body.length > 0 ? (
              <ArticleBody text={body} />
            ) : (
              <p className="text-sm text-slate-400">{t.noSnapshot}</p>
            )}
          </div>
        </Card>

        {/* 右：状态卡 + 要点卡 */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {t.masteryEyebrow}
              </p>
              <span className="text-sm font-semibold tabular-nums text-slate-800">
                {Math.round(mastery * 100)}%
              </span>
            </div>
            <div className="mt-2">
              <Bar value={mastery} target={MASTERY_THRESHOLD} />
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">{t.masteryFormula}</p>
          </Card>

          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {t.pointsEyebrow}
            </p>
            {chapter.keyPoints.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {chapter.keyPoints.map((kp, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-6 text-slate-700">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <span>{kp}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-400">{t.noPoints}</p>
            )}
          </Card>

          {/* N5 概念层回归：章概念图谱入口（AI 提炼 + 可视化 + 概念复习） */}
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {t.graphEyebrow}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-400">{t.graphDesc}</p>
            <Link
              to={`/learn/${chapter.id}/graph`}
              className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline"
            >
              {t.openGraph}
            </Link>
          </Card>
        </div>
      </div>

      {/* 底部主行动 */}
      <div className="sticky bottom-4 z-10 mt-6 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white/90 px-5 py-3.5 shadow-lg backdrop-blur">
        <p className="hidden text-xs text-slate-400 sm:block">
          {dueReview
            ? t.dueHint
            : chapter.status === "ready"
              ? t.readyHint
              : t.readingHint}
        </p>
        <div className="flex items-center gap-2">
          {mastery >= MASTERY_THRESHOLD && !dueReview ? (
            <span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              {t.directQuiz(Math.round(MASTERY_THRESHOLD * 100))}
            </span>
          ) : null}
          {dueReview ? (
            <button
              onClick={markReviewed}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              {t.markReviewed}
            </button>
          ) : chapter.status === "ready" ? (
            <button
              onClick={() =>
                navigate(
                  `/quiz/new?doc=${doc.id}&chapters=${chapter.id}&mode=unit-test`,
                )
              }
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              {t.goQuiz}
            </button>
          ) : (
            <button
              onClick={markReady}
              disabled={chapter.status === "mastered" || chapter.status === "retake"}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {chapter.status === "not-started" || chapter.status === "learning" ? t.markDone : t.doneLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 极简 Markdown 行渲染：标题加粗放大、空行留白、其余原文 pre-wrap（不做转义/代码高亮）。 */
function ArticleBody({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(
        <p
          key={i}
          className={
            level <= 2
              ? "mt-5 mb-2 text-lg font-semibold text-slate-900"
              : "mt-4 mb-1.5 text-base font-semibold text-slate-800"
          }
        >
          {heading[2].replace(/\s+#+\s*$/, "")}
        </p>,
      );
    } else if (line.trim() === "") {
      out.push(<div key={i} className="h-3" />);
    } else {
      out.push(
        <p key={i} className="text-[15px] leading-7 text-slate-700">
          <span className="whitespace-pre-wrap">{line}</span>
        </p>,
      );
    }
  });
  return <article>{out}</article>;
}
