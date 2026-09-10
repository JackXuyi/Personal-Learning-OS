/**
 * 章正文切片 —— 纯函数（只依赖 domain 类型，无 React / 无 storage，可 node 直跑单测）。
 *
 * 为什么抽出来：章正文的「取哪一段」在三个地方口径必须一致 ——
 * ① 章行展开预览（`ChapterRow`）、② 列表统计「共 N 字」（`SplitTab`）、
 * ③ 单测。三处各写一遍区间计算迟早漂移，故收敛到这里。
 *
 * 越界策略：`contentRef` 是在切分时算出的，若之后「替换正文」导致文本变短，
 * 旧区间会超出实际长度 —— 此处**夹取**而不是抛错（TC-EDGE-02），
 * 因为 UI 侧不应为历史数据买单。
 */
import type { Chapter, SourceDocument } from "../../domain";

/** 预览上限：单章在详情页一次最多渲染这么多字符（D3 决策）。 */
export const CHAPTER_PREVIEW_CHARS = 1200;

/** 章正文切片结果。 */
export interface ChapterPreview {
  /** 实际用于渲染的文本（已按上限截断）。 */
  text: string;
  /** 是否被截断（true → UI 提供「去阅读页」出口）。 */
  truncated: boolean;
  /** 该章正文总字符数（未截断）。 */
  chars: number;
}

/** 章正文长度（单一口径）：`SplitTab` 的「共 N 字」与 `ChapterRow` 的「N 字」共用。 */
export function chapterCharCount(chapter: Pick<Chapter, "contentRef">): number {
  return Math.max(0, chapter.contentRef.end - chapter.contentRef.start);
}

/**
 * 取一章的正文切片。
 *
 * - `textPreview` 缺失 / 区间为空 → `undefined`（不给 UI 造空壳，调用方据此隐藏展开入口）；
 * - 区间越界 → 夹取到合法范围，不抛错；
 * - 超过 `limit` → 优先在**末尾空行**处断开，避免把 markdown 的 ``` 围栏或表格行切一半；
 *   找不到合适的空行（或空行过早）时退回硬截断。
 */
export function chapterPreviewOf(
  doc: Pick<SourceDocument, "textPreview">,
  chapter: Pick<Chapter, "contentRef">,
  limit: number = CHAPTER_PREVIEW_CHARS,
): ChapterPreview | undefined {
  const body = doc.textPreview;
  if (!body) return undefined;

  const start = Math.max(0, Math.min(chapter.contentRef.start, body.length));
  const end = Math.max(start, Math.min(chapter.contentRef.end, body.length));
  if (end <= start) return undefined;

  const slice = body.slice(start, end);
  if (slice.length <= limit) return { text: slice, truncated: false, chars: slice.length };

  // 空行断开：只接受位置足够靠后（≥60%）的空行，否则截掉的太少、不如硬截断。
  const cut = slice.lastIndexOf("\n\n", limit);
  const at = cut >= limit * 0.6 ? cut : limit;
  return { text: slice.slice(0, at), truncated: true, chars: slice.length };
}
