/**
 * 跨文档概念图谱 纯函数单测（方案 `docs/cross-document-concept-graph-design-2026-10.md` §12）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:xdoc
 *
 * 覆盖：A 归属三级回退 / B 筛选集合 / C 核心子图 / D 集成 / E 边界与回归 / F 源文件卫生。
 *
 * ⚠️ 本测试能跑起来本身即验证：`cross-doc-graph-model.ts` 无 React / DOM 运行时依赖
 * （受 `rules/no-headless-browser-validation` 约束，渲染层不可自动校验，故判定逻辑全压纯函数）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type {
  KnowledgeGraph,
  KnowledgeRelation,
  KnowledgeUnit,
} from "../src/domain/knowledge.ts";
import {
  CORE_LIMIT,
  UNLINKED_KEY,
  coreSubgraphOf,
  ownerCounts,
  unitIdsOfDocuments,
  unitOwnerIndex,
  type DocRef,
} from "../src/features/knowledge/cross-doc-graph-model.ts";

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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* ── fixture 工具 ─────────────────────────────────────────────── */

/** 单元工厂：只关心 id / title，其余字段给稳定默认值。 */
const unit = (id: string, extra: Partial<KnowledgeUnit> = {}): KnowledgeUnit => ({
  id,
  title: id,
  kind: "concept",
  tags: [],
  createdAt: 1,
  ...extra,
});

const graphOf = (
  units: KnowledgeUnit[],
  relations: KnowledgeRelation[] = [],
): KnowledgeGraph => ({ units, relations });

/** 3 份资料 + 1 个已删资料 id（§11.2 的五种单元形态都用到）。 */
const DOCS: DocRef[] = [
  { id: "docA", title: "深度学习基础" },
  { id: "docB", title: "RAG 实战" },
  { id: "docC", title: "检索笔记" },
];

const evidence = (documentId: string): KnowledgeUnit["evidence"] => ({
  documentId,
  start: 0,
  end: 1,
  quote: "q",
});

/* ── A 组：unitOwnerIndex —— 归属三级回退（UC-01 / UC-04） ─────── */

check("TC-UC04-01 ① evidence.documentId 命中", () => {
  const idx = unitOwnerIndex(
    graphOf([unit("u1", { evidence: evidence("docA") })]),
    DOCS,
    new Map(),
  );
  assert.equal(idx.get("u1"), "docA");
});

check("TC-UC04-02 ② 无 evidence，反查章 unitIds 命中", () => {
  const idx = unitOwnerIndex(graphOf([unit("u2")]), DOCS, new Map([["docB", ["u2"]]]));
  assert.equal(idx.get("u2"), "docB");
});

check("TC-UC04-03 ③ 仅 sourceDocumentId 命中", () => {
  const idx = unitOwnerIndex(
    graphOf([unit("u3", { sourceDocumentId: "docC" })]),
    DOCS,
    new Map(),
  );
  assert.equal(idx.get("u3"), "docC");
});

check("TC-UC04-04 三级皆无 → UNLINKED_KEY", () => {
  const idx = unitOwnerIndex(graphOf([unit("u4")]), DOCS, new Map());
  assert.equal(idx.get("u4"), UNLINKED_KEY);
});

check("TC-UC04-05 三级同时命中 → 取 evidence（优先级 ①>②>③）", () => {
  const idx = unitOwnerIndex(
    graphOf([unit("u5", { evidence: evidence("docA"), sourceDocumentId: "docC" })]),
    DOCS,
    new Map([["docB", ["u5"]]]),
  );
  assert.equal(idx.get("u5"), "docA");
});

check("TC-UC04-06 ①级指向已删资料 → 跳过，继续回退到 ②", () => {
  const idx = unitOwnerIndex(
    graphOf([unit("u6", { evidence: evidence("docGone") })]),
    DOCS,
    new Map([["docB", ["u6"]]]),
  );
  assert.equal(idx.get("u6"), "docB");
});

check("TC-UC04-07 ③级指向已删资料、前两级落空 → UNLINKED_KEY", () => {
  const idx = unitOwnerIndex(
    graphOf([unit("u7", { sourceDocumentId: "docGone" })]),
    DOCS,
    new Map(),
  );
  assert.equal(idx.get("u7"), UNLINKED_KEY);
});

check("TC-UC04-08 同一单元被两份资料的章引用 → 字典序稳定（docA）", () => {
  const g = graphOf([unit("u8")]);
  const chapters = new Map<string, readonly string[]>([
    ["docB", ["u8"]],
    ["docA", ["u8"]],
  ]);
  const a = unitOwnerIndex(g, DOCS, chapters);
  const b = unitOwnerIndex(g, DOCS, chapters);
  assert.equal(a.get("u8"), "docA");
  assert.equal(b.get("u8"), "docA");
});

check("TC-UC04-09 documents 为空 → 全部 UNLINKED_KEY", () => {
  const idx = unitOwnerIndex(
    graphOf([
      unit("u9a", { evidence: evidence("docA") }),
      unit("u9b", { sourceDocumentId: "docC" }),
    ]),
    [],
    new Map([["docB", ["u9b"]]]),
  );
  assert.equal(idx.get("u9a"), UNLINKED_KEY);
  assert.equal(idx.get("u9b"), UNLINKED_KEY);
});

/* ── B 组：ownerCounts / unitIdsOfDocuments —— 筛选（UC-02 / UC-07） ── */

/** 5 → docA · 3 → docB · 2 → 未关联（§12.2 的口径）。 */
const OWNER = (() => {
  const m = new Map<string, string>();
  for (let i = 0; i < 5; i++) m.set(`a${i}`, "docA");
  for (let i = 0; i < 3; i++) m.set(`b${i}`, "docB");
  for (let i = 0; i < 2; i++) m.set(`x${i}`, UNLINKED_KEY);
  return m;
})();

check("TC-UC02-01 ownerCounts：各归属地计数正确", () => {
  const c = ownerCounts(OWNER);
  assert.equal(c.get("docA"), 5);
  assert.equal(c.get("docB"), 3);
  assert.equal(c.get(UNLINKED_KEY), 2);
});

check("TC-UC02-02 选中 {docA} → 只返回 docA 的 5 个单元", () => {
  const ids = unitIdsOfDocuments(OWNER, new Set(["docA"]));
  assert.equal(ids.size, 5);
  for (const id of ids) assert.equal(OWNER.get(id), "docA");
});

check("TC-UC02-03 选中 {UNLINKED_KEY} → 只返回未关联的 2 个单元", () => {
  const ids = unitIdsOfDocuments(OWNER, new Set([UNLINKED_KEY]));
  assert.equal(ids.size, 2);
  for (const id of ids) assert.equal(OWNER.get(id), UNLINKED_KEY);
});

check("TC-UC07-01 选中空集 → 空 Set（UC-07 未选中态）", () => {
  assert.equal(unitIdsOfDocuments(OWNER, new Set()).size, 0);
});

check("TC-UC02-04 全选 ≡ 不过滤（长度 === 计数总和）", () => {
  const all = unitIdsOfDocuments(OWNER, new Set(ownerCounts(OWNER).keys()));
  assert.equal(all.size, OWNER.size);
});

/* ── C 组：coreSubgraphOf —— 核心子图（UC-01 / UC-03） ────────── */

check("TC-UC01-01 池 10 个、limit 40 → 不截断", () => {
  const units = Array.from({ length: 10 }, (_, i) => unit(`u${i}`));
  const pick = coreSubgraphOf(graphOf(units));
  assert.equal(pick.shown, 10);
  assert.equal(pick.total, 10);
  assert.equal(pick.truncated, false);
  assert.equal(pick.hidden, 0);
});

check("TC-UC01-02 池 128 个、limit 40 → 截断 88", () => {
  const units = Array.from({ length: 128 }, (_, i) => unit(`u${String(i).padStart(3, "0")}`));
  const pick = coreSubgraphOf(graphOf(units));
  assert.equal(pick.total, 128);
  assert.equal(pick.shown, 40);
  assert.equal(pick.truncated, true);
  assert.equal(pick.hidden, 88);
});

check("TC-UC01-03 度数高的单元优先入选（5 hub + 100 leaf）", () => {
  const hubs = Array.from({ length: 5 }, (_, i) => unit(`hub${i}`));
  const leaves = Array.from({ length: 100 }, (_, i) => unit(`leaf${String(i).padStart(3, "0")}`));
  const relations: KnowledgeRelation[] = leaves.map((l, i) => ({
    id: `r${i}`,
    fromId: l.id,
    toId: `hub${i % 5}`,
    type: "related",
  }));
  const pick = coreSubgraphOf(graphOf([...hubs, ...leaves], relations), { limit: 40 });
  const ids = new Set(pick.graph.units.map((u) => u.id));
  for (let i = 0; i < 5; i++) assert.ok(ids.has(`hub${i}`), `hub${i} 应入选`);
  assert.equal(pick.shown, 40);
});

check("TC-UC01-04 度数相同 → 按 title 升序稳定取舍", () => {
  const g = graphOf([unit("u1", { title: "b" }), unit("u2", { title: "a" })]);
  const p1 = coreSubgraphOf(g, { limit: 1 });
  const p2 = coreSubgraphOf(g, { limit: 1 });
  assert.equal(p1.graph.units[0].title, "a");
  assert.deepEqual(p1, p2);
});

check("TC-UC01-05 度数为 0 的孤立单元、名额有余 → 仍入选", () => {
  const pick = coreSubgraphOf(
    graphOf([unit("a"), unit("b"), unit("isolated")], [
      { id: "r1", fromId: "a", toId: "b", type: "related" },
    ]),
  );
  const ids = pick.graph.units.map((u) => u.id).sort();
  assert.deepEqual(ids, ["a", "b", "isolated"]);
});

check("TC-UC03-01 连向池外的边不出现（无悬空边）", () => {
  const pool = Array.from({ length: 40 }, (_, i) => unit(`p${String(i).padStart(2, "0")}`));
  const outside = unit("outside");
  const relations: KnowledgeRelation[] = [
    { id: "bridge", fromId: "p00", toId: "outside", type: "related" },
  ];
  const pick = coreSubgraphOf(graphOf([...pool, outside], relations), {
    limit: 40,
    unitIds: new Set(pool.map((u) => u.id)),
  });
  assert.equal(pick.graph.relations.length, 0);
  assert.equal(pick.total, 40);
  assert.equal(pick.graph.units.some((u) => u.id === "outside"), false);
});

check("TC-UC03-02 同一输入连续两次 → 结果深相等（确定性）", () => {
  const units = Array.from({ length: 30 }, (_, i) => unit(`u${i}`, { title: `t${(i * 7) % 13}` }));
  const relations: KnowledgeRelation[] = units.map((u, i) => ({
    id: `r${i}`,
    fromId: u.id,
    toId: units[(i + 1) % 30].id,
    type: "related",
  }));
  const g = graphOf(units, relations);
  assert.deepEqual(coreSubgraphOf(g), coreSubgraphOf(g));
});

check("TC-UC03-03 只读：不改入参、返回数组为新实例", () => {
  const g = graphOf([unit("a"), unit("b")], [
    { id: "r1", fromId: "a", toId: "b", type: "related" },
  ]);
  const snapshot = JSON.stringify(g);
  const pick = coreSubgraphOf(g);
  // 返回值是过滤后的**新数组**（push 不波及入参）
  assert.notEqual(pick.graph.units, g.units);
  pick.graph.units.push(unit("zzz"));
  assert.equal(g.units.length, 2);
  // 函数自身不原地改入参
  assert.equal(JSON.stringify(g), snapshot);
});

check("TC-UC03-04 度数只在池内统计（池外边不计入）", () => {
  const g = graphOf([unit("a"), unit("b"), unit("z")], [
    { id: "r1", fromId: "z", toId: "a", type: "related" },
    { id: "r2", fromId: "z", toId: "b", type: "related" },
    { id: "r3", fromId: "b", toId: "c1", type: "related" },
    { id: "r4", fromId: "b", toId: "c2", type: "related" },
  ]);
  // 池 = {a,b,z}：z 度数 2，a/b 各 1。若把池外 c1/c2 计入，b 会是 3 并抢走唯一名额。
  const pick = coreSubgraphOf(g, { limit: 1, unitIds: new Set(["a", "b", "z"]) });
  assert.equal(pick.shown, 1);
  assert.equal(pick.graph.units[0].id, "z");
});

check("TC-UC03-05 unitIds 过滤后每个单元都在集合内", () => {
  const units = Array.from({ length: 20 }, (_, i) => unit(`u${i}`));
  const subset = new Set(["u1", "u3", "u5"]);
  const pick = coreSubgraphOf(graphOf(units), { unitIds: subset });
  assert.equal(pick.total, 3);
  for (const u of pick.graph.units) assert.ok(subset.has(u.id));
});

/* ── D 组：集成（UC-01） ──────────────────────────────────────── */

/** 3 份资料 × perDoc 概念；资料内部串成链（保证有边）。 */
function buildCrossDocs(perDoc: number) {
  const units: KnowledgeUnit[] = [];
  const chapterMap = new Map<string, readonly string[]>();
  const relations: KnowledgeRelation[] = [];
  for (const d of DOCS) {
    const ids: string[] = [];
    for (let i = 0; i < perDoc; i++) {
      const id = `${d.id}-u${String(i).padStart(2, "0")}`;
      units.push(unit(id, { title: `${d.id} 概念 ${i}` }));
      ids.push(id);
    }
    chapterMap.set(d.id, ids);
    for (let i = 1; i < ids.length; i++) {
      relations.push({ id: `r-${d.id}-${i}`, fromId: ids[i - 1], toId: ids[i], type: "related" });
    }
  }
  return { graph: graphOf(units, relations), chapterMap };
}

check("TC-UC01-06 全选 60 概念 → 结果跨 ≥2 份资料", () => {
  const { graph, chapterMap } = buildCrossDocs(20);
  const owner = unitOwnerIndex(graph, DOCS, chapterMap);
  const pick = coreSubgraphOf(graph, {
    unitIds: unitIdsOfDocuments(owner, new Set(ownerCounts(owner).keys())),
  });
  const docs = new Set(pick.graph.units.map((u) => owner.get(u.id)));
  assert.ok(docs.size >= 2, `应跨 ≥2 份资料，实际 ${[...docs].join(", ")}`);
});

check("TC-UC01-07 只选 1 份资料 → 结果全部属于该资料", () => {
  const { graph, chapterMap } = buildCrossDocs(20);
  const owner = unitOwnerIndex(graph, DOCS, chapterMap);
  const pick = coreSubgraphOf(graph, {
    unitIds: unitIdsOfDocuments(owner, new Set(["docA"])),
  });
  assert.ok(pick.graph.units.length > 0);
  for (const u of pick.graph.units) assert.equal(owner.get(u.id), "docA");
});

check("TC-UC01-08 全选 ≡ 全库单元集合", () => {
  const { graph, chapterMap } = buildCrossDocs(20);
  const owner = unitOwnerIndex(graph, DOCS, chapterMap);
  const ids = unitIdsOfDocuments(owner, new Set(ownerCounts(owner).keys()));
  assert.equal(ids.size, graph.units.length);
  for (const u of graph.units) assert.ok(ids.has(u.id));
});

/* ── E 组：边界与回归 ─────────────────────────────────────────── */

check("TC-EDGE-01 空图 → 全零、不截断", () => {
  const pick = coreSubgraphOf(graphOf([]));
  assert.deepEqual(pick.graph.units, []);
  assert.equal(pick.total, 0);
  assert.equal(pick.shown, 0);
  assert.equal(pick.truncated, false);
  assert.equal(pick.hidden, 0);
});

check("TC-EDGE-02 limit = 0 → 空结果但如实报告被截断", () => {
  const units = Array.from({ length: 5 }, (_, i) => unit(`u${i}`));
  const pick = coreSubgraphOf(graphOf(units, [
    { id: "r1", fromId: "u0", toId: "u1", type: "related" },
  ]), { limit: 0 });
  assert.equal(pick.shown, 0);
  assert.equal(pick.total, 5);
  assert.equal(pick.truncated, true);
  assert.deepEqual(pick.graph.relations, []);
});

check("TC-EDGE-03 limit 为负 → 视同 0，不抛异常", () => {
  const pick = coreSubgraphOf(graphOf([unit("a")]), { limit: -7 });
  assert.equal(pick.shown, 0);
  assert.equal(pick.truncated, true);
});

/** 布局上限真源：从 `layout.ts` 顶部注释里读，避免断言与注释脱钩。 */
function layoutCap(): number {
  const src = readFileSync(resolve(ROOT, "src/features/knowledge/layout.ts"), "utf8");
  const m = src.match(/规模假设：≤\s*(\d+)\s*节点/);
  assert.ok(m, "layout.ts 顶部应声明「规模假设：≤ N 节点」");
  return Number(m[1]);
}

check("TC-EDGE-04 CORE_LIMIT 不得超过布局自述的规模假设", () => {
  const cap = layoutCap();
  assert.ok(
    CORE_LIMIT <= cap,
    `CORE_LIMIT=${CORE_LIMIT} 超过 layout.ts 的 ≤${cap} 节点假设 —— 请重读 layout.ts 顶部注释`,
  );
});

check("TC-EDGE-05 越界守卫判据对越界值真的变红（51 应失败）", () => {
  const cap = layoutCap();
  const guard = (v: number) => v <= cap;
  assert.equal(guard(CORE_LIMIT), true);
  assert.equal(guard(cap + 1), false);
});

check("TC-EDGE-06 脏数据：边指向不存在的单元 → 不抛异常、脏边被丢弃", () => {
  const pick = coreSubgraphOf(graphOf([unit("a")], [
    { id: "dirty", fromId: "a", toId: "ghost", type: "related" },
  ]));
  assert.equal(pick.graph.relations.length, 0);
  assert.equal(pick.total, 1);
});

check("TC-EDGE-07 ownerCounts 空索引 → 空 Map（非 undefined）", () => {
  const c = ownerCounts(new Map());
  assert.ok(c instanceof Map);
  assert.equal(c.size, 0);
});

check("TC-EDGE-08 单元被两份资料引用 → 结果确定（不随 Map 迭代顺序漂移）", () => {
  const g = graphOf([unit("x")]);
  const fwd = unitOwnerIndex(g, DOCS, new Map([["docB", ["x"]], ["docC", ["x"]]]));
  const rev = unitOwnerIndex(g, DOCS, new Map([["docC", ["x"]], ["docB", ["x"]]]));
  assert.equal(fwd.get("x"), "docB");
  assert.equal(rev.get("x"), "docB");
});

/* ── F 组：源文件卫生（回滚护栏） ─────────────────────────────── */

check("TC-FILE-01 模型层无 React / DOM 运行时依赖", () => {
  const src = readFileSync(resolve(ROOT, "src/features/knowledge/cross-doc-graph-model.ts"), "utf8");
  assert.equal(/^import .*from "react/m.test(src), false, "模型层不得 import react");
  assert.match(src, /import type \{[^}]*\} from "\.\.\/\.\.\/domain"/);
});

check("TC-FILE-02 本方案触及的源文件均 ≤ 700 行", () => {
  const files = [
    "src/features/knowledge/cross-doc-graph-model.ts",
    "src/features/knowledge/CrossDocGraphPage.tsx",
    "src/features/knowledge/GraphView.tsx",
    "src/features/knowledge/layout.ts",
  ];
  for (const f of files) {
    const lines = readFileSync(resolve(ROOT, f), "utf8").split("\n").length;
    assert.ok(lines <= 700, `${f} 有 ${lines} 行，超过 700`);
  }
});

/* ── 汇总 ─────────────────────────────────────────────────────── */

for (const line of results) console.log(line);
const total = results.length;
if (failures > 0) {
  console.log(`\n失败 ${failures}/${total}`);
  process.exit(1);
}
console.log(`\n全部通过：${total}/${total}`);
