/**
 * P2 章节阅读（/learn/:chapterId）—— 三步闭环「步骤 1」的逐章学习页（T5，UI Workbench U3）。
 *
 * 布局：左 = 章正文（doc.textPreview 的 contentRef 切片）；右 = 六区（与 Learner Model 相连，
 * docs/ui-workbench-plan-2026-09.md §6-U3 + docs/learn-chapter-qa-design-2026-09.md §7
 * + docs/learn-feynman-restatement-design-2026-09.md §7）：
 *   1) 章状态 —— 状态徽标 + 掌握度 Bar + 口径说明（我学到哪）；
 *   2) Why it matters —— 要点首条 / 正文首句兜底（它讲什么 / 为什么值得学）；
 *   3) Knowledge —— 要点生成可点选知识 chips（N5 unitIds 就绪后以概念为准）；
 *      底部保留「打开本章概念图谱」N5 入口；action 区另有**自测卡入口**
 *      （「自测本章 · N 张」，由带原文出处的要点派生，零 AI；见
 *      docs/learn-flashcard-design-2026-09.md）；
 *   4) 问这一章 —— 章内提问面板（答案只依据用户导入的原文，引用可点回正文高亮）；
 *   5) 讲给我听 —— 费曼式复述面板（用自己的话讲一遍，AI 对照本章原文给差距反馈）；
 *   6) Evidence —— 溯源（《doc》第 x 章）+ 最近一次含本章的测评 Δ 掌握度（证据从哪来）。
 *   7) 我的划线 —— 本章划线批注（左栏选中原文 → 划线 → 可选写笔记；**零 AI 依赖**，
 *      见 docs/learn-highlight-note-design-2026-09.md）。物理位置插在 5 与 6 之间
 *      （方案 §8.8），编号沿用 UI Workbench 的七区规划。
 * 状态机写回：打开阅读（not-started → learning）与「标记学完」（→ ready）
 * 直接整批写 storage（listChapters/saveChapters 契约，docs §5.1）。
 * 原文档位：`?at=<文档绝对偏移>` 跳转 → 换算章内相对偏移后高亮并滚动
 * （与「资料内容 Tab」同一套 `highlightSourceRange` 口径：源串切 quote → DOM 字面匹配）。
 * 底部主行动保留；「标记学完」后提示下一步并刷新章级计划（plan 头项联动）。
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Bar, Card, ErrorState, EvidenceRow, Section } from "../../components/primitives";
import { Button } from "../../components/ui/button";
import {
  ANNOTATION_LIMITS,
  MASTERY_THRESHOLD,
  bodyFingerprint,
  isDueReview,
  resolveTranslationTarget,
  translationKeyOf,
} from "../../domain";
import type { Annotation, Chapter, LearnerState, SourceDocument, TranslationLang } from "../../domain";
import { applyKeyPointRating } from "../../engine";
import { isUsefulKeyPoint } from "../../lib/text-quality";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { useAiTask } from "../../stores/useAiTaskStore";
import { useTranslationIndexStore } from "../../stores/useTranslationIndexStore";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { useAiReady } from "../../hooks/useAiReady";
import { useLangStore } from "../../stores/useLangStore";
import { useI18n } from "../../i18n";
import { chapterBadge } from "./chapter-badge";
import { highlightSourceRange, markRanges, scrollToQuote, unwrapMarks, HIGHLIGHT_WINDOW } from "./highlight";
import { shortDate } from "./library/shared";
import {
  createAnnotation,
  listChapterAnnotations,
  removeAnnotation,
  updateAnnotationNote,
} from "./annotation-service";
import type { TranslationErrorKind } from "./translation-service";
import {
  persistTranslation,
  readCachedTranslation,
  translateChapterBody,
  translateSnippet,
} from "./translation-service";
import ChapterQaPanel from "./reader/ChapterQaPanel";
import ChapterRestatementPanel from "./reader/ChapterRestatementPanel";
import ChapterAnnotationsPanel from "./reader/ChapterAnnotationsPanel";
import SelectionToolbar from "./reader/SelectionToolbar";
import { peekCardStats } from "./flashcard-service";
import { estimatedMinutesOf } from "./translation-estimate";
import { pickRenderer } from "./render/renderer-registry";
import PlainTextRenderer from "./render/PlainTextRenderer";
import RenderErrorBoundary from "./render/RenderErrorBoundary";

/** 本章证据：最近一次含本章的判卷结果（Δ 掌握度）。 */
type ChapterEvidence =
  | { state: "loading" }
  | { state: "none" }
  | { state: "ok"; at: number; prev: number; cur: number };

/**
 * 译文视图状态（v6 起含**渐进渲染**）。
 *
 * `parts` 是逐块累积的译文（`null` = 该块未完成 / 被跳过）：首段约 25 秒即出，
 * 后续块陆续追加 —— 长章不再「白屏等十几分钟」。
 * 从缓存命中时 `parts` 只有一项（全文），`fromCache = true`。
 */
interface TrView {
  target: TranslationLang;
  parts: (string | null)[];
  /** 总块数（0 = 还没拿到第一个进度回调）。 */
  blocks: number;
  /** 失败 / 空输出被跳过的块数（如实标注，不补占位）。 */
  skipped: number;
  /** 从缓存读到（区别在于「这是上次翻的」——影响是否显示「重翻」）。 */
  fromCache: boolean;
}

export default function ChapterReaderPage() {
  const { m, lang } = useI18n();
  const t = m.learn.reader;
  /** 整章译文相关文案。 */
  const tt = t.translation;
  const { chapterId = "" } = useParams();
  const navigate = useNavigate();
  const [chapter, setChapter] = useState<Chapter | undefined>();
  const [doc, setDoc] = useState<SourceDocument | undefined>();
  const [learner, setLearner] = useState<LearnerState | undefined>();
  const [missing, setMissing] = useState(false);
  const [evidence, setEvidence] = useState<ChapterEvidence>({ state: "loading" });
  /** Knowledge 区点选高亮的知识块（-1 = 无）。 */
  const [activeChip, setActiveChip] = useState(-1);
  /**
   * 自测卡计数（F5 第 4 条）—— **只读**统计：已派生的卡数 / 到期数 / 无原文出处条数。
   * 计数真实来自 `keyPoints` ∩ `keyPointRefs`，不编造（入口按钮的显示依据）。
   */
  const [cards, setCards] = useState<
    { total: number; due: number; uncarded: number } | undefined
  >();

  const [searchParams] = useSearchParams();
  /** 原文锚点（文档绝对偏移）；非法值一律当未提供（与 ContentTab 同口径）。 */
  const atRaw = Number(searchParams.get("at") ?? NaN);
  const at = Number.isFinite(atRaw) && atRaw >= 0 ? atRaw : undefined;

  // ===== 整章 AI 翻译（docs/learn-ai-translation-design-2026-10.md §14.10）=====
  /**
   * 译文**落库**（v6 / D3 改判）：`(doc, chapter, target)` 一条，覆盖写；
   * 读时用 `bodyFingerprint` 比对，章节被编辑即视为无缓存（不删行，重翻覆盖）。
   */
  const uiTarget = useLangStore((s) => s.translationTarget);
  /** 唯一解析入口：`auto` → 界面语言（服务层与 UI 用同一个函数，避免判不同目标）。 */
  const target = resolveTranslationTarget(uiTarget, lang);
  const aiReady = useAiReady();
  const [view, setView] = useState<"source" | "translation">("source");
  const [tr, setTr] = useState<TrView | undefined>();
  const [trErr, setTrErr] = useState<TranslationErrorKind | undefined>();
  const trTask = useAiTask(`translation:${chapterId}`);
  /** 译文索引（按钮的「已翻 ✓」态与「重翻」入口都靠它）。 */
  const trIndexRows = useTranslationIndexStore((s) => s.rows);

  /**
   * 索引是**存储层的派生视图**，进页面时载入一次即可（之后靠 upsert / remove 增量维护）。
   * 加 `loaded` 判断是为了避免每次切章都全量读一遍（几百行的 IPC 不值当）。
   */
  useEffect(() => {
    if (!useTranslationIndexStore.getState().loaded) {
      void useTranslationIndexStore.getState().refresh();
    }
  }, []);

  /**
   * 目标语言变化 / 换章 → 清空译文视图并回到原文。
   *
   * 不清空的话，用户把设置从「日本語」改回「跟随界面语言」后会继续读到上一次的
   * 日文译文（"缓存命中，但命中错的目标"）—— 静默错比多一次点击糟得多。
   */
  useEffect(() => {
    setView("source");
    setTr(undefined);
    setTrErr(undefined);
  }, [target, chapterId]);

  /** 正文容器 —— 高亮副作用的作用域。 */
  const bodyRef = useRef<HTMLDivElement>(null);
  /** 正文的**相对定位宿主**（选区浮动工具条以它为参照绝对定位）。 */
  const bodyBoxRef = useRef<HTMLDivElement>(null);
  /** 章内引用高亮（章内相对偏移）；优先级高于 `?at=`。 */
  const [highlight, setHighlight] = useState<{ start: number; end: number } | undefined>();
  /** 本章划线批注（按 `start` 升序，storage 保证 —— 顺序贪心消歧的前提）。 */
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  /** 正文里**成功定位到**的批注 id（其余在右栏标注「正文中未定位到」，**不删记录**）。 */
  const [locatedIds, setLocatedIds] = useState<readonly string[]>([]);

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

  /** 章切换 / `?at=` 变化 → 清掉上一次的章内高亮（避免旧高亮抢占新的锚点）。 */
  useEffect(() => {
    setHighlight(undefined);
  }, [chapter?.id, at]);

  /** 自测卡计数（只读；`peekCardStats` 不写任何东西）。要点重跑后自动刷新。 */
  useEffect(() => {
    if (!chapter || !doc) return;
    let alive = true;
    void peekCardStats({ documentId: doc.id, chapterId: chapter.id }, Date.now()).then((st) => {
      if (alive) setCards({ total: st.total, due: st.due, uncarded: st.uncarded });
    });
    return () => {
      alive = false;
    };
  }, [doc?.id, chapter?.id, chapter?.keyPoints.length, chapter?.keyPointRefs?.length]);

  /** 加载本章划线批注（按章的维度组织 —— 复习回看就在这一章内看）。 */
  useEffect(() => {
    if (!chapter) return;
    let alive = true;
    void listChapterAnnotations(chapter.id).then((list) => {
      if (alive) setAnnotations(list);
    });
    return () => {
      alive = false;
    };
  }, [chapter?.id]);

  /**
   * 应用持久划线（F5 第 2 条）：两帧后执行，与 `?at=` 瞬时高亮同时机。
   *
   * ⚠️ 只剥持久层（`unwrapMarks`）而不动瞬时锚点层 —— 两层分离（D6），
   * 否则任何一次 `?at=` 跳转都会连带抹掉用户划线。
   * ⚠️ `annotations` 已按 `start` 升序（storage 契约）→ `markRanges` 的顺序贪心正确。
   */
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    // 译文视图里不套划线：译文偏移与源串毫无关系，`markRanges` 的贪心匹配
    // 只会把「碰巧同形」的片段标错。切回原文时本 effect 重跑，标记自动补回。
    if (view !== "source") return;
    const id = requestAnimationFrame(() => {
      unwrapMarks(root);
      const okIdx = markRanges(
        root,
        annotations.map((a) => a.quote),
      );
      setLocatedIds(okIdx.map((i) => annotations[i].id));
    });
    return () => cancelAnimationFrame(id);
  }, [annotations, chapter?.id, doc?.id, view]);

  /**
   * 渲染完成后再高亮：Markdown 子树异步提交 DOM，两帧时机与 `ContentTab` 一致。
   *
   * 两条来源**都是源串偏移**（旧实现误当 DOM 偏移用 → 系统性偏前，T12 已修正）：
   *  ① 章内引用：QA `citation.start/end`、复述 `p.start/p.end` —— 均来自
   *     `locateQuote` 的**章内相对源串偏移**（`ChapterQaPanel` / 复述面板）；
   *  ② `?at=`：文档绝对偏移 → `- contentRef.start` 换算为章内相对。
   * 二者统一交给 `highlightSourceRange(root, body, …)` —— 由源串切 quote 再匹配。
   * 越界 / 定位失败 → 返回 false 且不做改动（静默不跳，绝不错位）。
   */
  useEffect(() => {
    if (!chapter || !doc) return;
    const root = bodyRef.current;
    if (!root) return;
    // 同上：译文视图里源串偏移无对应 DOM 文本，跳过（不静默错位）。
    if (view !== "source") return;
    // body 必须与左栏实际渲染的源串是**同一个表达式**（见下方 <Renderer text={body}>）
    const body = doc.textPreview?.slice(chapter.contentRef.start, chapter.contentRef.end) ?? "";
    const start = highlight
      ? highlight.start
      : at !== undefined
        ? at - chapter.contentRef.start
        : undefined;
    if (start === undefined) return;
    const end = highlight ? highlight.end : start + HIGHLIGHT_WINDOW;
    const id = requestAnimationFrame(() => {
      highlightSourceRange(root, body, start, end);
    });
    return () => cancelAnimationFrame(id);
  }, [highlight, at, chapter?.id, chapter?.contentRef.start, doc?.id, view]);

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

  // ===== 划线批注（F5 第 2 条）=====

  /**
   * 某条划线在**源串**中的左侧上下文（供定位消歧用）。
   *
   * `Annotation.start` 是**文档绝对偏移**，先换算成章内相对再取前 60 字
   * （与 `highlightSourceRange` 内部的 `CONTEXT_CHARS` 同量级）。
   */
  const contextOf = (a: Annotation): string => {
    const body = doc?.textPreview?.slice(chapter?.contentRef.start, chapter?.contentRef.end) ?? "";
    const local = a.start - (chapter?.contentRef.start ?? 0);
    return body.slice(Math.max(0, local - 60), local);
  };

  /** 新建划线（含可选笔记）。`duplicate` 不新建，改为滚到已有那条（幂等语义）。 */
  const handleCreateAnnotation = async (quote: string, note: string) => {
    if (!chapter || !doc) return { status: "no-body" as const };
    const r = await createAnnotation({ doc, chapter, quote, note, now: Date.now() });
    const record = r.record;
    if (record && r.status === "ok") {
      // 就地并入列表并按 start 升序（与 storage 契约同序，保证顺序贪心正确）
      setAnnotations((prev) => [...prev, record].sort((x, y) => x.start - y.start));
    }
    if (record && r.status === "duplicate") {
      const root = bodyRef.current;
      if (root) scrollToQuote(root, record.quote, contextOf(record));
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
    if (root) scrollToQuote(root, a.quote, contextOf(a));
  };

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <ErrorState
          title={t.missingTitle}
          desc={t.missingDesc}
          action={
            <Link to="/learn" className="text-sm font-medium text-primary hover:underline">
              {t.backToCatalog}
            </Link>
          }
        />
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
  /**
   * 渲染前过质量门（2026-09-16 缺陷修复）：存量脏要点（PDF 抽取把编号标题糊进
   * 正文 → 断句切出碎片 `"4."`）不再渲染成只有编号的要点芯片，也不再用作导语。
   * 判据与生成侧 `cleanKeyPoints` 共用 `isUsefulKeyPoint`（单一真源）。
   */
  const keyPoints = chapter.keyPoints.filter(isUsefulKeyPoint);
  const whyLead = leadOf(keyPoints, body);
  /** 与「资料内容」Tab 同源：markdown 走 GFM，其余按格式回落，规则一致。 */
  const Renderer = pickRenderer(doc.format);

  /**
   * 缓存命中时**自动恢复**译文视图（v6.1）：切走再回来、换章再切回，已翻过的
   * 章直接落在译文上（0 等待），不用再点一次「译文 ✓」。
   *
   * 两条边界：
   * - **只读缓存，绝不自动翻译**（见 `showTranslation` 的注释）—— 没有缓存或
   *   指纹不符（章节被编辑过）就保持原文视图；
   * - **任务运行中不恢复**：离开时正在翻、回来任务还在跑的话，渐进内容挂在
   *   旧组件实例上已经丢了，切到译文只会看到空白 —— 等任务写完库再点按钮。
   *
   * 与上方的重置 effect 同触发集、声明在其后 ⇒ 同一轮 commit 先清后恢复，
   * 不会互相覆盖。用户手动切回「原文」后本 effect 不会重跑（deps 没变），
   * 不会强行把人拽回译文。
   */
  useEffect(() => {
    if (trTask.running) return;
    let alive = true;
    void (async () => {
      try {
        const cached = await readCachedTranslation({
          documentId: doc.id,
          chapterId: chapter.id,
          target,
          body,
        });
        if (alive && cached) {
          setTr({
            target,
            parts: [cached.text],
            blocks: cached.blocks,
            skipped: cached.skipped,
            fromCache: true,
          });
          setView("translation");
        }
      } catch {
        // 存储不可用 → 保持原文视图（与 showTranslation ② 的降级同口径）。
      }
    })();
    return () => {
      alive = false;
    };
    // `body` 随 doc/chapter 派生，指纹校验在读缓存内部兜底（不符 = 不命中）。
  }, [doc?.id, chapter?.id, target, trTask.running]);

  /**
   * 本章译文是否有可用缓存（按钮的「✓」态）。
   *
   * ⚠️ 比的是 `bodyFingerprint(body)` 而不是「索引里有这一行」：章节可能已被
   * 编辑 / 重切分，索引行还在但内容对不上了 —— 那时指向的是**旧译文**。
   */
  const trCachedRow = trIndexRows.get(translationKeyOf(doc.id, chapter.id, target));
  const trHasCache = !!trCachedRow && trCachedRow.bodyHash === bodyFingerprint(body);
  /** 渐进渲染的合成文本（已完成的块按序拼接，块间空行与 `translateText` 同口径）。 */
  const trText = tr
    ? tr.parts.filter((p): p is string => typeof p === "string" && p.length > 0).join("\n\n")
    : "";
  /** 已完成的块数（跳过的块不计 —— 它们不会产出文本）。 */
  const trDone = tr ? tr.parts.filter((p) => p !== null).length : 0;
  /**
   * 本章预估耗时（分钟）。长章（4 万字级）不预告时长 = 用户点下去才发现要等半小时；
   * 这里与设置页整库共用 `estimatedMinutesOf`（本地模型实测吞吐，云 API 不估）。
   */
  const trEstimateMinutes = body.length > 0
    ? estimatedMinutesOf(body.length, buildActiveProvider().kind)
    : undefined;

  /** 译钮文案：翻译中 / 已有译文 / 长章带预估 / 默认。 */
  const trButtonLabel = (): string => {
    if (trTask.running) return trTask.phase ?? tt.running;
    if (view === "translation" || trHasCache) return tt.cached;
    // 2 分钟以下的章不标 —— 「约 1 分钟」是噪音，用户本来也愿意等。
    if (trEstimateMinutes !== undefined && trEstimateMinutes >= 2) {
      return tt.targetLong(Math.round(trEstimateMinutes));
    }
    return tt.target;
  };

  // ===== 翻译动作（handler 放在 body / keyPoints 之后：它们要用这两个值）=====

  /**
   * 服务层分类 → 文案（穷尽 switch：新增 `TranslationErrorKind` 时 TS 报未覆盖）。
   *
   * ⚠️ `too-long` 现在**只剩划选片段**一条路径：整章不再有长度门槛（超长章按批
   * 拆开翻）。所以这里带的自始至终是**选区上限**，不是 `bodyMaxChars` ——
   * 拿错的数字去解释一个已经不会发生的失败，比不解释更糟。
   */
  const translationErrorText = (kind: TranslationErrorKind): string => {
    switch (kind) {
      case "no-body":
        return tt.errors["no-body"];
      case "too-long":
        return tt.tooLong(ANNOTATION_LIMITS.maxQuoteChars);
      case "no-ai":
        return tt.errors["no-ai"];
      case "not-configured":
        return tt.errors["not-configured"];
      case "parse":
        return tt.errors.parse;
      case "fetch":
        return tt.errors.fetch;
      case "generic":
        return tt.errors.generic;
    }
  };

  /**
   * 整章翻译 —— **只在用户点击时触发**（不自动）。
   *
   * 自动翻译是体验灾难：长章要串行调十几次本地模型，仅打开页面就烧几分钟。
   *
   * 三条路径（顺序不可调换）：
   * ① 内存里已有同目标译文 → 直接切视图（0 等待）；
   * ② 存储层有缓存且指纹一致 → 读出来直接渲染（0 等待，这是 v6 与首版最大的差别）；
   * ③ 都没有 → 调 AI，**渐进上屏**（首段即出，后续块陆续追加），完成后立即写库。
   */
  const showTranslation = async (opts?: { force?: boolean }) => {
    if (!opts?.force && tr && tr.target === target) {
      setView("translation");
      return;
    }
    setTrErr(undefined);

    // ② 缓存优先
    if (!opts?.force) {
      try {
        const cached = await readCachedTranslation({
          documentId: doc.id,
          chapterId: chapter.id,
          target,
          body,
        });
        if (cached) {
          setTr({
            target,
            parts: [cached.text],
            blocks: cached.blocks,
            skipped: cached.skipped,
            fromCache: true,
          });
          setView("translation");
          return;
        }
      } catch {
        // 读缓存失败当成「没缓存」：多翻一次远好过报错挡住阅读。
      }
    }

    // ③ 调 AI（渐进）
    setTr({ target, parts: [], blocks: 0, skipped: 0, fromCache: false });
    setView("translation");
    const r = await trTask
      .run(async (report) =>
        translateChapterBody({
          body,
          target,
          ...(chapter.title ? { chapterTitle: chapter.title } : {}),
          ...(keyPoints.length > 0 ? { keyPoints } : {}),
          // 块进度接到全局 AI 任务表：与全站 loading 文案同一口径。
          // ⚠️ `done` 已是**完成数**（v6 修掉了「上报在块发起前」的旧语义）。
          onProgress: (done, total) => {
            report(tt.runningAt(done, total), total > 0 ? done / total : undefined);
            setTr((cur) => (cur && cur.target === target ? { ...cur, blocks: total } : cur));
          },
          // 逐块上屏：这是「慢」的主要解法 —— 总时长不变，但用户不再盯着空白。
          onBlockDone: (index, text) =>
            setTr((cur) => {
              if (!cur || cur.target !== target) return cur;
              const parts = [...cur.parts];
              while (parts.length <= index) parts.push(null);
              parts[index] = text;
              return { ...cur, parts };
            }),
        }),
      )
      .catch(() => undefined);
    if (!r) return; // 重入被拦（task-already-running）→ 保持现状，不误导
    if (r.status === "error") {
      setTrErr(r.errorKind);
      setTr(undefined);
      return;
    }

    const saved = await persistTranslation({
      documentId: doc.id,
      chapterId: chapter.id,
      body,
      result: r,
    });
    // 收口成全章文本（渐进过程中的 `parts` 只用于中途显示）。
    setTr({
      target,
      parts: [r.text],
      blocks: r.blocks,
      skipped: r.skippedBlocks,
      fromCache: false,
    });
    if (saved) useTranslationIndexStore.getState().upsert(saved);
  };

  /**
   * 重翻：先删缓存再翻。
   *
   * 唯一的用途是「上次有段落没翻出来」（`skipped > 0`）—— 不删缓存的话新版
   * 写进去也会被当成一次普通覆盖，但那需要用户先知道「这次一定会更好」。
   */
  const retranslate = async () => {
    await storage.deleteTranslation(doc.id, chapter.id, target).catch(() => undefined);
    useTranslationIndexStore.getState().remove(doc.id, chapter.id, target);
    setTr(undefined);
    await showTranslation({ force: true });
  };

  /**
   * 划选片段翻译（注入给 `SelectionToolbar`）。
   *
   * 错误在**这里**映射成文案再交给工具条：i18n 映射只该有一份，工具条不重复。
   */
  const handleTranslateSelection = async (quote: string) => {
    const r = await translateSnippet({ text: quote, target });
    if (r.status === "ok") return { status: "ok" as const, text: r.text };
    return { status: "error" as const, message: translationErrorText(r.errorKind) };
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
          <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
            {badge.label}
          </span>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* 左：章正文 */}
        <Card className="px-4 py-5 sm:px-8 sm:py-7">
          <div className="flex items-start justify-between gap-3">
            <h1 className="min-w-0 text-xl font-semibold tracking-tight text-ink-1">
              {chapter.title || m.chapter.ordinal(chapter.order)}
            </h1>
            {/* 译文开关：有译文时变成「原文 / 译文」切换组（方案 §7.2） */}
            <div className="flex shrink-0 items-center gap-1">
              {view === "translation" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="reader-view-source"
                  onClick={() => setView("source")}
                >
                  {tt.source}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant={view === "translation" ? "secondary" : "ghost"}
                aria-pressed={view === "translation"}
                disabled={!aiReady}
                loading={trTask.running}
                data-testid="reader-translation-toggle"
                onClick={() => void showTranslation()}
              >
                {trButtonLabel()}
              </Button>
            </div>
          </div>
          <div ref={bodyBoxRef} className="relative mt-4 border-t border-line pt-5">
            <div ref={bodyRef} className="break-words">
              {view === "translation" && tr ? (
                /**
                 * 译文复用同一渲染器（D5-A）：markdown 资料的标题 / 列表 / 代码块
                 * 在译文里保持结构（提示词要求保留语法）。渲染失败仍有纯文本兜底。
                 *
                 * 渐进期间 `trText` 只含**已完成**的块 —— 每完成一块就重新渲染一次，
                 * 用户从第一段开始就能读（而不是等全章）。
                 */
                <RenderErrorBoundary
                  resetKey={`tr:${doc.id}:${chapter.id}:${tr.target}`}
                  fallback={<PlainTextRenderer text={trText} doc={doc} />}
                >
                  <Renderer text={trText} doc={doc} />
                </RenderErrorBoundary>
              ) : body.length > 0 ? (
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
            {/* 渐进渲染进度：只在「还在翻、且已有内容可看」时出现（首块之前是按钮上的进度） */}
            {view === "translation" && trTask.running && tr && tr.blocks > 1 && trDone < tr.blocks ? (
              <p
                data-testid="reader-translation-progress"
                className="mt-3 text-xs leading-5 text-ink-3"
              >
                {tt.progressHint(trDone, tr.blocks)}
              </p>
            ) : null}
            {/* 部分块失败：如实标注（不补占位、不假装完整）+ 重翻入口 */}
            {view === "translation" && tr && tr.skipped > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs leading-5 text-ink-3">
                <span data-testid="reader-translation-skipped">
                  {tt.skipped(tr.skipped, tr.blocks)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="reader-translation-refresh"
                  onClick={() => void retranslate()}
                >
                  {tt.refresh}
                </Button>
              </div>
            ) : null}
            {/* 失败：就近内联 + 重试（不用 Toast，与既有面板一致） */}
            {trErr ? (
              <div
                data-testid="reader-translation-error"
                className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-2"
              >
                <span>{translationErrorText(trErr)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="reader-translation-retry"
                  onClick={() => void showTranslation()}
                >
                  {tt.retry}
                </Button>
              </div>
            ) : null}
            {/* AI 未就绪：说明原因 + 去配置（按钮同时禁用，不给无效点击） */}
            {view === "source" && !aiReady && body.length > 0 ? (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <span>{tt.noAi}</span>
                <Link to="/settings/ai" className="font-medium text-primary hover:underline">
                  {tt.goConfigure}
                </Link>
              </p>
            ) : null}
            {/**
             * 选区浮动工具条（相对 bodyBoxRef 绝对定位；选区必须落在 bodyRef 内）。
             *
             * ⚠️ **译文视图下不挂载**：译文字符偏移与 `doc.textPreview` 毫无对应关系，
             * 在这里划线只会产出锚不回原文的假引用（方案 §3.3 / D4-A 的直接后果）。
             */}
            {view === "source" ? (
              <SelectionToolbar
                rootRef={bodyRef}
                hostRef={bodyBoxRef}
                onCreate={handleCreateAnnotation}
                onTranslate={handleTranslateSelection}
                translateEnabled={aiReady}
              />
            ) : null}
          </div>
        </Card>

        {/* 右：章状态 / Why it matters / Knowledge / 问这一章 / 讲给我听 / Evidence 六区 */}
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
            onHighlight={(start, end) => setHighlight({ start, end })}
            onJumpChapter={(targetId, atAbs) =>
              navigate(`/learn/chapter/${targetId}?at=${atAbs}`)
            }
          />

          {/* 5 · 讲给我听（费曼式复述；AI 对照本章原文给出可锚回的差距反馈） */}
          <ChapterRestatementPanel
            doc={doc}
            chapter={chapter}
            onHighlight={(start, end) => setHighlight({ start, end })}
          />

          {/* 7 · 我的划线（F5 第 2 条：选中原文 → 划线 → 可选笔记；零 AI）。
              物理位置在 5 与 6 之间（方案 §8.8 定案），编号沿用七区规划。 */}
          <ChapterAnnotationsPanel
            annotations={annotations}
            hasBody={body.length > 0}
            locatedIds={locatedIds}
            onLocate={locateAnnotation}
            onUpdateNote={handleUpdateNote}
            onRemove={handleRemoveAnnotation}
          />

          {/* 6 · Evidence（证据从哪来：溯源 + 最近测评 Δ） */}
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

      {/* 底部主行动：窄屏换行，按钮不挤压提示文案
          ⚠️ sticky 底栏内容随章节/复习态变化 → key 重挂载防 WKWebView 残影瓦片（详见 QuizAnswerPage 底栏注释）。 */}
      <div
        key={`${chapter.id}:${chapter.status}:${dueReview ? "due" : "ok"}`}
        className="sticky bottom-4 z-10 mt-6 flex transform-gpu flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-lg sm:px-5"
      >
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
 *
 * 入参是**已过质量门**的要点（调用方过滤，见组件内 `keyPoints`）——
 * 否则脏碎片会成为整段导语。
 */
function leadOf(keyPoints: readonly string[], body: string): string | undefined {
  if (keyPoints.length > 0) return keyPoints[0];
  const first = body
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s && !/^#{1,6}\s/.test(s));
  if (!first) return undefined;
  return first.length > 96 ? `${first.slice(0, 96)}…` : first;
}
