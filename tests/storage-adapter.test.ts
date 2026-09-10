/**
 * RAG 存储层单测（docs/storage-architecture-rag-2026-09.md §10.2 测试清单）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:storage
 *
 * 策略：注入 InMemoryStorage。LocalStorageAdapter / TauriStorage 都以它为基类，
 * 因此这批断言同时覆盖「内存 + localStorage」两条路径的共享逻辑；
 * SQLite 路径的差异（FTS5、降级）由 Tauri dev 手工验证承担。
 *
 * 覆盖：
 *  A. domain 辅助函数（T1）——sortSectionsByIndex / sortChunksByPosition /
 *     estimateTokenCount / embeddingKey；
 *  B. Section 层（list/get/save/批量/delete/sectionsByRange）；
 *  C. Chunk 层（list by chapter/document、get、delete、chunksByKnowledge）；
 *  D. KnowledgeUnit 层（list 全量/按文档、get、delete、批量覆盖）；
 *  E. KnowledgeRelation 层（relationsOf 双向、listRelations 过滤、prerequisitesOf、
 *     delete）；
 *  F. Embedding 层（list 按类型、get、delete、deleteEmbeddingsByTarget）；
 *  G. Evidence 链（listEvidenceBySubject 时间倒序）；
 *  H. fullTextSearch（大小写不敏感、scope 四维过滤、limit、空串）。
 */
import assert from "node:assert/strict";
import type { Chunk, Embedding, KnowledgeUnit, Section } from "../src/domain/index.ts";
import { embeddingKey } from "../src/domain/embedding.ts";
import { estimateTokenCount, sortChunksByPosition } from "../src/domain/chunk.ts";
import { sortSectionsByIndex } from "../src/domain/section.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";

const results: string[] = [];
let failures = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ===== 构造辅助 =====

function section(id: string, over: Partial<Section> = {}): Section {
  return {
    id,
    chapterId: "ch1",
    documentId: "doc1",
    title: `小节 ${id}`,
    level: 2,
    index: 0,
    contentRef: { start: 0, end: 10 },
    createdAt: 1,
    ...over,
  };
}

function chunk(id: string, over: Partial<Chunk> = {}): Chunk {
  return {
    id,
    documentId: "doc1",
    chapterId: "ch1",
    content: `正文 ${id}`,
    position: 0,
    knowledgeIds: [],
    createdAt: 1,
    ...over,
  };
}

function unit(id: string, over: Partial<KnowledgeUnit> = {}): KnowledgeUnit {
  return {
    id,
    title: `概念 ${id}`,
    kind: "concept",
    tags: [],
    createdAt: 1,
    ...over,
  };
}

function embedding(id: string, over: Partial<Embedding> = {}): Embedding {
  return {
    id,
    targetType: "chunk",
    targetId: "c1",
    model: "qwen-1.5b",
    vectorDim: 1536,
    createdAt: 1,
    ...over,
  };
}

const run = async () => {
  // ===== A. domain 辅助函数（T1）=====

  await check("A1 sortSectionsByIndex 升序且不改原数组", () => {
    const src = [section("s3", { index: 3 }), section("s1", { index: 1 })];
    const out = sortSectionsByIndex(src);
    assert.deepEqual(
      out.map((s) => s.id),
      ["s1", "s3"],
    );
    assert.equal(src[0].id, "s3", "不得原地排序");
  });

  await check("A2 sortChunksByPosition 升序且不改原数组", () => {
    const src = [chunk("c3", { position: 3 }), chunk("c1", { position: 1 })];
    const out = sortChunksByPosition(src);
    assert.deepEqual(
      out.map((c) => c.id),
      ["c1", "c3"],
    );
    assert.equal(src[0].id, "c3", "不得原地排序");
  });

  await check("A3 estimateTokenCount 中英混排启发式", () => {
    assert.equal(estimateTokenCount(""), 0);
    // 纯中文 6 字 → ceil(6 / 1.5) = 4
    assert.equal(estimateTokenCount("向量数据库"), 4);
    // 纯英文 8 字符 → ceil(8 / 4) = 2
    assert.equal(estimateTokenCount("abcdabcd"), 2);
    // 中文 3 字 + 英文 4 字符 → ceil(2 + 1) = 3
    assert.equal(estimateTokenCount("向量库abcd"), 3);
  });

  await check("A4 embeddingKey 带/不带 model", () => {
    assert.equal(embeddingKey("chunk", "c1"), "chunk:c1");
    assert.equal(embeddingKey("chunk", "c1", "qwen-1.5b"), "chunk:c1:qwen-1.5b");
    assert.notEqual(embeddingKey("chunk", "c1"), embeddingKey("knowledge", "c1"));
  });

  // ===== B. Section 层 =====

  await check("B1 saveSection / getSection 往返", async () => {
    const s = new InMemoryStorage();
    await s.saveSection(section("s1", { index: 1, contentRef: { start: 5, end: 20 } }));
    const got = await s.getSection("s1");
    assert.equal(got?.index, 1);
    assert.deepEqual(got?.contentRef, { start: 5, end: 20 });
    assert.equal(await s.getSection("missing"), undefined);
  });

  await check("B2 listSections 按 index 升序（写入顺序无关）", async () => {
    const s = new InMemoryStorage();
    await s.saveSections([
      section("s3", { index: 3 }),
      section("s1", { index: 1 }),
      section("s2", { index: 2, chapterId: "ch2" }), // 其他章，应被过滤
    ]);
    const list = await s.listSections("ch1");
    assert.deepEqual(
      list.map((x) => x.id),
      ["s1", "s3"],
    );
  });

  await check("B3 saveSections 同 id 覆盖（幂等）", async () => {
    const s = new InMemoryStorage();
    await s.saveSection(section("s1", { title: "v1" }));
    await s.saveSections([section("s1", { title: "v2" })]);
    assert.equal((await s.getSection("s1"))?.title, "v2");
  });

  await check("B4 deleteSection", async () => {
    const s = new InMemoryStorage();
    await s.saveSection(section("s1"));
    await s.deleteSection("s1");
    assert.equal(await s.getSection("s1"), undefined);
  });

  await check("B5 sectionsByRange 只取完全落在区间内的小节", async () => {
    const s = new InMemoryStorage();
    await s.saveSections([
      section("in1", { index: 2, contentRef: { start: 10, end: 20 } }),
      section("in2", { index: 1, contentRef: { start: 25, end: 30 } }),
      section("partial", { index: 3, contentRef: { start: 5, end: 40 } }), // 越界
      section("otherDoc", { index: 4, contentRef: { start: 10, end: 20 }, documentId: "doc2" }),
    ]);
    const list = await s.sectionsByRange("doc1", 8, 35);
    assert.deepEqual(
      list.map((x) => x.id),
      ["in2", "in1"],
      "应过滤越界与其他文档，并按 index 升序",
    );
  });

  // ===== C. Chunk 层 =====

  await check("C1 listChunks 按 position 升序且限定 chapter", async () => {
    const s = new InMemoryStorage();
    await s.saveChunks([
      chunk("c3", { position: 3 }),
      chunk("c1", { position: 1 }),
      chunk("cX", { position: 0, chapterId: "ch2" }),
    ]);
    const list = await s.listChunks("ch1");
    assert.deepEqual(
      list.map((c) => c.id),
      ["c1", "c3"],
    );
  });

  await check("C2 listChunksByDocument 跨章聚合", async () => {
    const s = new InMemoryStorage();
    await s.saveChunks([
      chunk("c1", { position: 1, chapterId: "ch1" }),
      chunk("c2", { position: 0, chapterId: "ch2" }),
      chunk("c3", { position: 0, documentId: "doc2" }),
    ]);
    const list = await s.listChunksByDocument("doc1");
    assert.deepEqual(
      list.map((c) => c.id),
      ["c2", "c1"],
      "跨章按 position 全局升序",
    );
  });

  await check("C3 getChunk / deleteChunk", async () => {
    const s = new InMemoryStorage();
    await s.saveChunk(chunk("c1", { content: "注意力机制" }));
    assert.equal((await s.getChunk("c1"))?.content, "注意力机制");
    await s.deleteChunk("c1");
    assert.equal(await s.getChunk("c1"), undefined);
  });

  await check("C4 chunksByKnowledge 命中多值 knowledgeIds", async () => {
    const s = new InMemoryStorage();
    await s.saveChunks([
      chunk("c1", { position: 0, knowledgeIds: ["k1", "k2"] }),
      chunk("c2", { position: 1, knowledgeIds: ["k2"] }),
      chunk("c3", { position: 2, knowledgeIds: [] }),
    ]);
    assert.deepEqual(
      (await s.chunksByKnowledge("k1")).map((c) => c.id),
      ["c1"],
    );
    assert.deepEqual(
      (await s.chunksByKnowledge("k2")).map((c) => c.id),
      ["c1", "c2"],
    );
    assert.equal((await s.chunksByKnowledge("k9")).length, 0);
  });

  // ===== D. KnowledgeUnit 层 =====

  await check("D1 listKnowledgeUnits 全量 / 按文档过滤", async () => {
    const s = new InMemoryStorage();
    await s.saveKnowledgeUnits([
      unit("k1", { sourceDocumentId: "doc1" }),
      unit("k2", { sourceDocumentId: "doc2" }),
      unit("k3"), // 无来源文档
    ]);
    assert.equal((await s.listKnowledgeUnits()).length, 3);
    assert.deepEqual(
      (await s.listKnowledgeUnits("doc1")).map((u) => u.id),
      ["k1"],
    );
    assert.equal((await s.listKnowledgeUnits("docX")).length, 0);
  });

  await check("D2 getKnowledgeUnit / deleteKnowledgeUnit", async () => {
    const s = new InMemoryStorage();
    await s.saveKnowledgeUnit(unit("k1", { kind: "skill" }));
    assert.equal((await s.getKnowledgeUnit("k1"))?.kind, "skill");
    await s.deleteKnowledgeUnit("k1");
    assert.equal(await s.getKnowledgeUnit("k1"), undefined);
  });

  await check("D3 saveKnowledgeUnits 同 id 覆盖（幂等）", async () => {
    const s = new InMemoryStorage();
    await s.saveKnowledgeUnit(unit("k1", { title: "v1" }));
    await s.saveKnowledgeUnits([unit("k1", { title: "v2" })]);
    assert.equal((await s.getKnowledgeUnit("k1"))?.title, "v2");
    assert.equal((await s.listKnowledgeUnits()).length, 1);
  });

  // ===== E. KnowledgeRelation 层 =====

  await check("E1 relationsOf 双向命中（from 与 to 都算）", async () => {
    const s = new InMemoryStorage();
    await s.saveRelations([
      { id: "r1", fromId: "k1", toId: "k2", type: "related" },
      { id: "r2", fromId: "k3", toId: "k1", type: "example" },
      { id: "r3", fromId: "k2", toId: "k3", type: "related" },
    ]);
    const got = (await s.relationsOf("k1")).map((r) => r.id).sort();
    assert.deepEqual(got, ["r1", "r2"]);
  });

  await check("E2 listRelations 全量 / 按 unitId 过滤", async () => {
    const s = new InMemoryStorage();
    await s.saveRelations([
      { id: "r1", fromId: "k1", toId: "k2", type: "related" },
      { id: "r2", fromId: "k2", toId: "k3", type: "related" },
    ]);
    assert.equal((await s.listRelations()).length, 2);
    assert.deepEqual(
      (await s.listRelations("k2")).map((r) => r.id).sort(),
      ["r1", "r2"],
    );
    assert.equal((await s.listRelations("k9")).length, 0);
  });

  await check("E3 prerequisitesOf 仅取 toId 命中且 type=prerequisite", async () => {
    const s = new InMemoryStorage();
    await s.saveKnowledgeUnits([unit("k1"), unit("k2"), unit("k3")]);
    // 语义：fromId 必须先掌握，才能学 toId；故查 X 的前置 = 找 toId===X 的 prerequisite 边。
    await s.saveRelations([
      { id: "r1", fromId: "k1", toId: "k3", type: "prerequisite" }, // k1 是 k3 的前置
      { id: "r2", fromId: "k2", toId: "k3", type: "related" }, // 类型不符 → 排除
      { id: "r3", fromId: "k3", toId: "k1", type: "prerequisite" }, // k3 是 k1 的前置
    ]);
    assert.deepEqual(
      (await s.prerequisitesOf("k3")).map((u) => u.id),
      ["k1"],
      "r2 类型不符应被排除",
    );
    assert.deepEqual(
      (await s.prerequisitesOf("k1")).map((u) => u.id),
      ["k3"],
    );
    assert.equal((await s.prerequisitesOf("k2")).length, 0, "k2 只有出边，无前置");
  });

  await check("E4 deleteRelation", async () => {
    const s = new InMemoryStorage();
    await s.saveRelation({ id: "r1", fromId: "k1", toId: "k2", type: "related" });
    await s.deleteRelation("r1");
    assert.equal((await s.listRelations()).length, 0);
  });

  // ===== F. Embedding 层 =====

  await check("F1 listEmbeddings 全量 / 按 targetType 过滤", async () => {
    const s = new InMemoryStorage();
    await s.saveEmbeddings([
      embedding("e1", { targetType: "chunk", targetId: "c1" }),
      embedding("e2", { targetType: "knowledge", targetId: "k1" }),
    ]);
    assert.equal((await s.listEmbeddings()).length, 2);
    assert.deepEqual(
      (await s.listEmbeddings("chunk")).map((e) => e.id),
      ["e1"],
    );
  });

  await check("F2 getEmbedding / deleteEmbedding", async () => {
    const s = new InMemoryStorage();
    await s.saveEmbedding(embedding("e1", { vectorDim: 768 }));
    assert.equal((await s.getEmbedding("e1"))?.vectorDim, 768);
    await s.deleteEmbedding("e1");
    assert.equal(await s.getEmbedding("e1"), undefined);
  });

  await check("F3 deleteEmbeddingsByTarget 跨 model 一并清除", async () => {
    const s = new InMemoryStorage();
    await s.saveEmbeddings([
      embedding("e1", { targetId: "c1", model: "qwen-1.5b" }),
      embedding("e2", { targetId: "c1", model: "openai-3-small" }),
      embedding("e3", { targetId: "c2", model: "qwen-1.5b" }),
    ]);
    await s.deleteEmbeddingsByTarget("c1");
    const left = (await s.listEmbeddings()).map((e) => e.id);
    assert.deepEqual(left, ["e3"], "同 target 的不同 model 向量都该清掉");
  });

  // ===== G. Evidence 链 =====

  await check("G1 listEvidenceBySubject 只取该主体且按时间倒序", async () => {
    const s = new InMemoryStorage();
    await s.appendEvidence({ at: 100, kind: "assessment", subjectId: "ch1", delta: 0.2 });
    await s.appendEvidence({ at: 300, kind: "review", subjectId: "ch1", delta: 0 });
    await s.appendEvidence({ at: 200, kind: "assessment", subjectId: "ch2", delta: -0.1 });
    const list = await s.listEvidenceBySubject("ch1");
    assert.deepEqual(
      list.map((e) => e.at),
      [300, 100],
    );
    assert.equal((await s.listEvidence()).length, 3, "全量链路不受影响");
  });

  // ===== H. fullTextSearch（内存降级实现）=====

  await check("H1 大小写不敏感子串匹配", async () => {
    const s = new InMemoryStorage();
    await s.saveChunks([
      chunk("c1", { position: 0, content: "Attention Is All You Need" }),
      chunk("c2", { position: 1, content: "卷积神经网络" }),
    ]);
    assert.deepEqual(
      (await s.fullTextSearch("attention")).map((c) => c.id),
      ["c1"],
    );
    assert.deepEqual(
      (await s.fullTextSearch("卷积")).map((c) => c.id),
      ["c2"],
    );
  });

  await check("H2 scope 四维过滤（document/chapter/section/knowledge）", async () => {
    const s = new InMemoryStorage();
    await s.saveChunks([
      chunk("c1", {
        position: 0,
        documentId: "d1",
        chapterId: "ch1",
        sectionId: "s1",
        knowledgeIds: ["k1"],
        content: "共享关键词 alpha",
      }),
      chunk("c2", {
        position: 1,
        documentId: "d2",
        chapterId: "ch2",
        sectionId: "s2",
        knowledgeIds: ["k2"],
        content: "共享关键词 beta",
      }),
    ]);
    const q = "共享关键词";
    assert.equal((await s.fullTextSearch(q)).length, 2, "无 scope 全量命中");
    assert.deepEqual(
      (await s.fullTextSearch(q, { documentId: "d1" })).map((c) => c.id),
      ["c1"],
    );
    assert.deepEqual(
      (await s.fullTextSearch(q, { chapterId: "ch2" })).map((c) => c.id),
      ["c2"],
    );
    assert.deepEqual(
      (await s.fullTextSearch(q, { sectionId: "s1" })).map((c) => c.id),
      ["c1"],
    );
    assert.deepEqual(
      (await s.fullTextSearch(q, { knowledgeId: "k2" })).map((c) => c.id),
      ["c2"],
    );
  });

  await check("H3 limit 截断（默认 10，按 position 升序返回）", async () => {
    const s = new InMemoryStorage();
    const many: Chunk[] = [];
    for (let i = 0; i < 15; i += 1) {
      many.push(chunk(`c${i}`, { position: i, content: `关键词 ${i}` }));
    }
    await s.saveChunks(many);
    assert.equal((await s.fullTextSearch("关键词")).length, 10, "默认 limit=10");
    assert.equal((await s.fullTextSearch("关键词", undefined, 3)).length, 3);
    assert.deepEqual(
      (await s.fullTextSearch("关键词", undefined, 3)).map((c) => c.id),
      ["c0", "c1", "c2"],
    );
  });

  await check("H4 空查询 / 无命中返回空数组", async () => {
    const s = new InMemoryStorage();
    await s.saveChunk(chunk("c1", { content: "一些正文" }));
    assert.deepEqual(await s.fullTextSearch(""), []);
    assert.deepEqual(await s.fullTextSearch("   "), []);
    assert.deepEqual(await s.fullTextSearch("不存在"), []);
  });

  console.log(results.join("\n"));
  console.log(`\nstorage-adapter: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
};

void run();
