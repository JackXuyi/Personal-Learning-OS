/**
 * 自测卡（F5 第 4 条 —— 由章要点一键生成 flashcard，接入间隔重复）。
 *
 * 定位与两条边界（docs/learn-flashcard-design-2026-09.md §13 定案）：
 *
 * 1. **卡片内容不落库（D4-A）**：卡面每次由 `Chapter.keyPoints` / `keyPointRefs`
 *    **现场派生**（`DerivedCard`），持久化只存**调度状态**（`CardState`）。
 *    要点文本被重跑改写 = 这是一张**新卡**（旧状态成孤儿，由引擎静默清理）——
 *    这正是 SRS 想要的行为，也避免了「双真源」与章节合并/重排后的进度串味。
 * 2. **本能力零 AI 依赖（D2-A）**：不调用任何模型，卡面 100% 来自既有 `Chapter`
 *    字段 —— 是 F5 四条里唯一在未配置 AI 时也完全可用的能力。
 *
 * 不变量：
 * - **成卡充要条件是「有原文出处」**（D2-b-A）：`quote` 非空且区间有效。无出处的
 *   要点**不成卡**（绝不生成「正面 = 背面」的空卡），UI 如实提示去跑「AI 分析要点」。
 * - **卡片不改掌握度**：`CardState` 与 `mastery` 无任何通路 —— mastery 的唯一写方
 *   仍是卷面（`engine/quiz-engine.ts` → `applyPaperResult`）。证据流里卡片记为
 *   `kind="card"`、`delta=0`（本文件的调度状态不参与 `LearnerState`）。
 */

import type { SelfRating } from "./assessment";

/** 单次会话最多出卡数：防止「一口气 200 张」把复习变成苦役。 */
export const FLASHCARD_SESSION_CAP = 20;

/**
 * 派生卡 —— **不落库**。由 `engine/flashcard-engine.ts::deriveChapterCards` 现场派生。
 *
 * 卡面语义：**正面 = `quote`（原文摘录）**，**背面 = `point`（要点）+ 点回原文**。
 */
export interface DerivedCard {
  /**
   * 稳定 id：`card_` + djb2(`chapterId` + `"\u0000"` + `point`)。
   *
   * **内容派生**，不是 `${chapterId}#${index}` —— index 型 id 在要点被重跑改写、
   * 或章节被 F7-a 合并/重排（`engine/chapter-edit-engine.ts`）后会把旧调度状态
   * **错配到另一条要点上**（静默的数据串味）。
   */
  id: string;
  chapterId: string;
  documentId: string;
  /** 章内序号（仅展示 / 同章内排序用，**不参与 id 计算**）。 */
  index: number;
  /** 背面：AI 提炼的要点。 */
  point: string;
  /** 正面：原文摘录（**成卡的充要条件**）。 */
  quote: string;
  /** 原文在 `doc.textPreview` 中的绝对偏移（跳回原文 / 高亮用）。 */
  start: number;
  end: number;
}

/**
 * 卡级调度状态 —— **唯一落库内容**（key = `DerivedCard.id`）。
 *
 * 与章级 `UnitMastery` 的区别：这里只有调度信息，**没有掌握度**；四档自评只推进
 * `nextReviewAt`，不产生任何 `mastery` 变化（见本文件头注释）。
 */
export interface CardState {
  cardId: string;
  chapterId: string;
  documentId: string;
  /** 下次到期（epoch ms）；缺省 = 从未评分（新卡，不算到期）。 */
  nextReviewAt?: number;
  /** 最近一次评分时间。 */
  lastReviewedAt: number;
  /** 累计评分次数。 */
  reps: number;
  /** 最近一次自评档。 */
  lastRating: SelfRating;
  /** 累计「忘记」次数（诚实展示用，不参与调度算法）。 */
  lapses: number;
}

/** 全部卡级调度状态（key = `DerivedCard.id`）。存储 key：`plos.flashcards`。 */
export type CardStateMap = Record<string, CardState>;
