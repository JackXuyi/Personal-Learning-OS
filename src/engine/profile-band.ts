/**
 * 画像 → 难度带 / 阅读速度（F1）。
 *
 * 为什么单独成文件：难度带的**先验映射**同时被出卷引擎（`quiz-engine`）与
 * 展示侧（`features/learn/paper-advice`）消费，两处必须同口径（paper-advice
 * 文件头明确要求「推荐带与实出带一致」）。放在此处作为单一真源，避免两边
 * 各写一份 `LEVEL_BAND` 后漂移。
 *
 * 只依赖 `domain` 与 `quiz-engine.bandOfMastery`，无 React / 无 storage。
 */
import type { DifficultyBand } from "./quiz-engine";
import { bandOfMastery } from "./quiz-engine";
import type { LearnerLevel, LearnerProfile, UnitMastery } from "../domain";

/**
 * 四档自评水平 → 三档难度带的**先验**映射（D4-A）。
 *
 * `beginner` 与 `basic` 同为 band 1（band 1 已含「记忆 + 理解」两个认知层，
 * 恰好对应「没接触过」与「读过但不会用」）；两者的差异落在**阅读速度因子**
 * （见 `LEVEL_PACE`）与 AI 讲解深浅，不落在题型难度上 —— 这样既不扩散
 * `DifficultyBand` 枚举（不动 `cognitiveOf` / 出题配额 / 主观题门），
 * 四个档位又各自仍有真实影响。
 */
const LEVEL_BAND: Record<LearnerLevel, DifficultyBand> = {
  beginner: 1,
  basic: 1,
  intermediate: 2,
  advanced: 3,
};

/**
 * 四档自评水平 → 阅读速度（字/分）。
 *
 * 显式镜像 `features/plan/chapter-action.ts` 的既有硬编码 350（`DEFAULT_PACE`）：
 * 分层约束不允许 `engine/` import `features/`，故两侧同值并各自注释来源。
 */
const LEVEL_PACE: Record<LearnerLevel, number> = {
  beginner: 300,
  basic: 350,
  intermediate: 400,
  advanced: 450,
};

/** 无画像时的默认阅读速度 = 既有硬编码值（350）→ 零回归。 */
export const DEFAULT_PACE = 350;

/** 自评水平 → 难度带先验；未填写 → band 1（与改动前 `bandOfMastery(undefined)` 同值）。 */
export function bandForLevel(level?: LearnerLevel): DifficultyBand {
  return level ? LEVEL_BAND[level] : 1;
}

/**
 * 单章难度带：**有掌握度证据看实测，无证据看自评先验**。
 *
 * 证据判据是 `attempts > 0 || mastery > 0` —— 不能只看 `attempts`：
 * `applyKeyPointRating` 不动 mastery/attempts，而 `applyRating` **会移动 mastery
 * 但不增 attempts**（`engine/learner-model.ts:219 / :248`），故
 * 「mastery > 0 而 attempts === 0」是合法状态，只看 attempts 会把它误判为
 * 「无证据」，让自评覆盖掉实测。
 */
export function bandForChapter(
  unit: UnitMastery | undefined,
  profile?: LearnerProfile,
): DifficultyBand {
  if (unit && (unit.attempts > 0 || unit.mastery > 0)) return bandOfMastery(unit.mastery);
  return bandForLevel(profile?.level);
}

/** 阅读速度（字/分）：无画像 → `DEFAULT_PACE`（既有 350，零回归）。 */
export function paceOf(profile?: LearnerProfile): number {
  return profile ? LEVEL_PACE[profile.level] : DEFAULT_PACE;
}
