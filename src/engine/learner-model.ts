/**
 * Learner Model（学习者模型）—— 让持久化的 LearnerState 保持可信。
 *
 * 每次测评都会产生证据；证据驱动掌握度更新。答错会登记误解，
 * 答对会把认知层级向前推。所有函数都是纯函数——由调用方
 * （引擎 / store）负责持久化结果。
 */
import type { Evaluation } from "../domain";
import type { CognitiveLevel, LearnerState, UnitMastery } from "../domain";
import { accuracyOf } from "../domain";

/** Mastery delta applied when the model has nothing else to go on. */
const UP_STEP = 0.08;
const DOWN_STEP = 0.12;

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
  const MS_PER_DAY = 86_400_000;
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
  if (after >= 0.8 && idx < COGNITIVE_ORDER.length - 1) {
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
