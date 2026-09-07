/**
 * Recommendation Engine — the "Next Best Action" decision.
 *
 * Picks the highest-priority action from the planner's output. Kept separate
 * from the planner so a future smarter model can replace this step without
 * touching gap analysis.
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
