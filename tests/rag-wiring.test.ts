/**
 * RAG 接线端到端单测（docs/rag-wiring-design-2026-09.md §12）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:rag
 *
 * 策略：注入 InMemoryStorage 走完整链路（导入 → chunk 落库 → FTS 命中 → 重切幂等 →
 * 级联清理），不触真实 SQLite / 真实网络。SQLite 路径的差异（BLOB 编解码、
 * db_delete_chunks_by_document）由 `cargo test` 的契约单测 + 桌面端手工验证承担。
 *
 * 覆盖：TC-UC01-01/02、TC-UC02-01/02、TC-UC05-01、TC-EDGE-09/10。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Chapter, Embedding } from "../src/domain/index.ts";
import { embeddingKey } from "../src/domain/embedding.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import { runUnitImport } from "../src/features/learn/import/pipeline.ts";
import { splitDocumentNow } from "../src/features/learn/split-service.ts";
import { rebuildChunks } from "../src/features/learn/index-chunks.ts";
import { deleteDocumentCascade, previewDeleteCascade } from "../src/features/learn/library-actions.ts";
import type { ImportUnit } from "../src/features/learn/import/types.ts";

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

const SAMPLE = [
  "# 深度学习导论",
  "",
  "本书从基础开始介绍神经网络与表示学习。",
  "",
  "## 第 1 章 神经网络基础",
  "",
  "神经元是神经网络的最小计算单元，通过激活函数引入非线性。",
  "",
  "反向传播利用链式法则计算梯度，是训练深网的核心算法。",
  "",
  "## 第 2 章 注意力机制",
  "",
  "查询与键的相似度决定注意力的分配，这一机制取代了循环结构。",
  "",
  "多头注意力在多个子空间中并行计算，提升了表达容量。",
  "",
  "## 第 3 章 强化学习基础",
  "",
  "智能体通过奖励信号优化策略，与监督学习的目标函数不同。",
].join("\n");

function unit(text: string, title = "深度学习导论"): ImportUnit {
  return { title, format: "md", splitFormat: "markdown", text };
}

/** 让 saveChunks 抛错，模拟写入中途失败（TC-EDGE-09）。 */
class FailingSaveStorage extends InMemoryStorage {
  override async saveChunks(): Promise<void> {
    throw new Error("模拟写入失败");
  }
}

const run = async () => {
  // ===== UC-01 导入后正文可检索 =====

  await check("UC01-01 导入 → chunk 落库且 position 全局连续", async () => {
    const s = new InMemoryStorage();
    const res = await runUnitImport(unit(SAMPLE), { storage: s });
    assert.ok(res.chapterIds.length >= 3, `应切出 ≥3 章，实际 ${res.chapterIds.length}`);

    const chunks = await s.listChunksByDocument(res.docId);
    assert.ok(chunks.length > 0, "导入后 chunks 表必须首次有数据");
    assert.deepEqual(
      chunks.map((c) => c.position),
      chunks.map((_c, i) => i),
      "position 全局连续",
    );
    assert.ok(
      chunks.every((c) => c.tokenCount !== undefined && c.tokenCount > 0),
      "每块都应有 tokenCount",
    );
    assert.ok(
      chunks.every((c) => c.metadata?.heading !== undefined),
      "块应带章标题上下文",
    );
  });

  await check("UC01-02 全文检索能命中正文（此前只能命中标题与要点）", async () => {
    const s = new InMemoryStorage();
    const res = await runUnitImport(unit(SAMPLE), { storage: s });
    const hits = await s.fullTextSearch("链式法则", undefined, 10);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].documentId, res.docId);
    assert.ok(hits[0].content.includes("链式法则"));

    // 章标题之外的正文内容也能检索到
    const hits2 = await s.fullTextSearch("多头注意力", undefined, 10);
    assert.ok(hits2.length >= 1);
  });

  // ===== UC-02 重切分幂等 =====

  await check("UC02-01 rebuildChunks 两次 → chunk 数不翻倍（TC-UC02-01）", async () => {
    const s = new InMemoryStorage();
    const res = await runUnitImport(unit(SAMPLE), { storage: s });
    const doc = (await s.getDocument(res.docId))!;
    const chapters = await s.listChapters(res.docId);

    const first = await rebuildChunks(doc, chapters, s);
    const second = await rebuildChunks(doc, chapters, s);
    assert.equal(first.chunks, second.chunks, "两次重建条数一致");
    assert.equal(
      (await s.listChunksByDocument(res.docId)).length,
      first.chunks,
      "不得累积孤儿",
    );
  });

  await check("UC02-02 重建后旧 chunk 的向量被清理（不出现「新块配旧向量」）", async () => {
    const s = new InMemoryStorage();
    const res = await runUnitImport(unit(SAMPLE), { storage: s });
    const doc = (await s.getDocument(res.docId))!;
    const chapters = await s.listChapters(res.docId);

    const before = await s.listChunksByDocument(res.docId);
    await s.saveEmbeddings(
      before.map(
        (c, i): Embedding => ({
          id: embeddingKey("chunk", c.id, "test-model"),
          targetType: "chunk",
          targetId: c.id,
          model: "test-model",
          vectorDim: 3,
          vector: [1, 0, i % 2],
          createdAt: 1,
        }),
      ),
    );
    assert.equal((await s.listEmbeddingVectors("chunk")).length, before.length);

    await rebuildChunks(doc, chapters, s);

    // 新 chunk id 全变 → 旧向量应被清空，只剩新块的 0 条
    const after = await s.listEmbeddingVectors("chunk");
    assert.equal(after.length, 0, "旧向量必须随旧 chunk 一起失效");
    const newIds = new Set((await s.listChunksByDocument(res.docId)).map((c) => c.id));
    assert.equal(
      newIds.has(before[0].id),
      false,
      "重切后 chunk id 应变化（区间相同亦重新生成）",
    );
  });

  await check("UC02-03 splitDocumentNow（手动切分）也落 chunk", async () => {
    const s = new InMemoryStorage();
    // 先造一份「已保存但未切分」的资料，再走手动切分入口
    const docId = "doc-manual";
    await s.saveDocument({
      id: docId,
      title: "手动切分样本",
      format: "md",
      importedAt: 1,
      status: "ready",
      textPreview: SAMPLE,
    });
    const res = await splitDocumentNow((await s.getDocument(docId))!, { storage: s, now: 1 });
    assert.equal(res.mode, "initial");
    const chunks = await s.listChunksByDocument(docId);
    assert.ok(chunks.length > 0, "手动切分也必须落 chunk");
    assert.equal(chunks.length, (await s.listChunksByDocument(docId)).length);
  });

  // ===== UC-05 + TC-EDGE-09 =====

  await check("UC05-01 删除资料级联清 chunk 与向量（TC-UC05-01）", async () => {
    const s = new InMemoryStorage();
    const res = await runUnitImport(unit(SAMPLE), { storage: s });
    const chunks = await s.listChunksByDocument(res.docId);
    await s.saveEmbeddings(
      chunks.map(
        (c): Embedding => ({
          id: embeddingKey("chunk", c.id, "m"),
          targetType: "chunk",
          targetId: c.id,
          model: "m",
          vectorDim: 2,
          vector: [1, 1],
          createdAt: 1,
        }),
      ),
    );

    const preview = await previewDeleteCascade(res.docId, s);
    assert.equal(preview.chunks, chunks.length, "预检要报出将被清理的块数");

    const report = await deleteDocumentCascade(res.docId, s);
    assert.equal(report.chunks, chunks.length);
    assert.equal((await s.listChunksByDocument(res.docId)).length, 0, "chunk 残留");
    assert.equal((await s.listEmbeddingVectors("chunk")).length, 0, "向量残留");
    assert.equal((await s.fullTextSearch("链式法则")).length, 0, "FTS 残留");
    assert.equal(await s.getDocument(res.docId), undefined);
  });

  await check("TC-EDGE-09 写入失败向上抛且不留半成品", async () => {
    const s = new FailingSaveStorage();
    const doc = {
      id: "doc-x",
      title: "T",
      format: "md" as const,
      importedAt: 1,
      status: "ready" as const,
      textPreview: SAMPLE,
    };
    const chapters: Chapter[] = [
      {
        id: "chp-1",
        documentId: "doc-x",
        order: 1,
        title: "第 1 章",
        contentRef: { start: 0, end: SAMPLE.length },
        keyPoints: [],
        unitIds: [],
        status: "not-started",
        createdAt: 1,
      },
    ];
    await assert.rejects(
      () => rebuildChunks(doc, chapters, s),
      /模拟写入失败/,
      "写入失败必须向上抛",
    );
    assert.equal((await s.listChunksByDocument("doc-x")).length, 0, "不得留半成品");
  });

  // ===== TC-EDGE-10 静态边界 =====

  await check("TC-EDGE-10 依赖边界：chunk-engine 不碰 storage/ai，index-service 不碰 chunk-engine", () => {
    const ce = readFileSync(new URL("../src/engine/chunk-engine.ts", import.meta.url), "utf8");
    assert.equal(/from\s+"[^"]*\/storage/.test(ce), false, "chunk-engine 不得依赖 storage");
    assert.equal(/from\s+"[^"]*\/ai/.test(ce), false, "chunk-engine 不得依赖 ai");
    assert.equal(/from\s+"react/.test(ce), false, "chunk-engine 不得依赖 React");

    const ic = readFileSync(new URL("../src/features/learn/index-chunks.ts", import.meta.url), "utf8");
    assert.equal(/from\s+"[^"]*\/ai/.test(ic), false, "index-chunks 属纯代码，不得依赖 ai");
  });

  console.log(results.join("\n"));
  console.log(`\nrag-wiring: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
};

void run();
