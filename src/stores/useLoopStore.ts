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
import type {
  Evaluation,
  GeneratedEntry,
  LearnerProfile,
  LearnerState,
  LearningGoal,
  MemoryDocMeta,
  SelfRating,
} from "../domain";
import { EMPTY_MEMORY_META } from "../domain";
import type { Messages } from "../i18n/messages/zh";
import { zh } from "../i18n/messages/zh";
// F9：记忆的状态入口在 store（设计 §8.14），实现全部委托给服务层。
// 依赖方向说明：`features/memory/*` **不** import 本模块（服务层的 `store` 参数是
// 注入的 `StorageAdapter`，可脱离 store 直测），故此处是真单向、无环。
import type { MemorySignals } from "../features/memory/memory-signals";
import type { MemoryTexts, RefreshOptions } from "../features/memory/memory-service";
import {
  applyAiEntries,
  clearMemoryDoc,
  loadMemory,
  markFileSaved,
  refreshFromFacts,
  restoreDismissed,
  saveUserDoc,
  useSystemVersion,
} from "../features/memory/memory-service";
import type { MergeStats } from "../features/memory/memory-doc-merge";

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
  /**
   * 学习者画像（F1）。由章级快照带出（`runChapterLoop` 读 `storage.getProfile()`），
   * 未填写 = `undefined`。
   */
  profile: LearnerProfile | undefined;
  loading: boolean;
  error: string | undefined;
  /** 重算快照；m = 当前界面语言（引擎 reason 文案随语言注入，默认中文）。 */
  refresh: (m?: Messages) => Promise<void>;
  /** 切换 activeGoal 上下文并重算（写入 storage，setActiveGoal + refresh）。 */
  switchGoal: (goalId: string, m?: Messages) => Promise<void>;
  /** 新建 / 更新目标（goal repo，U6 Goals CRUD）；保存后重算快照。 */
  saveGoal: (goal: LearningGoal, m?: Messages) => Promise<void>;
  /**
   * 保存 / 清除画像（F1）。**唯一写路径**：`storage.saveProfile` 后 `refresh`
   * 重算快照（画像影响计划队列顺序与 ETA，必须连带刷新）。
   */
  saveProfile: (profile: LearnerProfile | undefined, m?: Messages) => Promise<void>;
  /**
   * 删除目标（U6）。若删除的是当前 activeGoal，清掉 activeGoal 偏好 →
   * 读取时回退首个剩余目标（无脏状态，§U6 验收）。删除后重算快照。
   */
  removeGoal: (goalId: string, m?: Messages) => Promise<void>;
  /** 提交一次自评/作答并回写 Learner State。幂等：5s 撤销窗口内同一单元拒绝重复提交。 */
  submitAnswer: (
    unitId: string,
    evidence: ReviewEvidence,
    m?: Messages,
  ) => Promise<SubmitResult>;
  /** 撤销窗口内的回滚（保存提交前的状态快照）。返回是否成功撤销。 */
  undoReview: (unitId: string, m?: Messages) => Promise<boolean>;

  // ===== 学习者记忆（F9）=====
  /**
   * 记忆文档正文（markdown 真源）。**不随 `refresh` 重算** ——
   * 记忆按 D2 不进入任何计划 / 难度 / 配额的输入，故它不是计划快照的一部分（§4.4）。
   */
  memoryDoc: string;
  /** 记忆元数据（`lastWritten` / `dismissed` / 整理时刻）。同样不随 refresh 重算。 */
  memoryMeta: MemoryDocMeta;
  /**
   * 通道 A 整理（打开 `/memory` 时调用）：零外发，只可能改动「系统写过且用户没动过」的行。
   * 返回本轮动作报告供页面如实展示（更新 N 条 / 保留你改写的 M 条）。
   */
  refreshMemory: (signals: MemorySignals, opts: RefreshOptions) => Promise<MergeStats>;
  /** 用户手动编辑：**原样落库、完全不过合并器**（用户文本必须逐字节保存）。 */
  saveMemoryDoc: (doc: string) => Promise<void>;
  /** 通道 B 结果落库（用户点「写进文档」后调用）。 */
  applyMemoryAi: (
    entries: readonly GeneratedEntry[],
    opts: MemoryTexts & { now: number },
  ) => Promise<MergeStats>;
  /** 清空全部记忆（含手写区与墓碑；需 UI 二次确认）。 */
  clearMemory: () => Promise<void>;
  /** 恢复被删的记忆（清空墓碑 → 下次整理写回）。 */
  restoreMemory: () => Promise<void>;
  /** 「用系统的版本」：把某一行的控制权交回系统（见服务层注释的两种入口差异）。 */
  useSystemMemoryVersion: (key: string, currentLine: string) => Promise<void>;
  /**
   * 记录文档已落盘的时刻（UC-11 的基线）。**只改 meta**，返回后 store 回读一次。
   * ⚠️ 只应在**用户显式落盘成功后**调用 —— 见服务层 `markFileSaved` 的理由。
   */
  markMemoryFileSaved: (at: number) => Promise<void>;
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
  profile: undefined,
  loading: false,
  error: undefined,
  // F9：记忆初始为空态。**刻意不在 refresh 里读它**（见字段注释）；`/memory` 页
  // 打开时调 `refreshMemory` 才会从 storage 拉齐。
  memoryDoc: "",
  memoryMeta: EMPTY_MEMORY_META,

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
        // 画像随章级快照带出（runChapterLoop 已读 storage.getProfile()）——
        // 单一来源，不再单独读一次 storage。
        profile: chapterPlan.profile,
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

  saveGoal: async (goal, m?: Messages) => {
    await storage.saveGoal(goal);
    await get().refresh(m);
  },

  saveProfile: async (profile, m?: Messages) => {
    await storage.saveProfile(profile);
    await get().refresh(m);
  },

  removeGoal: async (goalId, m?: Messages) => {
    const wasActive = get().activeGoal?.id === goalId;
    await storage.deleteGoal(goalId);
    // 删除的是当前上下文 → 清偏好；getActiveGoal 回退列表首个（首个没了 → 再下一个）。
    if (wasActive) await storage.setActiveGoal(undefined);
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

  // ===== 学习者记忆（F9）=====
  // 全部动作的形态一致：服务层**注入 `storage`** → 落库 → 回读一次把 doc+meta 同步进 store。
  // 「回读」而不是「拼装返回值」是刻意的：storage 是唯一真源，拼装等于在这里再算一遍 doc
  //（「两把尺子」）。回读成本是两次 localStorage 读，可忽略。
  // ⚠️ 一律**不调 `refresh()`**：记忆不是计划输入（D2），调了会白算一遍计划快照。

  refreshMemory: async (signals, opts) => {
    const stats = await refreshFromFacts(storage, signals, opts);
    await syncMemory(set);
    return stats;
  },

  saveMemoryDoc: async (doc) => {
    await saveUserDoc(storage, doc);
    await syncMemory(set);
  },

  applyMemoryAi: async (entries, opts) => {
    const stats = await applyAiEntries(storage, entries, opts);
    await syncMemory(set);
    return stats;
  },

  clearMemory: async () => {
    await clearMemoryDoc(storage);
    await syncMemory(set);
  },

  restoreMemory: async () => {
    await restoreDismissed(storage);
    await syncMemory(set);
  },

  useSystemMemoryVersion: async (key, currentLine) => {
    await useSystemVersion(storage, key, currentLine);
    await syncMemory(set);
  },

  markMemoryFileSaved: async (at) => {
    await markFileSaved(storage, at);
    await syncMemory(set);
  },
}));

/**
 * 把 storage 里的记忆文档/元数据同步进 store（**回读**，不拼装）。
 *
 * 为什么每次变更后都回读而不是直接用返回值：服务层的返回是 stats（动作计数），
 * 不是最终文档；若在这里按 stats 拼文档，就等于把合并算法实现第二遍。
 */
async function syncMemory(set: (partial: Partial<LoopStoreState>) => void): Promise<void> {
  const { doc, meta } = await loadMemory(storage);
  set({ memoryDoc: doc, memoryMeta: meta });
}
