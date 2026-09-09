/**
 * Goals 功能共享数据工具（UI Workbench U6，docs/ui-workbench-plan-2026-09.md §U6）。
 *
 * 与 Today/Plan 同一套语义：
 * - 章就绪度 = 目标章范围内「掌握度 ≥ MASTERY_THRESHOLD」的章占比；
 * - 作用域 = goal.requiredChapterIds（空 → 全库章回退，与 runChapterLoop §7.3 一致）；
 * - 统一加载一次 docs/chapters/learner 供列表与详情使用（零引擎算法改动）。
 */
import type { Chapter, LearnerState, LearningGoal } from "../../domain";
import { MASTERY_THRESHOLD } from "../../domain";
import { applyForgetting } from "../../engine";
import type { StorageAdapter } from "../../storage";

/** 跨文档章行（含所属文档标题；order 已按 doc 内排序）。 */
export interface ChapterRow {
  chapter: Chapter;
  docTitle: string;
}

/** 目标章就绪度快照（列表卡片 / 详情头复用）。 */
export interface GoalStats {
  /** 范围内章总数。 */
  total: number;
  /** 达标章数（≥ MASTERY_THRESHOLD）。 */
  mastered: number;
  /** 就绪度 0..1（无范围章时为 0）。 */
  readiness: number;
  /** 是否已完成（有范围章且全部达标）。 */
  completed: boolean;
}

/** 一次读取全库章行（docs importedAt 升序；章 order 升序）。 */
export async function loadChapterRows(storage: StorageAdapter): Promise<ChapterRow[]> {
  const docs = await storage.listDocuments();
  const sortedDocs = [...docs].sort((a, b) => a.importedAt - b.importedAt);
  const rows: ChapterRow[] = [];
  for (const doc of sortedDocs) {
    const chapters = await storage.listChapters(doc.id);
    for (const chapter of chapters) rows.push({ chapter, docTitle: doc.title });
  }
  return rows;
}

/** 目标作用域：requiredChapterIds 命中优先；空 → 全库章（回退语义）。 */
export function scopeOf(goal: LearningGoal, allRows: ChapterRow[]): ChapterRow[] {
  if (!goal.requiredChapterIds || goal.requiredChapterIds.length === 0) return allRows;
  const wanted = new Set(goal.requiredChapterIds);
  return allRows.filter((r) => wanted.has(r.chapter.id));
}

/**
 * 目标就绪度统计。learner 传入「遗忘衰减后」的视图（读时折算，与引擎一致）；
 * 提供 rawLearner 时内部先 applyForgetting。
 */
export function goalStatsOf(
  _goal: LearningGoal,
  rows: ChapterRow[],
  rawLearner: LearnerState,
): GoalStats {
  const learner = applyForgetting(rawLearner, Date.now());
  const total = rows.length;
  const mastered = rows.filter(
    (r) => (learner.byUnit[r.chapter.id]?.mastery ?? 0) >= MASTERY_THRESHOLD,
  ).length;
  const readiness = total === 0 ? 0 : mastered / total;
  return {
    total,
    mastered,
    readiness,
    completed: total > 0 && mastered === total,
  };
}

/** 掌握度（遗忘衰减视图下）—— 供详情页行内展示，与就绪度同源。 */
export function masteryOfChapter(
  chapterId: string,
  rawLearner: LearnerState,
): number {
  return applyForgetting(rawLearner, Date.now()).byUnit[chapterId]?.mastery ?? 0;
}

export function docTitleOfRow(row: ChapterRow): string {
  return row.docTitle;
}
