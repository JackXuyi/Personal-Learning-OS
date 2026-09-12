/**
 * 章级前置软排序单测（docs/knowledge-sqlite-prereq-plan-design-2026-09.md §11，D2）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:prereq
 *
 * 覆盖：
 *  1) TC-UC03-01 前置未掌握 → 后移 + reasons 标注「前置章节」；
 *  2) TC-UC03-02 前置已达标 → 不标注、不后移；
 *  3) TC-UC03-03 无 graph / 空 graph → 与现状逐项一致（向后兼容）；
 *  4) TC-UC03-04 互为前置 → 双方各自标注，均出现，无死循环；
 *  5) TC-UC03-05 已达标但到期复习（cls=4）→ 不参与前置软排序；
 *  6) TC-EDGE-02 前置章不在计划范围内 → 忽略，不标注。
 */
import assert from "node:assert/strict";
import { buildChapterPlan } from "../src/engine/learning-planner.ts";
import { zh } from "../src/i18n/messages/zh.ts";
import type { Chapter } from "../src/domain/chapter.ts";
import type { KnowledgeGraph } from "../src/domain/knowledge.ts";
import type { LearnerState, UnitMastery } from "../src/domain/learner.ts";

const results: string[] = [];
let failures = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function chapter(id: string, order: number, title: string, unitIds: string[]): Chapter {
  return {
    id,
    documentId: "d1",
    order,
    title,
    contentRef: { start: order * 100, end: order * 100 + 100 },
    keyPoints: [],
    unitIds,
    status: "not-started",
    createdAt: 0,
  };
}

function mastery(patch: Partial<UnitMastery>): UnitMastery {
  return {
    mastery: 0,
    confidence: 0,
    attempts: 0,
    correctCount: 0,
    cognitiveLevel: "remember",
    misconceptions: [],
    applicationAbility: 0,
    interviewAbility: 0,
    ...patch,
  };
}

/** 章 A（含 2 概念）→ 概念 prerequisite → 章 B（含 1 概念）。 */
const CH_A = chapter("chA", 1, "第1章 文本切分", ["u1", "u2"]);
const CH_B = chapter("chB", 2, "第2章 向量检索", ["u3"]);
const GRAPH: KnowledgeGraph = {
  units: [
    { id: "u1", title: "分句", kind: "concept", tags: [], createdAt: 1 },
    { id: "u2", title: "重叠窗口", kind: "concept", tags: [], createdAt: 2 },
    { id: "u3", title: "向量召回", kind: "concept", tags: [], createdAt: 3 },
  ],
  relations: [
    { id: "r1", fromId: "u2", toId: "u3", type: "prerequisite" },
    { id: "r2", fromId: "u3", toId: "u1", type: "related" },
  ],
};
const NO_LEARNING: LearnerState = { byUnit: {} };
/** 前置章 chA 已达标（0.9）；chB 未学。 */
const A_MASTERED: LearnerState = { byUnit: { chA: mastery({ mastery: 0.9, attempts: 2 }) } };

const PREREQ_MARK = "前置章节";

check("TC-UC03-01 前置未掌握 → chB 排在 chA 之后且 reasons 标注", () => {
  const plan = buildChapterPlan({ chapters: [CH_A, CH_B], learnerState: NO_LEARNING, graph: GRAPH });
  assert.equal(plan.length, 2);
  assert.equal(plan[0].unitId, "chA", "前置章应排前");
  assert.equal(plan[1].unitId, "chB");
  assert.ok(
    plan[1].reasons.includes(zh.engine.prereqPending(CH_A.title)),
    `chB 应标注前置章节，实际：${plan[1].reasons.join(" | ")}`,
  );
  assert.ok(
    !plan[0].reasons.join(" ").includes(PREREQ_MARK),
    "chA 无前置，不应被标注",
  );
});

check("TC-UC03-02 前置章已达标 → 不标注", () => {
  const plan = buildChapterPlan({ chapters: [CH_A, CH_B], learnerState: A_MASTERED, graph: GRAPH });
  const b = plan.find((a) => a.unitId === "chB");
  assert.ok(b, "chB 应在计划中");
  assert.ok(!b.reasons.join(" ").includes(PREREQ_MARK), "前置已达标不应标注");
  assert.ok(!plan.some((a) => a.unitId === "chA"), "已达标且未到复习日的章不产生动作");
});

check("TC-UC03-03 无 graph / 空 graph → 与现状逐项一致（向后兼容）", () => {
  const withoutGraph = buildChapterPlan({ chapters: [CH_A, CH_B], learnerState: NO_LEARNING });
  const emptyGraph = buildChapterPlan({
    chapters: [CH_A, CH_B],
    learnerState: NO_LEARNING,
    graph: { units: [], relations: [] },
  });
  const shape = (plan: ReturnType<typeof buildChapterPlan>) =>
    plan.map((a) => ({ kind: a.kind, unitId: a.unitId, reasons: a.reasons }));
  assert.deepEqual(shape(emptyGraph), shape(withoutGraph));
  assert.ok(!shape(withoutGraph).some((s) => s.reasons.join(" ").includes(PREREQ_MARK)));
});

check("TC-UC03-04 互为前置 → 双方各自标注、均出现、无死循环", () => {
  const mutual: KnowledgeGraph = {
    ...GRAPH,
    relations: [
      { id: "r1", fromId: "u2", toId: "u3", type: "prerequisite" },
      { id: "r2", fromId: "u3", toId: "u1", type: "prerequisite" },
    ],
  };
  const plan = buildChapterPlan({ chapters: [CH_A, CH_B], learnerState: NO_LEARNING, graph: mutual });
  assert.equal(plan.length, 2, "双方都保留，不丢弃");
  const a = plan.find((x) => x.unitId === "chA");
  const b = plan.find((x) => x.unitId === "chB");
  assert.ok(a?.reasons.includes(zh.engine.prereqPending(CH_B.title)));
  assert.ok(b?.reasons.includes(zh.engine.prereqPending(CH_A.title)));
});

check("TC-UC03-05 已达标但到期复习（cls=4）→ 不标注前置", () => {
  const learner: LearnerState = {
    byUnit: {
      chA: mastery({ mastery: 0.4, attempts: 1 }),
      chB: mastery({ mastery: 0.9, attempts: 2, nextReviewAt: 1 }),
    },
  };
  const plan = buildChapterPlan({ chapters: [CH_A, CH_B], learnerState: learner, graph: GRAPH, now: 1000 });
  const b = plan.find((x) => x.unitId === "chB");
  assert.ok(b, "到期复习章应在计划中");
  assert.equal(b.kind, "review-points");
  assert.ok(!b.reasons.join(" ").includes(PREREQ_MARK), "到期复习不参与前置软排序");
});

check("TC-EDGE-02 前置章不在计划范围内 → 忽略，不标注", () => {
  // u9 属于未传入的 chC：跨文档/范围外前置不应让 chB 被标注。
  const outOfScope: KnowledgeGraph = {
    ...GRAPH,
    relations: [{ id: "r1", fromId: "u9", toId: "u3", type: "prerequisite" }],
  };
  const plan = buildChapterPlan({ chapters: [CH_A, CH_B], learnerState: NO_LEARNING, graph: outOfScope });
  const b = plan.find((x) => x.unitId === "chB");
  assert.ok(b);
  assert.ok(!b.reasons.join(" ").includes(PREREQ_MARK), "范围外前置必须忽略");
});

for (const line of results) console.log(line);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
