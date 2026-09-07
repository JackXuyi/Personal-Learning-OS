/**
 * 自适应测评支撑类型。
 *
 * 题目类型遵循 README（Recall … Interview），认知层级遵循
 * Bloom 分类法。测评结果以证据形式回喂给学习者模型。
 */

import type { CognitiveLevel } from "./learner";

/** 复习会话中的四档自评（Brainscape / RemNote 式）。 */
export type SelfRating = "forget" | "hard" | "good" | "easy";

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
  /** 证据质量 [0, 1]。 */
  quality?: number;
}
