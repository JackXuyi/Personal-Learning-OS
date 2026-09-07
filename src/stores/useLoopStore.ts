import { create } from "zustand";
import { createStorage, type StorageAdapter } from "../storage";
import { runLearningLoop, type LoopSnapshot } from "../engine";
import { applyEvaluation, applyForgetting, applyRating, nextReviewInDays } from "../engine";
import { newId } from "../domain";
import type { Evaluation, LearnerState, SelfRating } from "../domain";

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
  snapshot: LoopSnapshot | undefined;
  loading: boolean;
  error: string | undefined;
  refresh: () => Promise<void>;
  /** 提交一次自评/作答并回写 Learner State。幂等：5s 撤销窗口内同一单元拒绝重复提交。 */
  submitAnswer: (unitId: string, evidence: ReviewEvidence) => Promise<SubmitResult>;
  /** 撤销窗口内的回滚（保存提交前的状态快照）。返回是否成功撤销。 */
  undoReview: (unitId: string) => Promise<boolean>;
}

/** 撤销窗口（毫秒）。 */
export const UNDO_WINDOW_MS = 5_000;

/** 会话级撤销栈：unitId → 提交前的 Learner State 快照 + 提交时间。 */
const undoStack = new Map<string, { prevState: LearnerState; at: number }>();

export const useLoopStore = create<LoopStoreState>((set, get) => ({
  snapshot: undefined,
  loading: false,
  error: undefined,

  refresh: async () => {
    set({ loading: true, error: undefined });
    try {
      const snapshot = await runLearningLoop(storage);
      set({ snapshot, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  submitAnswer: async (unitId, evidence) => {
    const pending = undoStack.get(unitId);
    if (pending && Date.now() - pending.at < UNDO_WINDOW_MS) {
      throw new Error("该单元刚提交过，可撤销后重试。");
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
    await get().refresh();

    return { masteryDelta: Math.round((nextMastery - prevMastery) * 100) / 100, nextReviewInDays: intervalDays };
  },

  undoReview: async (unitId) => {
    const entry = undoStack.get(unitId);
    if (!entry) return false;
    if (Date.now() - entry.at >= UNDO_WINDOW_MS) {
      undoStack.delete(unitId);
      return false;
    }
    await storage.saveLearnerState(entry.prevState);
    undoStack.delete(unitId);
    await get().refresh();
    return true;
  },
}));
