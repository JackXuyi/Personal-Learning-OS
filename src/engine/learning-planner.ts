/**
 * Learning Planner — Goal → gaps → ordered actions.
 *
 * Dependency-first: a gap unit is only actionable once its prerequisite gaps
 * are cleared, so a "bottleneck" prerequisite (e.g. Reranking blocking
 * Evaluation) naturally becomes the top action. Every action carries the
 * reasons behind it (Explainable principle).
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
      // Worst-first: not-started > learning > proficient, then lowest mastery
      // first — so "red" gaps surface before "yellow" reviews.
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

      // Depth-first over prerequisite gaps so dependencies come first.
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

        // If a dependent gap still exists below this unit, it's a bottleneck.
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
          `Required for goal "${goal.title}" (importance: ${goal.importance}).`,
          `Current mastery is ${Math.round(mastery * 100)}%, target ${MASTERY_THRESHOLD * 100}%.`,
        ];
        if (blockedDependents.length > 0) {
          const names = blockedDependents
            .map((id) => graph.units.find((u) => u.id === id)?.title ?? id)
            .join(", ");
          reasons.push(`Key bottleneck — prerequisites for: ${names}.`);
        }
        if (unit?.tags.includes("remediation")) {
          reasons.push("Known misconception from recent assessments.");
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
