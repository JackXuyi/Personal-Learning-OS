/**
 * 核心对象 #4 — Learner State（学习者状态）。
 *
 * 描述"用户当前对某知识单元实际掌握了多少"。
 * 单一分数不够——我们跟踪置信度、尝试次数、认知层级、
 * 误解、遗忘以及应用/面试能力。
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
  /**
   * 下次复习时间戳（P0-1 复习调度）。由卷面（applyPaperResult）与要点自评
   * （applyKeyPointRating / applyRating）写入；planner 到期后以低优先级
   * review 动作重新入队（V2 T9 收口）。
   */
  nextReviewAt?: number;
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
