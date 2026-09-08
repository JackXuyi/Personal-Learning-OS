import { create } from "zustand";
import { createStorage, type StorageAdapter } from "../storage";
import {
  runChapterLoop,
  runLearningLoop,
  type ChapterLoopSnapshot,
  type LoopSnapshot,
} from "../engine";
import { applyEvaluation, applyForgetting, applyRating, nextReviewInDays } from "../engine";
import { newId } from "../domain";
import type { Evaluation, LearnerState, LearningGoal, SelfRating } from "../domain";
import type { Messages } from "../i18n/messages/zh";
import { zh } from "../i18n/messages/zh";

/**
 * 整个应用唯一的存储实例。默认由 localStorage 支撑
 * （见 src/storage）——后续可在此处切换为 SQLite 适配器。
 */
export const storage: StorageAdapter = createStorage();

/** 提交一次作答/自评的证据：对错（测评）或四档自评（复习）。 */
export type ReviewEvidence =
  | { correct: boolean }
  | { rating: SelfRating };

export interface SubmitResult {
  /** 掌握度变化量（如 +0.08 / -0.12），供变化徽标展示。 */
  masteryDelta: number;
  /** 下次复习间隔（天，启发式）。 */
  nextReviewInDays: number;
}

interface LoopStoreState {
  /** 概念层闭环快照（Phase 0 基座；ReviewSession / career 等沿用）。 */
  snapshot: LoopSnapshot | undefined;
  /** V2 章级闭环快照（/ 首页主 CTA 与 /plan 计划页，T8；作用域 = activeGoal，§7.3）。 */
  chapterPlan: ChapterLoopSnapshot | undefined;
  /** 多目标列表（goal repo；U0 数据准备，§7.2）。 */
  goals: LearningGoal[];
  /** 当前目标上下文（activeGoal；id 失效/未设置时回退列表首个目标）。 */
  activeGoal: LearningGoal | undefined;
  loading: boolean;
  error: string | undefined;
  /** 重算快照；m = 当前界面语言（引擎 reason 文案随语言注入，默认中文）。 */
  refresh: (m?: Messages) => Promise<void>;
  /** 切换 activeGoal 上下文并重算（写入 storage，setActiveGoal + refresh）。 */
  switchGoal: (goalId: string, m?: Messages) => Promise<void>;
  /** 提交一次自评/作答并回写 Learner State。幂等：5s 撤销窗口内同一单元拒绝重复提交。 */
  submitAnswer: (
    unitId: string,
    evidence: ReviewEvidence,
    m?: Messages,
  ) => Promise<SubmitResult>;
  /** 撤销窗口内的回滚（保存提交前的状态快照）。返回是否成功撤销。 */
  undoReview: (unitId: string, m?: Messages) => Promise<boolean>;
}

/** 撤销窗口（毫秒）。 */
export const UNDO_WINDOW_MS = 5_000;

/** 会话级撤销栈：unitId → 提交前的 Learner State 快照 + 提交时间。 */
const undoStack = new Map<string, { prevState: LearnerState; at: number }>();

export const useLoopStore = create<LoopStoreState>((set, get) => ({
  snapshot: undefined,
  chapterPlan: undefined,
  goals: [],
  activeGoal: undefined,
  loading: false,
  error: undefined,

  refresh: async (m?: Messages) => {
    set({ loading: true, error: undefined });
    try {
      // activeGoal 先解析（getActiveGoal：偏好 id 失效/未设置回退首个目标），
      // 概念层与章级快照均按该目标上下文重算（§7.3 读取路径参数化）。
      const activeGoal = await storage.getActiveGoal();
      const [snapshot, chapterPlan] = await Promise.all([
        runLearningLoop(storage, activeGoal?.id, m),
        runChapterLoop(storage, m, activeGoal?.id),
      ]);
      // 目标列表随快照刷新（seed 由 runLearningLoop 空库播种）。
      const goals = await storage.listGoals();
      const resolvedActive =
        goals.find((g) => g.id === activeGoal?.id) ?? goals[0];
      set({
        snapshot,
        chapterPlan,
        goals,
        activeGoal: resolvedActive,
        loading: false,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  switchGoal: async (goalId, m?: Messages) => {
    await storage.setActiveGoal(goalId);
    await get().refresh(m);
  },

  submitAnswer: async (unitId, evidence, m?: Messages) => {
    const pending = undoStack.get(unitId);
    if (pending && Date.now() - pending.at < UNDO_WINDOW_MS) {
      throw new Error(m?.engine.duplicateSubmit ?? zh.engine.duplicateSubmit);
    }

    const state = await storage.getLearnerState();
    const prevState = applyForgetting(state, Date.now());
    const prevMastery = prevState.byUnit[unitId]?.mastery ?? 0;

    let nextState: LearnerState;
    let intervalDays: number;
    if ("rating" in evidence) {
      nextState = applyRating(prevState, unitId, evidence.rating, Date.now());
      intervalDays = nextReviewInDays(evidence.rating);
    } else {
      // 测评对错：以启发式间隔表达「答对 4 天后再见 / 答错 1 天后重来」。
      const evaluation: Evaluation = {
        questionId: newId("eval"),
        correct: evidence.correct,
        misconceptionsDetected: [],
      };
      nextState = applyEvaluation(prevState, unitId, evaluation, Date.now());
      intervalDays = nextReviewInDays(evidence.correct ? "good" : "forget");
    }

    const nextMastery = nextState.byUnit[unitId]?.mastery ?? 0;
    await storage.saveLearnerState(nextState);
    undoStack.set(unitId, { prevState, at: Date.now() });

    // 重算闭环快照（就绪度/缺口/下一步随之变化）。
    await get().refresh(m);

    return { masteryDelta: Math.round((nextMastery - prevMastery) * 100) / 100, nextReviewInDays: intervalDays };
  },

  undoReview: async (unitId, m?: Messages) => {
    const entry = undoStack.get(unitId);
    if (!entry) return false;
    if (Date.now() - entry.at >= UNDO_WINDOW_MS) {
      undoStack.delete(unitId);
      return false;
    }
    await storage.saveLearnerState(entry.prevState);
    undoStack.delete(unitId);
    await get().refresh(m);
    return true;
  },
}));
