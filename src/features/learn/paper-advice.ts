/**
 * 出卷建议（paper-advice）—— 按学习情况推荐卷型与难度带。
 *
 * 设计（docs/library-detail-page-design-2026-09.md §4.3）：
 * - **纯函数**：无 React、无 storage、无 AI；输入 chapter + learner，输出建议。
 * - **阈值同源**：及格线 / 达标线直接复用 `domain/plan.ts` 的
 *   `MASTERY_FLOOR` / `MASTERY_THRESHOLD`，难度带复用 `bandOfMastery`，
 *   保证「详情页推荐」与「出卷引擎实际出的卷」口径一致，不自造一套阈值。
 * - **只建议不生成**：试卷 Tab 仅展示，出卷动作跳 `/quiz/new` 由用户确认。
 */
import type { Chapter, LearnerState, PaperMode } from "../../domain";
import { MASTERY_FLOOR, MASTERY_THRESHOLD } from "../../domain";
import type { DifficultyBand } from "../../engine/quiz-engine";
import { bandOfMastery } from "../../engine/quiz-engine";

/** 「已达标」判定线：≥ 此值不再推荐单章出卷（区别于达标线，给综合测留空间）。 */
export const MASTERY_MASTERED = 0.9;

/** 推荐理由枚举（UI 按 key 映射 i18n 文案）。 */
export type PaperAdviceReason =
  | "never"
  | "failed"
  | "weak"
  | "near"
  | "mastered"
  | "allMastered";

export interface PaperAdvice {
  mode: PaperMode;
  /** 难度带，与 createPaper 内部 `bandOfMastery` 同口径。 */
  band: DifficultyBand;
  reason: PaperAdviceReason;
}

/**
 * 单章出卷建议。
 *
 * | 条件 | mode | reason |
 * |------|------|--------|
 * | 从未测过（attempts === 0） | unit-test | never |
 * | mastery < 及格线 且 测过 | retake | failed |
 * | 及格线 ≤ mastery < 达标线 | unit-test | weak |
 * | 达标线 ≤ mastery < 0.9 | stage-test | near |
 * | mastery ≥ 0.9 | unit-test（标记 mastered，UI 显示「已达标」） | mastered |
 */
export function recommendPaper(args: {
  chapter: Chapter;
  learner?: LearnerState | null;
}): PaperAdvice {
  const { chapter, learner } = args;
  const unit = learner?.byUnit[chapter.id];
  const mastery = unit?.mastery ?? 0;
  const attempts = unit?.attempts ?? 0;
  const band = bandOfMastery(mastery);

  if (attempts === 0) return { mode: "unit-test", band, reason: "never" };
  if (mastery < MASTERY_FLOOR) return { mode: "retake", band, reason: "failed" };
  if (mastery < MASTERY_THRESHOLD) return { mode: "unit-test", band, reason: "weak" };
  if (mastery < MASTERY_MASTERED) return { mode: "stage-test", band, reason: "near" };
  return { mode: "unit-test", band, reason: "mastered" };
}

/** 该章是否已经不需要再出卷（≥0.9）。 */
export function isChapterMastered(
  chapter: Chapter,
  learner?: LearnerState | null,
): boolean {
  return (learner?.byUnit[chapter.id]?.mastery ?? 0) >= MASTERY_MASTERED;
}

/**
 * 资料级建议：全部章达标 → 推荐「综合测」；否则 `undefined`（不给资料级建议）。
 *
 * 无章节时返回 `undefined`（无卷可出）。
 */
export function recommendDocPaper(args: {
  chapters: readonly Chapter[];
  learner?: LearnerState | null;
}): PaperAdvice | undefined {
  const { chapters, learner } = args;
  if (chapters.length === 0) return undefined;
  const allMastered = chapters.every((c) => isChapterMastered(c, learner));
  if (!allMastered) return undefined;
  // 综合测难度带取全章最高带：整卷应能拉开区分度。
  const band = chapters.reduce<DifficultyBand>((acc, c) => {
    const b = bandOfMastery(learner?.byUnit[c.id]?.mastery ?? 0);
    return b > acc ? b : acc;
  }, 1);
  return { mode: "final-test", band, reason: "allMastered" };
}
