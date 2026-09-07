/**
 * 核心对象 #5 —— Learning Goal（学习目标）。
 *
 * 目标是整个系统的入口。职业 / 学习 / 考试 / 个人 / 研究 / 项目
 * 六类目标最终都汇入同一个学习引擎。
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
  /** 目标预计所需的单元（概念层）。 */
  requiredUnitIds: string[];
  /**
   * 目标要求的章节范围（V2 章级；可选）。
   * 为空时章级计划由调用方传入整本文档的章；给定后 buildChapterPlan
   * 只对范围内章排动作（plan.ts）。
   */
  requiredChapterIds?: string[];
  createdAt: number;
  /** Optional deadline (epoch ms). */
  deadlineAt?: number;
}

/** 种子数据与首页仪表盘使用的示例目标。 */
export const DEFAULT_GOAL: LearningGoal = {
  id: "goal-ai-app-engineer",
  type: "career",
  title: "AI Application Engineer",
  description: "The career example used throughout the README.",
  importance: "high",
  requiredUnitIds: [],
  createdAt: 0,
};
