/**
 * 阅读页容器 —— 面包屑 + 左栏（正文/译文）+ 右栏（六区）+ 底部行动条。
 *
 * ⚠️ 本组件**只在 doc / chapter 都就绪之后才被挂载**（外壳负责加载与早退）⇒
 * 内部 hook 数量恒定。这正是本次拆分要根治的缺陷：早先在页面里，
 * 「译文缓存命中 → 自动恢复视图」的 effect 被写在了 `!chapter || !doc` 的
 * 早退**之后** —— 首屏 89 个 hook、数据到位后 90 个，直接触发
 * 「React has detected a change in the order of Hooks」。
 *
 * 收在这里的都是**跨栏**的东西：
 * - 划线（左栏发起、右栏展示与回看）与两个正文 DOM ref（左栏挂 DOM、容器滚动）；
 * - 章内引用高亮（右栏的两个 AI 面板发起、左栏执行）；
 * - 章状态推进（标记学完 / 复习完成 —— 唯一写 storage 的地方）。
 */
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Annotation, Chapter, LearnerState, SourceDocument } from "../../../domain";
import { storage, useLoopStore } from "../../../stores/useLoopStore";
import { applyKeyPointRating } from "../../../engine";
import { useI18n } from "../../../i18n";
import { chapterBadge } from "../chapter-badge";
import { scrollToQuote } from "../highlight";
import {
  createAnnotation,
  listChapterAnnotations,
  removeAnnotation,
  updateAnnotationNote,
} from "../annotation-service";
import ChapterReaderMain from "./ChapterReaderMain";
import ChapterReaderSidebar from "./ChapterReaderSidebar";
import ChapterReaderActions from "./ChapterReaderActions";
import { bodyOf, contextOf, usefulKeyPointsOf } from "./reader-shared";

interface Props {
  doc: SourceDocument;
  chapter: Chapter;
  learner: LearnerState | undefined;
  /** 章状态推进后写回外壳（外壳持有 doc / chapter / learner）。 */
  onChapterChange: (c: Chapter | undefined) => void;
  onLearnerChange: (l: LearnerState) => void;
}

export default function ChapterReader({
  doc,
  chapter,
  learner,
  onChapterChange,
  onLearnerChange,
}: Props) {
  const { m } = useI18n();
  const t = m.learn.reader;
  const [searchParams] = useSearchParams();
  /** 原文锚点（文档绝对偏移）；非法值一律当未提供（与 ContentTab 同口径）。 */
  const atRaw = Number(searchParams.get("at") ?? NaN);
  const at = Number.isFinite(atRaw) && atRaw >= 0 ? atRaw : undefined;

  /** 本章划线批注（按 `start` 升序，storage 保证 —— 顺序贪心消歧的前提）。 */
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  /** 正文里**成功定位到**的批注 id（其余在右栏标注「正文中未定位到」，**不删记录**）。 */
  const [locatedIds, setLocatedIds] = useState<readonly string[]>([]);
  /** Knowledge 区点选高亮的知识块（-1 = 无）。 */
  const [activeChip, setActiveChip] = useState(-1);
  /** 章内引用高亮（章内相对偏移）；优先级高于 `?at=`。 */
  const [highlight, setHighlight] = useState<{ start: number; end: number } | undefined>();

  /**
   * 正文 DOM refs 收在容器里（左栏只负责把 DOM 挂上去）：划线的「回看」与
   * 「重复项定位」都要 `scrollToQuote`，而定位目标在左栏的 DOM 里。
   */
  const bodyRef = useRef<HTMLDivElement>(null);
  /** 正文的**相对定位宿主**（选区浮动工具条以它为参照绝对定位）。 */
  const bodyBoxRef = useRef<HTMLDivElement>(null);

  const body = bodyOf(doc, chapter);
  const keyPoints = usefulKeyPointsOf(chapter);
  const mastery = learner?.byUnit[chapter.id]?.mastery ?? 0;
  const badge = chapterBadge(chapter.status, mastery, m);

  /** 章切换 / `?at=` 变化 → 清掉上一次的章内高亮（避免旧高亮抢占新的锚点）。 */
  useEffect(() => {
    setHighlight(undefined);
  }, [chapter.id, at]);

  /** 加载本章划线批注（按章的维度组织 —— 复习回看就在这一章内看）。 */
  useEffect(() => {
    let alive = true;
    void listChapterAnnotations(chapter.id).then((list) => {
      if (alive) setAnnotations(list);
    });
    return () => {
      alive = false;
    };
  }, [chapter.id]);

  // ===== 章状态推进（本组件是唯一的 storage 写方）=====

  /** 标记学完：learning / not-started → ready，随后刷新章级计划（U3 下一步联动）。 */
  const markReady = async () => {
    const chapters = await storage.listChapters(doc.id);
    const updated = chapters.map((c) =>
      c.id === chapter.id ? { ...c, status: "ready" as const } : c,
    );
    await storage.saveChapters(doc.id, updated);
    onChapterChange(updated.find((c) => c.id === chapter.id));
    await useLoopStore.getState().refresh(m);
  };

  /** 复习完成：按「good」自评顺延下次复习（T9 到期动作闭环；只做调度不改掌握度）。 */
  const markReviewed = async () => {
    const ls = await storage.getLearnerState();
    const next = applyKeyPointRating(ls, chapter.id, "good", Date.now());
    await storage.saveLearnerState(next);
    onLearnerChange(next);
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

  // ===== 划线批注（F5 第 2 条）=====

  /** 新建划线（含可选笔记）。`duplicate` 不新建，改为滚到已有那条（幂等语义）。 */
  const handleCreateAnnotation = async (quote: string, note: string) => {
    const r = await createAnnotation({ doc, chapter, quote, note, now: Date.now() });
    const record = r.record;
    if (record && r.status === "ok") {
      // 就地并入列表并按 start 升序（与 storage 契约同序，保证顺序贪心正确）
      setAnnotations((prev) => [...prev, record].sort((x, y) => x.start - y.start));
    }
    if (record && r.status === "duplicate") {
      const root = bodyRef.current;
      if (root) scrollToQuote(root, record.quote, contextOf(doc, chapter, record));
    }
    return r;
  };

  /** 改笔记：只换 `note` / `updatedAt`，区间与 id 不变（高亮不必重建、列表不跳动）。 */
  const handleUpdateNote = async (a: Annotation, note: string) => {
    const r = await updateAnnotationNote({ record: a, note, now: Date.now() });
    const saved = r.record;
    if (r.status === "ok" && saved) {
      setAnnotations((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
    }
    return r;
  };

  /** 删除一条划线（不影响掌握度 / 章状态 / 试卷）。 */
  const handleRemoveAnnotation = async (a: Annotation) => {
    await removeAnnotation(a.id);
    setAnnotations((prev) => prev.filter((x) => x.id !== a.id));
  };

  /** 回看：滚到正文对应位置并闪烁；命不中则什么也不做（条目仍保留在右栏）。 */
  const locateAnnotation = (a: Annotation) => {
    const root = bodyRef.current;
    if (root) scrollToQuote(root, a.quote, contextOf(doc, chapter, a));
  };

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
          <span
            className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}
          >
            {badge.label}
          </span>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <ChapterReaderMain
          doc={doc}
          chapter={chapter}
          body={body}
          keyPoints={keyPoints}
          annotations={annotations}
          highlight={highlight}
          at={at}
          bodyRef={bodyRef}
          bodyBoxRef={bodyBoxRef}
          onLocatedIds={setLocatedIds}
          onCreateAnnotation={handleCreateAnnotation}
        />
        <ChapterReaderSidebar
          doc={doc}
          chapter={chapter}
          learner={learner}
          body={body}
          keyPoints={keyPoints}
          annotations={annotations}
          locatedIds={locatedIds}
          activeChip={activeChip}
          onActiveChip={setActiveChip}
          onHighlight={(start, end) => setHighlight({ start, end })}
          onLocate={locateAnnotation}
          onUpdateNote={handleUpdateNote}
          onRemove={(a) => void handleRemoveAnnotation(a)}
        />
      </div>

      <ChapterReaderActions
        doc={doc}
        chapter={chapter}
        learner={learner}
        onMarkReady={() => void markReady()}
        onMarkReviewed={() => void markReviewed()}
      />
    </div>
  );
}
