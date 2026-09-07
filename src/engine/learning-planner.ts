/**
 * 学习规划器 —— 目标 → 缺口 → 有序动作。
 *
 * 依赖优先：只有先决缺口被清除后，某缺口单元才可执行，因此像
 * Reranking 阻塞 Evaluation 这样的「瓶颈」先决条件会自然成为首要动作。
 * 每个动作都携带其背后的理由（可解释原则）。
 */
import type { KnowledgeGraph, LearnerState, LearningGoal, NextAction } from "../domain";
import { MASTERY_THRESHOLD, newId } from "../domain";
import { prerequisitesOf } from "../domain";
import { bandOf, masteryOfUnit } from "./mastery-engine";

export interface PlanInput {
  goal: LearningGoal;
  graph: KnowledgeGraph;
  learnerState: LearnerState;
}

export interface LearningPlanner {
  buildPlan(input: PlanInput): NextAction[];
}

function kindForMastery(mastery: number): NextAction["kind"] {
  switch (bandOf(mastery)) {
    case "not-started":
      return "learn";
    case "learning":
      return "practice";
    default:
      return "review";
  }
}

export function createLearningPlanner(): LearningPlanner {
  return {
    buildPlan({ goal, graph, learnerState }) {
      const gaps = goal.requiredUnitIds.filter(
        (unitId) => masteryOfUnit(learnerState, unitId) < MASTERY_THRESHOLD,
      );
      // 按严重度优先：not-started > learning > proficient，再按掌握度升序，
      // 让「红色」缺口先于「黄色」复习项浮现。
      const severity = (m: number): number => {
        switch (bandOf(m)) {
          case "not-started":
            return 0;
          case "learning":
            return 1;
          default:
            return 2;
        }
      };
      const sortedGaps = [...gaps].sort(
        (a, b) =>
          severity(masteryOfUnit(learnerState, a)) -
            severity(masteryOfUnit(learnerState, b)) ||
          masteryOfUnit(learnerState, a) - masteryOfUnit(learnerState, b),
      );
      const gapSet = new Set(sortedGaps);
      const actions: NextAction[] = [];
      const visited = new Set<string>();

      // 对先决缺口做深度优先遍历，使依赖项排在前面。
      const visit = (unitId: string) => {
        if (visited.has(unitId)) return;
        visited.add(unitId);
        if (!gapSet.has(unitId)) return;

        const unit = graph.units.find((u) => u.id === unitId);
        const mastery = masteryOfUnit(learnerState, unitId);
        const prereqs = prerequisitesOf(graph, unitId);
        for (const prereq of prereqs) {
          if (gapSet.has(prereq.id)) visit(prereq.id);
        }

        // 若该单元之下仍有依赖它的缺口，它就是瓶颈。
        const blockedDependents = gaps.filter((otherId) =>
          otherId !== unitId &&
          !visited.has(otherId) &&
          graph.relations.some(
            (r) =>
              r.fromId === unitId &&
              r.toId === otherId &&
              r.type === "prerequisite",
          ),
        );

        const reasons: string[] = [
          `目标「${goal.title}」所需（重要度：${goal.importance}）。`,
          `当前掌握度为 ${Math.round(mastery * 100)}%，目标 ${MASTERY_THRESHOLD * 100}%。`,
        ];
        if (blockedDependents.length > 0) {
          const names = blockedDependents
            .map((id) => graph.units.find((u) => u.id === id)?.title ?? id)
            .join("、");
          reasons.push(`关键瓶颈 —— 以下内容的先决条件：${names}。`);
        }
        if (unit?.tags.includes("remediation")) {
          reasons.push("近期测评中发现的已知误解。");
        }

        actions.push({
          id: newId("action"),
          kind: kindForMastery(mastery),
          unitId,
          priority: actions.length,
          reasons,
          createdAt: Date.now(),
        });
      };

      for (const unitId of sortedGaps) visit(unitId);
      return actions;
    },
  };
}
