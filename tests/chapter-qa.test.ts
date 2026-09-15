/**
 * 章内提问单测（docs/learn-chapter-qa-design-2026-09.md §12）。
 * 运行：npm run test:qa
 *
 * 覆盖：解析器宽容/严判、锚定三不变式、范围锁定（缺口 A 回归）、
 * 两段式扩展、上下文截断、六态降级（empty / not-found / unanchored / no-ai / error）。
 *
 * 注：本文件**不 import 任何 .tsx** —— node 的 `--experimental-strip-types`
 * 不支持 JSX。引用标记切分逻辑因此被抽到 `reader/qa-citations.ts`（纯 .ts）。
 */
import assert from "node:assert/strict";
import type {
  Chapter,
  Chunk,
  Embedding,
  EmbeddingTargetType,
  EmbeddingVector,
  SourceDocument,
} from "../src/domain/index.ts";
import { embeddingKey } from "../src/domain/embedding.ts";
import type { RetrievalScope } from "../src/storage/types.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import type { AIProvider } from "../src/ai/types.ts";
import type { Embedder } from "../src/ai/embedding.ts";
import { hybridSearch } from "../src/ai/retrieval/hybrid-search.ts";
import {
  CHAPTER_QA_CONTEXT_CHARS,
  CONTEXT_BLOCK_CHARS,
  retrieveChapterContext,
} from "../src/ai/retrieval/chapter-context.ts";
import { buildChapterQaMessages, parseChapterQaAnswer } from "../src/ai/chapter-qa.ts";
import {
  MAX_CITATIONS,
  MAX_QUESTION_CHARS,
  anchorQuotes,
  askChapter,
} from "../src/features/learn/chapter-qa-service.ts";
import { splitCitationMarkers } from "../src/features/learn/reader/qa-citations.ts";

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

// ===== 语料 fixture（偏移手工对齐，保证 locateQuote 可命中） =====

const HEADER = "资料页眉。\n";
const SENT1 = "反向传播利用链式法则计算梯度。";
const SENT2 = "链式法则是训练神经网络的核心机制。";
const SENT3 = "训练神经网络需要大量算力支持。";
const SENT4 = "注意力机制通过查询与键的相似度决定权重分配。";
const SENT5 = "注意力机制是序列建模的核心机制之一。";
const CH1 = SENT1 + SENT2;
const CH2 = SENT4 + SENT5;
const SEP = "\n";
const TEXT = HEADER + CH1 + SEP + CH2;

const CH1_REF = { start: HEADER.length, end: HEADER.length + CH1.length };
const CH2_REF = { start: HEADER.length + CH1.length + SEP.length, end: TEXT.length };

function chunk(id: string, content: string, chapterId: string, position: number): Chunk {
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

function chapter(id: string, order: number, title: string, ref: { start: number; end: number }): Chapter {
  return {
    id,
    documentId: "doc1",
    order,
    title,
    contentRef: ref,
    keyPoints: [],
    unitIds: [],
    status: "not-started",
    createdAt: 1,
  };
}

const CHUNKS: Chunk[] = [
  chunk("c1", SENT1, "ch1", 0),
  chunk("c2", SENT2, "ch1", 1),
  chunk("c3", SENT3, "ch1", 2),
  chunk("c4", SENT4, "ch2", 3),
  chunk("c5", SENT5, "ch2", 4),
];

/** 铺一份两章资料 + chunk。 */
async function seed(
  s: InMemoryStorage,
  opts: { chunks?: Chunk[]; textPreview?: string } = {},
): Promise<void> {
  const doc: SourceDocument = {
    id: "doc1",
    title: "资料A",
    format: "md",
    importedAt: 1,
    status: "ready",
    textPreview: opts.textPreview ?? TEXT,
  };
  await s.saveDocument(doc);
  await s.saveChapters("doc1", [
    chapter("ch1", 1, "第 1 章 基础", CH1_REF),
    chapter("ch2", 2, "第 2 章 进阶", CH2_REF),
  ]);
  await s.saveChunks(opts.chunks ?? CHUNKS);
}

/** 记录调用次数的存储（用于断言「早退不检索」「向量候选按范围过滤」）。 */
class SpyStorage extends InMemoryStorage {
  ftCalls = 0;
  embCalls = 0;
  chunksCalls = 0;
  embTargetIds: (readonly string[] | undefined)[] = [];

  async fullTextSearch(
    q: string,
    scope?: RetrievalScope,
    limit?: number,
  ): Promise<Chunk[]> {
    this.ftCalls += 1;
    return super.fullTextSearch(q, scope, limit);
  }
  async listEmbeddingVectors(
    t: EmbeddingTargetType,
    ids?: readonly string[],
  ): Promise<EmbeddingVector[]> {
    this.embCalls += 1;
    this.embTargetIds.push(ids);
    return super.listEmbeddingVectors(t, ids);
  }
  async listChunks(chapterId: string): Promise<Chunk[]> {
    this.chunksCalls += 1;
    return super.listChunks(chapterId);
  }
}

/** 假 provider：返回预置内容；`isConfigured` 与调用次数可控。 */
function fakeProvider(content: string, configured = true): { provider: AIProvider; calls: { chat: number } } {
  const calls = { chat: 0 };
  const provider: AIProvider = {
    kind: "custom",
    isConfigured: () => configured,
    chat: () => {
      calls.chat += 1;
      return Promise.resolve({ content });
    },
  };
  return { provider, calls };
}

/** 假 encoder：按文本查表返回 2 维向量。 */
function fakeEmbedder(map: Record<string, number[]>): Embedder {
  return {
    model: "m",
    dim: 2,
    embed: (texts) => Promise.resolve(texts.map((t) => map[t] ?? [0, 0])),
  };
}

/** 造一条 JSON 应答。 */
function qaJson(found: boolean, answer: string, quotes: string[]): string {
  return JSON.stringify(found ? { found: true, answer, quotes } : { found: false, reason: answer });
}

const run = async () => {
  // ===== A. 提示词与解析器 =====

  await check("TC-UC01-03 buildChapterQaMessages 的硬约束与片段编号", () => {
    const msgs = buildChapterQaMessages({
      chapterTitle: "第 1 章 基础",
      documentTitle: "资料A",
      question: "这章讲了什么？",
      blocks: [
        { index: 1, chunkId: "c1", chapterId: "ch1", chapterTitle: "第 1 章 基础", text: SENT1 },
        { index: 2, chunkId: "c4", chapterId: "ch2", chapterTitle: "第 2 章 进阶", text: SENT4 },
      ],
    });
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, "system");
    assert.ok(msgs[0].content.includes("严禁使用片段之外的任何知识"));
    assert.ok(msgs[0].content.includes("逐字复制"));
    assert.ok(msgs[0].content.includes("found=false"));
    const user = msgs[1].content;
    assert.equal(msgs[1].role, "user");
    assert.ok(user.includes("【片段 1】"));
    assert.ok(user.includes("【片段 2】"));
    assert.ok(user.includes("【用户问题】这章讲了什么？"));
    // 来源只标章标题，不写「第 n 章」（片段序号 ≠ 章序号）
    assert.ok(user.includes("来源：「第 1 章 基础」"));
  });

  await check("TC-EDGE-09 严判 found：缺字段 / 字符串 \"true\" 一律 false", () => {
    assert.equal(parseChapterQaAnswer({ answer: "a", quotes: ["b"] }).found, false);
    assert.equal(parseChapterQaAnswer({ found: "true", answer: "a", quotes: ["b"] }).found, false);
    assert.equal(parseChapterQaAnswer({ found: 1, answer: "a", quotes: ["b"] }).found, false);
    assert.equal(parseChapterQaAnswer("nope").found, false);
    assert.equal(parseChapterQaAnswer(null).found, false);
    // 显式 true 才通过
    assert.equal(parseChapterQaAnswer({ found: true, answer: "a", quotes: ["b"] }).found, true);
  });

  await check("TC-EDGE-10 found=true 但无回答 / 无引文 → false", () => {
    assert.equal(parseChapterQaAnswer({ found: true, answer: "", quotes: ["b"] }).found, false);
    assert.equal(parseChapterQaAnswer({ found: true, answer: "   ", quotes: ["b"] }).found, false);
    assert.equal(parseChapterQaAnswer({ found: true, answer: "a", quotes: [] }).found, false);
    assert.equal(parseChapterQaAnswer({ found: true, answer: "a" }).found, false);
  });

  await check("解析器：quotes 去空 / 去重 / 单条截断 / 条数上限", () => {
    const long = "x".repeat(2500);
    const out = parseChapterQaAnswer({
      found: true,
      answer: "a",
      quotes: ["  b  ", "", "b", "   ", long, "c", "d", "e", "f", "g"],
    });
    assert.equal(out.quotes[0], "b");
    assert.equal(out.quotes.filter((q) => q === "b").length, 1, "重复项应去重");
    assert.ok(out.quotes.length <= MAX_CITATIONS, "条数应受上限约束");
    assert.ok(out.quotes.every((q) => q.length <= 2000), "单条应被截断到上限");
  });

  // ===== B. 锚定三不变式 =====

  await check("TC-UC01-02 折叠命中：换行被写成空格仍命中，且偏移还原到原始串", async () => {
    const s = new InMemoryStorage();
    const raw = "第一段内容\n第二段内容继续";
    const doc: SourceDocument = {
      id: "doc9",
      title: "折叠",
      format: "md",
      importedAt: 1,
      status: "ready",
      textPreview: raw,
    };
    await s.saveDocument(doc);
    const chapters = [chapter("cA", 1, "章A", { start: 0, end: raw.length })];
    const out = anchorQuotes(["第一段内容 第二段内容继续"], raw, chapters, "cA");
    assert.equal(out.length, 1, "折叠空白后应命中");
    assert.equal(out[0].start, 0);
    assert.equal(out[0].end, raw.length, "end 应为原始串绝对偏移");
    assert.equal(raw.slice(out[0].start, out[0].end), "第一段内容\n第二段内容继续");
  });

  await check("TC-UC07-02 部分锚不上 → 只留能锚的（绝不显示未核验引文）", async () => {
    const chapters = [chapter("ch1", 1, "第 1 章 基础", CH1_REF), chapter("ch2", 2, "第 2 章 进阶", CH2_REF)];
    const out = anchorQuotes(
      [SENT1, "这句原文里根本没有出现过。", SENT4],
      TEXT,
      chapters,
      "ch1",
    );
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((c) => c.quote), [SENT1, SENT4]);
    assert.equal(out[0].inThisChapter, true);
    assert.equal(out[1].inThisChapter, false);
  });

  await check("TC-UC08-01 跨章边界的区间 → 丢弃（不归属任何单章）", () => {
    const chapters = [chapter("ch1", 1, "第 1 章 基础", CH1_REF), chapter("ch2", 2, "第 2 章 进阶", CH2_REF)];
    const spanning = "核心机制。" + SEP + "注意力机制";
    assert.ok(TEXT.includes(spanning), "fixture 自身应包含该跨章串");
    assert.deepEqual(anchorQuotes([spanning], TEXT, chapters, "ch1"), []);
  });

  await check("TC-UC08-02 落在所有 contentRef 之外的区间 → 丢弃", () => {
    const chapters = [chapter("ch1", 1, "第 1 章 基础", CH1_REF), chapter("ch2", 2, "第 2 章 进阶", CH2_REF)];
    assert.ok(HEADER.includes("资料页眉。"));
    assert.deepEqual(anchorQuotes(["资料页眉。"], TEXT, chapters, "ch1"), []);
  });

  await check(`TC-EDGE-01 可锚 quote 超过 ${MAX_CITATIONS} 条时截到上限`, () => {
    const chapters = [chapter("ch1", 1, "第 1 章 基础", CH1_REF), chapter("ch2", 2, "第 2 章 进阶", CH2_REF)];
    const seven = ["链式法则", "梯度", "权重分配", SENT1, SENT2, SENT4, SENT5];
    const out = anchorQuotes(seven, TEXT, chapters, "ch1");
    assert.equal(out.length, MAX_CITATIONS);
  });

  await check("TC-EDGE-02 同一片段重复出现 → 去重后 1 条", () => {
    const chapters = [chapter("ch1", 1, "第 1 章 基础", CH1_REF)];
    const out = anchorQuotes([SENT1, SENT1, ` ${SENT1} `], TEXT, chapters, "ch1");
    assert.equal(out.length, 1);
  });

  // ===== C. 检索范围（缺口 A） =====

  await check("TC-EDGE-03 restrictChunkIds 同时锁住向量路（缺口 A 回归）", async () => {
    const s = new SpyStorage();
    await seed(s);
    await s.saveEmbeddings(
      ["c1", "c2", "c4"].map(
        (id): Embedding => ({
          id: embeddingKey("chunk", id, "m"),
          targetType: "chunk",
          targetId: id,
          model: "m",
          vectorDim: 2,
          vector: [1, 0],
          createdAt: 1,
        }),
      ),
    );
    const ownIds = ["c1", "c2"];
    const out = await hybridSearch("链式法则", {
      storage: s,
      embedder: fakeEmbedder({ 链式法则: [1, 0] }),
      restrictChunkIds: ownIds,
    });
    assert.ok(out.hits.length > 0, "范围内应有命中");
    assert.ok(
      out.hits.every((h) => h.chunk.chapterId === "ch1"),
      "结果不得含范围外的 ch2 chunk",
    );
    assert.deepEqual(s.embTargetIds, [ownIds], "向量候选请求的 targetIds 应等于入参");
  });

  await check("TC-EDGE-04 restrictChunkIds: [] → 短路，不发起 FTS / embedding", async () => {
    const s = new SpyStorage();
    await seed(s);
    await s.saveEmbeddings([
      {
        id: embeddingKey("chunk", "c1", "m"),
        targetType: "chunk",
        targetId: "c1",
        model: "m",
        vectorDim: 2,
        vector: [1, 0],
        createdAt: 1,
      },
    ]);
    const out = await hybridSearch("链式法则", {
      storage: s,
      embedder: fakeEmbedder({ 链式法则: [1, 0] }),
      restrictChunkIds: [],
    });
    assert.deepEqual(out, { hits: [], mode: "fulltext" });
    assert.equal(s.ftCalls, 0, "不得退化成全库 FTS");
    assert.equal(s.embCalls, 0, "不得退化成全库向量");
  });

  await check("TC-EDGE-06 上下文总量超上限 → 超限即停，不截半条", async () => {
    const s = new InMemoryStorage();
    const big = Array.from({ length: 6 }, (_v, i) =>
      chunk(`b${i}`, `关键词${"x".repeat(1500)}`, "ch1", i),
    );
    await seed(s, { chunks: big });
    const ctx = await retrieveChapterContext({
      storage: s,
      chapterId: "ch1",
      documentId: "doc1",
      query: "关键词",
    });
    const total = ctx.blocks.reduce((n, b) => n + b.text.length, 0);
    assert.ok(total <= CHAPTER_QA_CONTEXT_CHARS, `总量 ${total} 应 ≤ ${CHAPTER_QA_CONTEXT_CHARS}`);
    assert.ok(ctx.blocks.every((b) => b.text.length === CONTEXT_BLOCK_CHARS), "不得出现半条");
    assert.equal(ctx.blocks.length, Math.floor(CHAPTER_QA_CONTEXT_CHARS / CONTEXT_BLOCK_CHARS));
  });

  // ===== D. 端到端 askChapter =====

  await check("TC-UC01-01 本章命中充足 → answered + scopeUsed=chapter", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider, calls } = fakeProvider(qaJson(true, "本章讲链式法则。", [SENT1]));
    const out = await askChapter({
      storage: s,
      provider,
      documentId: "doc1",
      chapterId: "ch1",
      // 注：内存后端 FTS 是**整串子串匹配**（未分词），故查询词取原文子串；
      // 生产 FTS5 走 trigram 分词，能力更强。
      question: "链式法则",
    });
    assert.equal(out.status, "answered");
    assert.equal(out.citations.length, 1);
    assert.equal(out.citations[0].inThisChapter, true);
    assert.equal(out.citations[0].chapterId, "ch1");
    assert.equal(out.scopeUsed, "chapter");
    assert.equal(out.answer, "本章讲链式法则。");
    assert.equal(out.question, "链式法则");
    assert.equal(calls.chat, 1);
  });

  await check("TC-UC02-01/02 本章命中不足 → 扩到同资料他章，跨章引用标注正确", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider } = fakeProvider(qaJson(true, "见第 2 章。", [SENT5]));
    const out = await askChapter({
      storage: s,
      provider,
      documentId: "doc1",
      chapterId: "ch1",
      question: "核心机制",
    });
    assert.equal(out.scopeUsed, "document", "本章仅 1 条命中应触发扩展");
    assert.equal(s.ftCalls, 2, "扩展段应额外发起一次检索");
    assert.equal(out.citations.length, 1);
    const c = out.citations[0];
    assert.equal(c.inThisChapter, false);
    assert.equal(c.chapterId, "ch2");
    assert.ok(c.start >= CH2_REF.start && c.end <= CH2_REF.end, "命中区间应落在 ch2 的 contentRef 内");
  });

  await check("TC-UC02-03 本章命中恰为 2 → 不触发扩展", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider } = fakeProvider(qaJson(true, "本章即可回答。", [SENT1]));
    const out = await askChapter({
      storage: s,
      provider,
      documentId: "doc1",
      chapterId: "ch1",
      question: "链式法则",
    });
    assert.equal(out.scopeUsed, "chapter");
    assert.equal(s.ftCalls, 1, "不得发起扩展检索");
  });

  await check("TC-UC03-01 模型判 found=false → not-found，不产出回答", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider } = fakeProvider(JSON.stringify({ found: false, reason: "资料中未提及" }));
    const out = await askChapter({
      storage: s,
      provider,
      documentId: "doc1",
      chapterId: "ch1",
      question: "链式法则",
    });
    assert.equal(out.status, "not-found");
    assert.equal(out.answer, undefined);
    assert.deepEqual(out.citations, []);
  });

  await check("TC-UC03-02 检索 0 命中 → not-found 且不调用模型", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider, calls } = fakeProvider(qaJson(true, "不该被调用", [SENT1]));
    const out = await askChapter({
      storage: s,
      provider,
      documentId: "doc1",
      chapterId: "ch1",
      question: "完全无关的词zzz",
    });
    assert.equal(out.status, "not-found");
    assert.equal(calls.chat, 0, "无上下文时不得调用模型");
  });

  await check("TC-UC04-01 本章无 chunk → empty 且不调用模型", async () => {
    const s = new SpyStorage();
    await seed(s, { chunks: [chunk("c4", SENT4, "ch2", 0)] });
    const { provider, calls } = fakeProvider(qaJson(true, "不该被调用", [SENT1]));
    const out = await askChapter({
      storage: s,
      provider,
      documentId: "doc1",
      chapterId: "ch1",
      question: "链式法则",
    });
    assert.equal(out.status, "empty");
    assert.equal(s.ftCalls, 0, "无 chunk 时不应检索");
    assert.equal(calls.chat, 0);
  });

  await check("TC-UC04-02 textPreview 为空 → empty 且不检索", async () => {
    const s = new SpyStorage();
    await seed(s, { textPreview: "" });
    const { provider, calls } = fakeProvider(qaJson(true, "x", [SENT1]));
    const out = await askChapter({
      storage: s,
      provider,
      documentId: "doc1",
      chapterId: "ch1",
      question: "链式法则",
    });
    assert.equal(out.status, "empty");
    assert.equal(s.ftCalls, 0);
    assert.equal(calls.chat, 0);
  });

  await check("TC-UC05-01 未配置 AI → no-ai 早退（不检索、不调用）", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider, calls } = fakeProvider(qaJson(true, "x", [SENT1]), false);
    const out = await askChapter({
      storage: s,
      provider,
      documentId: "doc1",
      chapterId: "ch1",
      question: "链式法则",
    });
    assert.equal(out.status, "no-ai");
    assert.equal(s.chunksCalls, 0, "不该读 chunk");
    assert.equal(s.ftCalls, 0, "不该检索");
    assert.equal(calls.chat, 0, "不该调用模型");
  });

  await check("TC-UC06-01 非 JSON 输出 → error/parse（文案由 UI 映射）", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider } = fakeProvider("not json at all");
    const out = await askChapter({
      storage: s,
      provider,
      documentId: "doc1",
      chapterId: "ch1",
      question: "链式法则",
    });
    assert.equal(out.status, "error");
    assert.equal(out.errorKind, "parse");
  });

  await check("TC-UC06-02 截断 JSON 先经 repairTruncatedJson 抢救 → 不报错", async () => {
    const s = new SpyStorage();
    await seed(s);
    // 截断点落在「完整数组元素之后」→ 抢救保留完整元素（reason 字段被丢弃）
    const { provider } = fakeProvider('{"found":true,"answer":"a","quotes":["链式法则","梯度"],"reason":"x');
    const out = await askChapter({
      storage: s,
      provider,
      documentId: "doc1",
      chapterId: "ch1",
      question: "链式法则",
    });
    assert.equal(out.status, "answered");
    assert.equal(out.citations.length, 2);
  });

  await check("TC-UC07-01 found=true 但引文全锚不上 → unanchored（展示答案 + 零引用）", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider } = fakeProvider(qaJson(true, "本章主要讨论注意力机制与循环结构的对比。", ["这句是模型改写，原文里不存在。"]));
    const out = await askChapter({
      storage: s,
      provider,
      documentId: "doc1",
      chapterId: "ch1",
      question: "链式法则",
    });
    assert.equal(out.status, "unanchored");
    assert.equal(out.citations.length, 0, "绝不显示未核验的引文");
    assert.equal(out.answer, "本章主要讨论注意力机制与循环结构的对比。");
  });

  await check("TC-EDGE-07/08 问题非法（超长 / 纯空白）→ error，且不检索", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider } = fakeProvider(qaJson(true, "x", [SENT1]));
    const long = await askChapter({
      storage: s,
      provider,
      documentId: "doc1",
      chapterId: "ch1",
      question: "问".repeat(MAX_QUESTION_CHARS + 1),
    });
    assert.equal(long.status, "error");
    assert.equal(long.errorKind, "invalid-question");

    const blank = await askChapter({
      storage: s,
      provider,
      documentId: "doc1",
      chapterId: "ch1",
      question: "   ",
    });
    assert.equal(blank.status, "error");
    assert.equal(blank.errorKind, "invalid-question");
    assert.equal(s.ftCalls, 0, "问题非法时不应检索");
  });

  // ===== E. 引用标记渲染（纯函数） =====

  await check("TC-EDGE-11 答案含 [9] 而只有 2 条引用 → [9] 当普通文本，不崩", () => {
    const text = "结论见 A[9]，另见 B[1]。";
    const segs = splitCitationMarkers(text, 2);
    const cited = segs.filter((s) => s.citation !== undefined).map((s) => s.citation);
    assert.deepEqual(cited, [1], "越界下标不得被当作引用");
    assert.ok(
      segs.some((s) => s.citation === undefined && s.text.includes("[9]")),
      "[9] 应保留为普通文本",
    );
    assert.equal(segs.map((s) => s.text).join(""), text, "切分不得丢字");
  });

  await check("TC-EDGE-11b 全部下标越界 → 原样一段普通文本", () => {
    const segs = splitCitationMarkers("只有 [7] 一个标记", 2);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].citation, undefined);
    assert.equal(segs[0].text, "只有 [7] 一个标记");
  });

  console.log(results.join("\n"));
  console.log(`\nchapter-qa: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
};

void run();
