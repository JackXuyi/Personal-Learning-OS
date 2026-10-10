/**
 * 章级前置「人工覆盖」单测（F7 范围 4，
 * docs/chapter-prereq-override-design-2026-09.md §6）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:prereqoverride
 *
 * 覆盖：
 *  A. domain 合并语义 —— `chapterPrerequisiteIds` 叠加人工增删、自环剔除、
 *     无自动前置时人工项照样入库；
 *  B. domain 开关归一化 —— `togglePrereqOverride` 不攒无意义记录、空即 undefined；
 *  C. domain 视图 —— `chapterPrereqEntries` 的来源标记与保序；
 *  D. 存储 —— upsert / 深度拷贝 / 确定性顺序 / 幂等删除 / clearAll；
 *  E. 服务 —— `applyPrereqToggle` 的落库与「回到纯自动即删记录」；
 *  F. 计划端到端 —— 人工增删真的改变 `buildChapterPlan` 的标注与排序，
 *     且**没有概念图时人工项仍然生效**（回归门：不能依赖 graph 是否传了）。
 *
 * ⚠️ 本文件与 `tests/planner-prereq.test.ts` 的分工：那份测 **D2 自动推导**的
 * 软排序行为（无人工作用时与旧口径逐项一致），本份测**人工覆盖**这一层。
 */
import assert from "node:assert/strict";
import { buildChapterPlan } from "../src/engine/learning-planner.ts";
import {
  chapterPrereqEntries,
  chapterPrerequisiteIds,
  prereqOverrideMap,
  togglePrereqOverride,
} from "../src/domain/knowledge.ts";
import type { ChapterPrereqOverride, KnowledgeGraph } from "../src/domain/knowledge.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import {
  applyPrereqToggle,
  clearPrereqOverride,
  loadPrereqOverrides,
} from "../src/features/learn/prereq-service.ts";
import { zh } from "../src/i18n/messages/zh.ts";
import type { Chapter } from "../src/domain/chapter.ts";
import type { LearnerState } from "../src/domain/learner.ts";

const results: string[] = [];
let failures = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
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

/** 章 A（u1/u2）→ 概念 u2 是 u3 的 prerequisite → 章 B（u3）。C 无概念。 */
const CH_A = chapter("chA", 1, "第1章 文本切分", ["u1", "u2"]);
const CH_B = chapter("chB", 2, "第2章 向量检索", ["u3"]);
const CH_C = chapter("chC", 3, "第3章 端到端联调", []);
const GRAPH: KnowledgeGraph = {
  units: [
    { id: "u1", title: "分句", kind: "concept", tags: [], createdAt: 1 },
    { id: "u2", title: "重叠窗口", kind: "concept", tags: [], createdAt: 2 },
    { id: "u3", title: "向量召回", kind: "concept", tags: [], createdAt: 3 },
  ],
  relations: [{ id: "r1", fromId: "u2", toId: "u3", type: "prerequisite" }],
};
const NO_LEARNING: LearnerState = { byUnit: {} };
const PREREQ_MARK = "前置章节";

/** 便捷构造：只给某一章一条覆盖记录。 */
function overrideOf(
  chapterId: string,
  added: string[] = [],
  removed: string[] = [],
): Map<string, ChapterPrereqOverride> {
  return new Map([[chapterId, { chapterId, added, removed }]]);
}

/* ------------------------------------------------------------ A. 合并语义 */

await check("A1 无人工作用时与旧口径逐项一致（空 Map ≡ 不传）", () => {
  const without = chapterPrerequisiteIds(GRAPH, [CH_A, CH_B]);
  const empty = chapterPrerequisiteIds(GRAPH, [CH_A, CH_B], new Map());
  assert.deepEqual([...empty], [...without]);
  assert.deepEqual(without.get("chB"), ["chA"]);
  assert.equal(without.has("chA"), false, "chA 无前置，不该出现在 Map 里");
});

await check("A2 人工新增：无自动前置的章也能被指定前置", () => {
  const map = chapterPrerequisiteIds(GRAPH, [CH_A, CH_B, CH_C], overrideOf("chC", ["chA"]));
  assert.deepEqual(map.get("chC"), ["chA"]);
  assert.deepEqual(map.get("chB"), ["chA"], "自动推导不受影响");
});

await check("A3 人工剔除：自动前置被移除后该章从 Map 里消失（空集不占位）", () => {
  const map = chapterPrerequisiteIds(GRAPH, [CH_A, CH_B], overrideOf("chB", [], ["chA"]));
  assert.equal(map.has("chB"), false);
});

await check("A4 人工增删叠加：先剔自动、再加另一条", () => {
  const map = chapterPrerequisiteIds(
    GRAPH,
    [CH_A, CH_B, CH_C],
    overrideOf("chB", ["chC"], ["chA"]),
  );
  assert.deepEqual(map.get("chB"), ["chC"]);
});

await check("A5 自环剔除：把章自己设为前置无效", () => {
  const map = chapterPrerequisiteIds(GRAPH, [CH_A, CH_B], overrideOf("chA", ["chA"]));
  assert.equal(map.has("chA"), false);
});

await check("A6 人工项不按范围过滤（用户显式指定的不被本次调用的 chapters 抹掉）", () => {
  // chA 不在本次范围内，但它被显式指定为 chC 的前置 → 仍应产出（下游按范围兜底）。
  const map = chapterPrerequisiteIds(GRAPH, [CH_C], overrideOf("chC", ["chA"]));
  assert.deepEqual(map.get("chC"), ["chA"]);
});

/* ---------------------------------------------------- B. 开关归一化 */

await check("B1 与自动一致的人工意图不落记录（want=true 且本就是自动）", () => {
  assert.equal(togglePrereqOverride(undefined, "chB", "chA", true, ["chA"]), undefined);
});

await check("B2 want=false 且本就不是前置 → 无记录可落", () => {
  assert.equal(togglePrereqOverride(undefined, "chC", "chA", false, []), undefined);
});

await check("B3 非自动项 want=true → 记入 added（removed 顺带清掉）", () => {
  const next = togglePrereqOverride(
    { chapterId: "chC", added: [], removed: ["chA"] },
    "chC",
    "chA",
    true,
    [],
  );
  assert.deepEqual(next, { chapterId: "chC", added: ["chA"], removed: [] });
});

await check("B4 自动项 want=false → 记入 removed", () => {
  assert.deepEqual(togglePrereqOverride(undefined, "chB", "chA", false, ["chA"]), {
    chapterId: "chB",
    added: [],
    removed: ["chA"],
  });
});

await check("B5 取消人工新增后回到 undefined（记录被清空）", () => {
  const added = togglePrereqOverride(undefined, "chC", "chA", true, []);
  assert.deepEqual(added?.added, ["chA"]);
  assert.equal(togglePrereqOverride(added, "chC", "chA", false, []), undefined);
});

await check("B6 恢复自动（want=true 且是自动项）→ 抵消 removed，记录消失", () => {
  const removed = togglePrereqOverride(undefined, "chB", "chA", false, ["chA"]);
  assert.equal(togglePrereqOverride(removed, "chB", "chA", true, ["chA"]), undefined);
});

await check("B7 自环开关是恒等（不改动当前记录）", () => {
  const current: ChapterPrereqOverride = { chapterId: "chC", added: ["chA"], removed: [] };
  assert.equal(togglePrereqOverride(current, "chC", "chC", false, []), current);
});

/* ------------------------------------------------------------ C. 视图 */

await check("C1 生效条目带来源标记，且自动在前、人工在后", () => {
  const entries = chapterPrereqEntries(["a", "b"], {
    chapterId: "x",
    added: ["c"],
    removed: ["a"],
  });
  assert.deepEqual(entries, [
    { chapterId: "b", origin: "auto" },
    { chapterId: "c", origin: "manual" },
  ]);
});

await check("C2 added 与自动重复时不重复出现（仍标为自动）", () => {
  const entries = chapterPrereqEntries(["a"], { chapterId: "x", added: ["a"], removed: [] });
  assert.deepEqual(entries, [{ chapterId: "a", origin: "auto" }]);
});

await check("C3 无覆盖记录时即自动集合原样", () => {
  assert.deepEqual(chapterPrereqEntries(["a", "b"], undefined), [
    { chapterId: "a", origin: "auto" },
    { chapterId: "b", origin: "auto" },
  ]);
});

await check("C4 prereqOverrideMap：按 chapterId 建索引（后者覆盖前者）", () => {
  const map = prereqOverrideMap([
    { chapterId: "x", added: ["a"], removed: [] },
    { chapterId: "y", added: [], removed: ["b"] },
  ]);
  assert.equal(map.size, 2);
  assert.deepEqual(map.get("y"), { chapterId: "y", added: [], removed: ["b"] });
});

/* ------------------------------------------------------------ D. 存储 */

await check("D1 upsert / list / 幂等 delete", async () => {
  const s = new InMemoryStorage();
  assert.deepEqual(await s.listPrereqOverrides(), []);
  await s.savePrereqOverride({ chapterId: "chB", added: ["chA"], removed: [] });
  await s.savePrereqOverride({ chapterId: "chB", added: ["chA", "chC"], removed: [] });
  assert.deepEqual(await s.listPrereqOverrides(), [
    { chapterId: "chB", added: ["chA", "chC"], removed: [] },
  ]);
  await s.deletePrereqOverride("chB");
  await s.deletePrereqOverride("chB"); // 幂等
  assert.deepEqual(await s.listPrereqOverrides(), []);
});

await check("D2 list 返回深拷贝（改返回值不污染存储）", async () => {
  const s = new InMemoryStorage();
  await s.savePrereqOverride({ chapterId: "chB", added: ["chA"], removed: [] });
  const first = await s.listPrereqOverrides();
  first[0].added.push("chC");
  first[0].removed.push("chA");
  assert.deepEqual(await s.listPrereqOverrides(), [
    { chapterId: "chB", added: ["chA"], removed: [] },
  ]);
});

await check("D3 save 存入的是副本（外部数组后续被改不影响存储）", async () => {
  const s = new InMemoryStorage();
  const added = ["chA"];
  await s.savePrereqOverride({ chapterId: "chB", added, removed: [] });
  added.push("chC");
  assert.deepEqual((await s.listPrereqOverrides())[0].added, ["chA"]);
});

await check("D4 顺序确定（按 chapterId 升序，与写入顺序无关）", async () => {
  const s = new InMemoryStorage();
  await s.savePrereqOverride({ chapterId: "chZ", added: ["a"], removed: [] });
  await s.savePrereqOverride({ chapterId: "chA", added: ["b"], removed: [] });
  assert.deepEqual(
    (await s.listPrereqOverrides()).map((o) => o.chapterId),
    ["chA", "chZ"],
  );
});

await check("D5 clearAll 后覆盖记录清空（不留在盘上成为孤儿）", async () => {
  const s = new InMemoryStorage();
  await s.savePrereqOverride({ chapterId: "chB", added: ["chA"], removed: [] });
  await s.clearAll();
  assert.deepEqual(await s.listPrereqOverrides(), []);
});

/* ------------------------------------------------------------ E. 服务 */

await check("E1 loadPrereqOverrides：数组 → Map", async () => {
  const s = new InMemoryStorage();
  await s.savePrereqOverride({ chapterId: "chB", added: ["chA"], removed: [] });
  const map = await loadPrereqOverrides({ storage: s });
  assert.ok(map.has("chB"));
  assert.deepEqual(map.get("chB")?.added, ["chA"]);
});

await check("E2 applyPrereqToggle：落库；抵消后删除记录", async () => {
  const s = new InMemoryStorage();
  const first = await applyPrereqToggle(
    { chapterId: "chC", targetId: "chA", want: true, derived: [], current: undefined },
    { storage: s },
  );
  assert.deepEqual(first, { chapterId: "chC", added: ["chA"], removed: [] });
  assert.equal((await s.listPrereqOverrides()).length, 1);

  const second = await applyPrereqToggle(
    { chapterId: "chC", targetId: "chA", want: false, derived: [], current: first },
    { storage: s },
  );
  assert.equal(second, undefined);
  assert.equal((await s.listPrereqOverrides()).length, 0, "回到纯自动必须删掉记录");
});

await check("E3 clearPrereqOverride：幂等删除", async () => {
  const s = new InMemoryStorage();
  await s.savePrereqOverride({ chapterId: "chB", added: ["chA"], removed: [] });
  await clearPrereqOverride("chB", { storage: s });
  await clearPrereqOverride("chB", { storage: s });
  assert.equal((await s.listPrereqOverrides()).length, 0);
});

/* ------------------------------------------------- F. 计划端到端 */

await check("F1 人工新增前置 → 计划里被标注且后移", () => {
  const plan = buildChapterPlan(
    {
      chapters: [CH_A, CH_B, CH_C],
      learnerState: NO_LEARNING,
      graph: GRAPH,
      prereqOverrides: overrideOf("chC", ["chA"]),
    },
    zh,
  );
  const c = plan.find((a) => a.unitId === "chC");
  assert.ok(c, "chC 应在计划中");
  assert.ok(
    c.reasons.includes(zh.engine.prereqPending(CH_A.title)),
    `chC 应标注人工前置，实际：${c.reasons.join(" | ")}`,
  );
  assert.ok(
    plan.indexOf(c) > plan.findIndex((a) => a.unitId === "chA"),
    "前置未掌握的章应排在同类之后",
  );
});

await check("F2 人工剔除前置 → 不再被标注", () => {
  const marked = buildChapterPlan(
    { chapters: [CH_A, CH_B], learnerState: NO_LEARNING, graph: GRAPH },
    zh,
  );
  assert.ok(marked[1].reasons.join(" ").includes(PREREQ_MARK), "前置条件：自动推导本应标注");
  const plan = buildChapterPlan(
    {
      chapters: [CH_A, CH_B],
      learnerState: NO_LEARNING,
      graph: GRAPH,
      prereqOverrides: overrideOf("chB", [], ["chA"]),
    },
    zh,
  );
  const b = plan.find((a) => a.unitId === "chB");
  assert.ok(b);
  assert.ok(!b.reasons.join(" ").includes(PREREQ_MARK), "人工剔除后不该再标注");
});

await check("F3 无概念图但有人工覆盖 → 仍然生效（不能只看 graph 决定开关）", () => {
  const plan = buildChapterPlan(
    {
      chapters: [CH_A, CH_C],
      learnerState: NO_LEARNING,
      prereqOverrides: overrideOf("chC", ["chA"]),
    },
    zh,
  );
  const c = plan.find((a) => a.unitId === "chC");
  assert.ok(c?.reasons.includes(zh.engine.prereqPending(CH_A.title)));
});

await check("F4 零回归：无图 + 空覆盖 Map ≡ 两个都不传", () => {
  const bare = buildChapterPlan({ chapters: [CH_A, CH_B, CH_C], learnerState: NO_LEARNING }, zh);
  const emptyOverrides = buildChapterPlan(
    {
      chapters: [CH_A, CH_B, CH_C],
      learnerState: NO_LEARNING,
      prereqOverrides: new Map(),
    },
    zh,
  );
  const shape = (plan: ReturnType<typeof buildChapterPlan>) =>
    plan.map((a) => ({ kind: a.kind, unitId: a.unitId, reasons: a.reasons }));
  assert.deepEqual(shape(emptyOverrides), shape(bare));
  assert.ok(!shape(bare).some((s) => s.reasons.join(" ").includes(PREREQ_MARK)));
});

for (const line of results) console.log(line);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
