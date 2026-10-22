/**
 * 阅读页左栏 —— 章正文 + 整章译文（docs/learn-ai-translation-design-2026-10.md §14.10）。
 *
 * 左栏是**译文状态与动作的唯一持有者**：`view` / `tr` / `trErr` 都在这里，
 * 「译文开关」「渐进进度」「部分失败 + 重翻」「内联错误 + 重试」四个显示分支
 * 也全在这里；容器只负责把跨栏的东西（划线、高亮）搬进来搬出去。
 *
 * ⚠️ 两条 effect 的**声明顺序不可调换**（这是「先清后恢复」的全部实现）：
 *   ① 目标语言变化 / 换章 → 清空译文视图并回到原文（重置）；
 *   ② 缓存命中时自动恢复译文视图（恢复）。
 * 二者触发集相同、① 声明在前 ⇒ 同一轮 commit 先清后恢复，不会互相覆盖。
 *
 * ⚠️ 译文视图下不做两件事（偏移与源串毫无对应关系）：
 *   - 不套划线标记（`markRanges` 的顺序贪心会把「碰巧同形」的片段标错）；
 *   - 不做 `?at=` / 引用的源串高亮（`highlightSourceRange` 会静默错位）。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../../../components/primitives";
import { Button } from "../../../components/ui/button";
import { ANNOTATION_LIMITS, bodyFingerprint, resolveTranslationTarget, translationKeyOf } from "../../../domain";
import type { Annotation, Chapter, SourceDocument, TranslationLang } from "../../../domain";
import { storage } from "../../../stores/useLoopStore";
import { useAiTask } from "../../../stores/useAiTaskStore";
import { useTranslationIndexStore } from "../../../stores/useTranslationIndexStore";
import { buildActiveProvider } from "../../../stores/useSettingsStore";
import { useLangStore } from "../../../stores/useLangStore";
import { useAiReady } from "../../../hooks/useAiReady";
import { useI18n } from "../../../i18n";
import {
  highlightSourceRange,
  markRanges,
  unwrapMarks,
  HIGHLIGHT_WINDOW,
} from "../highlight";
import type { AnnotationStatus } from "../annotation-service";
import type { TranslationErrorKind } from "../translation-service";
import {
  persistTranslation,
  readCachedTranslation,
  translateChapterBody,
  translateSnippet,
} from "../translation-service";
import { estimatedMinutesOf } from "../translation-estimate";
import { pickRenderer } from "../render/renderer-registry";
import PlainTextRenderer from "../render/PlainTextRenderer";
import RenderErrorBoundary from "../render/RenderErrorBoundary";
import SelectionToolbar from "./SelectionToolbar";

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

interface Props {
  doc: SourceDocument;
  chapter: Chapter;
  /** 章正文（容器派生，与译文指纹同源）。 */
  body: string;
  keyPoints: string[];
  annotations: readonly Annotation[];
  /** 章内引用高亮（章内相对偏移）；优先级高于 `?at=`。 */
  highlight: { start: number; end: number } | undefined;
  /** 原文锚点（文档绝对偏移）； undefined = 未提供 / 非法值。 */
  at: number | undefined;
  /** 正文容器 —— 高亮副作用的作用域（refs 由容器持有：划线回看也要用）。 */
  bodyRef: React.RefObject<HTMLDivElement | null>;
  /** 正文的**相对定位宿主**（选区浮动工具条以它为参照绝对定位）。 */
  bodyBoxRef: React.RefObject<HTMLDivElement | null>;
  /** 上报正文中**成功定位到**的批注 id（右栏据此标注「正文中未定位到」）。 */
  onLocatedIds: (ids: readonly string[]) => void;
  /** 新建划线（容器注入：容器持有列表，本组件只发起）。 */
  onCreateAnnotation: (quote: string, note: string) => Promise<{ status: AnnotationStatus }>;
}

export default function ChapterReaderMain({
  doc,
  chapter,
  body,
  keyPoints,
  annotations,
  highlight,
  at,
  bodyRef,
  bodyBoxRef,
  onLocatedIds,
  onCreateAnnotation,
}: Props) {
  const { m, lang } = useI18n();
  const t = m.learn.reader;
  /** 整章译文相关文案。 */
  const tt = t.translation;

  // ===== 整章 AI 翻译（docs/learn-ai-translation-design-2026-10.md §14.10）=====
  const uiTarget = useLangStore((s) => s.translationTarget);
  /** 唯一解析入口：`auto` → 界面语言（服务层与 UI 用同一个函数，避免判不同目标）。 */
  const target = resolveTranslationTarget(uiTarget, lang);
  const aiReady = useAiReady();
  const [view, setView] = useState<"source" | "translation">("source");
  const [tr, setTr] = useState<TrView | undefined>();
  const [trErr, setTrErr] = useState<TranslationErrorKind | undefined>();
  const trTask = useAiTask(`translation:${chapter.id}`);
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
  }, [target, chapter.id]);

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
      onLocatedIds(okIdx.map((i) => annotations[i].id));
    });
    return () => cancelAnimationFrame(id);
  }, [annotations, chapter.id, doc.id, view]);

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
    const root = bodyRef.current;
    if (!root) return;
    // 同上：译文视图里源串偏移无对应 DOM 文本，跳过（不静默错位）。
    if (view !== "source") return;
    // body 必须与左栏实际渲染的源串是**同一个表达式**（见下方 <Renderer text={body}>）
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
  }, [highlight, at, chapter.id, chapter.contentRef.start, doc.id, view]);

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
    // `body` 随 doc/chapter 派生（故不入 deps，与切章前的口径一致），
    // 指纹校验在读缓存内部兜底（不符 = 不命中）。
  }, [doc.id, chapter.id, target, trTask.running]);

  /** 与「资料内容」Tab 同源：markdown 走 GFM，其余按格式回落，规则一致。 */
  const Renderer = pickRenderer(doc.format);

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
  const trEstimateMinutes =
    body.length > 0 ? estimatedMinutesOf(body.length, buildActiveProvider().kind) : undefined;

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
          <p data-testid="reader-translation-progress" className="mt-3 text-xs leading-5 text-ink-3">
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
            onCreate={onCreateAnnotation}
            onTranslate={handleTranslateSelection}
            translateEnabled={aiReady}
          />
        ) : null}
      </div>
    </Card>
  );
}
