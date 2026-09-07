/**
 * Learning plan / gap / next-action types.
 *
 * Outputs of the Learning Planner & Recommendation Engine — everything an
 * "adaptive" system needs to decide the next best action.
 */

export type ActionKind =
  | "learn"
  | "review"
  | "practice"
  | "remediation"
  | "assessment"
  | "explore";

export interface SkillGap {
  unitId: string;
  currentMastery: number;
  /** Mastery required by the goal (defaults to 0.8). */
  targetMastery: number;
  /** Why this gap matters (Explainable principle). */
  reasons: string[];
}

export interface NextAction {
  id: string;
  kind: ActionKind;
  unitId: string;
  /** Lower number = higher priority. */
  priority: number;
  /** Human-readable justification, kept so the UI can answer "why?". */
  reasons: string[];
  createdAt: number;
}

export interface LearningPlan {
  id: string;
  goalId: string;
  actions: NextAction[];
  updatedAt: number;
}

export const MASTERY_THRESHOLD = 0.8;
export const MASTERY_FLOOR = 0.6;
