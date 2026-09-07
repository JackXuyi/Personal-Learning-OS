/**
 * 学习计划 / 缺口 / 下一步动作类型。
 *
 * 学习规划器与推荐引擎的输出——自适应系统据此决定「最佳下一步」。
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
  /** 该目标要求达到的掌握度（默认 0.8）。 */
  targetMastery: number;
  /** 为什么这个缺口重要（可解释原则）。 */
  reasons: string[];
}

export interface NextAction {
  id: string;
  kind: ActionKind;
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
