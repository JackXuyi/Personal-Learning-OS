/**
 * 章节人工编辑引擎（chapter-edit-engine）—— 纯函数，零 React / 零 IO / 零 AI。
 *
 * 与 splitter-engine 的分工：
 * - splitter-engine 管「文档 → 章节」的初次生产（含 AI 精修应用）；
 * - 本模块管「章节 → 章节」的人工修正（重命名 / 区间合并 / 重排 / 拆分）。
 * 二者共享本模块的 `renumberChapters` 与区间合并语义（单一真源），
 * 避免「同一动作从不同入口进去产生两种结果」。
 *
 * 设计约束（docs/chapter-edit-design-2026-09.md §4.3.1；拆分见 §13）：
 * - 全部为纯函数，不修改入参（返回新数组 / 新对象）；
 * - 入参章节数组**必须按 order 升序**，调用方负责保证；
 * - 合并后 keyPoints 与 keyPointRefs[].point 保持同步（`chapter.ts:77` 契约）。
 */
import { newId } from "../domain";
import type { Chapter, ChapterRange, ChapterStatus, KeyPointRef } from "../domain";
import { cleanKeyPoints, normalizeKeyPointText } from "../lib/text-quality";

/** 合并后 keyPoints 上限（与 applyChapterRefine 的既有口径一致，避免两套标准）。 */
export const MERGED_KEY_POINTS_CAP = 6;

/** status 保守序：数值越小越"没学完"（合并取最低者）。 */
const STATUS_RANK: Record<ChapterStatus, number> = {
  "not-started": 0,
  learning: 1,
  retake: 2,
  ready: 3,
  mastered: 4,
};

/**
 * 重写 order 为连续 1..n（merge / reorder 后保持不变量）。
 * 注意：保持传入数组顺序，**不做排序** —— 调用方负责传入有序列表。
 */
export function renumberChapters(chapters: readonly Chapter[]): Chapter[] {
  return chapters.map((c, i) => ({ ...c, order: i + 1 }));
}

/** 重命名章节（返回新数组；不改 order / 区间 / 其他字段）。空串或纯空白 → 保持原名。 */
export function renameChapter(chapters: Chapter[], chapterId: string, title: string): Chapter[] {
  return chapters.map((c) => (c.id === chapterId ? { ...c, title: title.trim() || c.title } : c));
}

/** 区间合并结果。 */
export interface MergeRangeResult {
  chapters: Chapter[];
  /** 合并后的章（未发生合并时为 undefined）。 */
  merged?: Chapter;
  /** 被并吞的章 id（不含保留章）—— 掌握度迁移的输入。 */
  absorbedIds: string[];
}

/**
 * 合并 [fromId, toId] 区间为一章（**含区间内所有章**，不要求相邻）。
 * 入参须按 order 升序；任一 id 不存在或 from 在 to 之后 → 原样返回、不改数据。
 *
 * 字段合并规则（逐字段契约，见方案 §4.3.1）：
 * - id / title 取首章（保留最靠前的稳定标识，避免新 id 让历史试卷/证据全断）；
 * - contentRef 取区间并集（= 首章 start .. 尾章 end，因切分区间连续）；
 * - keyPoints 区间内所有章并集 → `cleanKeyPoints` 清洗（规范化 / 质量门 / 去重 / 截断至上限）；
 * - keyPointRefs 区间并集，并与合并后 keyPoints **逐一对齐**（对不上的丢弃）；
 * - unitIds 区间并集去重；status 取区间内最低；createdAt 取区间内最早。
 */
export function mergeChapterRange(
  chapters: Chapter[],
  fromId: string,
  toId: string,
): MergeRangeResult {
  const ids = chapters.map((c) => c.id);
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from === -1 || to === -1 || from > to) return { chapters, absorbedIds: [] };

  const range = chapters.slice(from, to + 1);
  const head = range[0];
  const tail = range[range.length - 1];

  // keyPoints：全区间并集 → 清洗单一真源（规范化 → 质量门 → 去重 → 截断）。
  const keyPoints = cleanKeyPoints(
    range.flatMap((c) => c.keyPoints),
    { maxItems: MERGED_KEY_POINTS_CAP, dedupe: true },
  );

  // keyPointRefs：全区间并集（各自按规范化后的 point 建索引），再对齐到保留的 keyPoints。
  const refByPoint = new Map<string, KeyPointRef>();
  for (const c of range) {
    for (const ref of c.keyPointRefs ?? []) {
      const key = normalizeKeyPointText(ref.point);
      if (!refByPoint.has(key)) refByPoint.set(key, ref);
    }
  }
  const keyPointRefs = keyPoints
    .map((p) => refByPoint.get(p))
    .filter((r): r is KeyPointRef => Boolean(r));

  const merged: Chapter = {
    ...head,
    contentRef: { start: head.contentRef.start, end: tail.contentRef.end },
    keyPoints,
    unitIds: dedupe(range.flatMap((c) => c.unitIds)),
    status: range.reduce(
      (low, c) => (STATUS_RANK[c.status] < STATUS_RANK[low] ? c.status : low),
      head.status,
    ),
    createdAt: Math.min(...range.map((c) => c.createdAt)),
  };
  // 同步契约：refs 为空则不保留首章可能残留的旧 refs（否则 keyPoints 与 refs 脱同步）。
  if (keyPointRefs.length > 0) merged.keyPointRefs = keyPointRefs;
  else delete merged.keyPointRefs;

  const next = renumberChapters([...chapters.slice(0, from), merged, ...chapters.slice(to + 1)]);
  return { chapters: next, merged, absorbedIds: range.slice(1).map((c) => c.id) };
}

/** 按指定 id 顺序重排章节并重写 order；未列出的保持原相对顺序附后。 */
export function reorderChapters(chapters: Chapter[], orderedIds: string[]): Chapter[] {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const next: Chapter[] = [];
  for (const id of orderedIds) {
    const c = byId.get(id);
    if (c) {
      next.push(c);
      byId.delete(id);
    }
  }
  for (const c of byId.values()) next.push(c); // 未列出的保持在后
  return renumberChapters(next);
}

// ---------------------------------------------------------------- 手动拆分（F7-b）

/** 拆分结果。 */
export interface SplitChapterResult {
  chapters: Chapter[];
  /** 新建的下半章 id；offset 无效 / 章不存在而未拆分时为 undefined。 */
  newChapterId?: string;
}

/**
 * 把一章按绝对偏移切为两章（纯函数）。
 *
 * 字段归属（逐字段契约，docs/chapter-edit-design-2026-09.md §13）：
 * - **上半章保留原 id / title / status / createdAt 与全部 unitIds** —— 原章的学习历史
 *   以 `chapterId` 为键（`learnerState.byUnit`），保留 id 使掌握度与历史**天然留在上半章**，
 *   无需任何掌握度迁移；
 * - **下半章为新 id**（`newId("chp")`），status 重置 `not-started`、unitIds 置空
 *   （概念无偏移信息，保守全部留在上半章，下半章可重新精修 / 抽取）；
 * - `keyPoints` / `keyPointRefs`：有引用的按 `ref.start < offset` 归属两侧（两两对齐，
 *   保持 `chapter.ts:77` 同步契约）；**无引用的要点（本地兜底摘要）无偏移信息 → 保守留上半章**；
 * - `contentRef`：上半 `{start, offset}`、下半 `{offset, end}` —— 并集仍落在原区间内，
 *   正文零丢失、切片契约不破；
 * - `title`：下半章取 `newTitle`（空 / 缺省则沿用原章标题）；上半章标题不变。
 *
 * offset 必须**严格落在区间内部**（`start < offset < end`），否则会产生空章 → 视为无效，
 * 原样返回（`newChapterId` 为 undefined）。入参须按 order 升序；返回新数组并重写 order 1..n。
 */
export function splitChapterAt(
  chapters: Chapter[],
  chapterId: string,
  offset: number,
  newTitle?: string,
): SplitChapterResult {
  const idx = chapters.findIndex((c) => c.id === chapterId);
  if (idx === -1) return { chapters };
  const target = chapters[idx];
  const { start, end } = target.contentRef;
  if (!Number.isFinite(offset) || offset <= start || offset >= end) return { chapters };

  const { headPoints, headRefs, tailPoints, tailRefs } = partitionChapterKeyPoints(target, offset);

  const head: Chapter = { ...target, contentRef: { start, end: offset } };
  if (headPoints.length > 0) {
    head.keyPoints = headPoints;
    if (headRefs.length > 0) head.keyPointRefs = headRefs;
    else delete head.keyPointRefs;
  } else {
    head.keyPoints = [];
    delete head.keyPointRefs;
  }

  const tail: Chapter = {
    id: newId("chp"),
    documentId: target.documentId,
    order: 0, // renumberChapters 会重写
    title: newTitle?.trim() || target.title,
    contentRef: { start: offset, end },
    keyPoints: tailPoints,
    unitIds: [],
    status: "not-started",
    createdAt: target.createdAt,
  };
  if (tailRefs.length > 0) tail.keyPointRefs = tailRefs;

  const next = renumberChapters([
    ...chapters.slice(0, idx),
    head,
    tail,
    ...chapters.slice(idx + 1),
  ]);
  return { chapters: next, newChapterId: tail.id };
}

/**
 * 按偏移把章的 keyPoints / keyPointRefs 拆到上下两半。
 * - 有引用（`ref.start` 已知）→ 按 `ref.start < offset` 归属；
 * - 无引用的要点 → 无法归属，保守留在上半；
 * - 两侧 refs 均按各自 keyPoints 逐条对齐（保持 keyPoints↔refs 同步契约）。
 */
function partitionChapterKeyPoints(
  chapter: Pick<Chapter, "keyPoints" | "keyPointRefs">,
  offset: number,
): { headPoints: string[]; headRefs: KeyPointRef[]; tailPoints: string[]; tailRefs: KeyPointRef[] } {
  const refByPoint = new Map<string, KeyPointRef>();
  for (const ref of chapter.keyPointRefs ?? []) {
    refByPoint.set(normalizeKeyPointText(ref.point), ref);
  }

  const headOwn: string[] = [];
  const tailPoints: string[] = [];
  const unattributed: string[] = [];
  for (const point of chapter.keyPoints) {
    const ref = refByPoint.get(normalizeKeyPointText(point));
    if (!ref) {
      unattributed.push(point); // 本地兜底摘要（无偏移）→ 保守留上半
      continue;
    }
    if (ref.start < offset) headOwn.push(point);
    else tailPoints.push(point);
  }

  const headPoints = [...headOwn, ...unattributed];
  return {
    headPoints,
    headRefs: refsForPoints(headPoints, refByPoint),
    tailPoints,
    tailRefs: refsForPoints(tailPoints, refByPoint),
  };
}

/** 按 keyPoints 顺序取出对应 refs（无引用的要点跳过）—— 与 mergeChapterRange 对齐口径一致。 */
function refsForPoints(points: readonly string[], refByPoint: Map<string, KeyPointRef>): KeyPointRef[] {
  return points
    .map((p) => refByPoint.get(normalizeKeyPointText(p)))
    .filter((r): r is KeyPointRef => Boolean(r));
}

/** 拆分候选切点的默认上限（防止超长章在对话框里铺出上百行）。 */
export const SPLIT_CANDIDATE_LIMIT = 40;

/**
 * 章内可拆分的候选切点（**绝对偏移**，升序去重，严格落在区间内部）。
 *
 * 优先级：空行分段处 →（无则）单个换行处 →（再无则）区间中点。返回的偏移取分隔符
 * **之后**的位置，故下半章从其第一行开始、不以前导空行开头。
 *
 * `max` 限制候选数量；超出时按等距采样（保留首尾），避免长章对话框铺满。
 */
export function splitCandidatesOf(
  text: string,
  range: ChapterRange,
  max: number = SPLIT_CANDIDATE_LIMIT,
): number[] {
  const len = text.length;
  const start = Math.max(0, Math.min(range.start, len));
  const end = Math.max(start, Math.min(range.end, len));
  if (end - start < 2) return [];
  const body = text.slice(start, end);

  let offsets = boundaryOffsetsAfter(body, /\n[ \t]*\n/g);
  if (offsets.length === 0) offsets = boundaryOffsetsAfter(body, /\n/g);
  if (offsets.length === 0) {
    const mid = start + Math.floor((end - start) / 2);
    return mid > start && mid < end ? [mid] : [];
  }

  const abs = [...new Set(offsets.map((o) => start + o))]
    .filter((o) => o > start && o < end)
    .sort((a, b) => a - b);
  return sampleEvenly(abs, max);
}

/** 收集分隔符「之后」的偏移（body 内，相对切片起点）。 */
function boundaryOffsetsAfter(body: string, separator: RegExp): number[] {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = separator.exec(body)) !== null) out.push(m.index + m[0].length);
  return out;
}

/** 等距采样（保留首尾）；超过 max 时只取 max 条。 */
function sampleEvenly(items: number[], max: number): number[] {
  if (items.length <= max) return items;
  if (max <= 1) return items.slice(0, Math.max(0, max));
  const out: number[] = [];
  for (let i = 0; i < max; i += 1) {
    out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  }
  return [...new Set(out)];
}

/** 数组去重（保序）。 */
function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}
