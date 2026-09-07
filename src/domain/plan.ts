/**
 * 学习计划 / 缺口 / 下一步动作类型。
 *
 * 学习规划器与推荐引擎的输出——自适应系统据此决定「最佳下一步」。
 */

export type ActionKind =
  // 概念层（Phase 0 基座，保留给概念粒度缺口）
  | "learn"
  | "review"
  | "practice"
  | "remediation"
  | "assessment"
  | "explore"
  // V2 章级（docs §5.5）：学习/出卷/补考/复习都以 Chapter 为单位
  | "learn-chapter"
  | "chapter-quiz"
  | "retake-quiz"
  | "review-points";

export interface SkillGap {
  unitId: string;
  currentMastery: number;
  /** 该目标要求达到的掌握度（默认 0.8）。 */
  targetMastery: number;
  /** 为什么这个缺口重要（可解释原则）。 */
  reasons: string[];
}

export interface NextAction {
  id: string;
  kind: ActionKind;
  /** 动作对象 id —— 概念层为 KnowledgeUnit.id；V2 章级为 Chapter.id（subjectId 语义，UI 不区分）。 */
  unitId: string;
  /** 数值越小优先级越高。 */
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
