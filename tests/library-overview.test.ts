/**
 * 资料详情页 · 「概览」Tab（AI 整篇总结）单测
 * （docs/library-detail-page-overview-tab-design-2026-09.md §12.2）。
 *
 * 运行：npm run test:overview（或 npm run test:library 五组串联）
 *
 * 覆盖：
 *  - planOverviewBlocks：门槛、章边界、章内二次切、无章节按段落、块数上限、
 *    连续覆盖不变式、空正文、contentRef 越界；
 *  - parseChunkDigest / parseOverviewDraft：裁剪 / 去重 / 上限 / 拒绝路径；
 *  - isOverviewStale：三态；
 *  - 三个 builder：消息结构；
 *  - summarizeDocumentWithAi：空正文 / 超长抛错、单次成稿、map-reduce、
 *    单块失败跳过计数、全块失败抛错。
 *
 * 无网络、无 provider 构造：所有 AI 交互都走本地假 provider 或纯函数。
 */
import assert from "node:assert/strict";
import {
  OVERVIEW_LIMITS,
  buildChunkDigestMessages,
  buildOverviewMergeMessages,
  buildOverviewMessages,
  parseChunkDigest,
  parseOverviewDraft,
  planOverviewBlocks,
  summarizeDocumentWithAi,
} from "../src/ai/overview-pipeline.ts";
import { AiProviderError } from "../src/ai/types.ts";
import type { AIProvider, ChatInput, ChatOutput } from "../src/ai/types.ts";
import { isOverviewStale } from "../src/domain/document.ts";
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

/** 造一个最小可用的章（只用到 contentRef / title，其余字段给足）。 */
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

const JSON_OVERVIEW = {
  gist: "讲了张量与自动微分",
  sections: [{ heading: "张量", detail: "从存储布局到元信息" }],
  prerequisites: ["会 Python"],
  keywords: ["张量"],
};

/** 按 system prompt 区分阶段：map 阶段回分块摘要，其余回整篇概览。 */
const phaseAwareReply = async (input: ChatInput): Promise<ChatOutput> => ({
  content: input.messages[0].content.includes("其中一段")
    ? JSON.stringify({ digest: "这一段讲了张量", keywords: ["张量"], headings: ["张量"] })
    : JSON.stringify(JSON_OVERVIEW),
});

/* ---------- 1. planOverviewBlocks ---------- */

await check("TC-OV-01 短文 → 恰好 1 块，label 为空", () => {
  const b = planOverviewBlocks({ text: "甲".repeat(500) });
  assert.equal(b.length, 1);
  assert.deepEqual({ s: b[0].start, e: b[0].end, l: b[0].label }, { s: 0, e: 500, l: "" });
});

await check("TC-OV-02 长度恰好 = chunkChars → 不切（≤ 而非 <）", () => {
  const b = planOverviewBlocks({ text: "甲".repeat(OVERVIEW_LIMITS.chunkChars) });
  assert.equal(b.length, 1);
  assert.equal(b[0].end, OVERVIEW_LIMITS.chunkChars);
});

await check("TC-OV-03 按章边界切：5 章 × 8000 字 → 5 块且与章起点对齐", () => {
  const chapters = [0, 1, 2, 3, 4].map((i) =>
    ch(`c${i + 1}`, `第 ${i + 1} 章`, i * 8000, (i + 1) * 8000),
  );
  const text = "甲".repeat(40_000);
  const b = planOverviewBlocks({ text, chapters });
  assert.equal(b.length, 5);
  b.forEach((blk, i) => {
    assert.equal(blk.start, i * 8000, `第 ${i} 块应对齐章起点`);
    assert.equal(blk.label, chapters[i].title, `第 ${i} 块 label 应为章标题`);
  });
});

await check("TC-OV-04 单章超限 → 章内按 \\n\\n 二次切（≥3 块）", () => {
  const text = Array.from({ length: 60 }, (_, i) => `段${i}` + "乙".repeat(480)).join("\n\n");
  const chapters = [ch("c1", "唯一长章", 0, text.length)];
  const b = planOverviewBlocks({ text, chapters });
  assert.ok(b.length >= 3, `应 ≥3 块，实为 ${b.length}`);
  // 每个切点（非硬切的那些）都应落在 "\n\n" 之后
  for (let i = 1; i < b.length; i++) {
    const cut = b[i].start;
    assert.equal(text.slice(cut - 2, cut), "\n\n", `切点 ${cut} 应落在空行之后`);
  }
});

await check("TC-OV-05 无章节 → 按段落空行切（≥2 块）", () => {
  const text = Array.from({ length: 60 }, (_, i) => `段${i}` + "乙".repeat(480)).join("\n\n");
  const b = planOverviewBlocks({ text });
  assert.ok(b.length >= 2, `应 ≥2 块，实为 ${b.length}`);
  for (let i = 1; i < b.length; i++) {
    assert.equal(text.slice(b[i].start - 2, b[i].start), "\n\n");
  }
});

await check("TC-OV-06 块数上限：40 万字 / 400 章 → 块数 ≤ maxChunks，末块到文末", () => {
  const text = "丙".repeat(400_000);
  const chapters = Array.from({ length: 400 }, (_, i) =>
    ch(`c${i + 1}`, `T${i + 1}`, i * 1000, (i + 1) * 1000),
  );
  const b = planOverviewBlocks({ text, chapters });
  assert.ok(b.length <= OVERVIEW_LIMITS.maxChunks, `块数 ${b.length} 应 ≤ ${OVERVIEW_LIMITS.maxChunks}`);
  assert.equal(b[b.length - 1].end, text.length, "末块必须到文末（不留尾巴）");
});

await check("TC-OV-07 不变式：连续覆盖、无重叠、拼接 === 原文", () => {
  const text = Array.from({ length: 200 }, (_, i) => `块${i}` + "丁".repeat(300)).join("\n\n");
  const cases = [
    planOverviewBlocks({ text }),
    planOverviewBlocks({ text, chunkChars: 5000 }),
    planOverviewBlocks({ text, maxChunks: 3 }),
  ];
  for (const b of cases) {
    assert.equal(b[0].start, 0, "首块起点必须为 0");
    assert.equal(b[b.length - 1].end, text.length, "末块终点必须为文末");
    b.forEach((blk, i) => {
      if (i > 0) assert.equal(b[i - 1].end, blk.start, "块之间必须连续");
      assert.ok(blk.end > blk.start, "块不能为空");
    });
    assert.equal(b.map((x) => text.slice(x.start, x.end)).join(""), text, "拼接必须等于原文");
  }
});

await check("TC-OV-08 空 / 纯空白正文 → []（不抛错）", () => {
  assert.deepEqual(planOverviewBlocks({ text: "" }), []);
  assert.deepEqual(planOverviewBlocks({ text: "   \n\n \t " }), []);
});

await check("TC-OV-09 contentRef 越界 → 夹取处理，不抛错", () => {
  const text = "戊".repeat(30_000);
  const chapters = [ch("c1", "越界章", 99_999, 999_999), ch("c2", "正常章", 15_000, 20_000)];
  const b = planOverviewBlocks({ text, chapters });
  assert.ok(b.length >= 2);
  assert.equal(b[b.length - 1].end, text.length);
  assert.ok(b.every((x) => x.start >= 0 && x.end <= text.length));
});

/* ---------- 2. parseChunkDigest ---------- */

await check("TC-OV-10 parseChunkDigest：合规规范化 + 裁剪 + 去重 + 条数上限", () => {
  const out = parseChunkDigest({
    digest: "己".repeat(300),
    keywords: ["关键词", "关键词", "  ", "另一个"],
    headings: ["主题一", "主题二", "主题三", "主题四", "主题五"],
  });
  assert.equal(out.digest.length, OVERVIEW_LIMITS.digestChars, "digest 应裁到 120 字");
  assert.deepEqual(out.keywords, ["关键词", "另一个"], "应去重并丢掉空串");
  assert.equal(out.headings.length, OVERVIEW_LIMITS.digestHeadingMax, "headings 应截到 4 条");
});

await check("TC-OV-11 parseChunkDigest：非对象 / 缺 digest / 空 digest → 抛错", () => {
  for (const bad of [[{ digest: "x" }], {}, { digest: "   " }, "digest"]) {
    assert.throws(
      () => parseChunkDigest(bad),
      (err: unknown) => err instanceof AiProviderError,
      `应拒绝：${JSON.stringify(bad)}`,
    );
  }
});

/* ---------- 3. parseOverviewDraft ---------- */

await check("TC-OV-12 parseOverviewDraft：裁剪与上限（sections 6 / detail 80 / gist 60 / keywords 去重 6）", () => {
  const out = parseOverviewDraft({
    gist: "庚".repeat(200),
    sections: Array.from({ length: 8 }, (_, i) => ({
      heading: `标${i}`.repeat(30),
      detail: "辛".repeat(200),
    })),
    prerequisites: Array.from({ length: 5 }, (_, i) => `需知 ${i}`),
    keywords: ["甲", "甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬"],
  });
  assert.equal(out.gist.length, OVERVIEW_LIMITS.gistChars);
  assert.equal(out.sections.length, OVERVIEW_LIMITS.sectionMax);
  assert.equal(out.sections[0].heading.length, OVERVIEW_LIMITS.sectionHeadingChars);
  assert.equal(out.sections[0].detail.length, OVERVIEW_LIMITS.sectionDetailChars);
  assert.equal(out.prerequisites.length, OVERVIEW_LIMITS.prereqMax);
  assert.deepEqual(out.keywords, ["甲", "乙", "丙", "丁", "戊", "己"], "去重后截到 6");
});

await check("TC-OV-12b parseOverviewDraft：缺 heading / detail 的段落被丢弃", () => {
  const out = parseOverviewDraft({
    gist: "g",
    sections: [
      { heading: "有效", detail: "有效正文" },
      { heading: "", detail: "无标题" },
      { heading: "无正文", detail: "" },
      { heading: "   ", detail: "   " },
    ],
    prerequisites: [],
    keywords: [],
  });
  assert.equal(out.sections.length, 1);
  assert.deepEqual(out.prerequisites, []);
  assert.deepEqual(out.keywords, []);
});

await check("TC-OV-13 parseOverviewDraft：gist 空 / sections 空 / 非对象 → 抛错（不给空壳概览）", () => {
  const bads: unknown[] = [
    { gist: "", sections: [{ heading: "a", detail: "b" }] },
    { gist: "g", sections: [] },
    { gist: "g" },
    { sections: [{ heading: "a", detail: "b" }] },
    [{ gist: "g", sections: [{ heading: "a", detail: "b" }] }],
  ];
  for (const bad of bads) {
    assert.throws(
      () => parseOverviewDraft(bad),
      (err: unknown) => err instanceof AiProviderError,
      `应拒绝：${JSON.stringify(bad)}`,
    );
  }
});

/* ---------- 4. isOverviewStale ---------- */

await check("TC-OV-14 isOverviewStale 三态：无概览 false / 长度一致 false / 长度不一致 true", () => {
  const base = { gist: "g", sections: [], prerequisites: [], keywords: [], generatedAt: 1, mode: "single" as const };
  assert.equal(isOverviewStale({ textPreview: "abcd" }), false, "无概览 → false（不制造焦虑）");
  assert.equal(
    isOverviewStale({ textPreview: "abcd", overview: { ...base, sourceChars: 4 } }),
    false,
  );
  assert.equal(
    isOverviewStale({ textPreview: "abcd", overview: { ...base, sourceChars: 3 } }),
    true,
  );
  assert.equal(isOverviewStale({ overview: { ...base, sourceChars: 0 } }), false, "无正文且源为 0 → false");
});

/* ---------- 5. builders ---------- */

await check("builders：三个提示词各自带 system + user，且 user 含关键上下文", () => {
  const single = buildOverviewMessages({ title: "资料甲", text: "正文" });
  assert.equal(single.length, 2);
  assert.equal(single[0].role, "system");
  assert.ok(single[1].content.includes("资料甲") && single[1].content.includes("正文"));

  const digest = buildChunkDigestMessages({ blockIndex: 1, blockTotal: 5, label: "第三章", text: "块正文" });
  assert.equal(digest.length, 2);
  assert.ok(digest[1].content.includes("2/5"), "应标明第 i/n 块");
  assert.ok(digest[1].content.includes("第三章"), "应带块标识");
  assert.ok(digest[1].content.includes("块正文"));

  const merge = buildOverviewMergeMessages({
    title: "资料甲",
    totalChars: 30_000,
    digests: [
      { digest: "第一块摘要", keywords: [], headings: [] },
      { digest: "第二块摘要", keywords: [], headings: ["主题"] },
    ],
  });
  assert.equal(merge.length, 2);
  assert.ok(merge[1].content.includes("第一块摘要") && merge[1].content.includes("第二块摘要"));
  assert.ok(merge[1].content.includes("分 2 段"));
});

await check("buildOverviewMergeMessages：摘要总量超 reduceChars → 按顺序截断并如实标注", () => {
  const digests = Array.from({ length: 200 }, (_, i) => ({
    digest: `第${i}段` + "壬".repeat(OVERVIEW_LIMITS.digestChars),
    keywords: [],
    headings: [],
  }));
  const msgs = buildOverviewMergeMessages({ title: "t", totalChars: 999_999, digests });
  const user = msgs[1].content;
  assert.ok(user.includes("省略"), "超限时应标注省略");
  assert.ok(!user.includes("第199段"), "超限的尾部摘要不应出现");
  assert.ok(user.length < OVERVIEW_LIMITS.reduceChars + 800, "拼装后不应远超上限");
});

/* ---------- 6. 执行器 ---------- */

await check("执行器：空正文直接抛错，不发起 AI 调用", async () => {
  let called = 0;
  const p = mkProvider(async () => {
    called += 1;
    return { content: "" };
  });
  await assert.rejects(
    () => summarizeDocumentWithAi(p, { title: "t", text: "   \n  " }),
    (err: unknown) => err instanceof AiProviderError,
  );
  assert.equal(called, 0, "空正文不应产生任何调用");
});

await check("执行器：正文超 maxTextChars → 抛错并提示上限，不发起调用", async () => {
  let called = 0;
  const p = mkProvider(async () => {
    called += 1;
    return { content: "" };
  });
  await assert.rejects(
    () => summarizeDocumentWithAi(p, { title: "t", text: "癸".repeat(OVERVIEW_LIMITS.maxTextChars + 1) }),
    (err: unknown) => err instanceof AiProviderError && err.message.includes(String(OVERVIEW_LIMITS.maxTextChars)),
  );
  assert.equal(called, 0);
});

await check("执行器：短文 → 单次成稿（mode=single、chunks=1、skipped=0、phase=single）", async () => {
  const phases: string[] = [];
  const r = await summarizeDocumentWithAi(mkProvider(phaseAwareReply), {
    title: "短文",
    text: "甲".repeat(5000),
    onProgress: (_i, _n, _l, phase) => phases.push(phase),
  });
  assert.equal(r.mode, "single");
  assert.equal(r.chunks, 1);
  assert.equal(r.skipped, 0);
  assert.deepEqual(phases, ["single"]);
  assert.equal(r.draft.gist, JSON_OVERVIEW.gist);
});

await check("执行器：长文 → map-reduce（逐块摘要 + 归并，phase 序列 map×n + merge）", async () => {
  const phases: string[] = [];
  const r = await summarizeDocumentWithAi(mkProvider(phaseAwareReply), {
    title: "长文",
    text: "甲".repeat(30_000),
    onProgress: (_i, _n, _l, phase) => phases.push(phase),
  });
  assert.equal(r.mode, "map-reduce");
  assert.equal(r.chunks, 3, "3 万字按 1.2 万切 → 3 块");
  assert.equal(r.skipped, 0);
  assert.deepEqual(phases, ["map", "map", "map", "merge"]);
  assert.equal(r.draft.sections.length, 1);
});

await check("执行器：单块失败 → 跳过并计数，其余照常成稿", async () => {
  let digestCalls = 0;
  const p = mkProvider(async (input) => {
    if (input.messages[0].content.includes("其中一段")) {
      digestCalls += 1;
      if (digestCalls === 1) throw new Error("模拟某块失败");
      return { content: JSON.stringify({ digest: "摘要", keywords: [], headings: [] }) };
    }
    return { content: JSON.stringify(JSON_OVERVIEW) };
  });
  const r = await summarizeDocumentWithAi(p, { title: "t", text: "甲".repeat(30_000) });
  assert.equal(r.mode, "map-reduce");
  assert.equal(r.skipped, 1, "应有 1 块被跳过");
  assert.equal(r.draft.gist, JSON_OVERVIEW.gist);
});

await check("执行器：全部块失败 → 抛错（不落半成品）", async () => {
  const p = mkProvider(async (input) => {
    if (input.messages[0].content.includes("其中一段")) throw new Error("全失败");
    return { content: JSON.stringify(JSON_OVERVIEW) };
  });
  await assert.rejects(
    () => summarizeDocumentWithAi(p, { title: "t", text: "甲".repeat(30_000) }),
    (err: unknown) => err instanceof AiProviderError,
  );
});

await check("执行器：归并输出不合规 → 抛错（sections 为空不写库）", async () => {
  const p = mkProvider(async (input) =>
    input.messages[0].content.includes("其中一段")
      ? { content: JSON.stringify({ digest: "摘要", keywords: [], headings: [] }) }
      : { content: JSON.stringify({ gist: "只有一句话" }) },
  );
  await assert.rejects(
    () => summarizeDocumentWithAi(p, { title: "t", text: "甲".repeat(30_000) }),
    (err: unknown) => err instanceof AiProviderError,
  );
});

console.log(results.join("\n"));
if (failures > 0) {
  console.error(`\n[library-overview] ${results.length - failures}/${results.length} 通过`);
  process.exit(1);
}
console.log(`\n[library-overview] ${results.length}/${results.length} 通过`);
