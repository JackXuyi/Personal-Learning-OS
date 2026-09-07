/**
 * 学习规划器 —— 概念层（buildPlan）+ V2 章级（buildChapterPlan）。
 *
 * 概念层（Phase 0 基座）：目标 → 缺口 → 有序动作。依赖优先：只有先决缺口
 * 被清除后，某缺口单元才可执行；瓶颈先决条件自然成为首要动作。每个动作
 * 都携带其背后的理由（可解释原则）。
 *
 * V2 章级（docs §5.5 / P7）：章集合 + 章掌握度 → 状态机排序动作。队列顺序
 * 遵循「重学弱章 > 补考弱章 > 复习要点 > 测已学章 > 推进下一未学章」；
 * 章掌握度唯一写方为卷面（T3 双证据原则），补考判定用 MASTERY_FLOOR。
 */
import type {
  Chapter,
  KnowledgeGraph,
  LearnerState,
  LearningGoal,
  NextAction,
  UnitMastery,
} from "../domain";
import { MASTERY_FLOOR, MASTERY_THRESHOLD, newId } from "../domain";
import { prerequisitesOf, sortChaptersByOrder } from "../domain";
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

/* ------------------------------------------------------------------ */
/* V2 章级规划（T4）                                                   */
/* ------------------------------------------------------------------ */

export interface ChapterPlanInput {
  /** 计划范围的章（按 order 升序；调用方可先用 goal.requiredChapterIds 过滤）。 */
  chapters: Chapter[];
  learnerState: LearnerState;
  /** 测试注入时间戳。 */
  now?: number;
}

/** 队列类型序号：越小越前（重学弱章 > 补考 > 复习要点 > 测已学章 > 推进未学章）。 */
type ChapterActionSpec = {
  kind: "learn-chapter" | "chapter-quiz" | "retake-quiz" | "review-points";
  cls: number;
  mastery: number;
  order: number;
  chapterId: string;
  title: string;
  reasons: string[];
};

const pct = (v: number): number => Math.round(v * 100);

/** 单章决策：已掌握 → 无动作；否则按 状态机 × 卷面证据 给一个最高优先动作。 */
function specForChapter(
  chapter: Chapter,
  unit: UnitMastery | undefined,
): ChapterActionSpec | undefined {
  const m = unit?.mastery ?? 0;
  // 已达标（卷面 ≥0.8）→ 无动作；retake 状态例外（状态机显式要求补考）。
  if (m >= MASTERY_THRESHOLD && chapter.status !== "retake") return undefined;
  const title = `《${chapter.title}》`;

  // 状态机显式待补考 → 补考。
  if (chapter.status === "retake") {
    return {
      kind: "retake-quiz", cls: 1, mastery: m, order: chapter.order,
      chapterId: chapter.id, title,
      reasons: [
        `${title}处于待补考状态。`,
        `补考卷自动降一档难度，达标（${MASTERY_THRESHOLD * 100}%）后章状态回 mastered。`,
      ],
    };
  }

  const examined = (unit?.attempts ?? 0) > 0; // 是否有卷面证据
  if (examined) {
    if (m < MASTERY_FLOOR) {
      // 低掌握：<0.4 建议重读（重学弱章），0.4–0.6 直接补考。
      if (m < 0.4) {
        return {
          kind: "learn-chapter", cls: 0, mastery: m, order: chapter.order,
          chapterId: chapter.id, title,
          reasons: [
            `${title}卷面仅 ${pct(m)}%（低于 40%），建议重读本幕后补考。`,
            `达标线 ${MASTERY_THRESHOLD * 100}%，及格线 ${MASTERY_FLOOR * 100}%。`,
          ],
        };
      }
      return {
        kind: "retake-quiz", cls: 1, mastery: m, order: chapter.order,
        chapterId: chapter.id, title,
        reasons: [
          `${title}卷面 ${pct(m)}% 未达及格线（${MASTERY_FLOOR * 100}%），建议补考。`,
          "补考卷自动降一档难度。",
        ],
      };
    }
    return {
      kind: "review-points", cls: 2, mastery: m, order: chapter.order,
      chapterId: chapter.id, title,
      reasons: [
        `${title}掌握度 ${pct(m)}% 距达标线（${MASTERY_THRESHOLD * 100}%）一步之遥。`,
        "复习章内要点后可直考综合测。",
      ],
    };
  }

  // 尚无卷面证据：学完待测 → 单元测；未学/学习中 → 推进学习。
  if (chapter.status === "ready" || chapter.status === "mastered") {
    return {
      kind: "chapter-quiz", cls: 3, mastery: m, order: chapter.order,
      chapterId: chapter.id, title,
      reasons: [
        `${title}已标记学完，出单元测验证掌握度。`,
      ],
    };
  }
  return {
    kind: "learn-chapter", cls: 4, mastery: m, order: chapter.order,
    chapterId: chapter.id, title,
    reasons: [
      `${title}尚未学习——按顺序推进本章。`,
    ],
  };
}

/**
 * 章级计划：为每章产出「下一步」动作并排序。
 *
 * 队列顺序（cls）：重学弱章(0) > 补考(1) > 复习要点(2) > 测已学章(3) >
 * 推进未学章(4)；同类内掌握度低者在前（更弱先补），同掌握度按章 order。
 * 已达标章（mastery ≥ MASTERY_THRESHOLD 且非 retake 态）不产生动作。
 * 每个动作携带可解释理由（P7 计划页直接展示 reasons）。
 */
export function buildChapterPlan(input: ChapterPlanInput): NextAction[] {
  const { learnerState, now = Date.now() } = input;
  const specs = sortChaptersByOrder(input.chapters)
    .map((chapter) => specForChapter(chapter, learnerState.byUnit[chapter.id]))
    .filter((s): s is ChapterActionSpec => s !== undefined)
    .sort(
      (a, b) =>
        a.cls - b.cls ||
        a.mastery - b.mastery ||
        a.order - b.order,
    );

  return specs.map((s, i) => ({
    id: newId("action"),
    kind: s.kind,
    unitId: s.chapterId,
    priority: i,
    reasons: s.reasons,
    createdAt: now,
  }));
}
