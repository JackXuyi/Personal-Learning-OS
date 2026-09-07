/**
 * 推荐引擎 —— 「下一步最佳动作」的决策。
 *
 * 从规划器输出中挑选优先级最高的动作。与规划器分离，
 * 以便未来更智能的模型可在不触碰缺口分析的前提下替换本步骤。
 */
import type { NextAction } from "../domain";

export interface RecommendationEngine {
  recommendNext(actions: NextAction[]): NextAction | undefined;
  topN(actions: NextAction[], n: number): NextAction[];
}

export function createRecommendationEngine(): RecommendationEngine {
  return {
    recommendNext(actions) {
      const sorted = [...actions].sort((a, b) => a.priority - b.priority);
      return sorted[0];
    },
    topN(actions, n) {
      return [...actions].sort((a, b) => a.priority - b.priority).slice(0, n);
    },
  };
}
