/**
 * 章内 map-reduce 单测 —— 概念 / 要点 / 章节精修三条管道不再因长度失败。
 *
 * 运行：`npm run test:aimap`
 *
 * 覆盖（对应 docs/ai-chapter-mapreduce-design-2026-09.md §12）：
 *  - 分块不变式（自适应块尺寸、块数 ≤8、短章单块直出、边界两侧）；
 *  - 要点：块数、调用次数、单块失败跳过、全失败抛错、归并回退（D6）；
 *  - **引用式归并的不变量**：产出条目的 quote / start / end 与代码侧候选逐字节
 *    一致 —— AI 在归并里伪造的引文必须被丢弃；
 *  - 概念：mergeOf 引用、越界剔除、条数上限、evidence 从候选继承、关系重映射；
 *  - 精修：分批数、批内 index → 整篇 index、跨批 mergeIntoPrevious、失败批计数。
 *
 * 无网络、无真实 provider：全部走本地假 provider 或纯函数。
 */
import assert from "node:assert/strict";
import {
  planChapterBlocks,
  extractKeyPointsMapped,
  parseKeyPointDrafts,
  parseKeyPointMerge,
  hasMeaningfulText,
} from "../src/ai/chapter-map-reduce.ts";
import { extractConceptsMapped, parseConceptMerge } from "../src/ai/concept-map-reduce.ts";
import type { ConceptCandidate } from "../src/ai/concept-map-reduce.ts";
import { planRefineBatches, refineChaptersBatched } from "../src/ai/refine-batch.ts";
import { applyChapterRefine } from "../src/engine/splitter-engine.ts";
import { AiProviderError } from "../src/ai/types.ts";
import type { AIProvider, ChatInput, ChatOutput } from "../src/ai/types.ts";
import type { Chapter } from "../src/domain/chapter.ts";

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

/* ---------- 夹具 ---------- */

/** 造一段长正文：每 40 字带一个唯一标记「#i」，便于块内取到互不相同的 quote。 */
function makeBody(len: number): string {
  let s = "";
  let i = 0;
  while (s.length < len) {
    s += `#${i} ` + "甲".repeat(Math.max(0, 36 - String(i).length));
    i++;
  }
  return s.slice(0, len);
}

/** 造一个最小可用的章。 */
function ch(id: string, title: string, start: number, end: number): Chapter {
  return {
    id,
    documentId: "doc-1",
    order: Number(id.replace(/\D/g, "")) || 1,
    title,
    contentRef: { start, end },
    keyPoints: [],
    unitIds: [],
    status: "not-started",
    createdAt: 0,
  };
}

/** 假 provider：`reply` 决定每次 chat 的返回，便于逐路径验证执行器。 */
function mkProvider(reply: (input: ChatInput) => Promise<ChatOutput>): AIProvider {
  return {
    kind: "builtin",
    isConfigured: () => true,
    chat: reply,
    generateAssessment: () => Promise.reject(new Error("不应被调用")),
    evaluateAnswer: () => Promise.reject(new Error("不应被调用")),
  };
}

/** 分块阶段（"其中一段"）vs 归并阶段（"不要输出原文引文"）。 */
const isBlock = (input: ChatInput) => input.messages[0].content.includes("其中一段");
const isMerge = (input: ChatInput) => input.messages[0].content.includes("不要输出原文引文");

/** 取出一条消息里的正文（user 消息末段）。 */
function bodyOf(input: ChatInput): string {
  const user = input.messages[1].content;
  const at = user.lastIndexOf("\n\n");
  return user.slice(at + 2);
}

/** 简易锚定器：quote 在正文中首次出现处（找不到 → undefined）。 */
const anchorOf = (body: string) => (quote: string) => {
  const at = body.indexOf(quote);
  return at < 0 ? undefined : { start: at, end: at + quote.length };
};

/* ---------- 1. 分块 ---------- */

await check("TC-EDGE-02 章长 3,000 / 3,001 字 → 恰好 1 块 / 2 块（门槛两侧）", () => {
  assert.equal(planChapterBlocks(makeBody(3_000)).length, 1, "3,000 字应单块直出");
  assert.equal(planChapterBlocks(makeBody(3_001)).length, 2, "3,001 字应切成 2 块");
});

await check("TC-EDGE-05 20 万字单章 → 自适应收敛到 ≤8 块，且连续覆盖不变式成立", () => {
  const body = makeBody(200_000);
  const blocks = planChapterBlocks(body);
  assert.ok(blocks.length <= 8, `块数 ${blocks.length} 应 ≤ 8`);
  assert.equal(blocks[0].start, 0, "首块起点必须为 0");
  assert.equal(blocks[blocks.length - 1].end, body.length, "末块必须到文末");
  blocks.forEach((b, i) => {
    if (i > 0) assert.equal(blocks[i - 1].end, b.start, "块之间必须连续");
    assert.ok(b.end > b.start, "块不能为空");
  });
  assert.equal(blocks.map((b) => body.slice(b.start, b.end)).join(""), body, "拼接必须等于原文");
});

/* ---------- 2. 要点：执行器 ---------- */

await check("TC-UC01-01 4.5 万字 → 8 块、8 次 map + 1 次归并、产出 ≤8 条 refs", async () => {
  const body = makeBody(45_000);
  let blockCalls = 0;
  let mergeCalls = 0;
  const p = mkProvider(async (input) => {
    if (isBlock(input)) {
      blockCalls++;
      const quote = bodyOf(input).slice(0, 8);
      return { content: JSON.stringify({ points: [{ point: `要点 ${blockCalls}`, quote }] }) };
    }
    mergeCalls++;
    return { content: JSON.stringify([{ point: "归并后的要点", sourceIndex: 0 }]) };
  });
  const out = await extractKeyPointsMapped(p, {
    chapterTitle: "长章",
    text: body,
    anchor: anchorOf(body),
  });
  assert.equal(out.blocks, 8, "4.5 万字应按自适应尺寸切成 8 块");
  assert.equal(blockCalls, 8, "map 应调用 8 次");
  assert.equal(mergeCalls, 1, "归并应调用 1 次");
  assert.ok(out.refs.length <= 8, `refs 应 ≤8，实为 ${out.refs.length}`);
  assert.equal(out.mergeFallback, false);
  assert.equal(out.skippedBlocks, 0);
});

await check("引用式归并：quote / start / end 与代码侧候选逐字节一致（AI 伪造的引文被丢弃）", async () => {
  const body = makeBody(45_000);
  let firstQuote = "";
  const p = mkProvider(async (input) => {
    if (isBlock(input)) {
      const quote = bodyOf(input).slice(0, 8);
      if (!firstQuote) firstQuote = quote;
      return { content: JSON.stringify({ points: [{ point: "要点", quote }] }) };
    }
    // 归并阶段刻意伪造引文与偏移 —— 实现必须完全忽略它们
    return {
      content: JSON.stringify([
        { point: "归并后的要点", sourceIndex: 0, quote: "完全伪造的引文", start: 999_999, end: 1 },
      ]),
    };
  });
  const out = await extractKeyPointsMapped(p, { chapterTitle: "t", text: body, anchor: anchorOf(body) });
  const r = out.refs[0];
  assert.equal(r.quote, firstQuote, "quote 必须继承自候选，而不是 AI 给的引文");
  assert.ok(r.quote !== "完全伪造的引文", "AI 伪造的引文必须被丢弃");
  // 最强断言：产出的区间切出来就是它自己的 quote（可溯源）
  assert.equal(body.slice(r.start, r.end), r.quote, "start/end 必须落在 quote 自身所在区间");
});

await check("TC-UC01-02 第 3 块失败 → 章仍成功，skippedBlocks = 1，其余块保留", async () => {
  const body = makeBody(45_000);
  let n = 0;
  const p = mkProvider(async (input) => {
    if (isBlock(input)) {
      n++;
      if (n === 3) throw new Error("模拟某块失败");
      const quote = bodyOf(input).slice(0, 8);
      return { content: JSON.stringify({ points: [{ point: `要点 ${n}`, quote }] }) };
    }
    return { content: JSON.stringify([{ point: "归并", sourceIndex: 0 }]) };
  });
  const out = await extractKeyPointsMapped(p, { chapterTitle: "t", text: body, anchor: anchorOf(body) });
  assert.equal(out.skippedBlocks, 1, "应有 1 块被跳过");
  assert.ok(out.refs.length > 0, "其余块的内容应保留");
});

await check("TC-UC01-03 全部块失败 → 抛 AiProviderError（章进 failed[]）", async () => {
  const body = makeBody(45_000);
  const p = mkProvider(async (input) => {
    if (isBlock(input)) throw new Error("全失败");
    return { content: "[]" };
  });
  await assert.rejects(
    () => extractKeyPointsMapped(p, { chapterTitle: "t", text: body, anchor: anchorOf(body) }),
    (err: unknown) => err instanceof AiProviderError,
  );
});

await check("TC-UC01-04 归并失败 → 回退代码级合并结果，mergeFallback = true，不抛错（D6）", async () => {
  const body = makeBody(45_000);
  const p = mkProvider(async (input) => {
    if (isBlock(input)) {
      const quote = bodyOf(input).slice(0, 8);
      return { content: JSON.stringify({ points: [{ point: "要点", quote }] }) };
    }
    throw new Error("归并失败");
  });
  const out = await extractKeyPointsMapped(p, { chapterTitle: "t", text: body, anchor: anchorOf(body) });
  assert.equal(out.mergeFallback, true, "应标记为归并回退");
  assert.ok(out.refs.length > 0, "应保留代码级合并结果");
  assert.equal(out.refs[0].quote, body.slice(out.refs[0].start, out.refs[0].end), "回退结果同样可溯源");
});

await check("TC-EDGE-08 锚定失败 → 该条当场丢弃并计入 unanchored", async () => {
  const body = makeBody(45_000);
  const p = mkProvider(async (input) => {
    if (isBlock(input)) {
      return {
        content: JSON.stringify({ points: [{ point: "锚不上的要点", quote: "这段文字并不在正文里出现" }] }),
      };
    }
    return { content: "[]" };
  });
  const out = await extractKeyPointsMapped(p, { chapterTitle: "t", text: body, anchor: anchorOf(body) });
  assert.ok(out.unanchored >= 1, "应计入 unanchored");
  assert.equal(out.refs.length, 0, "锚不上的条目不得入库");
});

await check("TC-EDGE-06 归并输出重复 sourceIndex → 去重后不产生重复 ref", () => {
  const candidates = [
    // 占位用两字起（质量门要求有效字符 ≥2，单字会被当作符号丢弃）。
    { index: 0, point: "甲点", quote: "q0", start: 0, end: 2 },
    { index: 1, point: "乙点", quote: "q1", start: 2, end: 4 },
  ];
  const out = parseKeyPointMerge(
    [
      { point: "甲点", sourceIndex: 0 },
      { point: "甲点", sourceIndex: 0 },
      { point: "甲点的另一种说法", sourceIndex: 0 },
      { point: "乙点", sourceIndex: 1 },
    ],
    candidates,
  );
  assert.equal(out.length, 2, "同一候选的重复引用（含同区间不同措辞）应被去重");
  assert.deepEqual(out.map((r) => r.start), [0, 2]);
});

await check("TC-EDGE-07 归并产物全非法 → 返回空（由调用方回退）", () => {
  const candidates = [{ index: 0, point: "甲", quote: "q0", start: 0, end: 2 }];
  const out = parseKeyPointMerge(
    [{ sourceIndex: 99, point: "越界" }, { sourceIndex: 0, point: "" }, "垃圾", null],
    candidates,
  );
  assert.deepEqual(out, [], "全部非法应返回空数组");
});

await check("TC-UC04-01 短章（2.9k 字）→ 块数 1，不调归并", async () => {
  const body = makeBody(2_900);
  let calls = 0;
  let mergeCalls = 0;
  const p = mkProvider(async (input) => {
    calls++;
    if (isMerge(input)) mergeCalls++;
    const quote = body.slice(0, 8);
    return { content: JSON.stringify({ points: [{ point: "要点", quote }] }) };
  });
  const out = await extractKeyPointsMapped(p, { chapterTitle: "t", text: body, anchor: anchorOf(body) });
  assert.equal(out.blocks, 1);
  assert.equal(calls, 1, "短章只应调用 1 次");
  assert.equal(mergeCalls, 0, "短章不应触发归并");
});

await check("TC-EDGE-01 空正文 → 抛错且不发起任何调用", async () => {
  let called = 0;
  const p = mkProvider(async () => {
    called++;
    return { content: "{}" };
  });
  await assert.rejects(
    () => extractKeyPointsMapped(p, { chapterTitle: "t", text: "   \n  ", anchor: () => undefined }),
    (err: unknown) => err instanceof AiProviderError,
  );
  assert.equal(called, 0, "空正文不应产生任何调用");
});

/* ---------- 3. 概念：引用式归并 ---------- */

await check("TC-UC02-01 mergeOf 合并 + evidence 从候选继承", async () => {
  const body = makeBody(45_000);
  const p = mkProvider(async (input) => {
    if (isBlock(input)) {
      const blockText = bodyOf(input);
      return {
        content: JSON.stringify({
          units: [{ title: `概念@${blockText.slice(0, 4)}`, kind: "concept", quote: blockText.slice(0, 8) }],
          relations: [],
        }),
      };
    }
    return {
      content: JSON.stringify([
        { title: "合并概念", kind: "concept", summary: "s", tags: [], mergeOf: [0, 1] },
      ]),
    };
  });
  const out = await extractConceptsMapped(p, {
    chapterTitle: "t",
    text: body,
    documentId: "doc-1",
    anchor: anchorOf(body),
  });
  // 8 块 × 1 个概念 = 8 个候选；mergeOf [0,1] 合并前两个，其余 6 个追加为独立概念
  assert.equal(out.units[0].title, "合并概念", "归并项应排在最前");
  assert.ok(out.units.length >= 1);
  const ev = out.units[0].evidence;
  assert.ok(ev, "合并后的概念应继承候选的 evidence");
  assert.equal(ev!.documentId, "doc-1");
  assert.equal(body.slice(ev!.start, ev!.end), ev!.quote, "继承的出处必须可溯源");
  assert.equal(ev!.start, 0, "应取 mergeOf 中首个可锚定候选（候选 0 在正文开头）");
});

await check("TC-UC02-02 mergeOf 越界 → 越界项剔除；全越界则该条丢弃，不抛错", () => {
  const candidates: ConceptCandidate[] = [
    { index: 0, title: "甲", kind: "concept", tags: [] },
    { index: 1, title: "乙", kind: "concept", tags: [] },
  ];
  const { merged, candidateToMerged } = parseConceptMerge(
    [
      { title: "合并", kind: "concept", mergeOf: [0, 99, -1] },
      { title: "全越界", kind: "concept", mergeOf: [50, 51] },
    ],
    candidates,
  );
  assert.equal(merged.length, 2, "合法归并项 + 未被覆盖候选（乙）追加");
  assert.equal(merged[0].title, "合并");
  assert.equal(candidateToMerged[0], 0, "候选 0 → 归并项 0");
  assert.equal(candidateToMerged[1], 1, "未被覆盖的候选 1 → 追加槽位 1");
});

await check("TC-UC02-03 归并输出 30 条 → 归并项截断到 conceptMergeMax = 20", () => {
  const candidates: ConceptCandidate[] = Array.from({ length: 40 }, (_, i) => ({
    index: i,
    title: `概念 ${i}`,
    kind: "concept" as const,
    tags: [],
  }));
  const raw = Array.from({ length: 30 }, (_, i) => ({
    title: `合并 ${i}`,
    kind: "concept",
    mergeOf: [i],
  }));
  const { merged } = parseConceptMerge(raw, candidates);
  assert.equal(merged.filter((c) => c.title.startsWith("合并 ")).length, 20, "归并项应被截到 20");
});

await check("概念：短章（2.9k 字）→ 单块直出，不调归并", async () => {
  const body = makeBody(2_900);
  let calls = 0;
  let mergeCalls = 0;
  const p = mkProvider(async (input) => {
    calls++;
    if (isMerge(input)) mergeCalls++;
    return {
      content: JSON.stringify({
        units: [{ title: "概念", kind: "concept", quote: body.slice(0, 8) }],
        relations: [],
      }),
    };
  });
  const out = await extractConceptsMapped(p, {
    chapterTitle: "t",
    text: body,
    documentId: "doc-1",
    anchor: anchorOf(body),
  });
  assert.equal(out.blocks, 1);
  assert.equal(calls, 1);
  assert.equal(mergeCalls, 0);
  assert.equal(out.units.length, 1);
});

await check("概念：分块后关系下标抬升到全局空间并落到真实 unit id", async () => {
  const body = makeBody(45_000);
  const p = mkProvider(async (input) => {
    if (isBlock(input)) {
      const blockText = bodyOf(input);
      return {
        content: JSON.stringify({
          units: [
            { title: `A@${blockText.slice(0, 4)}`, kind: "concept", quote: blockText.slice(0, 8) },
            { title: `B@${blockText.slice(0, 4)}`, kind: "concept", quote: blockText.slice(4, 12) },
          ],
          relations: [{ from: 0, to: 1, type: "related" }],
        }),
      };
    }
    // 归并：每条自成一类（不合并），保持 16 个概念
    return { content: JSON.stringify([]) };
  });
  const out = await extractConceptsMapped(p, {
    chapterTitle: "t",
    text: body,
    documentId: "doc-1",
    anchor: anchorOf(body),
  });
  assert.ok(out.units.length >= 2, `应有多个概念，实为 ${out.units.length}`);
  assert.ok(out.relations.length >= 1, "块内关系应被保留");
  const ids = new Set(out.units.map((u) => u.id));
  for (const rel of out.relations) {
    assert.ok(ids.has(rel.fromId), "关系 fromId 必须指向真实 unit");
    assert.ok(ids.has(rel.toId), "关系 toId 必须指向真实 unit");
    assert.notEqual(rel.fromId, rel.toId, "不应出现自环");
  }
});

/* ---------- 4. 章节精修：分批 ---------- */

await check("TC-UC03-01 60 章 → 5 批（12 章/批），且顺序保持", () => {
  const chapters = Array.from({ length: 60 }, (_, i) => ch(`c${i + 1}`, `第 ${i + 1} 章`, i * 1000, (i + 1) * 1000));
  const text = "甲".repeat(60_000);
  const batches = planRefineBatches(chapters, text);
  assert.equal(batches.length, 5, `应切 5 批，实为 ${batches.length}`);
  assert.ok(batches.every((b) => b.chapters.length <= 12), "每批 ≤12 章");
  assert.equal(batches[0].chapters[0].globalIndex, 0);
  assert.equal(batches[4].chapters[0].globalIndex, 48, "末批首章的整篇下标应为 48");
});

await check("TC-UC04-02 10 章 / 2 万字 → 单批（调用次数与改造前一致）", () => {
  const chapters = Array.from({ length: 10 }, (_, i) => ch(`c${i + 1}`, `第 ${i + 1} 章`, i * 2000, (i + 1) * 2000));
  const batches = planRefineBatches(chapters, "甲".repeat(20_000));
  assert.equal(batches.length, 1);
});

await check("TC-UC03-03 批内 index 0 → 整篇 index 12（下标重映射）", async () => {
  const chapters = Array.from({ length: 24 }, (_, i) => ch(`c${i + 1}`, `第 ${i + 1} 章`, i * 1000, (i + 1) * 1000));
  let call = 0;
  const p = mkProvider(async () => {
    call++;
    return {
      content: JSON.stringify([{ index: 0, title: call === 1 ? "第一批首章" : "第二批首章" }]),
    };
  });
  const { refines, batches, failedBatches } = await refineChaptersBatched(p, chapters, "甲".repeat(24_000));
  assert.equal(batches, 2, "24 章应按 12 章/批切 2 批");
  assert.equal(failedBatches, 0);
  assert.equal(refines[0].index, 0);
  assert.equal(refines[1].index, 12, "第二批的批内 index 0 应重映射为整篇 index 12");
});

await check("TC-UC03-04 跨批 mergeIntoPrevious 生效（并入上一批末章，D5）", async () => {
  const chapters = Array.from({ length: 24 }, (_, i) => ch(`c${i + 1}`, `第 ${i + 1} 章`, i * 1000, (i + 1) * 1000));
  let call = 0;
  const p = mkProvider(async () => {
    call++;
    return {
      content:
        call === 1
          ? JSON.stringify([{ index: 0, title: "第一批首章" }])
          : JSON.stringify([{ index: 0, title: "第二批首章", mergeIntoPrevious: true }]),
    };
  });
  const { refines } = await refineChaptersBatched(p, chapters, "甲".repeat(24_000));
  const next = applyChapterRefine([...chapters], refines);
  assert.equal(next.length, 23, "第 13 章应并入第 12 章（跨批合并生效）");
  assert.equal(next[11].contentRef.end, 13 * 1000, "合并后区间应延展到被并入章");
});

await check("TC-UC03-02 第 2 批抛错 → 该批 0 条建议，其余批正常，failedBatches = 1", async () => {
  const chapters = Array.from({ length: 24 }, (_, i) => ch(`c${i + 1}`, `第 ${i + 1} 章`, i * 1000, (i + 1) * 1000));
  let call = 0;
  const p = mkProvider(async () => {
    call++;
    if (call === 2) throw new Error("模拟第二批失败");
    return { content: JSON.stringify([{ index: 0, title: "第一批首章" }]) };
  });
  const { refines, batches, failedBatches } = await refineChaptersBatched(p, chapters, "甲".repeat(24_000));
  assert.equal(batches, 2);
  assert.equal(failedBatches, 1, "应记录 1 个失败批");
  assert.equal(refines.length, 1, "只应保留成功批的建议");
  assert.equal(refines[0].index, 0);
});

/* ---------- 5. 要点解析上限（D4） ---------- */

await check("D4：单块要点条数上限为 8（由 5 放宽）", () => {
  const out = parseKeyPointDrafts({
    points: Array.from({ length: 12 }, (_, i) => ({ point: `要点 ${i}`, quote: `原文 ${i}` })),
  });
  assert.equal(out.length, 8, "应截断到 8 条");
});

/* ---------- 6. 要点质量门（纯符号 point，2026-09-13 README 图片残留案例） ---------- */

await check("质量门：纯符号/单字符 point 被丢弃，有效条目保留", () => {
  const out = parseKeyPointDrafts({
    points: [
      { point: "!", quote: "![](https://example.com/banner.png)" }, // README 图片残留案例
      { point: "•", quote: "•" },
      { point: "1.", quote: "1." },
      { point: "a", quote: "a" }, // 单个有效字符也算无意义
      { point: "RAG 采用混合检索", quote: "RAG 采用混合检索提升召回" },
    ],
  });
  assert.equal(out.length, 1, "只应保留有效要点");
  assert.equal(out[0]?.point, "RAG 采用混合检索");
});

await check("质量门：全部为纯符号时抛 request-failed（与空响应同口径）", () => {
  assert.throws(
    () => parseKeyPointDrafts({ points: [{ point: "!", quote: "!" }, { point: "？", quote: "？" }] }),
    /未返回任何带原文出处的要点/,
  );
});

await check("质量门：归并阶段同样丢弃纯符号 point（候选继承不受影响）", () => {
  const candidates = [
    { index: 0, point: "!", quote: "!", start: 0, end: 1 },
    { index: 1, point: "混合检索结合 FTS 与向量", quote: "混合检索结合 FTS 与向量", start: 10, end: 24 },
  ];
  const out = parseKeyPointMerge(
    [
      { point: "!", sourceIndex: 0 },
      { point: "混合检索要点", sourceIndex: 1 },
    ],
    candidates,
  );
  assert.equal(out.length, 1, "符号条应被丢弃");
  assert.equal(out[0]?.quote, "混合检索结合 FTS 与向量", "有效条目的 quote 整体继承候选");
});

await check("质量门：hasMeaningfulText 边界（CJK / 数字 / 混合符号）", () => {
  assert.equal(hasMeaningfulText("要点"), true, "CJK 计有效字符");
  assert.equal(hasMeaningfulText("RAG v2"), true);
  assert.equal(hasMeaningfulText("！？。……"), false, "全角标点不算有效字符");
  assert.equal(hasMeaningfulText("-•·"), false);
  assert.equal(hasMeaningfulText("9"), false, "单个数字不算");
  assert.equal(hasMeaningfulText(""), false);
});

await check("质量门：导入精修路径同样过滤纯符号 keyPoints（O1，engine.applyChapterRefine）", () => {
  const chapter = ch("c1", "第一章", 0, 100);
  const out = applyChapterRefine([chapter], [
    {
      index: 0,
      keyPoints: ["!", "•", "本章讲解 RAG 的混合检索机制", "1."],
    },
  ]);
  assert.deepEqual(
    out[0]?.keyPoints,
    ["本章讲解 RAG 的混合检索机制"],
    "纯符号要点应被过滤，有效要点保留",
  );
});

console.log(results.join("\n"));
if (failures > 0) {
  console.error(`\n[ai-map-reduce] ${results.length - failures}/${results.length} 通过`);
  process.exit(1);
}
console.log(`\n[ai-map-reduce] ${results.length}/${results.length} 通过`);
