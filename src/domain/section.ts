/**
 * Section（小节）—— Chapter 下的逻辑分段（可选，支持三层结构）。
 * 例：Chapter 7 下可有 7.1、7.2、7.3 多个 Section。
 * 搜索时可在 Section 粒度返回结果。
 *
 * 层级：Document → Chapter → Section → Chunk
 */

import type { ChapterRange } from "./chapter";

export interface Section {
  id: string;
  chapterId: string;
  documentId: string;
  title: string;
  /** 标题级数（1-6 对应 H1-H6）。 */
  level: number;
  /** 章内序号。 */
  index: number;
  /** 正文切片引用（字符区间）。 */
  contentRef: ChapterRange;
  createdAt: number;
}

/** 按 index 升序排序（与 Chapter 同样规则）。 */
export function sortSectionsByIndex(sections: Section[]): Section[] {
  return [...sections].sort((a, b) => a.index - b.index);
}
