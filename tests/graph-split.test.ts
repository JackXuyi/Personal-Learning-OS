/**
 * 概念图 ↔ SQLite DTO 纯函数单测（docs/knowledge-sqlite-prereq-plan-design-2026-09.md §11）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:graph
 *
 * 覆盖：
 *  1) TC-UC01-01 splitGraph → mergeGraph 逐字段往返相等（含 evidence 四字段）；
 *  2) TC-UC01-02 悬空 relation（from/to 无对应 unit）被丢弃；
 *  3) TC-UC01-03 部分 evidence（四列不全）→ 整体缺省，不产出半个 evidence；
 *  4) TC-EDGE-03 同一 unit id 重拆（upsert 幂等）→ 输出 id 不变、字段取新值；
 *  5) diffIds → saveGraph 的删除集合（在旧不在新）。
 */
import assert from "node:assert/strict";
import { diffIds, mergeGraph, splitGraph } from "../src/storage/graph-split.ts";
import type { KnowledgeGraph } from "../src/domain/knowledge.ts";

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

const GRAPH: KnowledgeGraph = {
  units: [
    {
      id: "u1",
      title: "向量检索",
      kind: "concept",
      summary: "用向量做语义召回",
      sourceDocumentId: "d1",
      tags: ["NLP", "检索"],
      createdAt: 1,
      evidence: { documentId: "d1", start: 10, end: 42, quote: "先编码再近邻搜索" },
    },
    { id: "u2", title: "文本切分", kind: "concept", tags: [], createdAt: 2 },
  ],
  relations: [
    { id: "r1", fromId: "u2", toId: "u1", type: "prerequisite", strength: 0.8 },
    { id: "r2", fromId: "u1", toId: "u2", type: "related" },
  ],
};

/** 归一化：JSON 往返丢掉值为 undefined 的键（DTO 映射会显式带上 summary: undefined 等）。 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

check("TC-UC01-01 split → merge 往返逐字段相等（evidence 不丢）", () => {
  const { units, relations } = splitGraph(GRAPH);
  assert.equal(units.length, 2);
  assert.equal(relations.length, 2);
  const merged = mergeGraph(units, relations);
  assert.deepEqual(plain(merged.units), plain(GRAPH.units));
  assert.deepEqual(plain(merged.relations), plain(GRAPH.relations));
});

check("TC-UC01-01b evidence 四列只落完整三元组 + quote", () => {
  const { units } = splitGraph(GRAPH);
  const withEvidence = units.find((u) => u.id === "u1");
  assert.equal(withEvidence?.evidenceDocumentId, "d1");
  assert.equal(withEvidence?.evidenceStart, 10);
  assert.equal(withEvidence?.evidenceEnd, 42);
  assert.equal(withEvidence?.evidenceQuote, "先编码再近邻搜索");
  const bare = units.find((u) => u.id === "u2");
  assert.equal(bare?.evidenceDocumentId, undefined, "无 evidence 的概念不写列");
});

check("TC-UC01-02 悬空 relation 被丢弃（诚实降级）", () => {
  const { units } = splitGraph(GRAPH);
  const merged = mergeGraph(units, [
    { id: "r1", fromId: "u2", toId: "u1", relType: "prerequisite", createdAt: 1 },
    { id: "rGhost", fromId: "ghost", toId: "u1", relType: "related", createdAt: 1 },
    { id: "rGhost2", fromId: "u1", toId: "ghost", relType: "related", createdAt: 1 },
  ]);
  assert.deepEqual(merged.relations.map((r) => r.id), ["r1"]);
});

check("TC-UC01-03 部分 evidence（四列不全）→ 整体缺省", () => {
  const merged = mergeGraph(
    [
      {
        id: "u9",
        title: "半截概念",
        kind: "concept",
        tags: [],
        createdAt: 3,
        evidenceDocumentId: "d1",
        evidenceStart: 5,
        // end / quote 缺失
      },
    ],
    [],
  );
  assert.equal(merged.units[0].evidence, undefined, "不产出半个 evidence");
});

check("TC-EDGE-03 同一 unit id 重拆 → id 稳定、字段取新值（upsert 幂等）", () => {
  const first = splitGraph(GRAPH);
  const resplit = splitGraph({
    ...GRAPH,
    units: [{ ...GRAPH.units[0], title: "向量检索（重抽）" }, GRAPH.units[1]],
  });
  assert.deepEqual(
    resplit.units.map((u) => u.id),
    first.units.map((u) => u.id),
    "id 集合不变，表内覆盖而非翻倍",
  );
  assert.equal(resplit.units[0].title, "向量检索（重抽）");
});

check("diffIds 返回「在旧不在新」的 id（saveGraph 删除集）", () => {
  assert.deepEqual(
    diffIds([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]),
    ["a"],
  );
  assert.deepEqual(diffIds([], [{ id: "a" }]), [], "空表无需删除");
  assert.deepEqual(diffIds([{ id: "a" }], []), ["a"], "整图清空 → 全删");
});

for (const line of results) console.log(line);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
