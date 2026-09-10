/**
 * P2 章节阅读（/learn/:chapterId）—— 三步闭环「步骤 1」的逐章学习页（T5，UI Workbench U3）。
 *
 * 布局：左 = 章正文（doc.textPreview 的 contentRef 切片）；右 = 四区（与 Learner Model 相连，
 * docs/ui-workbench-plan-2026-09.md §6-U3）：
 *   1) 章状态 —— 状态徽标 + 掌握度 Bar + 口径说明（我学到哪）；
 *   2) Why it matters —— 要点首条 / 正文首句兜底（它讲什么 / 为什么值得学）；
 *   3) Knowledge —— 要点生成可点选知识 chips（N5 unitIds 就绪后以概念为准）；
 *      底部保留「打开本章概念图谱」N5 入口；
 *   4) Evidence —— 溯源（《doc》第 x 章）+ 最近一次含本章的测评 Δ 掌握度（证据从哪来）。
 * 状态机写回：打开阅读（not-started → learning）与「标记学完」（→ ready）
 * 直接整批写 storage（listChapters/saveChapters 契约，docs §5.1）。
 * 底部主行动保留；「标记学完」后提示下一步并刷新章级计划（plan 头项联动）。
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bar, Card, EvidenceRow, Section } from "../../components/primitives";
import { Button } from "../../components/ui/button";
import { MASTERY_THRESHOLD, isDueReview } from "../../domain";
import type { Chapter, LearnerState, SourceDocument } from "../../domain";
import { applyKeyPointRating } from "../../engine";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { useI18n } from "../../i18n";
import { chapterBadge } from "./chapter-badge";
import { pickRenderer } from "./render/renderer-registry";
import PlainTextRenderer from "./render/PlainTextRenderer";
import RenderErrorBoundary from "./render/RenderErrorBoundary";

/** 本章证据：最近一次含本章的判卷结果（Δ 掌握度）。 */
type ChapterEvidence =
  | { state: "loading" }
  | { state: "none" }
  | { state: "ok"; at: number; prev: number; cur: number };

export default function ChapterReaderPage() {
  const { m, lang } = useI18n();
  const t = m.learn.reader;
  const { chapterId = "" } = useParams();
  const navigate = useNavigate();
  const [chapter, setChapter] = useState<Chapter | undefined>();
  const [doc, setDoc] = useState<SourceDocument | undefined>();
  const [learner, setLearner] = useState<LearnerState | undefined>();
  const [missing, setMissing] = useState(false);
  const [evidence, setEvidence] = useState<ChapterEvidence>({ state: "loading" });
  /** Knowledge 区点选高亮的知识块（-1 = 无）。 */
  const [activeChip, setActiveChip] = useState(-1);

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

  /** Evidence 区：取最近一次含本章的判卷结果。 */
  useEffect(() => {
    if (!chapter) return;
    let alive = true;
    setEvidence({ state: "loading" });
    void (async () => {
      const results = await storage.listPaperResults();
      const hit = results.find((r) => r.perChapter[chapter.id]);
      if (!alive) return;
      if (!hit) {
        setEvidence({ state: "none" });
        return;
      }
      const info = hit.perChapter[chapter.id];
      setEvidence({ state: "ok", at: hit.createdAt, prev: info.previousMastery, cur: info.mastery });
    })();
    return () => {
      alive = false;
    };
  }, [chapter?.id]);

  const mastery = chapter ? (learner?.byUnit[chapter.id]?.mastery ?? 0) : 0;
  const badge = chapter ? chapterBadge(chapter.status, mastery, m) : undefined;
  /** 到期复习（T9）：已达标且 nextReviewAt 已过 → 引导「复习完成」顺延。 */
  const dueReview = !!chapter && !!learner && isDueReview(learner.byUnit[chapter.id], Date.now());

  /** 标记学完：learning / not-started → ready，随后刷新章级计划（U3 下一步联动）。 */
  const markReady = async () => {
    if (!chapter || !doc) return;
    const chapters = await storage.listChapters(doc.id);
    const updated = chapters.map((c) =>
      c.id === chapter.id ? { ...c, status: "ready" as const } : c,
    );
    await storage.saveChapters(doc.id, updated);
    setChapter(updated.find((c) => c.id === chapter.id));
    await useLoopStore.getState().refresh(m);
  };

  /** 复习完成：按「good」自评顺延下次复习（T9 到期动作闭环；只做调度不改掌握度）。 */
  const markReviewed = async () => {
    if (!chapter) return;
    const ls = await storage.getLearnerState();
    const next = applyKeyPointRating(ls, chapter.id, "good", Date.now());
    await storage.saveLearnerState(next);
    setLearner(next);
    // §7.1 evidence log · review 写点（delta=0；verdict=good 自评）。
    try {
      await storage.appendEvidence({
        at: Date.now(),
        kind: "review",
        subjectId: chapter.id,
        verdict: "good",
        delta: 0,
      });
    } catch {
      /* 证据落库失败不阻塞复习主流程。 */
    }
    await useLoopStore.getState().refresh(m);
  };

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-base font-semibold text-ink-1">{t.missingTitle}</p>
        <p className="mt-1 text-sm text-ink-2">{t.missingDesc}</p>
        <Link to="/learn" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
          {t.backToCatalog}
        </Link>
      </div>
    );
  }

  if (!chapter || !doc) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-sm text-ink-3">{t.opening}</p>
      </div>
    );
  }

  const body = doc.textPreview?.slice(chapter.contentRef.start, chapter.contentRef.end) ?? "";
  const whyLead = leadOf(chapter, body);
  /** 与「资料内容」Tab 同源：markdown 走 GFM，其余按格式回落，规则一致。 */
  const Renderer = pickRenderer(doc.format);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 xl:max-w-[1500px]">
      {/* 面包屑 */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link to="/learn" className="text-xs text-ink-3 transition-colors hover:text-primary">
            {t.backCatalogShort}
          </Link>
          <p className="mt-0.5 truncate text-xs text-ink-3">
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
        <Card className="px-4 py-5 sm:px-8 sm:py-7">
          <h1 className="text-xl font-semibold tracking-tight text-ink-1">
            {chapter.title || m.chapter.ordinal(chapter.order)}
          </h1>
          <div className="mt-4 break-words border-t border-line pt-5">
            {body.length > 0 ? (
              <RenderErrorBoundary
                resetKey={`${doc.id}:${chapter.id}:${doc.format}`}
                fallback={<PlainTextRenderer text={body} doc={doc} />}
              >
                <Renderer text={body} doc={doc} />
              </RenderErrorBoundary>
            ) : (
              <p className="text-sm text-ink-3">{t.noSnapshot}</p>
            )}
          </div>
        </Card>

        {/* 右：章状态 / Why it matters / Knowledge / Evidence 四区 */}
        <div className="min-w-0 space-y-6">
          {/* 1 · 章状态（我学到哪） */}
          <section className="space-y-2">
            <Section title={t.masteryEyebrow} />
            <div className="flex items-center justify-between gap-2">
              {badge ? (
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
              ) : null}
              <span className="text-sm font-semibold tabular-nums text-ink-1">
                {Math.round(mastery * 100)}%
              </span>
            </div>
            <Bar value={mastery} target={MASTERY_THRESHOLD} />
            <p className="text-xs leading-5 text-ink-3">{t.masteryFormula}</p>
          </section>

          {/* 2 · Why it matters（它讲什么 / 为什么值得学） */}
          <section className="space-y-2">
            <Section title={t.whyEyebrow} />
            {whyLead ? (
              <p className="text-sm leading-6 text-ink-1">{whyLead}</p>
            ) : (
              <p className="text-sm text-ink-3">{t.noPoints}</p>
            )}
          </section>

          {/* 3 · Knowledge（本章知识块，点选高亮） */}
          <section className="space-y-2">
            <Section
              title={t.knowledgeEyebrow}
              action={
                <Link
                  to={`/learn/${chapter.id}/graph`}
                  className="text-xs font-medium text-ink-3 transition-colors hover:text-primary"
                >
                  {t.openGraph}
                </Link>
              }
            />
            {chapter.keyPoints.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {chapter.keyPoints.map((kp, i) => {
                  const active = activeChip === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-label={t.knowledgeSelect}
                      aria-pressed={active}
                      onClick={() => setActiveChip(active ? -1 : i)}
                      className={`rounded-lg border px-2.5 py-1 text-left text-xs leading-5 transition-colors ${
                        active
                          ? "border-primary bg-primary/5 text-ink-1"
                          : "border-line bg-surface text-ink-2 hover:border-ink-3/40"
                      }`}
                    >
                      {kp}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-ink-3">{t.noPoints}</p>
            )}
          </section>

          {/* 4 · Evidence（证据从哪来：溯源 + 最近测评 Δ） */}
          <section className="space-y-2">
            <Section title={t.evidenceEyebrow} />
            {evidence.state === "ok" ? (
              <EvidenceRow
                time={shortDate(evidence.at, lang)}
                title={`${m.units.action.assessment} · ${doc.title}`}
                delta={`${Math.round(evidence.prev * 100)}% → ${Math.round(evidence.cur * 100)}%`}
                deltaTone={
                  evidence.cur > evidence.prev
                    ? "up"
                    : evidence.cur < evidence.prev
                      ? "down"
                      : "neutral"
                }
                source={t.evidenceSource(doc.title, m.chapter.ordinal(chapter.order))}
              />
            ) : evidence.state === "none" ? (
              <p className="text-sm text-ink-3">{t.evidenceNone}</p>
            ) : null}
          </section>
        </div>
      </div>

      {/* 底部主行动：窄屏换行，按钮不挤压提示文案 */}
      <div className="sticky bottom-4 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/90 px-4 py-3.5 shadow-lg backdrop-blur sm:px-5">
        <div className="min-w-0">
          <p className="hidden text-xs text-ink-3 sm:block">
            {dueReview
              ? t.dueHint
              : chapter.status === "ready"
                ? t.readyHint
                : t.readingHint}
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
            <Button
              onClick={markReviewed}
              className="rounded-lg px-5 font-semibold"
            >
              {t.markReviewed}
            </Button>
          ) : chapter.status === "ready" ? (
            <Button
              onClick={() =>
                navigate(`/quiz/new?doc=${doc.id}&chapters=${chapter.id}&mode=unit-test`)
              }
              className="rounded-lg px-5 font-semibold"
            >
              {t.goQuiz}
            </Button>
          ) : (
            <Button
              onClick={markReady}
              disabled={chapter.status === "mastered" || chapter.status === "retake"}
              className="rounded-lg px-5 font-semibold"
            >
              {chapter.status === "not-started" || chapter.status === "learning" ? t.markDone : t.doneLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Why it matters 导语：要点首条优先；无要点时回退正文首句（去标题行）截断，
 * 保持右栏始终能回答「这章讲什么」。
 */
function leadOf(chapter: Chapter, body: string): string | undefined {
  if (chapter.keyPoints.length > 0) return chapter.keyPoints[0];
  const first = body
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s && !/^#{1,6}\s/.test(s));
  if (!first) return undefined;
  return first.length > 96 ? `${first.slice(0, 96)}…` : first;
}

/** 短日期（随界面语言）：9/8 或 Sep 8。 */
function shortDate(at: number, lang: "zh" | "en"): string {
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    month: lang === "zh" ? "numeric" : "short",
    day: "numeric",
  }).format(new Date(at));
}
