/**
 * 导入后 AI 整理 单测（docs/import-ai-enrich-design-2026-09.md §11 / §12.1）。
 *
 * 运行：npm run test:enrich（或 npm run test:library 串联）
 *
 * 覆盖：
 *  A. isReplaceableTitle —— 三态（"user" / "derived" / 缺省）；
 *  B. createSerialQueue —— 串行不交叠、失败不阻断后续、返回值透传；
 *  C. enrichDocumentNow —— 校验（未配置 / 无正文）、标题策略（替换 / 不替换 / AI 漏字段）、
 *     写库形状（sourceChars / mode / chunks / model / generatedAt）、失败不写半成品、
 *     「title 不进 DocumentOverview」；
 *  D. 回归 —— 旧 title/overview 在失败时原样保留。
 *
 * 无网络、无 zustand、无 React：所有 AI 交互都走本地假 provider。
 */
import assert from "node:assert/strict";
import {
  EnrichError,
  createSerialQueue,
  enrichDocumentNow,
  isReplaceableTitle,
} from "../src/features/learn/enrich-service.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import type { AIProvider, ChatInput, ChatOutput } from "../src/ai/types.ts";
import type { Chapter } from "../src/domain/chapter.ts";
import type { SourceDocument } from "../src/domain/document.ts";

// ------------------------------------------------------------- 构造工具

/** 假 provider：`reply` 决定每次 chat 的返回，便于逐路径验证编排。 */
function mkProvider(
  reply: (input: ChatInput) => Promise<ChatOutput>,
  configured = true,
): AIProvider {
  return {
    kind: "builtin",
    isConfigured: () => configured,
    chat: reply,
  };
}

/** 记录 saveDocument 次数的存储（验证「失败不写库」）。 */
class CountingStorage extends InMemoryStorage {
  saves = 0;
  async saveDocument(doc: SourceDocument): Promise<void> {
    this.saves += 1;
    return super.saveDocument(doc);
  }
}

function mkDoc(over: Partial<SourceDocument> = {}): SourceDocument {
  return {
    id: "doc1",
    title: "第3章_Agent架构_v2",
    format: "markdown",
    importedAt: 1,
    status: "ready",
    textPreview: "甲".repeat(5000),
    ...over,
  };
}

/** 造一个最小可用的章（只用 contentRef / title）。 */
function ch(id: string, title: string, start: number, end: number): Chapter {
  return {
    id,
    documentId: "doc1",
    order: Number(id.replace(/\D/g, "")) || 1,
    title,
    contentRef: { start, end },
    keyPoints: [],
    unitIds: [],
    status: "not-started",
    createdAt: 0,
  };
}

/** 预置资料并把写库计数归零（setup 的写入不应计入断言）。 */
async function seed(store: CountingStorage, doc: SourceDocument): Promise<void> {
  await store.saveDocument(doc);
  store.saves = 0;
}

/** 合规的成稿响应（含 title）。 */
const RAW_OK = {
  title: "Agent 架构入门",
  gist: "讲了 Agent 的架构演进",
  sections: [{ heading: "单体", detail: "从单体到多智能体" }],
  prerequisites: ["会 TypeScript"],
  keywords: ["Agent"],
};

/** 按 system prompt 区分阶段：map 阶段回分块摘要，其余回整篇成稿。 */
const phaseAware = (raw: unknown) => async (input: ChatInput): Promise<ChatOutput> => ({
  content: input.messages[0].content.includes("其中一段")
    ? JSON.stringify({ digest: "这一段讲了张量", keywords: ["张量"], headings: ["张量"] })
    : JSON.stringify(raw),
});

const SHORT = "甲".repeat(5000); // ≤ chunkChars → 单次成稿
const LONG = "甲".repeat(30_000); // > chunkChars → map-reduce 3 块

// ============================================================ A. 标题策略谓词

function testReplaceableUser(): void {
  assert.equal(isReplaceableTitle("user"), false);
}

function testReplaceableDerived(): void {
  assert.equal(isReplaceableTitle("derived"), true);
}

function testReplaceableUndefined(): void {
  // 缺省 = 文件名 / 仓库名 / 兜底「未命名」→ 可覆盖。
  assert.equal(isReplaceableTitle(undefined), true);
}

// ============================================================ B. 串行队列

async function testQueueSerialNoOverlap(): Promise<void> {
  const enqueue = createSerialQueue();
  const order: number[] = [];
  let inflight = 0;
  let maxInflight = 0;
  const task = (i: number) => async (): Promise<number> => {
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, 5));
    order.push(i);
    inflight -= 1;
    return i;
  };
  await Promise.all([enqueue(task(1)), enqueue(task(2)), enqueue(task(3))]);
  assert.deepEqual(order, [1, 2, 3], "完成顺序应等于入队顺序");
  assert.equal(maxInflight, 1, "任一时刻最多一个任务在跑");
}

async function testQueueFailureDoesNotBlock(): Promise<void> {
  const enqueue = createSerialQueue();
  const done: string[] = [];
  const p1 = enqueue(async () => {
    throw new Error("第一个失败");
  });
  const p2 = enqueue(async () => {
    done.push("b");
  });
  const p3 = enqueue(async () => {
    done.push("c");
  });
  await assert.rejects(() => p1);
  await Promise.all([p2, p3]);
  assert.deepEqual(done, ["b", "c"], "前一个失败不应阻断后续任务");
}

async function testQueuePassesThroughResult(): Promise<void> {
  const enqueue = createSerialQueue();
  const r = await enqueue(async () => "结果");
  assert.equal(r, "结果");
  // 队列在失败后仍可继续使用（tail 已被 catch 平复）。
  await assert.rejects(() => enqueue(async () => Promise.reject(new Error("x"))));
  assert.equal(await enqueue(async () => 42), 42);
}

// ============================================================ C. 编排

async function testEnrichReplacesTitleAndWritesOverview(): Promise<void> {
  const store = new CountingStorage();
  const doc = mkDoc({ textPreview: SHORT });
  await seed(store, doc);
  const r = await enrichDocumentNow(doc, [], {
    storage: store,
    provider: mkProvider(phaseAware(RAW_OK)),
    replaceTitle: true,
    now: 777,
  });
  assert.equal(r.title, "Agent 架构入门");
  assert.equal(r.titleChanged, true);
  const saved = await store.getDocument("doc1");
  assert.equal(saved?.title, "Agent 架构入门");
  assert.equal(saved?.overview?.gist, RAW_OK.gist);
  assert.deepEqual(saved?.overview?.keywords, ["Agent"]);
  assert.equal(saved?.overview?.sourceChars, SHORT.length);
  assert.equal(saved?.overview?.generatedAt, 777);
  assert.equal(store.saves, 1, "成功路径只写一次库");
}

async function testEnrichShortTextSingleMode(): Promise<void> {
  const store = new CountingStorage();
  const doc = mkDoc({ textPreview: SHORT });
  await seed(store, doc);
  const r = await enrichDocumentNow(doc, [], {
    storage: store,
    provider: mkProvider(phaseAware(RAW_OK)),
    replaceTitle: false,
  });
  assert.equal(r.overview.mode, "single");
  assert.equal(r.overview.chunks, undefined, "single 时不写 chunks");
}

async function testEnrichLongTextMapReduce(): Promise<void> {
  const store = new CountingStorage();
  const doc = mkDoc({ textPreview: LONG });
  await seed(store, doc);
  const r = await enrichDocumentNow(doc, [], {
    storage: store,
    provider: mkProvider(phaseAware(RAW_OK)),
    replaceTitle: false,
  });
  assert.equal(r.overview.mode, "map-reduce");
  assert.ok((r.overview.chunks ?? 0) > 1, "长文应分多块");
}

async function testEnrichKeepsUserTitle(): Promise<void> {
  const store = new CountingStorage();
  const doc = mkDoc({ title: "我的读书笔记", textPreview: SHORT });
  await seed(store, doc);
  const r = await enrichDocumentNow(doc, [], {
    storage: store,
    provider: mkProvider(phaseAware(RAW_OK)),
    replaceTitle: false,
  });
  assert.equal(r.title, "我的读书笔记", "用户标题不被覆盖");
  assert.equal(r.titleChanged, false);
  const saved = await store.getDocument("doc1");
  assert.equal(saved?.title, "我的读书笔记");
  assert.ok(saved?.overview, "概览仍照常写入");
}

async function testEnrichWithoutAiTitleKeepsOriginal(): Promise<void> {
  const store = new CountingStorage();
  const doc = mkDoc({ textPreview: SHORT });
  await seed(store, doc);
  const noTitle = { ...RAW_OK, title: undefined };
  const r = await enrichDocumentNow(doc, [], {
    storage: store,
    provider: mkProvider(phaseAware(noTitle)),
    replaceTitle: true,
  });
  assert.equal(r.titleChanged, false, "模型漏 title → 保留原标题");
  assert.ok(r.overview.gist, "概览照常产出");
}

async function testEnrichNotConfigured(): Promise<void> {
  const store = new CountingStorage();
  const doc = mkDoc();
  await seed(store, doc);
  await assert.rejects(
    () =>
      enrichDocumentNow(doc, [], {
        storage: store,
        provider: mkProvider(phaseAware(RAW_OK), false),
        replaceTitle: true,
      }),
    (err: unknown) => err instanceof EnrichError && err.kind === "not-configured",
  );
  assert.equal(store.saves, 0, "未配置不写库");
}

async function testEnrichNoBody(): Promise<void> {
  const store = new CountingStorage();
  const doc = mkDoc({ textPreview: "   \n  " });
  await seed(store, doc);
  await assert.rejects(
    () =>
      enrichDocumentNow(doc, [], {
        storage: store,
        provider: mkProvider(phaseAware(RAW_OK)),
        replaceTitle: true,
      }),
    (err: unknown) => err instanceof EnrichError && err.kind === "no-body",
  );
  assert.equal(store.saves, 0, "无正文不写库");
}

async function testEnrichFailureWritesNothing(): Promise<void> {
  const store = new CountingStorage();
  const oldOverview = {
    gist: "旧概览",
    sections: [{ heading: "旧", detail: "旧的" }],
    prerequisites: [],
    keywords: [],
    generatedAt: 1,
    sourceChars: LONG.length,
    mode: "map-reduce" as const,
  };
  const doc = mkDoc({ textPreview: LONG, overview: oldOverview });
  await seed(store, doc);
  // 归并输出不合规（sections 为空）→ parseOverviewDraft 抛错。
  const badReduce = async (input: ChatInput): Promise<ChatOutput> => ({
    content: input.messages[0].content.includes("其中一段")
      ? JSON.stringify({ digest: "摘要", keywords: [], headings: [] })
      : JSON.stringify({ gist: "只有一句话" }),
  });
  await assert.rejects(() =>
    enrichDocumentNow(doc, [], {
      storage: store,
      provider: mkProvider(badReduce),
      replaceTitle: true,
    }),
  );
  assert.equal(store.saves, 0, "失败不写半成品");
  const saved = await store.getDocument("doc1");
  assert.equal(saved?.title, "第3章_Agent架构_v2", "旧标题原样保留");
  assert.equal(saved?.overview?.gist, "旧概览", "旧概览原样保留");
}

async function testTitleNeverLeaksIntoOverview(): Promise<void> {
  const store = new CountingStorage();
  const doc = mkDoc({ textPreview: SHORT });
  await seed(store, doc);
  const r = await enrichDocumentNow(doc, [], {
    storage: store,
    provider: mkProvider(phaseAware(RAW_OK)),
    replaceTitle: true,
  });
  // ⚠️ DocumentOverview 类型上没有 title —— spread 一旦污染就会落一个不存在的字段。
  assert.ok(!Object.keys(r.overview).includes("title"), "title 不得进 DocumentOverview");
  const saved = await store.getDocument("doc1");
  assert.ok(!Object.keys(saved?.overview ?? {}).includes("title"));
}

async function testEnrichWritesModel(): Promise<void> {
  const store = new CountingStorage();
  const doc = mkDoc({ textPreview: SHORT });
  await seed(store, doc);
  const r = await enrichDocumentNow(doc, [], {
    storage: store,
    provider: mkProvider(phaseAware(RAW_OK)),
    replaceTitle: false,
    model: "qwen3.5:4b",
  });
  assert.equal(r.overview.model, "qwen3.5:4b");
}

async function testEnrichWithChaptersUsesChapterBlocks(): Promise<void> {
  const store = new CountingStorage();
  // 5 章 × 8000 字 = 40000 字 → 按章边界切 5 块（章对齐优先于等分）。
  const chapters = [0, 1, 2, 3, 4].map((i) =>
    ch(`c${i + 1}`, `第 ${i + 1} 章`, i * 8000, (i + 1) * 8000),
  );
  const doc = mkDoc({ textPreview: "甲".repeat(40_000) });
  await seed(store, doc);
  const r = await enrichDocumentNow(doc, chapters, {
    storage: store,
    provider: mkProvider(phaseAware(RAW_OK)),
    replaceTitle: false,
  });
  assert.equal(r.overview.mode, "map-reduce");
  assert.equal(r.overview.chunks, 5, "应按 5 个章边界分块");
}

async function testEnrichReportsProgressPhases(): Promise<void> {
  const store = new CountingStorage();
  const doc = mkDoc({ textPreview: SHORT });
  await seed(store, doc);
  const phases: string[] = [];
  await enrichDocumentNow(doc, [], {
    storage: store,
    provider: mkProvider(phaseAware(RAW_OK)),
    replaceTitle: false,
    onProgress: (_i, _n, _label, phase) => phases.push(phase),
  });
  assert.deepEqual(phases, ["single"]);
}

// ============================================================ D. 边界

async function testEnrichBlankTitleStillGetsOverview(): Promise<void> {
  const store = new CountingStorage();
  // 粘贴留空 → 标题落兜底「未命名」，属于可覆盖值。
  const doc = mkDoc({ title: "未命名", textPreview: SHORT });
  await seed(store, doc);
  const r = await enrichDocumentNow(doc, [], {
    storage: store,
    provider: mkProvider(phaseAware(RAW_OK)),
    replaceTitle: true,
  });
  assert.equal(r.title, "Agent 架构入门");
  assert.equal(r.titleChanged, true);
}

async function testEnrichEmptyChaptersOK(): Promise<void> {
  const store = new CountingStorage();
  // 0 章（内容过短仅保存）也应能出概览——概览不依赖切分。
  const doc = mkDoc({ textPreview: SHORT });
  await seed(store, doc);
  const r = await enrichDocumentNow(doc, [], {
    storage: store,
    provider: mkProvider(phaseAware(RAW_OK)),
    replaceTitle: false,
  });
  assert.ok(r.overview.gist);
  assert.equal(store.saves, 1);
}

// ------------------------------------------------------------- 执行

const tests: [string, () => Promise<void> | void][] = [
  ["A/isReplaceableTitle \"user\" → false", testReplaceableUser],
  ["A/isReplaceableTitle \"derived\" → true", testReplaceableDerived],
  ["A/isReplaceableTitle 缺省 → true", testReplaceableUndefined],
  ["B/队列串行不交叠", testQueueSerialNoOverlap],
  ["B/队列失败不阻断后续", testQueueFailureDoesNotBlock],
  ["B/队列透传返回值且可复用", testQueuePassesThroughResult],
  ["C/替换标题并写入概览（一次写库）", testEnrichReplacesTitleAndWritesOverview],
  ["C/短文 → 单次成稿（无 chunks）", testEnrichShortTextSingleMode],
  ["C/长文 → map-reduce", testEnrichLongTextMapReduce],
  ["C/replaceTitle=false → 保留用户标题", testEnrichKeepsUserTitle],
  ["C/模型漏 title → 保留原标题且概览照常", testEnrichWithoutAiTitleKeepsOriginal],
  ["C/未配置 AI → not-configured 且不写库", testEnrichNotConfigured],
  ["C/无正文 → no-body 且不写库", testEnrichNoBody],
  ["C/归并不合规 → 失败不写库且旧数据保留", testEnrichFailureWritesNothing],
  ["C/title 不污染 DocumentOverview", testTitleNeverLeaksIntoOverview],
  ["C/model 写入 overview.model", testEnrichWritesModel],
  ["C/有章时按章边界分块", testEnrichWithChaptersUsesChapterBlocks],
  ["C/onProgress 上报 single 阶段", testEnrichReportsProgressPhases],
  ["D/兜底标题「未命名」可被覆盖", testEnrichBlankTitleStillGetsOverview],
  ["D/0 章资料仍能出概览", testEnrichEmptyChaptersOK],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ❌ ${name}`);
    console.error(err);
  }
}
if (failed > 0) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log(`\n全部 ${tests.length} 项通过`);
