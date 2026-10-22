/**
 * 阅读页右栏 —— 七区中的右侧六区（docs/ui-workbench-plan-2026-09.md §6-U3）：
 *   1) 章状态 —— 状态徽标 + 掌握度 Bar + 口径说明（我学到哪）；
 *   2) Why it matters —— 要点首条 / 正文首句兜底（它讲什么 / 为什么值得学）；
 *   3) Knowledge —— 要点生成可点选知识 chips + 自测卡入口 + 概念图谱入口；
 *   4) 问这一章 —— 章内提问面板（答案只依据用户导入的原文，引用可点回正文高亮）；
 *   5) 讲给我听 —— 费曼式复述面板（用自己的话讲一遍，AI 对照本章原文给差距反馈）；
 *   6) 我的划线 —— 本章划线批注（物理位置在 5 与 6 之间，编号沿用七区规划）；
 *   7) Evidence —— 溯源（《doc》第 x 章）+ 最近一次含本章的测评 Δ 掌握度。
 *
 * 自测卡计数与章证据的 effect 也收在这里 —— 它们只喂本栏，没必要占用容器。
 * 本组件零 storage 写：划线动作全部由容器注入。
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bar, EvidenceRow, Section } from "../../../components/primitives";
import { MASTERY_THRESHOLD } from "../../../domain";
import type { Annotation, Chapter, LearnerState, SourceDocument } from "../../../domain";
import { storage } from "../../../stores/useLoopStore";
import { useI18n } from "../../../i18n";
import { shortDate } from "../library/shared";
import { chapterBadge } from "../chapter-badge";
import { peekCardStats } from "../flashcard-service";
import type { AnnotationStatus } from "../annotation-service";
import ChapterQaPanel from "./ChapterQaPanel";
import ChapterRestatementPanel from "./ChapterRestatementPanel";
import ChapterAnnotationsPanel from "./ChapterAnnotationsPanel";
import { leadOf } from "./reader-shared";

/** 本章证据：最近一次含本章的判卷结果（Δ 掌握度）。 */
type ChapterEvidence =
  | { state: "loading" }
  | { state: "none" }
  | { state: "ok"; at: number; prev: number; cur: number };

interface Props {
  doc: SourceDocument;
  chapter: Chapter;
  learner: LearnerState | undefined;
  /** 章正文（容器派生；卡片入口与「无正文」提示都要用）。 */
  body: string;
  /** 已过质量门的要点（容器派生）。 */
  keyPoints: readonly string[];
  annotations: readonly Annotation[];
  locatedIds: readonly string[];
  activeChip: number;
  onActiveChip: (i: number) => void;
  /** 正文高亮（章内相对偏移）—— 由 4 / 5 两个面板发起，左栏执行。 */
  onHighlight: (start: number, end: number) => void;
  onLocate: (a: Annotation) => void;
  onUpdateNote: (a: Annotation, note: string) => Promise<{ status: AnnotationStatus }>;
  onRemove: (a: Annotation) => void;
}

export default function ChapterReaderSidebar({
  doc,
  chapter,
  learner,
  body,
  keyPoints,
  annotations,
  locatedIds,
  activeChip,
  onActiveChip,
  onHighlight,
  onLocate,
  onUpdateNote,
  onRemove,
}: Props) {
  const { m, lang } = useI18n();
  const t = m.learn.reader;
  const navigate = useNavigate();
  /**
   * 自测卡计数（F5 第 4 条）—— **只读**统计：已派生的卡数 / 到期数 / 无原文出处条数。
   * 计数真实来自 `keyPoints` ∩ `keyPointRefs`，不编造（入口按钮的显示依据）。
   */
  const [cards, setCards] = useState<
    { total: number; due: number; uncarded: number } | undefined
  >();
  const [evidence, setEvidence] = useState<ChapterEvidence>({ state: "loading" });

  /** 自测卡计数（只读；`peekCardStats` 不写任何东西）。要点重跑后自动刷新。 */
  useEffect(() => {
    let alive = true;
    void peekCardStats({ documentId: doc.id, chapterId: chapter.id }, Date.now()).then((st) => {
      if (alive) setCards({ total: st.total, due: st.due, uncarded: st.uncarded });
    });
    return () => {
      alive = false;
    };
  }, [doc.id, chapter.id, chapter.keyPoints.length, chapter.keyPointRefs?.length]);

  /** Evidence 区：取最近一次含本章的判卷结果。 */
  useEffect(() => {
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
  }, [chapter.id]);

  const mastery = learner?.byUnit[chapter.id]?.mastery ?? 0;
  const badge = chapterBadge(chapter.status, mastery, m);
  const whyLead = leadOf(keyPoints, body);

  return (
    <div className="min-w-0 space-y-6">
      {/* 1 · 章状态（我学到哪） */}
      <section className="space-y-2">
        <Section title={t.masteryEyebrow} />
        <div className="flex items-center justify-between gap-2">
          {badge ? (
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}
            >
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
            <div className="flex items-center gap-3">
              {cards && cards.total > 0 ? (
                <Link
                  to={`/study/session?mode=cards&documentId=${doc.id}&chapterId=${chapter.id}`}
                  data-testid="chapter-cards-cta"
                  className="text-xs font-medium text-primary transition-colors hover:underline"
                >
                  <span data-testid="chapter-cards-count">
                    {t.cards.cta(cards.total)}
                    {cards.due > 0 ? ` · ${t.cards.dueBadge(cards.due)}` : ""}
                  </span>
                </Link>
              ) : null}
              <Link
                to={`/learn/${chapter.id}/graph`}
                className="text-xs font-medium text-ink-3 transition-colors hover:text-primary"
              >
                {t.openGraph}
              </Link>
            </div>
          }
        />
        {keyPoints.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {keyPoints.map((kp, i) => {
              const active = activeChip === i;
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={t.knowledgeSelect}
                  aria-pressed={active}
                  onClick={() => onActiveChip(active ? -1 : i)}
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
        {/* 无原文出处的要点不成卡：如实说明，不生成「正面 = 背面」的空卡 */}
        {cards && cards.uncarded > 0 ? (
          <div data-testid="chapter-cards-uncarded" className="space-y-0.5">
            {cards.total > 0 ? (
              <p className="text-xs text-ink-3">
                {t.cards.uncarded(cards.uncarded, cards.uncarded + cards.total)}
              </p>
            ) : (
              <p className="text-xs text-ink-3">{t.cards.uncardedAll}</p>
            )}
            <Link
              to={`/learn/doc/${doc.id}?tab=knowledge`}
              className="inline-block text-xs font-medium text-primary hover:underline"
            >
              {t.cards.goAnalyze}
            </Link>
            <p className="text-xs text-ink-3">{t.cards.needAi}</p>
          </div>
        ) : null}
      </section>

      {/* 4 · 问这一章（章内提问；答案只依据本资料原文，引用可点回正文） */}
      <ChapterQaPanel
        doc={doc}
        chapter={chapter}
        onHighlight={onHighlight}
        onJumpChapter={(targetId, atAbs) => navigate(`/learn/chapter/${targetId}?at=${atAbs}`)}
      />

      {/* 5 · 讲给我听（费曼式复述；AI 对照本章原文给出可锚回的差距反馈） */}
      <ChapterRestatementPanel doc={doc} chapter={chapter} onHighlight={onHighlight} />

      {/* 6 · 我的划线（F5 第 2 条：选中原文 → 划线 → 可选笔记；零 AI）。
          物理位置在 5 与 6 之间（方案 §8.8 定案），编号沿用七区规划。 */}
      <ChapterAnnotationsPanel
        annotations={annotations}
        hasBody={body.length > 0}
        locatedIds={locatedIds}
        onLocate={onLocate}
        onUpdateNote={onUpdateNote}
        onRemove={onRemove}
      />

      {/* 7 · Evidence（证据从哪来：溯源 + 最近测评 Δ） */}
      <section className="space-y-2">
        <Section title={t.evidenceEyebrow} />
        {evidence.state === "ok" ? (
          <EvidenceRow
            time={shortDate(evidence.at, lang)}
            title={`${m.units.action.assessment} · ${doc.title}`}
            delta={`${Math.round(evidence.prev * 100)}% → ${Math.round(evidence.cur * 100)}%`}
            deltaTone={
              evidence.cur > evidence.prev ? "up" : evidence.cur < evidence.prev ? "down" : "neutral"
            }
            source={t.evidenceSource(doc.title, m.chapter.ordinal(chapter.order))}
          />
        ) : evidence.state === "none" ? (
          <p className="text-sm text-ink-3">{t.evidenceNone}</p>
        ) : null}
      </section>
    </div>
  );
}
