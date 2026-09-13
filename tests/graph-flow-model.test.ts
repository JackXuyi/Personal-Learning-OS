/**
 * 图谱 → React Flow 元素映射 纯函数单测（docs/knowledge-graph-react-flow-design-2026-09.md §12）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:flow
 *
 * 覆盖：坐标换算（中心点 → 左上角）、关系类型过滤、悬空边丢弃、掌握度视觉档位、
 * 缺口判定、聚焦淡化、边样式分派、宽度估算钳制、空输入与文件行数上限。
 *
 * ⚠️ 本测试能跑起来本身即验证 TC-EDGE-07：模型层对 `@xyflow/react` 只用了
 * `import type`，未引入任何 DOM 运行时依赖。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { KnowledgeGraph } from "../src/domain/knowledge.ts";
import type { Point } from "../src/features/knowledge/layout.ts";
import {
  DIM_EDGE_OPACITY,
  DIM_OPACITY,
  GAP_THRESHOLD,
  NODE_H,
  buildFlowEdges,
  buildFlowNodes,
  edgeVisualOf,
  isVisibleLink,
  nodeVisualOf,
  nodeWidth,
} from "../src/features/knowledge/graph-flow-model.ts";

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

/** 三节点四关系：prerequisite / related / parent 画边，example 不画。 */
const GRAPH: KnowledgeGraph = {
  units: [
    { id: "a", title: "向量检索", kind: "concept", tags: [], createdAt: 1 },
    { id: "b", title: "文本切分", kind: "concept", tags: [], createdAt: 2 },
    { id: "c", title: "调参", kind: "skill", tags: [], createdAt: 3 },
  ],
  relations: [
    { id: "r1", fromId: "a", toId: "b", type: "prerequisite" },
    { id: "r2", fromId: "b", toId: "c", type: "related" },
    { id: "r3", fromId: "a", toId: "c", type: "parent" },
    { id: "r4", fromId: "b", toId: "c", type: "example" },
  ],
};

const POSITIONS: Map<string, Point> = new Map([
  ["a", { x: 100, y: 80 }],
  ["b", { x: 300, y: 200 }],
  ["c", { x: 500, y: 300 }],
]);

function buildNodes(overrides: Partial<Parameters<typeof buildFlowNodes>[0]> = {}) {
  return buildFlowNodes({
    graph: GRAPH,
    positions: POSITIONS,
    masteryByUnit: {},
    requiredUnitIds: [],
    highlightIds: [],
    ...overrides,
  });
}

const byId = (nodes: ReturnType<typeof buildFlowNodes>, id: string) => {
  const node = nodes.find((n) => n.id === id);
  assert.ok(node, `节点 ${id} 应存在`);
  return node;
};

// ── 用例 ────────────────────────────────────────────────────

check("TC-FLOW-01 坐标：中心点 → 左上角（减半宽半高）", () => {
  const nodes = buildNodes();
  const a = byId(nodes, "a");
  const w = nodeWidth("向量检索");
  assert.equal(a.width, w);
  assert.deepEqual(a.position, { x: 100 - w / 2, y: 80 - NODE_H / 2 });
});

check("TC-FLOW-02 关系过滤：example 不画边，其余三条画边", () => {
  const edges = buildFlowEdges(GRAPH);
  assert.equal(edges.length, 3);
  assert.equal(edges.some((e) => e.id === "r4"), false);
  assert.deepEqual(
    edges.map((e) => e.id).sort(),
    ["r1", "r2", "r3"],
  );
});

check("TC-FLOW-03 形状：skill → 菱形，concept → 圆角矩形", () => {
  assert.equal(nodeVisualOf(GRAPH.units[0], 0).shape, "round");
  assert.equal(nodeVisualOf(GRAPH.units[2], 0).shape, "diamond");
});

check("TC-FLOW-04 缺口判定：required 且 mastery < 阈值", () => {
  const low = buildNodes({ requiredUnitIds: ["a"], masteryByUnit: { a: 0.5 } });
  assert.equal(byId(low, "a").data.isGap, true);
  // 非 required → 不算缺口
  const notRequired = buildNodes({ requiredUnitIds: [], masteryByUnit: { a: 0.5 } });
  assert.equal(byId(notRequired, "a").data.isGap, false);
  // 达到阈值 → 不算缺口
  const mastered = buildNodes({
    requiredUnitIds: ["a"],
    masteryByUnit: { a: GAP_THRESHOLD },
  });
  assert.equal(byId(mastered, "a").data.isGap, false);
});

check("TC-FLOW-05 聚焦淡化：非邻域节点 0.1，跨邻域边 0.08", () => {
  const focusSet = new Set(["a", "b"]);
  const nodes = buildNodes({ focusSet });
  assert.equal(byId(nodes, "a").style?.opacity, 1);
  assert.equal(byId(nodes, "b").style?.opacity, 1);
  assert.equal(byId(nodes, "c").style?.opacity, DIM_OPACITY);

  const edges = buildFlowEdges(GRAPH, focusSet);
  const r1 = edges.find((e) => e.id === "r1")!; // a→b，两端都在
  const r3 = edges.find((e) => e.id === "r3")!; // a→c，含域外
  assert.notEqual(r1.style?.opacity, DIM_EDGE_OPACITY);
  assert.equal(r3.style?.opacity, DIM_EDGE_OPACITY);
});

check("TC-FLOW-06 悬空边：端点不在 units 内 → 丢弃", () => {
  const graph: KnowledgeGraph = {
    units: [GRAPH.units[0]],
    relations: [
      { id: "ok", fromId: "a", toId: "a", type: "related" },
      { id: "ghost", fromId: "a", toId: "不存在的单元", type: "related" },
    ],
  };
  const edges = buildFlowEdges(graph);
  assert.deepEqual(
    edges.map((e) => e.id),
    ["ok"],
  );
});

check("TC-FLOW-07 空图：节点与边均为空数组", () => {
  const empty: KnowledgeGraph = { units: [], relations: [] };
  assert.deepEqual(buildFlowNodes({
    graph: empty,
    positions: new Map(),
    masteryByUnit: {},
    requiredUnitIds: [],
    highlightIds: [],
  }), []);
  assert.deepEqual(buildFlowEdges(empty), []);
});

check("TC-FLOW-08 边样式分派：虚线箭头 / 实线 / 细线", () => {
  const pre = edgeVisualOf("prerequisite");
  assert.equal(pre.arrow, true);
  assert.equal(pre.strokeDasharray, "5 4");

  const rel = edgeVisualOf("related");
  assert.equal(rel.arrow, false);
  assert.equal(rel.strokeDasharray, undefined);

  const child = edgeVisualOf("parent");
  assert.equal(child.arrow, false);
  assert.ok(child.strokeWidth < rel.strokeWidth, "父子边应比相关边更细");
});

check("TC-FLOW-09 宽度估算：钳制在 [64, 170]，中文宽于同长度英文", () => {
  assert.equal(nodeWidth("学"), 64); // 13 + 22 = 35 → 钳到 64
  const long = nodeWidth("abcdefghijklmnopqrstuvwxyz");
  assert.equal(long, 170); // 26 * 7.5 + 22 = 217 → 钳到 170
  // 同字符数、未触底钳制时，中文（13/字）宽于英文（7.5/字）
  assert.ok(nodeWidth("中文本五个字") > nodeWidth("abcde"));
});

check("TC-FLOW-10 导入高亮：仅 highlightIds 成员置真", () => {
  const nodes = buildNodes({ highlightIds: ["b"] });
  assert.equal(byId(nodes, "a").data.isHighlight, false);
  assert.equal(byId(nodes, "b").data.isHighlight, true);
});

// ── 边界与回归 ──────────────────────────────────────────────

check("TC-EDGE-01 单节点零关系：1 节点 0 边", () => {
  const graph: KnowledgeGraph = { units: [GRAPH.units[0]], relations: [] };
  const nodes = buildFlowNodes({
    graph,
    positions: new Map([["a", { x: 10, y: 10 }]]),
    masteryByUnit: {},
    requiredUnitIds: [],
    highlightIds: [],
  });
  assert.equal(nodes.length, 1);
  assert.deepEqual(buildFlowEdges(graph), []);
});

check("TC-EDGE-02 positions 缺某 unit：该节点跳过，不抛错", () => {
  const positions = new Map<string, Point>([["a", { x: 10, y: 10 }]]);
  const nodes = buildNodes({ positions });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, "a");
});

check("TC-EDGE-03 masteryByUnit 缺 key：mastery 取 0 → not-started", () => {
  const nodes = buildNodes({ masteryByUnit: {} });
  const a = byId(nodes, "a");
  assert.equal(a.data.mastery, 0);
  assert.equal(a.data.band, "not-started");
});

check("TC-EDGE-04 focusSet 只含已不存在的 id：全部淡化（组件层据此做防护）", () => {
  const nodes = buildNodes({ focusSet: new Set(["已删除的单元"]) });
  assert.ok(nodes.every((n) => n.style?.opacity === DIM_OPACITY));
});

check("TC-EDGE-05 极长中英混合标题：钳到 170", () => {
  assert.equal(nodeWidth("这是一个非常非常非常长的中文标题用来测试宽度估算上限abcdefg"), 170);
});

check("TC-EDGE-06 isVisibleLink：4 类画边，其余不画", () => {
  const visible = ["prerequisite", "related", "parent", "child"] as const;
  const hidden = ["example", "contrast", "application", "source"] as const;
  for (const t of visible) assert.equal(isVisibleLink(t), true, `${t} 应画边`);
  for (const t of hidden) assert.equal(isVisibleLink(t), false, `${t} 不应画边`);
});

check("TC-EDGE-07 模型层无 DOM 运行时依赖（本测试跑通即自证）", () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/features/knowledge/graph-flow-model.ts"),
    "utf8",
  );
  // 只允许 `import type` 形式引用 @xyflow/react
  assert.match(src, /import type \{[^}]*\} from "@xyflow\/react"/);
  assert.equal(/^import \{[^}]*\} from "@xyflow\/react"/m.test(src), false);
});

check("TC-EDGE-08 所触及源文件 ≤700 行", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const files = [
    "src/features/knowledge/graph-flow-model.ts",
    "src/features/knowledge/UnitNode.tsx",
    "src/features/knowledge/GraphView.tsx",
    "src/features/knowledge/layout.ts",
  ];
  for (const f of files) {
    const lines = readFileSync(resolve(root, f), "utf8").split("\n").length;
    assert.ok(lines <= 700, `${f} 有 ${lines} 行，超过 700`);
  }
});

// ── 汇总 ────────────────────────────────────────────────────

for (const line of results) console.log(line);
const total = results.length;
if (failures > 0) {
  console.log(`\n失败 ${failures}/${total}`);
  process.exit(1);
}
console.log(`\n全部通过：${total}/${total}`);
