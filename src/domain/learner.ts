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

/**
 * Bloom 认知层级由低到高 —— **唯一排序真源**。
 *
 * ⚠️ 抽取理由（2026-09-22 收口）：此前有**两份等价副本**各自维护同一次序 ——
 * `engine/learner-model.ts` 的 `COGNITIVE_ORDER`（推进层级）与
 * `features/learn/resplit-mastery.ts` 的 `COGNITIVE_ORDER`（合并取最高）。
 * 同一规则散在多处＝两把尺子：任一处漏改，层级推进与合并口径立刻分叉。
 * 次序只此一份，消费方一律 `cognitiveIndexOf` / 引用本常量。
 */
export const COGNITIVE_ORDER: readonly CognitiveLevel[] = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
];

/** 认知层级初值（`emptyUnit` 与会话兜底共用；＝ `COGNITIVE_ORDER[0]`）。 */
export const COGNITIVE_BASE_LEVEL: CognitiveLevel = "remember";

/**
 * 认知层级 → 序号（0..`COGNITIVE_ORDER.length - 1`）。
 * 缺省 / 认不出的值回退初值档（`COGNITIVE_BASE_LEVEL`），**绝不返回 -1**
 * —— 返回负数会让调用方的 `sort` / `max` 静默把未知档排到最前或最后。
 */
export function cognitiveIndexOf(level: CognitiveLevel | undefined): number {
  const i = level === undefined ? -1 : COGNITIVE_ORDER.indexOf(level);
  return i < 0 ? 0 : i;
}

/**
 * 自适应测评会话覆盖的档位数 —— 会话只走 `COGNITIVE_ORDER` 的前三档
 * （`analyze` 及以上留给将来的扩展，不在自适应循环内）。
 */
export const SESSION_LEVEL_COUNT = 3;

/**
 * 测评会话起始档位（0 .. `SESSION_LEVEL_COUNT` - 1）：**直接取持久化的认知层级**，
 * 越界钳到末档。
 *
 * ⚠️ 2026-09-22 前这里没有函数 —— `AssessmentSession` 由 `mastery` **重新推导**
 * （≥0.8→应用 / >0→理解 / 否则记忆），而引擎侧 `nextCognitiveLevel` 早已把同一件事
 * 算好并写进 `UnitMastery.cognitiveLevel` ⇒ 同一规则两处实现：`mastery ∈ (0, 0.5)`
 * 时引擎判「记忆」而界面从「理解」起步。现一律以持久化值为准。
 */
export function sessionLevelIndexOf(level: CognitiveLevel | undefined): number {
  return Math.min(cognitiveIndexOf(level), SESSION_LEVEL_COUNT - 1);
}

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
