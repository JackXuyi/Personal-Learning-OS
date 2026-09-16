/**
 * 章节人工编辑引擎（chapter-edit-engine）—— 纯函数，零 React / 零 IO / 零 AI。
 *
 * 与 splitter-engine 的分工：
 * - splitter-engine 管「文档 → 章节」的初次生产（含 AI 精修应用）；
 * - 本模块管「章节 → 章节」的人工修正（重命名 / 区间合并 / 重排）。
 * 二者共享本模块的 `renumberChapters` 与区间合并语义（单一真源），
 * 避免「同一动作从不同入口进去产生两种结果」。
 *
 * 设计约束（docs/chapter-edit-design-2026-09.md §4.3.1）：
 * - 全部为纯函数，不修改入参（返回新数组 / 新对象）；
 * - 入参章节数组**必须按 order 升序**，调用方负责保证；
 * - 合并后 keyPoints 与 keyPointRefs[].point 保持同步（`chapter.ts:77` 契约）。
 */
import type { Chapter, ChapterStatus, KeyPointRef } from "../domain";
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

/** 数组去重（保序）。 */
function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}
