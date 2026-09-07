/**
 * Core Object #4 — Learner State.
 *
 * Describes "what the user actually masters right now" for a knowledge unit.
 * A single score is not enough — we track confidence, attempts, cognitive
 * level, misconceptions, forgetting and application/interview ability.
 */

export type CognitiveLevel =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate"
  | "create";

/** Per-unit learning record. Keyed by KnowledgeUnit.id in LearnerState. */
export interface UnitMastery {
  /** Mastery in [0, 1]. */
  mastery: number;
  /** Self-reported / calibrated confidence in [0, 1]. */
  confidence: number;
  attempts: number;
  correctCount: number;
  /** Bloom-level reached for this unit. */
  cognitiveLevel: CognitiveLevel;
  /** Misconceptions the system detected (Assessment engine input). */
  misconceptions: string[];
  lastReviewedAt?: number;
  lastAssessmentAt?: number;
  /** Evidence-backed application ability in [0, 1]. */
  applicationAbility: number;
  /** Evidence-backed interview ability in [0, 1]. */
  interviewAbility: number;
}

export interface LearnerState {
  /** Keyed by KnowledgeUnit.id. */
  byUnit: Record<string, UnitMastery>;
}

export function accuracyOf(unit: UnitMastery): number {
  return unit.attempts > 0 ? unit.correctCount / unit.attempts : 0;
}

/** The RAG example from the README, provided as sample seed data. */
export const RAG_UNIT_IDS = {
  retrieval: "rag-retrieval",
  embedding: "rag-embedding",
  chunking: "rag-chunking",
  reranking: "rag-reranking",
  evaluation: "rag-evaluation",
  production: "rag-production",
} as const;
