/**
 * Mastery Engine（掌握度引擎）—— 把掌握度归入档位，并判断某单元
 * 对给定目标是否构成缺口。共享阈值定义在领域层。
 */
import type { LearnerState } from "../domain";
import { MASTERY_THRESHOLD } from "../domain";
import { masteryOf } from "./learner-model";

export type MasteryBand = "not-started" | "learning" | "proficient" | "mastered";

export function bandOf(mastery: number): MasteryBand {
  if (mastery <= 0) return "not-started";
  if (mastery < 0.4) return "learning";
  if (mastery < MASTERY_THRESHOLD) return "proficient";
  return "mastered";
}

/** 当单元当前掌握度低于目标阈值时，即为缺口。 */
export function isGap(
  state: LearnerState,
  unitId: string,
  targetMastery = MASTERY_THRESHOLD,
): boolean {
  const unit = masteryOf(state, unitId);
  if (!unit) return true;
  return unit.mastery < targetMastery;
}

export function masteryOfUnit(state: LearnerState, unitId: string): number {
  return masteryOf(state, unitId)?.mastery ?? 0;
}

/** Average mastery across a set of units (goal readiness proxy). */
export function averageMastery(state: LearnerState, unitIds: string[]): number {
  if (unitIds.length === 0) return 0;
  const sum = unitIds.reduce((acc, id) => acc + masteryOfUnit(state, id), 0);
  return sum / unitIds.length;
}
