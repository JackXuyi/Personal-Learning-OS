/**
 * Learner Model（学习者模型）—— 让持久化的 LearnerState 保持可信。
 *
 * 每次测评都会产生证据；证据驱动掌握度更新。答错会登记误解，
 * 答对会把认知层级向前推。所有函数都是纯函数——由调用方
 * （引擎 / store）负责持久化结果。
 *
 * 双证据原则（V2）：subject（章 / 概念）的 mastery 唯一写方 = 卷面
 * （applyPaperResult）；自评（applyKeyPointRating）只做调度
 * （nextReviewAt）+ confidence 微调，不再移动 mastery / attempts / correctCount。
 */
import type { CognitiveLevel, Evaluation, LearnerState, SelfRating, UnitMastery } from "../domain";
import { MASTERY_FLOOR, MASTERY_THRESHOLD, accuracyOf } from "../domain";

/** Mastery delta applied when the model has nothing else to go on. */
const UP_STEP = 0.08;
const DOWN_STEP = 0.12;

/** 四档自评对应的掌握度增量（启发式，非测量值）。 */
const RATING_STEP: Record<SelfRating, number> = {
  forget: -DOWN_STEP,
  hard: 0.04,
  good: UP_STEP,
  easy: 0.12,
};

/** 四档自评对应的「下次复习」间隔天数（启发式）。 */
const RATING_INTERVAL_DAYS: Record<SelfRating, number> = {
  forget: 1,
  hard: 2,
  good: 4,
  easy: 7,
};

/** 卷面分数 → 下次复习间隔（天）：高分长间隔。 */
export function reviewIntervalDaysForScore(score: number): number {
  if (score >= MASTERY_THRESHOLD) return 7;
  if (score >= MASTERY_FLOOR) return 3;
  return 1;
}

/** 自评 → 下次复习间隔（天）。 */
export function nextReviewInDays(rating: SelfRating): number {
  return RATING_INTERVAL_DAYS[rating];
}

/** 自评 → 掌握度增量（供 UI 预览「忘记→1 天…」与 DeltaBadge）。 */
export function ratingStep(rating: SelfRating): number {
  return RATING_STEP[rating];
}

const MS_PER_DAY = 86_400_000;

const COGNITIVE_ORDER: readonly CognitiveLevel[] = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
];

export function emptyUnit(now: number): UnitMastery {
  return {
    mastery: 0,
    confidence: 0,
    attempts: 0,
    correctCount: 0,
    cognitiveLevel: "remember",
    misconceptions: [],
    applicationAbility: 0,
    interviewAbility: 0,
    lastAssessmentAt: now,
  };
}

export function masteryOf(state: LearnerState, unitId: string): UnitMastery | undefined {
  return state.byUnit[unitId];
}

/**
 * 卷面 → 新掌握度（docs §3 步骤 3）：newMastery = 0.65 × score + 0.35 × prev，
 * 含历史分量，避免单次考试波动把掌握度带偏。
 */
export function smoothedMastery(score: number, prevMastery: number): number {
  return clamp01(0.65 * score + 0.35 * prevMastery);
}

/** Apply an evaluation result to the learner state (pure, returns a new state). */
export function applyEvaluation(
  state: LearnerState,
  unitId: string,
  evaluation: Evaluation,
  now: number,
): LearnerState {
  const prev = state.byUnit[unitId] ?? emptyUnit(now);
  const correct = evaluation.correct;

  const mastery = clamp01(prev.mastery + (correct ? UP_STEP : -DOWN_STEP));
  const attempts = prev.attempts + 1;
  const correctCount = prev.correctCount + (correct ? 1 : 0);

  const misconceptions = correct
    ? prev.misconceptions.filter((m) => !evaluation.misconceptionsDetected.includes(m))
    : dedupe([...prev.misconceptions, ...evaluation.misconceptionsDetected]);

  // 置信度向「观测到的正确率」靠拢；在真实证据（项目、面试）
  // 到来之前，应用/面试能力先跟随掌握度。
  const observed = accuracyOf({ ...prev, correctCount, attempts });
  const confidence = clamp01(prev.confidence + (observed - prev.confidence) * 0.2);
  const cognitiveLevel = nextCognitiveLevel(prev.cognitiveLevel, correct, mastery);

  return {
    ...state,
    byUnit: {
      ...state.byUnit,
      [unitId]: {
        ...prev,
        mastery,
        confidence,
        attempts,
        correctCount,
        misconceptions,
        cognitiveLevel,
        applicationAbility: clamp01(mastery * 0.9),
        interviewAbility: clamp01(mastery * 0.6),
        lastAssessmentAt: now,
        lastReviewedAt: now,
      },
    },
  };
}

/**
 * 遗忘曲线（Phase 2 简化版）：若某知识单元超过 `halfLifeDays` 天未被复习，
 * 其掌握度会向底线衰减。纯函数 —— 返回新的状态。
 */
export function applyForgetting(
  state: LearnerState,
  now: number,
  halfLifeDays = 30,
): LearnerState {
  const byUnit = { ...state.byUnit };
  let changed = false;

  for (const [id, unit] of Object.entries(byUnit)) {
    const last = unit.lastReviewedAt ?? 0;
    if (last === 0) continue;
    const days = (now - last) / MS_PER_DAY;
    if (days <= halfLifeDays) continue;

    const decay = Math.min(0.05, 0.5 * (1 - Math.exp(-(days - halfLifeDays) / halfLifeDays)));
    if (decay <= 0.001) continue;
    changed = true;
    byUnit[id] = {
      ...unit,
      mastery: clamp01(unit.mastery * (1 - decay)),
      confidence: clamp01(unit.confidence * (1 - decay)),
    };
  }
  return changed ? { ...state, byUnit } : state;
}

/**
 * 卷面结果回写（V2 章掌握度唯一写方，双证据原则）。
 *
 * 纯函数。由 gradePaper → gradeAndApply（quiz-engine）为每章调用：
 *   - mastery = smoothedMastery(score, prevMastery)；
 *   - confidence 向卷面分平滑靠拢（卷面是真实对错证据）；
 *   - attempts / correctCount 累加客观题证据（evidenceCorrect / evidenceTotal）；
 *   - nextReviewAt 按卷面分数档写入（P0-1）；认知层级按达标情况推进。
 * misconceptions 不在此处推断（P0-3：待 AI 批语回填，避免本地猜测污染）。
 */
export function applyPaperResult(
  state: LearnerState,
  subjectId: string,
  input: { score: number; evidenceCorrect: number; evidenceTotal: number },
  now: number,
): LearnerState {
  const prev = state.byUnit[subjectId] ?? emptyUnit(now);
  const mastery = smoothedMastery(input.score, prev.mastery);
  const confidence = clamp01(0.65 * input.score + 0.35 * prev.confidence);
  const attempts = prev.attempts + input.evidenceTotal;
  const correctCount = prev.correctCount + input.evidenceCorrect;
  const cognitiveLevel = nextCognitiveLevel(
    prev.cognitiveLevel,
    input.score >= MASTERY_FLOOR,
    mastery,
  );

  return {
    ...state,
    byUnit: {
      ...state.byUnit,
      [subjectId]: {
        ...prev,
        mastery,
        confidence,
        attempts,
        correctCount,
        cognitiveLevel,
        applicationAbility: clamp01(mastery * 0.9),
        interviewAbility: clamp01(mastery * 0.6),
        lastAssessmentAt: now,
        lastReviewedAt: now,
        nextReviewAt: now + reviewIntervalDaysForScore(input.score) * MS_PER_DAY,
      },
    },
  };
}

/**
 * 章内要点复习的四档自评（V2 定位；替代 applyRating 的 mastery 副作用）。
 *
 * 只做调度 + 置信度微调：写 nextReviewAt / lastReviewedAt / confidence，
 * 不移动 mastery / attempts / correctCount —— 章掌握度由卷面唯一写方
 * （双证据原则）。ReviewSession 切换至章内要点复习后改调本函数。
 */
export function applyKeyPointRating(
  state: LearnerState,
  subjectId: string,
  rating: SelfRating,
  now: number,
): LearnerState {
  const prev = state.byUnit[subjectId] ?? emptyUnit(now);
  const step = RATING_STEP[rating];
  return {
    ...state,
    byUnit: {
      ...state.byUnit,
      [subjectId]: {
        ...prev,
        confidence: clamp01(prev.confidence + step * 0.5),
        lastReviewedAt: now,
        nextReviewAt: now + RATING_INTERVAL_DAYS[rating] * MS_PER_DAY,
      },
    },
  };
}

/**
 * 概念层复习的四档自评（遗留入口：卷面闭环接入前，概念级演示仍靠自评
 * 移动 mastery；接入后 UI 改调 applyKeyPointRating）。
 *
 * 修正（P1 attempts 污染）：自评不是「对错」证据，不再 attempts + 1 /
 * correctCount 累加，避免稀释正确率、压置信度。写入 nextReviewAt（P0-1）。
 */
export function applyRating(
  state: LearnerState,
  unitId: string,
  rating: SelfRating,
  now: number,
): LearnerState {
  const prev = state.byUnit[unitId] ?? emptyUnit(now);
  const step = RATING_STEP[rating];
  return {
    ...state,
    byUnit: {
      ...state.byUnit,
      [unitId]: {
        ...prev,
        mastery: clamp01(prev.mastery + step),
        confidence: clamp01(prev.confidence + step * 0.5),
        lastReviewedAt: now,
        nextReviewAt: now + RATING_INTERVAL_DAYS[rating] * MS_PER_DAY,
      },
    },
  };
}

function nextCognitiveLevel(
  current: CognitiveLevel,
  correct: boolean,
  after: number,
): CognitiveLevel {
  if (!correct) {
    // 高位档明显答错时下调一级。
    if (after < 0.4) return current === "remember" ? current : "understand";
    return current;
  }
  const idx = COGNITIVE_ORDER.indexOf(current);
  if (after >= MASTERY_THRESHOLD && idx < COGNITIVE_ORDER.length - 1) {
    return COGNITIVE_ORDER[Math.min(idx + 1, COGNITIVE_ORDER.length - 1)];
  }
  if (after >= 0.5 && idx === 0) return "understand";
  return current;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
