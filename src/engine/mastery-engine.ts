/**
 * Mastery Engine — classifies mastery into bands and decides whether a unit
 * is a gap for a given goal. Shared thresholds live in the domain layer.
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

/** A unit is a gap when its current mastery is below the goal's threshold. */
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
