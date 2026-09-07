/**
 * V2 学习闭环的主对象 —— Chapter（章节）。
 *
 * 对应「学一章 → 考一卷 → AI 判卷 → 生成计划」三步方案：章节是资料切分的
 * 产物，也是学习 / 出卷 / 掌握度追踪 / 学习计划的最小单位。
 *
 * 层级：Document（1）→ Chapter（n）→ KnowledgeUnit（概念层，N5 启用，此处仅留位 unitIds）。
 *
 * 设计决策（docs/learning-system-v2-design-2026-09.md §5.1）：
 * 章节是一等实体，而不是 KnowledgeUnit 的 kind 变体——掌握度主体的粒度决定
 * 长期架构；独立实体让「章内概念层回归」只是加一层（填充 unitIds + 复用引擎），
 * 而非数据迁移 + 语义重构。引擎通过 MasterySubject 接口同时服务 chapter 与
 * concept（复用算法、不复用类型）。
 */

/** 章节学习状态（章状态机，docs §3 步骤 1）。 */
export type ChapterStatus =
  | "not-started"
  | "learning"
  | "ready"
  | "mastered"
  | "retake";

/**
 * 章状态流转：
 *   not-started → learning（打开阅读）→ ready（标记学完）
 *   ready → mastered（卷面 ≥ 0.8）
 *   ready 且卷面 < 0.6 → retake（待补考，补考卷达标后回 mastered）
 */
export const CHAPTER_FLOW: Record<ChapterStatus, ChapterStatus[]> = {
  "not-started": ["learning", "ready"],
  learning: ["ready"],
  ready: ["mastered", "retake"],
  mastered: ["retake"],
  retake: ["mastered", "ready"],
};

/** 章正文在文档纯文本中的字符区间（引用切片，不复制原文）。 */
export interface ChapterRange {
  /** 起点（含）。 */
  start: number;
  /** 终点（不含）。 */
  end: number;
}

export interface Chapter {
  id: string;
  /** 所属文档（SourceDocument.id）。 */
  documentId: string;
  /** 章序号 1..n（目录 / planner 排序依据）。 */
  order: number;
  title: string;
  /** 正文切片引用。 */
  contentRef: ChapterRange;
  /** 章内要点（AI 提炼；本地兜底为正文首句摘要）。 */
  keyPoints: string[];
  /** 章下概念留位（N5 抽取引擎写入；V2 首版恒空）。 */
  unitIds: string[];
  /** 章状态（切分产出时恒为 not-started，由学习/测评推进）。 */
  status: ChapterStatus;
  createdAt: number;
}

/** 章节级「可掌握对象」视图——引擎只依赖该抽象（MasterySubject.kind="chapter"）。 */
export function asMasterySubject(chapter: Chapter): {
  id: string;
  kind: "chapter";
  title: string;
} {
  return { id: chapter.id, kind: "chapter", title: chapter.title };
}

/** 按 order 升序排序（存储写入与读取统一使用，保证确定性）。 */
export function sortChaptersByOrder(chapters: Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => a.order - b.order);
}
