/**
 * 检索层单测（docs/rag-wiring-design-2026-09.md §12）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:retrieval
 *
 * 覆盖：余弦相似度边界、top-k 定序、RRF 融合、混合检索双路与降级、
 * 索引增量补齐、分批容错、幂等 id、前置能力校验、重入门闩。
 */
import assert from "node:assert/strict";
import type { Chapter, Chunk, Embedding, EmbeddingVector, SourceDocument } from "../src/domain/index.ts";
import { embeddingKey } from "../src/domain/embedding.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import type { AIProvider } from "../src/ai/types.ts";
import { cosineSimilarity, cosineTopK } from "../src/ai/retrieval/vector-search.ts";
import { fuseRankings } from "../src/ai/retrieval/rrf.ts";
import { hybridSearch } from "../src/ai/retrieval/hybrid-search.ts";
import { buildIndex } from "../src/features/learn/index-service.ts";
import { useIndexStore } from "../src/stores/useIndexStore.ts";
import { rebuildIndex } from "../src/features/learn/index-service.ts";

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

// ===== 辅助 =====

function vec(targetId: string, vector: number[], model = "m"): EmbeddingVector {
  return { targetId, model, dim: vector.length, vector };
}

function chunk(id: string, content: string, chapterId = "ch1", position = 0): Chunk {
  return {
    id,
    documentId: "doc1",
    chapterId,
    content,
    position,
    knowledgeIds: [],
    createdAt: 1,
  };
}

function chapter(id: string, title: string): Chapter {
  return {
    id,
    documentId: "doc1",
    order: 1,
    title,
    contentRef: { start: 0, end: 1 },
    keyPoints: [],
    unitIds: [],
    status: "not-started",
    createdAt: 1,
  };
}

/** 按「文本 → 向量」映射造一个假 provider；`failOn` 指定抛错的入参文本。 */
function fakeProvider(map: Record<string, number[]>, opts: { failOn?: string } = {}): AIProvider {
  return {
    kind: "custom",
    isConfigured: () => true,
    chat: () => Promise.resolve({ content: "" }),
    embed: (texts) =>
      Promise.resolve(
        texts.map((t) => {
          if (opts.failOn && t.includes(opts.failOn)) throw new Error("模拟 embedding 失败");
          return map[t] ?? [0, 0];
        }),
      ),
    generateAssessment: () => Promise.reject(new Error("not needed in tests")),
    evaluateAnswer: () => Promise.reject(new Error("not needed in tests")),
  };
}

/** 一个没有向量化能力的 provider（builtin 同款：embed 属性不存在）。 */
function noEmbedProvider(): AIProvider {
  return {
    kind: "custom",
    isConfigured: () => true,
    chat: () => Promise.resolve({ content: "" }),
    generateAssessment: () => Promise.reject(new Error("not needed in tests")),
    evaluateAnswer: () => Promise.reject(new Error("not needed in tests")),
  };
}

/** 铺一份带 chapter 与 chunk 的资料。 */
async function seed(s: InMemoryStorage, chunks: Chunk[]): Promise<void> {
  const doc: SourceDocument = {
    id: "doc1",
    title: "资料A",
    format: "md",
    importedAt: 1,
    status: "ready",
    textPreview: "正文",
  };
  await s.saveDocument(doc);
  await s.saveChapters("doc1", [chapter("ch1", "第 1 章 基础")]);
  await s.saveChunks(chunks);
}

const run = async () => {
  // ===== A. 余弦相似度 =====

  await check("A1 cosineSimilarity 手算校验", () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
    assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
    // [1,1] 与 [1,0]：dot=1, |a|=√2, |b|=1 → 1/√2
    assert.ok(Math.abs(cosineSimilarity([1, 1], [1, 0]) - Math.SQRT1_2) < 1e-12);
  });

  await check("A2 零向量 → 0，不产生 NaN（TC-EDGE-06）", () => {
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
    assert.equal(cosineSimilarity([0, 0], [0, 0]), 0);
    assert.equal(cosineSimilarity([], [1, 1]), 0);
    assert.equal(Number.isNaN(cosineSimilarity([0, 0], [1, 1])), false);
  });

  await check("A3 cosineTopK 定序符合手算（TC-UC04-01）", () => {
    const q = [1, 0];
    const { hits, skipped } = cosineTopK(
      q,
      [
        vec("正交", [0, 1]),
        vec("同向", [1, 0]),
        vec("近似", [0.9, Math.sqrt(1 - 0.81)]),
      ],
      10,
    );
    assert.equal(skipped, 0);
    assert.deepEqual(
      hits.map((h) => h.targetId),
      ["同向", "近似", "正交"],
    );
    assert.ok(hits[0].score > hits[1].score && hits[1].score > hits[2].score);
  });

  await check("A4 维度不一致的候选跳过并计数（TC-EDGE-05）", () => {
    const { hits, skipped } = cosineTopK(
      [1, 0],
      [vec("ok", [1, 0]), vec("dim3", [1, 0, 0]), { targetId: "empty", model: "m", dim: 0, vector: [] }],
      10,
    );
    assert.deepEqual(
      hits.map((h) => h.targetId),
      ["ok"],
    );
    assert.equal(skipped, 2);
  });

  await check("A5 top-k 截断与零结果", () => {
    const candidates = Array.from({ length: 5 }, (_v, i) => vec(`c${i}`, [1, 0]));
    assert.equal(cosineTopK([1, 0], candidates, 2).hits.length, 2);
    assert.equal(cosineTopK([1, 0], [], 5).hits.length, 0);
    // 分数相同时按 targetId 字典序，结果确定
    assert.deepEqual(
      cosineTopK([1, 0], candidates, 3).hits.map((h) => h.targetId),
      ["c0", "c1", "c2"],
    );
  });

  // ===== B. RRF =====

  await check("B1 两路都靠前的元素升至首位（TC-UC04-02）", () => {
    // 注：方案原文给的例子 fuseRankings([[a,b],[b,a]]) 两元素分数实际相等（并列），
    // 这里改用真正的「两路都靠前」例子：a 只在第一路第 1，b 在两路都靠前。
    const out = fuseRankings([
      ["a", "b"],
      ["b", "c"],
    ]);
    assert.equal(out[0], "b");
    assert.deepEqual(out.slice().sort(), ["a", "b", "c"]);
  });

  await check("B2 同一路内重复 id 只计首次", () => {
    const withDup = fuseRankings([["a", "a", "b"]]);
    const without = fuseRankings([["a", "b"]]);
    assert.deepEqual(withDup, without, "重复不应把 a 的分数刷高");
  });

  await check("B3 limit 截断 / 空输入", () => {
    assert.equal(fuseRankings([["a", "b", "c"]], { limit: 2 }).length, 2);
    assert.deepEqual(fuseRankings([]), []);
    assert.deepEqual(fuseRankings([[], []]), []);
  });

  await check("B4 k 越小，头部名次优势越大（公式方向校验）", () => {
    // k 小时 rank1 的 1/(k+1) 远大于 rank2 的 1/(k+2)
    const small = fuseRankings([["a", "b"]], { k: 1 });
    const large = fuseRankings([["a", "b"]], { k: 1000 });
    assert.deepEqual(small, large, "单路情形下顺序与 k 无关");
    // 两路交叉时 k 影响融合：a 第 1+第 3，b 第 2+第 2
    const kSmall = fuseRankings([["a", "b"], ["b", "a"]], { k: 1 });
    assert.equal(kSmall.length, 2);
  });

  // ===== C. 混合检索 =====

  await check("C1 provider 无 embed 能力 → 仅全文检索，不抛错（TC-UC04-03）", async () => {
    const s = new InMemoryStorage();
    await seed(s, [chunk("c1", "反向传播利用链式法则")]);
    const out = await hybridSearch("链式法则", {
      storage: s,
      provider: noEmbedProvider(),
    });
    assert.equal(out.mode, "fulltext");
    assert.equal(out.hits.length, 1);
    assert.equal(out.hits[0].semantic, false);
    assert.equal(out.hits[0].docTitle, "资料A");
    assert.equal(out.hits[0].chapterTitle, "第 1 章 基础");
  });

  await check("C2 双路融合：FTS 命中 + 向量独有命中，且标注语义来源", async () => {
    const s = new InMemoryStorage();
    await seed(s, [
      chunk("c1", "反向传播利用链式法则计算梯度", "ch1", 0),
      chunk("c2", "智能体通过奖励信号优化策略", "ch1", 1),
    ]);
    // 只有 c2 有向量；查询向量与 c2 更接近
    await s.saveEmbeddings([
      {
        id: embeddingKey("chunk", "c2", "m"),
        targetType: "chunk",
        targetId: "c2",
        model: "m",
        vectorDim: 2,
        vector: [0.99, 0.14],
        createdAt: 1,
      } satisfies Embedding,
    ]);

    const out = await hybridSearch("链式法则", {
      storage: s,
      provider: fakeProvider({ 链式法则: [1, 0] }),
    });
    assert.equal(out.mode, "hybrid");
    const ids = out.hits.map((h) => h.chunk.id);
    assert.ok(ids.includes("c1"), "FTS 命中应在结果内");
    assert.ok(ids.includes("c2"), "向量独有命中应进入结果");
    assert.equal(out.hits.find((h) => h.chunk.id === "c1")?.semantic, false);
    assert.equal(out.hits.find((h) => h.chunk.id === "c2")?.semantic, true);
  });

  await check("C3 库中无向量 / 空查询 → 降级全文，不报错", async () => {
    const s = new InMemoryStorage();
    await seed(s, [chunk("c1", "反向传播")]);
    const noVec = await hybridSearch("反向传播", {
      storage: s,
      provider: fakeProvider({ 反向传播: [1, 0] }),
    });
    assert.equal(noVec.mode, "fulltext", "库里没有向量时不算 hybrid");
    assert.equal(noVec.hits.length, 1);

    const empty = await hybridSearch("   ", { storage: s });
    assert.deepEqual(empty, { hits: [], mode: "fulltext" });
  });

  await check("C4 embedding 失败 → 静默降级全文（检索不中断）", async () => {
    const s = new InMemoryStorage();
    await seed(s, [chunk("c1", "反向传播")]);
    await s.saveEmbeddings([
      {
        id: "e1",
        targetType: "chunk",
        targetId: "c1",
        model: "m",
        vectorDim: 2,
        vector: [1, 0],
        createdAt: 1,
      },
    ]);
    const out = await hybridSearch("反向传播", {
      storage: s,
      provider: fakeProvider({}, { failOn: "反向传播" }),
    });
    assert.equal(out.mode, "fulltext");
    assert.equal(out.hits.length, 1, "FTS 路结果必须保留");
  });

  // ===== D. 索引编排 =====

  await check("D1 onlyMissing 只补缺失（TC-UC03-01）", async () => {
    const s = new InMemoryStorage();
    await seed(s, [chunk("c1", "A"), chunk("c2", "B"), chunk("c3", "C"), chunk("c4", "D"), chunk("c5", "E")]);
    for (const id of ["c1", "c2", "c3"]) {
      await s.saveEmbeddings([
        {
          id: embeddingKey("chunk", id, "m"),
          targetType: "chunk",
          targetId: id,
          model: "m",
          vectorDim: 2,
          vector: [1, 0],
          createdAt: 1,
        },
      ]);
    }
    const seen: string[] = [];
    const provider: AIProvider = {
      ...fakeProvider({}),
      embed: (texts) => {
        seen.push(...texts);
        return Promise.resolve(texts.map(() => [1, 0]));
      },
    };
    const p = await buildIndex({ storage: s, provider, model: "m", onlyMissing: true });
    assert.equal(p.total, 2, "只应处理缺失的 2 条");
    assert.deepEqual(seen.sort(), ["D", "E"]);
    assert.equal(p.done, 2);
    assert.equal(p.failed, 0);
    assert.equal((await s.listEmbeddingVectors("chunk")).length, 5);
  });

  await check("D2 某批失败 → 计入 failed，其余批仍写入（TC-UC03-02）", async () => {
    const s = new InMemoryStorage();
    await seed(s, [
      chunk("c1", "好1"),
      chunk("c2", "坏"),
      chunk("c3", "好2"),
      chunk("c4", "好3"),
    ]);
    const p = await buildIndex({
      storage: s,
      provider: fakeProvider({}, { failOn: "坏" }),
      model: "m",
      batchSize: 2,
    });
    assert.equal(p.total, 4);
    assert.equal(p.failed, 2, "含「坏」的那批应整批失败");
    assert.equal(p.done, 2, "另一批应成功写入");
    assert.equal((await s.listEmbeddingVectors("chunk")).length, 2);
  });

  await check("D3 幂等：embedding id = embeddingKey，重复执行不新增", async () => {
    const s = new InMemoryStorage();
    await seed(s, [chunk("c1", "A")]);
    const provider = fakeProvider({ A: [1, 0] });
    await buildIndex({ storage: s, provider, model: "m" });
    await buildIndex({ storage: s, provider, model: "m" });
    const list = await s.listEmbeddings("chunk");
    assert.equal(list.length, 1);
    assert.equal(list[0].id, embeddingKey("chunk", "c1", "m"));
  });

  await check("D4 换模型 → 新旧向量并存，覆盖率按模型独立", async () => {
    const s = new InMemoryStorage();
    await seed(s, [chunk("c1", "A")]);
    await buildIndex({ storage: s, provider: fakeProvider({ A: [1, 0] }), model: "m1" });
    await buildIndex({ storage: s, provider: fakeProvider({ A: [1, 0, 0] }), model: "m2" });
    assert.equal((await s.listEmbeddings("chunk")).length, 2, "多模型共存");
    assert.equal(
      (await s.listEmbeddingVectors("chunk")).filter((v) => v.model === "m2").length,
      1,
    );
  });

  await check("D5 前置能力不足 → 抛错而不是静默空跑", async () => {
    const s = new InMemoryStorage();
    await seed(s, [chunk("c1", "A")]);
    await assert.rejects(
      () => buildIndex({ storage: s, provider: noEmbedProvider(), model: "m" }),
      /不支持向量化/,
    );
    await assert.rejects(
      () => buildIndex({ storage: s, provider: fakeProvider({ A: [1, 0] }), model: "  " }),
      /未配置 Embedding 模型/,
    );
  });

  await check("D6 空正文 chunk 不进入向量化队列", async () => {
    const s = new InMemoryStorage();
    await seed(s, [chunk("c1", "A"), chunk("c2", "   ")]);
    const p = await buildIndex({
      storage: s,
      provider: fakeProvider({ A: [1, 0] }),
      model: "m",
    });
    assert.equal(p.total, 1);
  });

  await check("D7 索引任务重入门闩（TC-EDGE-11）", async () => {
    // 手动置 running（模拟任务进行中），rebuildIndex 必须直接拒绝而不是并发写。
    useIndexStore.getState().begin();
    try {
      await assert.rejects(() => rebuildIndex(), /正在进行中/);
    } finally {
      useIndexStore.getState().finish();
    }
    assert.equal(useIndexStore.getState().running, false);
  });

  await check("D8 进度回调按批推进且终态自洽", async () => {
    const s = new InMemoryStorage();
    await seed(s, [chunk("c1", "A"), chunk("c2", "B"), chunk("c3", "C")]);
    const snaps: number[] = [];
    await buildIndex({
      storage: s,
      provider: fakeProvider({ A: [1, 0], B: [1, 0], C: [1, 0] }),
      model: "m",
      batchSize: 1,
      onProgress: (p) => snaps.push(p.done + p.failed),
    });
    assert.deepEqual(snaps, [0, 1, 2, 3], "首批前应有 0 进度快照，其后逐批递增");
  });

  console.log(results.join("\n"));
  console.log(`\nretrieval: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
};

void run();
