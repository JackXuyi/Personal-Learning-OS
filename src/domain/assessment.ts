/**
 * Adaptive Assessment support types.
 *
 * Question types follow the README (Recall … Interview), cognitive levels
 * follow Bloom's taxonomy. Evaluations feed the Learner Model with evidence.
 */

import type { CognitiveLevel } from "./learner";

export type QuestionType =
  | "recall"
  | "understanding"
  | "comparison"
  | "application"
  | "debugging"
  | "design"
  | "case-study"
  | "coding"
  | "interview";

/** Difficulty in 1..5. */
export interface Question {
  id: string;
  unitId: string;
  type: QuestionType;
  cognitiveLevel: CognitiveLevel;
  prompt: string;
  options?: string[];
  /** Best-effort reference answer used when a model is unavailable. */
  referenceAnswer?: string;
  difficulty: number;
}

export interface Answer {
  questionId: string;
  content: string;
  submittedAt: number;
}

export interface Evaluation {
  questionId: string;
  correct: boolean;
  score?: number;
  feedback?: string;
  /** Misconceptions surfaced by this evaluation (if any). */
  misconceptionsDetected: string[];
}

/** Evidence chain: Source → Knowledge → Question → Answer → Evaluation → Mastery. */
export interface Evidence {
  id: string;
  kind: "question" | "project" | "interview" | "note";
  unitId: string;
  title: string;
  description?: string;
  sourceDocumentId?: string;
  at: number;
  /** Quality of the evidence in [0, 1]. */
  quality?: number;
}
