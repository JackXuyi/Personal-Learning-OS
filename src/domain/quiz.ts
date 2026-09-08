/**
 * V2 学习闭环的测评对象 —— Quiz / Paper（试卷）。
 *
 * 「学一章 → 考一卷 → AI 判卷 → 生成计划」第二步的领域模型：以 Chapter 为
 * 出卷单位，四种题型（客观：选择/判断；主观：问答/应用）覆盖 Bloom 认知层级，
 * 四种卷型（单元测 / 阶段测 / 综合测 / 补考卷）承载不同范围与配比。
 *
 * 判分契约（T3）：客观题本地确定性判分（answer 比对）；主观题
 * 无 AI Provider 时置 pending，不伪造判分（P0-3）。PaperResult 由
 * gradePaper（quiz-engine）产出，此处定义类型。
 */

import type { CognitiveLevel } from "./learner";

/** 四种题型。Bloom 映射：选择/判断 = remember/understand；问答 = understand/analyze；应用 = apply/evaluate。 */
export type QuizType = "choice" | "judge" | "qa" | "application";

/** 四种卷型（docs §3 步骤 2 配比表）。 */
export type PaperMode = "unit-test" | "stage-test" | "final-test" | "retake";

/** 出卷范围：哪些章 + 哪种卷型。 */
export interface PaperScope {
  chapterIds: string[];
  mode: PaperMode;
}

/** 单题。answer 用于客观题本地判分；referenceAnswer 为主观题评分参考（AI 判分用）。 */
export interface PaperQuestion {
  id: string;
  /** 题目归属章（掌握度回写按此键聚合）。 */
  chapterId: string;
  type: QuizType;
  cognitiveLevel: CognitiveLevel;
  prompt: string;
  /** choice 用：选项数组（判分比对选项索引，见 answer）。 */
  options?: string[];
  /** choice：正确项在 options 中的索引字符串；judge："true" | "false"。 */
  answer?: string;
  /** qa / application 用：评分参考（AI 判分 / 展示参考答案）。 */
  referenceAnswer?: string;
  /** 难度 1..5（由章 mastery 难度带决定）。 */
  difficulty: number;
}

export type PaperStatus = "open" | "grading" | "done";

export interface Paper {
  id: string;
  scope: PaperScope;
  /** 展示标题，如「综合测」或「单元测 · 第三章 检索」。 */
  title: string;
  questions: PaperQuestion[];
  status: PaperStatus;
  createdAt: number;
  submittedAt?: number;
}

/* ---------- 元信息（UI 预览 / 卷型标识复用） ---------- */

export const QUIZ_TYPE_LABEL: Record<QuizType, string> = {
  choice: "选择题",
  judge: "判断题",
  qa: "问答题",
  application: "应用题",
};

export const PAPER_MODE_LABEL: Record<PaperMode, string> = {
  "unit-test": "单元测",
  "stage-test": "阶段测",
  "final-test": "综合测",
  retake: "补考卷",
};

/** 各卷型预计时长（分钟，docs §3 配比表）。 */
export const PAPER_MODE_DURATION_MIN: Record<PaperMode, number> = {
  "unit-test": 8,
  "stage-test": 15,
  "final-test": 30,
  retake: 5,
};

/** 客观题（本地可确定性判分）。 */
export function isObjectiveType(type: QuizType): boolean {
  return type === "choice" || type === "judge";
}

/** 主观题（需 AI 出题/批改；无 Provider 时剔除或置 pending）。 */
export function isSubjectiveType(type: QuizType): boolean {
  return !isObjectiveType(type);
}

/* ---------- 判分（T3 · gradePaper / gradeAndApply 的类型契约） ---------- */

/** 交卷答案：questionId → 作答串（choice = 选中项在 options 中的索引；judge = "true" | "false"；qa/application = 文本）。 */
export type PaperAnswers = Record<string, string>;

/** 判分 + 掌握度回写的完整产物（quiz-engine gradeAndApply 返回，供报告页消费）。 */
export interface PaperResult {
  paperId: string;
  /**
   * 全卷总分 0..1，口径随证据完整度（N3 双证据）：
   *   - 基线 = Σ客观(难度×对错) / Σ客观难度（gradePaper / gradeAndApply 产出）；
   *   - AI 主观分并入后 = (Σ客观难度得分 + Σ主观难度×AI分) / Σ全部难度
   *     （仅当卷内所有「已作答」主观题均拿到 AI 分；未作答主观题按确定性 0 分
   *     并入，与客观题未答判错对称）。存在缺 AI 分的已作答题 → 保持基线口径。
   */
  totalScore: number;
  /** 逐章：score = 卷面客观分；previousMastery / mastery = 回写前后掌握度（只吃客观证据）。 */
  perChapter: Record<
    string,
    { score: number; previousMastery: number; mastery: number }
  >;
  /**
   * 错题回顾：客观错题（含未答）；主观题 <0.6（AI 批改，附 aiFeedback/point）与
   * 未作答主观题（确定性 0 分）也进此列。
   */
  wrongQuestions: {
    questionId: string;
    yourAnswer: string;
    aiFeedback?: string;
    point?: string;
  }[];
  /** 客观题证据快照（难度权重与得分；卷面并入重算用——重试批改无需再持客观作答）。 */
  objective?: { weight: number; earned: number };
  /** 主观题作答快照（questionId → 作答原文；N3b 报告页重试 AI 批改的数据源）。 */
  subjectiveAnswers?: Record<string, string>;
  /** 已确定得分的主观题（questionId → 0..1：AI 批改分；未作答为确定性 0 分）。 */
  subjectiveScores?: Record<string, number>;
  createdAt: number;
}
