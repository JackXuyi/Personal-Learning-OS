/**
 * Core Object #5 — Learning Goal.
 *
 * The goal is the entry point of the whole system. Career / Study / Exam /
 * Personal / Research / Project all flow into the same Learning Engine.
 */
export type GoalType =
  | "career"
  | "study"
  | "exam"
  | "personal"
  | "research"
  | "project";

export type GoalImportance = "high" | "medium" | "low";

export interface LearningGoal {
  id: string;
  type: GoalType;
  title: string;
  description?: string;
  importance: GoalImportance;
  /** Knowledge units the goal is expected to require. */
  requiredUnitIds: string[];
  createdAt: number;
  /** Optional deadline (epoch ms). */
  deadlineAt?: number;
}

/** Sample goal used by seed data & the Home dashboard. */
export const DEFAULT_GOAL: LearningGoal = {
  id: "goal-ai-app-engineer",
  type: "career",
  title: "AI Application Engineer",
  description: "The career example used throughout the README.",
  importance: "high",
  requiredUnitIds: [],
  createdAt: 0,
};
