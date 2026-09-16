/**
 * 划线批注编排（annotation-service）—— 选区 quote → 定位回原文 → 落库 / 改笔记 /
 * 删除 / 重切分后重定位。
 *
 * 设计（docs/learn-highlight-note-design-2026-09.md §4.2 / §5 / §8.5）：
 * - **零 AI / 零网络**（D9）：**不 import `src/ai/*`** —— 本能力与自测卡同类，
 *   是 F5 四条里唯一在未配置模型时也 100% 可用的一条。
 * - **零伪造区间**：`quote` 必须在章正文里由 `locateQuote` 定位到，且回校
 *   `textPreview.slice(start, end) === quote`。**落库的 `quote` 以原文实际切片为准**
 *   （不是用户选区的字面）—— 折叠档命中时二者可能不同，让 `quote` 永远等于原文。
 * - **诚意降级**：定位不到 → `unanchored` 且**零写入**；回看时命不中只标注
 *   「正文中未定位到」，**不删记录**（用户的手写笔记不能因为渲染差异被清掉）。
 * - **不写证据流、不动掌握度**（D4）：`mastery` 唯一写方仍是卷面。
 * - 错误只产**分类**（状态枚举），文案由 UI 走 i18n 映射。
 *
 * 本模块是纯 TS（无 React / 无 i18n / 无 store 订阅）→ 可被
 * `node --experimental-strip-types` 直跑单测。
 */
import type { Annotation, Chapter, SourceDocument } from "../../domain";
import { ANNOTATION_LIMITS, annotationId } from "../../domain";
import type { StorageAdapter } from "../../storage";
import { storage } from "../../stores/useLoopStore";
import { locateQuote } from "./evidence-anchor";

/** 创建 / 更新结果状态（UI 据此分支渲染，不做隐式兜底）。 */
export type AnnotationStatus =
  | "ok" // 定位成功且已落库
  | "unanchored" // quote 无法锚回章正文 → **不落库**，如实提示
  | "no-body" // 本章无正文快照（textPreview 为空）
  | "duplicate" // 同区间已存在 → 不新建、不覆盖笔记（幂等，滚动到已有条目）
  | "too-short" // quote < minQuoteChars
  | "too-long" // quote > maxQuoteChars 或 note > maxNoteChars
  | "capped" // 本章批注数达上限
  | "error"; // 存储 / 读取异常

export interface AnnotationResult {
  status: AnnotationStatus;
  /** 落库后的记录（仅 `ok` / `duplicate` 时存在）。 */
  record?: Annotation;
  at: number;
}

export interface CreateAnnotationInput {
  doc: Pick<SourceDocument, "id" | "textPreview">;
  chapter: Pick<Chapter, "id" | "contentRef">;
  /** 用户选中的原文（verbatim，来自 `window.getSelection().toString()`）。 */
  quote: string;
  /** 同时写入的笔记（缺省 = 纯高亮）。 */
  note?: string;
  now: number;
  /** 注入用（单测传 `InMemoryStorage`）。 */
  storage?: StorageAdapter;
}

/**
 * 建一条划线（可选带笔记）。
 *
 * 判定顺序（每一步都**先于任何写入**，见 §5.1）：
 * 护栏 → 正文存在 → 章上限 → `locateQuote` 锚定 → 回校取原文字面 → 幂等 →
 * 落库。
 */
export async function createAnnotation(input: CreateAnnotationInput): Promise<AnnotationResult> {
  const store = input.storage ?? storage;
  const now = input.now;
  const quote = input.quote.trim();
  const note = input.note ?? "";

  // ① 护栏：过长 / 过短 / 笔记超长 —— 零写入（UI 已在提交前拦截，service 侧同样拒绝）
  if (quote.length < ANNOTATION_LIMITS.minQuoteChars) return { status: "too-short", at: now };
  if (quote.length > ANNOTATION_LIMITS.maxQuoteChars || note.length > ANNOTATION_LIMITS.maxNoteChars) {
    return { status: "too-long", at: now };
  }

  // ② 正文快照必须存在（没有原文就无从锚定，也不可能"改原文"）
  const text = input.doc.textPreview ?? "";
  const body = text.slice(input.chapter.contentRef.start, input.chapter.contentRef.end);
  if (!text || !body) return { status: "no-body", at: now };

  try {
    // ③ 章上限：达上限如实拒绝（不静默丢弃最旧 —— 那是数据损失，不是限流）
    const existing = await store.listAnnotationsByChapter(input.chapter.id);

    // ④ 锚定：不信选区自带的任何偏移，一律由 quote 反查（对齐 KeyPointRef 口径）
    const hit = locateQuote(body, quote);
    if (!hit) return { status: "unanchored", at: now };

    const start = input.chapter.contentRef.start + hit.start;
    const end = input.chapter.contentRef.start + hit.end;
    // 回校：折叠档命中时用户选区字面可能与原文不同 → 以**原文实际切片**为准
    const actual = text.slice(start, end);
    if (!actual) return { status: "unanchored", at: now };

    // ⑤ 幂等：区间派生 id 相同即同一条（重复划线不新建、**不覆盖已有笔记**）
    const id = annotationId(input.doc.id, start, end);
    const same = existing.find((a) => a.id === id);
    if (same) return { status: "duplicate", record: same, at: now };

    if (existing.length >= ANNOTATION_LIMITS.maxPerChapter) return { status: "capped", at: now };

    const record: Annotation = {
      id,
      documentId: input.doc.id,
      chapterId: input.chapter.id,
      quote: actual,
      start,
      end,
      note,
      createdAt: now,
      updatedAt: now,
    };
    await store.saveAnnotation(record);
    return { status: "ok", record, at: now };
  } catch {
    // 存储异常 → 如实报错，不伪造成功（UI 内联提示「保存失败，请重试」）
    return { status: "error", at: now };
  }
}

/**
 * 改笔记（**不动区间**：`id` / `quote` / `start` / `end` 全部保持不变，
 * 这样正文里的高亮不必重建，列表也不会跳动）。
 *
 * 入参带整条 `record` 而非 id：存储契约刻意**不提供** `getAnnotation(id)`
 * —— 调用方（右栏面板）手上就有这条记录，少一次往返也少一个 API 面。
 */
export async function updateAnnotationNote(input: {
  record: Annotation;
  note: string;
  now: number;
  storage?: StorageAdapter;
}): Promise<AnnotationResult> {
  const store = input.storage ?? storage;
  const note = input.note ?? "";
  if (note.length > ANNOTATION_LIMITS.maxNoteChars) return { status: "too-long", at: input.now };

  try {
    // 清空笔记 → note 落成空串，条目退化为纯高亮（**记录保留**，与「删除」区分）
    const saved: Annotation = { ...input.record, note, updatedAt: input.now };
    await store.saveAnnotation(saved);
    return { status: "ok", record: saved, at: input.now };
  } catch {
    return { status: "error", at: input.now };
  }
}

/** 删除一条划线（幂等；不影响掌握度 / 章状态 / 试卷）。 */
export async function removeAnnotation(
  id: string,
  store: StorageAdapter = storage,
): Promise<void> {
  await store.deleteAnnotation(id);
}

/** 只读包装（避免 UI 直接摸 storage）：某章批注，按 `start` 升序。 */
export async function listChapterAnnotations(
  chapterId: string,
  store: StorageAdapter = storage,
): Promise<Annotation[]> {
  return store.listAnnotationsByChapter(chapterId);
}

/** 重切分 / 合并后的重定位统计。 */
export interface RelinkOutcome {
  /** 按 quote 重新定位成功并改写区间的条数。 */
  relinked: number;
  /** 按 quote 再也找不到、已删除的条数。 */
  dropped: number;
}

/**
 * 重切分 / 合并章节后**按 quote 重定位**（UC-05）。
 *
 * 为什么以 `quote` 而非旧偏移为准：重切分后 `contentRef` 全变，旧偏移必然失效；
 * 而 `quote` 是原文字面，天然可搬 —— 这正是「锚定真源是 quote，偏移只是缓存」
 * （docs/library-detail-page-design-2026-09.md §4.3）的兑现。
 *
 * - 命中：改写 `start/end/chapterId`（**id 也随之重派生**，因为它由区间派生）；
 *   旧 id 一并删除，避免同一区间留下两条记录。
 * - 未命中：删除该条（**不保留指不到正文的孤儿**）——这一条与「回看时命不中
 *   不删记录」并不矛盾：那是**渲染差异**（数据仍在正文里），这是**数据已被替换**。
 */
export async function relinkAnnotations(input: {
  documentId: string;
  storage?: StorageAdapter;
  now?: number;
}): Promise<RelinkOutcome> {
  const store = input.storage ?? storage;
  const list = await store.listAnnotations(input.documentId);
  if (list.length === 0) return { relinked: 0, dropped: 0 };

  try {
    const doc = await store.getDocument(input.documentId);
    const text = doc?.textPreview ?? "";
    const chapters = doc ? await store.listChapters(input.documentId) : [];
    if (!text) {
      // 正文快照被整体清空 → 全部失效（如实报数，不静默丢）
      await store.deleteAnnotations(list.map((a) => a.id));
      return { relinked: 0, dropped: list.length };
    }

    const toSave: Annotation[] = [];
    const toDelete: string[] = [];
    let relinked = 0;
    let dropped = 0;

    for (const a of list) {
      const hit = locateQuote(text, a.quote);
      if (!hit) {
        toDelete.push(a.id);
        dropped++;
        continue;
      }
      const chapterId = chapterOfRange(chapters, hit.start, hit.end) ?? a.chapterId;
      const nextId = annotationId(input.documentId, hit.start, hit.end);
      if (nextId === a.id && chapterId === a.chapterId) continue; // 位置未变，无需重写
      if (nextId !== a.id) toDelete.push(a.id);
      toSave.push({ ...a, id: nextId, chapterId, start: hit.start, end: hit.end });
      relinked++;
    }

    if (toDelete.length > 0) await store.deleteAnnotations(toDelete);
    for (const a of toSave) await store.saveAnnotation(a);
    return { relinked, dropped };
  } catch {
    // 存储异常：不动任何记录（宁可留旧偏移，也不半个批次写一半）
    return { relinked: 0, dropped: 0 };
  }
}

/** 区间落在哪一章（完全包含）。找不到返回 `undefined`（调用方回退旧 chapterId）。 */
function chapterOfRange(
  chapters: readonly Chapter[],
  start: number,
  end: number,
): string | undefined {
  return chapters.find((c) => start >= c.contentRef.start && end <= c.contentRef.end)?.id;
}
