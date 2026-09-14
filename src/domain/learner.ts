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

/* ------------------------------------------------------------------ */
/* 学习者画像（F1）—— 「你是谁、有多少时间、偏好怎么学」                */
/* ------------------------------------------------------------------ */

/**
 * 自评水平。**仅在该章没有任何掌握度证据时**作难度先验
 * （见 `engine/profile-band.ts::bandForChapter`）—— 一旦有卷面/自评掌握度，
 * 一律以实测为准，绝不让「我自评高级」覆盖「我这一章考了 30 分」。
 */
export type LearnerLevel = "beginner" | "basic" | "intermediate" | "advanced";

/** 合法档位（UI 选项与 normalize 校验共用同一真源）。 */
export const LEARNER_LEVELS: readonly LearnerLevel[] = [
  "beginner",
  "basic",
  "intermediate",
  "advanced",
];

/** 广度优先（先把全书铺开） vs 深度优先（学一章测一章）。 */
export type StudyDepth = "breadth" | "depth";

/** 学习方式偏好：阅读为主 / 练习为主 / 测验为主。 */
export type StudyStyle = "reading" | "practice" | "quiz";

/** 画像字段护栏（UI 与 normalize 共用；缺失语义 = 未填写）。 */
export const PROFILE_LIMITS = {
  /** 每周可投入分钟数下限（低于此视为未声明）。 */
  weeklyMinutesMin: 30,
  /** 每周可投入分钟数上限（168 小时 = 一周全部时间）。 */
  weeklyMinutesMax: 168 * 60,
  /** 背景摘要字符上限。 */
  backgroundChars: 600,
} as const;

/**
 * 学习者画像（与 `LearnerState` 并列但**不混合**）：
 * `LearnerState` 记「实际掌握了多少」，本类型记「用户自己声明的你是谁」。
 *
 * 缺省语义 = **未填写**：`storage.getProfile()` 返回 `undefined`，
 * 所有消费点据此退回改动前的行为（零回归），绝不自动写默认值
 * （防「系统替我设了 beginner」的假象）。
 */
export interface LearnerProfile {
  level: LearnerLevel;
  /**
   * 每周可投入分钟数。缺省 / 越界 = **未声明**（预计完成日期不产出）。
   * 这是「投入意愿」，简历里推不出来 —— 只能用户自己填。
   */
  weeklyMinutes?: number;
  preferences: { depth: StudyDepth; style: StudyStyle };
  /**
   * 背景摘要（学历 / 年限 / 领域 / 技能栈）。AI 出题与章内提问的上下文，
   * ≤ `PROFILE_LIMITS.backgroundChars`。
   */
  background?: string;
  /** 背景摘要来源，供 UI 标注「由简历整理」。 */
  backgroundSource?: "manual" | "resume";
  updatedAt: number;
}

/**
 * 到期复习判定（V2 T9）：已安排过复习（nextReviewAt 有值）且已到复习日。
 * 到期章即便掌握度仍达标，也应重新入队复习（防遗忘衰减）。
 */
export function isDueReview(unit: UnitMastery | undefined, now: number): boolean {
  return unit?.nextReviewAt !== undefined && unit.nextReviewAt <= now;
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
