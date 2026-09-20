/**
 * 学习规划器 —— 概念层（buildPlan）+ V2 章级（buildChapterPlan）。
 *
 * 概念层（Phase 0 基座）：目标 → 缺口 → 有序动作。依赖优先：只有先决缺口
 * 被清除后，某缺口单元才可执行；瓶颈先决条件自然成为首要动作。每个动作
 * 都携带其背后的理由（可解释原则）。
 *
 * V2 章级（docs §5.5 / P7）：章集合 + 章掌握度 → 状态机排序动作。队列顺序
 * 遵循「重学弱章 > 补考弱章 > 复习要点 > 测已学章 > 到期复习(防遗忘) > 推进
 * 下一未学章」；章掌握度唯一写方为卷面（T3 双证据原则），补考判定用 MASTERY_FLOOR。
 * 到期复习（T9）：已达标章 nextReviewAt 过期后以低优先级复习动作重新入队。
 */
import type {
  Chapter,
  KnowledgeGraph,
  LearnerState,
  LearningGoal,
  NextAction,
  StudyDepth,
  UnitMastery,
} from "../domain";
import { MASTERY_FLOOR, MASTERY_THRESHOLD, newId } from "../domain";
import {
  chapterPrerequisiteIds,
  isDueReview,
  prerequisitesOf,
  sortChaptersByOrder,
} from "../domain";
import { bandOf, masteryOfUnit } from "./mastery-engine";
import type { Messages } from "../i18n/messages/zh";
import { zh } from "../i18n/messages/zh";

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

export function createLearningPlanner(m: Messages = zh): LearningPlanner {
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
          m.engine.goalRequired({ title: goal.title, importance: goal.importance }),
          m.engine.currentMastery(Math.round(mastery * 100), MASTERY_THRESHOLD * 100),
        ];
        if (blockedDependents.length > 0) {
          const names = blockedDependents
            .map((id) => graph.units.find((u) => u.id === id)?.title ?? id)
            .join("、");
          reasons.push(m.engine.bottleneckPrereq(names));
        }
        if (unit?.tags.includes("remediation")) {
          reasons.push(m.engine.knownMisconception);
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
  /**
   * 可选：概念图。传入后启用「章级前置软排序」（D2）——由概念 prerequisite 边
   * 推导章与章的先后，前置未掌握的章在同类内后移并在 reasons 里标注。
   * 缺省 = 现状行为（向后兼容：无图/空图与不传等价）。
   */
  graph?: KnowledgeGraph;
  /**
   * 可选：学习偏好（F1）。只消费 `depth` —— `style` 不参与排序
   * （状态机已定死 action kind，硬塞排序会产出「填了没用」的伪效果）。
   * 缺省 = 现状顺序（零回归）。
   */
  prefs?: { depth?: StudyDepth };
  /** 测试注入时间戳。 */
  now?: number;
}

/**
 * 队列类型序号：越小越前（重学弱章 > 补考 > 复习要点 > **测已学章 > 到期复习** >
 * 推进未学章）。实测档位：`0` 重学弱章 · `1` 补考 · `2` 复习要点 · **`3` 测已学章 ·
 * `4` 到期复习** · `5` 推进未学章。⚠️ 本行在 2026-09-20 前**写反**（旧文把到期复习
 * 排在测已学章之前），与文件头注释自相矛盾 —— 以本行为准。
 */
type ChapterActionSpec = {
  kind: "learn-chapter" | "chapter-quiz" | "retake-quiz" | "review-points";
  cls: number;
  mastery: number;
  order: number;
  chapterId: string;
  title: string;
  reasons: string[];
  /** 到期复习专属：下次复习时间（越早到期越先复习）。非到期动作缺省。 */
  dueAt?: number;
  /** 前置未掌握的章标题（软排序用；仅未达标章标注，到期复习不参与）。 */
  blocked?: string[];
};

const pct = (v: number): number => Math.round(v * 100);

/**
 * 队列档位覆盖（F1 学习偏好 · D3）。
 *
 * 默认恒等（`depth` 或未填写 → 与改动前逐项相同）。`breadth`（广度优先）把
 * 「推进未学章」(cls 5) 提到「测已学章」(cls 3) 之前 —— 先把全书铺开再统一测验。
 * **只在同类档位之间换序**，不跨过重学弱章 / 补考 / 复习要点 / 到期复习。
 */
export function clsRankMap(depth?: StudyDepth): Record<number, number> {
  if (depth === "breadth") return { 0: 0, 1: 1, 2: 2, 3: 5, 4: 4, 5: 3 };
  return { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
}

/**
 * 单章决策：已掌握 → 若到期复习（nextReviewAt 已过）给低优先级复习动作，
 * 否则无动作；未达标按 状态机 × 卷面证据 给一个最高优先动作。
 */
function specForChapter(
  chapter: Chapter,
  unit: UnitMastery | undefined,
  now: number,
  m: Messages,
): ChapterActionSpec | undefined {
  const mastery = unit?.mastery ?? 0;
  // 已达标（卷面 ≥0.8）且非 retake 态：仅当到复习日（T9 防遗忘）才入队低优先级复习。
  if (mastery >= MASTERY_THRESHOLD && chapter.status !== "retake") {
    if (!isDueReview(unit, now)) return undefined;
    const dueIn = Math.max(0, Math.round((now - (unit?.nextReviewAt ?? now)) / 86_400_000));
    return {
      kind: "review-points", cls: 4, mastery, order: chapter.order,
      chapterId: chapter.id, title: `《${chapter.title}》`,
      dueAt: unit?.nextReviewAt,
      reasons: [
        m.engine.chapterDue(chapter.title, dueIn),
        m.engine.reviewResetsSchedule,
      ],
    };
  }
  const title = `《${chapter.title}》`;

  // 状态机显式待补考 → 补考。
  if (chapter.status === "retake") {
    return {
      kind: "retake-quiz", cls: 1, mastery, order: chapter.order,
      chapterId: chapter.id, title,
      reasons: [
        m.engine.retakePending(chapter.title),
        m.engine.retakePlanNote(MASTERY_THRESHOLD * 100),
      ],
    };
  }

  const examined = (unit?.attempts ?? 0) > 0; // 是否有卷面证据
  if (examined) {
    if (mastery < MASTERY_FLOOR) {
      // 低掌握：<0.4 建议重读（重学弱章），0.4–0.6 直接补考。
      if (mastery < 0.4) {
        return {
          kind: "learn-chapter", cls: 0, mastery, order: chapter.order,
          chapterId: chapter.id, title,
          reasons: [
            m.engine.lowScoreReread(chapter.title, pct(mastery), MASTERY_FLOOR * 100),
            m.engine.thresholds(MASTERY_THRESHOLD * 100, MASTERY_FLOOR * 100),
          ],
        };
      }
      return {
        kind: "retake-quiz", cls: 1, mastery, order: chapter.order,
        chapterId: chapter.id, title,
        reasons: [
          m.engine.belowFloorRetake(chapter.title, pct(mastery), MASTERY_FLOOR * 100),
          m.engine.retakeEasier,
        ],
      };
    }
    return {
      kind: "review-points", cls: 2, mastery, order: chapter.order,
      chapterId: chapter.id, title,
      reasons: [
        m.engine.nearTargetReview(chapter.title, pct(mastery), MASTERY_THRESHOLD * 100),
        m.engine.reviewThenQuiz,
      ],
    };
  }

  // 尚无卷面证据：学完待测 → 单元测；未学/学习中 → 推进学习。
  if (chapter.status === "ready" || chapter.status === "mastered") {
    return {
      kind: "chapter-quiz", cls: 3, mastery, order: chapter.order,
      chapterId: chapter.id, title,
      reasons: [
        m.engine.chapterDoneVerify(chapter.title),
      ],
    };
  }
  return {
    kind: "learn-chapter", cls: 5, mastery, order: chapter.order,
    chapterId: chapter.id, title,
    reasons: [
      m.engine.chapterNotStarted(chapter.title),
    ],
  };
}

/**
 * 章级计划：为每章产出「下一步」动作并排序。
 *
 * 队列顺序（cls）：重学弱章(0) > 补考(1) > 复习要点(2) > 测已学章(3) >
 * 到期复习(4) > 推进未学章(5)；同类内**前置未掌握者后移**（D2 软排序，不跨类、
 * 不丢弃），再按掌握度低者在前（更弱先补），到期复习按到期先后（最久未复习的
 * 先复习），同掌握度按章 order。
 * 已达标章（mastery ≥ MASTERY_THRESHOLD 且非 retake 态）：到期（nextReviewAt
 * 已过，T9 防遗忘）才以低优先级复习动作入队，否则不产生动作。
 * 每个动作携带可解释理由（P7 计划页直接展示 reasons）。
 */
export function buildChapterPlan(
  input: ChapterPlanInput,
  m: Messages = zh,
): NextAction[] {
  const { learnerState, now = Date.now(), graph } = input;
  // F1：偏好的档位覆盖（默认恒等 → 零回归）。
  const rank = clsRankMap(input.prefs?.depth);
  // D2：概念 prerequisite 边 → 章级前置（未传图则为 undefined，全程不参与）。
  const prereqMap = graph ? chapterPrerequisiteIds(graph, input.chapters) : undefined;
  const chapterById = new Map(input.chapters.map((c) => [c.id, c]));
  const masteryOfChapter = (id: string): number => learnerState.byUnit[id]?.mastery ?? 0;

  const specs = sortChaptersByOrder(input.chapters)
    .map((chapter) => {
      const spec = specForChapter(chapter, learnerState.byUnit[chapter.id], now, m);
      if (spec === undefined || prereqMap === undefined) return spec;
      // 到期复习（cls=4）已是达标章的低优先级补漏，不参与前置软排序。
      if (spec.cls === 4) return spec;
      const blocked = (prereqMap.get(chapter.id) ?? [])
        .filter((pid) => chapterById.has(pid) && masteryOfChapter(pid) < MASTERY_THRESHOLD)
        .map((pid) => chapterById.get(pid)?.title ?? pid);
      if (blocked.length > 0) {
        spec.blocked = blocked;
        spec.reasons.push(m.engine.prereqPending(blocked.join("》《")));
      }
      return spec;
    })
    .filter((s): s is ChapterActionSpec => s !== undefined)
    .sort(
      (a, b) =>
        rank[a.cls] - rank[b.cls] ||
        // 软排序：同类内前置未掌握者后移（不跨类、不丢弃——用户仍可手动执行）。
        (a.blocked ? 1 : 0) - (b.blocked ? 1 : 0) ||
        (a.dueAt ?? Number.POSITIVE_INFINITY) - (b.dueAt ?? Number.POSITIVE_INFINITY) ||
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
