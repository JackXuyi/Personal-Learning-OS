/**
 * 客观题即时提示单测（docs/ai-immediate-explain-design-2026-10.md §12）。
 * 运行：npm run test:explain
 *
 * 覆盖（**按风险排序，最要命的排最前**）：
 *   1. 🔴 D3 安全红线 —— 提示词里**绝不能出现正确项信息**（见 A 组）；
 *   2. 解析器严判、条数/字符上限；
 *   3. `tutorTierOf` 阈值边界、`trimThread` 成对与封顶；
 *   4. `objectiveQuestionHint` 六态（mock provider + mock storage 打穿）。
 *
 * 注：本文件**不 import 任何 .tsx** —— node 的 `--experimental-strip-types`
 * 不支持 JSX。UI 渲染因此不在单测范围（人工走查，见方案 §11.1）。
 */
import assert from "node:assert/strict";
import type {
  Chapter,
  Chunk,
  Paper,
  PaperQuestion,
  SourceDocument,
} from "../src/domain/index.ts";
import type { AIProvider } from "../src/ai/types.ts";
import type { Embedder } from "../src/ai/embedding.ts";
import { PIPELINE_LIMITS } from "../src/ai/pipeline-core.ts";
import {
  EXPLAIN_SYSTEM,
  buildExplainMessages,
  parseExplainAnswer,
} from "../src/ai/explain-question.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import {
  trimThread,
  tutorTierOf,
} from "../src/features/learn/chapter-qa-service.ts";
import { objectiveQuestionHint } from "../src/features/quiz/explain-service.ts";
import { referenceOptionText } from "../src/features/quiz/meta.ts";
import { zh } from "../src/i18n/messages/zh.ts";

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

/* ===== 语料 fixture（偏移手工对齐，保证 locateQuote 可命中） ===== */

const HEADER = "资料页眉。\n";
const SENT1 = "Reranking 在检索链路里负责最终顺序。";
const SENT2 = "初排给出候选集合，rerank 只负责排序质量。";
const CH1 = SENT1 + SENT2;
const CH2 = "BM25 依赖词频与逆文档频率这两个稀疏信号。";
const SEP = "\n";
const TEXT = HEADER + CH1 + SEP + CH2;
const CH1_REF = { start: HEADER.length, end: HEADER.length + CH1.length };

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

/** 铺一份含正文快照的资料 + 章 + chunk。 */
async function seed(s: InMemoryStorage, opts: { withChunks?: boolean } = {}): Promise<void> {
  const doc: SourceDocument = {
    id: "doc1",
    title: "RAG 指南",
    format: "md",
    importedAt: 1,
    status: "ready",
    textPreview: TEXT,
  };
  await s.saveDocument(doc);
  await s.saveChapters("doc1", [chapter("ch1", 1, "第 1 章 Reranking", CH1_REF)]);
  if (opts.withChunks !== false) {
    await s.saveChunks([chunk("c1", SENT1, "ch1", 0), chunk("c2", SENT2, "ch1", 1)]);
  }
}

/** 记录检索次数的存储（用于断言「早退不检索」）。 */
class SpyStorage extends InMemoryStorage {
  ftCalls = 0;
  async fullTextSearch(q: string, scope?: unknown, limit?: number) {
    this.ftCalls += 1;
    return super.fullTextSearch(q, scope as never, limit);
  }
}

function fakeProvider(
  content: string,
  configured = true,
): { provider: AIProvider; calls: { chat: number } } {
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

/** 假 encoder（无向量也能走通：FTS 路独立成立）。 */
function fakeEmbedder(): Embedder {
  return { model: "m", dim: 2, embed: (texts) => Promise.resolve(texts.map(() => [0, 0])) };
}

function explainJson(found: boolean, explanation: string, quotes: string[]): string {
  return JSON.stringify(found ? { found: true, explanation, quotes } : { found: false, reason: explanation });
}

/** 判断题 fixture：无 options ⇒ 检索 query 就是题面本身（内存存储按子串匹配）。 */
function judgeQuestion(over: Partial<PaperQuestion> = {}): PaperQuestion {
  return {
    id: "q1",
    chapterId: "ch1",
    type: "judge",
    cognitiveLevel: "understand",
    prompt: SENT1,
    answer: "true",
    difficulty: 3,
    ...over,
  };
}

function paperOf(...questions: PaperQuestion[]): Paper {
  return {
    id: "p1",
    scope: { chapterIds: ["ch1"], mode: "unit-test" },
    title: "单元测",
    questions,
    status: "open",
    createdAt: 1,
  };
}

const run = async () => {
  // ===== A. 🔴 D3 安全红线：提示词不得泄露正确项 =====

  await check("TC-EX-A01 提示词不含任何正确项标记（D3 红线）", () => {
    const q = judgeQuestion({
      type: "choice",
      options: ["减少候选文档数量", "对初排结果重排序", "生成向量索引", "压缩正文长度"],
      answer: "1", // 正确项 = B
      prompt: "Reranking 在检索链路里的作用是？",
    });
    const msgs = buildExplainMessages({
      question: q.prompt,
      options: q.options,
      chapterTitle: "第 1 章 Reranking",
      documentTitle: "RAG 指南",
      blocks: [{ index: 1, chunkId: "c1", chapterId: "ch1", chapterTitle: "第 1 章", text: SENT1 }],
      depth: "hint",
    });
    const user = msgs[1].content;
    // ① 四个选项**原序**都在
    for (const [i, opt] of (q.options ?? []).entries()) {
      assert.ok(
        user.includes(`${String.fromCharCode(65 + i)}. ${opt}`),
        `选项 ${String.fromCharCode(65 + i)} 必须原序出现`,
      );
    }
    // ② 任何正确项标记都是安全事故
    for (const leak of ["正确答案", "正确项", "correct", "answer key", "正确选项", "（对）", "[答案]"]) {
      assert.ok(!user.includes(leak), `提示词泄露了「${leak}」`);
    }
    // ③ 系统提示词里必须明说「你不知道正确答案」
    assert.ok(EXPLAIN_SYSTEM.includes("你不知道这道题的正确答案"));
    assert.ok(msgs[0].content === EXPLAIN_SYSTEM);
  });

  await check("TC-EX-A02 depth=hint 不给结论、depth=answer 允许结论", () => {
    const base = {
      question: "Q",
      chapterTitle: "C",
      documentTitle: "D",
      blocks: [{ index: 1, chunkId: "c1", chapterId: "ch1", chapterTitle: "C", text: SENT1 }],
    };
    const hint = buildExplainMessages({ ...base, depth: "hint" })[1].content;
    const full = buildExplainMessages({ ...base, depth: "answer" })[1].content;
    assert.ok(hint.includes("**不要**直接给出结论句"), "hint 档必须禁止结论句");
    assert.ok(!full.includes("**不要**直接给出结论句"));
    assert.ok(full.includes("可以给出明确的结论句"));
  });

  // ===== B. 解析器：宽容取值 + 严判 found =====

  await check("TC-EX-B01 严判 found：缺字段 / 字符串 \"true\" / 空值一律 false", () => {
    assert.equal(parseExplainAnswer({ explanation: "a", quotes: ["b"] }).found, false);
    assert.equal(parseExplainAnswer({ found: "true", explanation: "a", quotes: ["b"] }).found, false);
    assert.equal(parseExplainAnswer({ found: true, explanation: "  ", quotes: ["b"] }).found, false);
    assert.equal(parseExplainAnswer({ found: true, explanation: "a", quotes: [] }).found, false);
    assert.equal(parseExplainAnswer("不是对象").found, false);
  });

  await check("TC-EX-B02 quotes 去重 / 截断 / 条数上限", () => {
    const long = "引".repeat(500);
    const raw = { found: true, explanation: "ok", quotes: [long, long, "短引一", "短引二", "短引三"] };
    const d = parseExplainAnswer(raw);
    assert.equal(d.quotes.length, PIPELINE_LIMITS.explainMaxQuotes, "条数必须封顶");
    assert.equal(d.quotes[0].length, PIPELINE_LIMITS.explainQuoteMaxChars, "单条必须截断");
    // 去重发生在截断之前（两条长引截断后相同，但去重按原始串判）
    assert.equal(new Set(d.quotes).size, d.quotes.length);
  });

  // ===== C. Feature B 纯函数 =====

  await check("TC-EX-C01 tutorTierOf 阈值边界（undefined 按最弱）", () => {
    assert.equal(tutorTierOf(undefined), "scaffold", "没证据 = 不了解，不该直达结论");
    assert.equal(tutorTierOf(0), "scaffold");
    assert.equal(tutorTierOf(0.39), "scaffold");
    assert.equal(tutorTierOf(0.4), "standard");
    assert.equal(tutorTierOf(0.74), "standard");
    assert.equal(tutorTierOf(0.75), "direct");
    assert.equal(tutorTierOf(1), "direct");
  });

  await check("TC-EX-C02 trimThread 保留最近 3 轮且成对（孤立 tutor 去掉）", () => {
    const turns = [
      { role: "tutor" as const, text: "孤儿回答" },
      { role: "user" as const, text: "u1" },
      { role: "tutor" as const, text: "t1" },
      { role: "user" as const, text: "u2" },
      { role: "tutor" as const, text: "t2" },
      { role: "user" as const, text: "u3" },
      { role: "tutor" as const, text: "t3" },
      { role: "user" as const, text: "u4" },
      { role: "tutor" as const, text: "t4" },
    ];
    const out = trimThread(turns);
    assert.equal(out.length, PIPELINE_LIMITS.qaThreadMaxTurns * 2, "只保留最近 3 轮往返");
    assert.equal(out[0].role, "user", "首轮必须是 user —— 孤立 tutor 会让模型以为在自言自语");
    assert.equal(out[0].text, "u2");
    assert.equal(out[out.length - 1].text, "t4");
    assert.equal(turns.length, 9, "纯函数不得改实参");
  });

  await check("TC-EX-C03 trimThread 单条文本封顶", () => {
    const long = "问".repeat(1000);
    const out = trimThread([{ role: "user", text: long }]);
    assert.equal(out[0].text.length, PIPELINE_LIMITS.qaThreadTurnChars);
  });

  // ===== D. 编排层六态 =====

  await check("TC-EX-D01 主观题 → error，且不检索不调用（EX-A01）", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider, calls } = fakeProvider(explainJson(true, "不该出现", [SENT1]));
    const res = await objectiveQuestionHint({
      paper: paperOf(judgeQuestion({ type: "qa", answer: undefined })),
      questionId: "q1",
      storage: s,
      provider,
      embedder: fakeEmbedder(),
    });
    assert.equal(res.status, "error");
    assert.equal(calls.chat, 0, "主观题不得调用模型");
    assert.equal(s.ftCalls, 0, "主观题不得检索");
  });

  await check("TC-EX-D02 AI 未配置 → no-ai，且不检索不调用（EX-A02）", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider, calls } = fakeProvider(explainJson(true, "x", [SENT1]), false);
    const res = await objectiveQuestionHint({
      paper: paperOf(judgeQuestion()),
      questionId: "q1",
      storage: s,
      provider,
      embedder: fakeEmbedder(),
    });
    assert.equal(res.status, "no-ai");
    assert.equal(calls.chat, 0);
    assert.equal(s.ftCalls, 0, "未配置 AI 时不检索（零伪造的底线）");
    assert.equal(res.citations.length, 0);
  });

  await check("TC-EX-D03 本章无 chunk → empty（EX-A03）", async () => {
    const s = new SpyStorage();
    await seed(s, { withChunks: false });
    const { provider, calls } = fakeProvider(explainJson(true, "x", [SENT1]));
    const res = await objectiveQuestionHint({
      paper: paperOf(judgeQuestion()),
      questionId: "q1",
      storage: s,
      provider,
      embedder: fakeEmbedder(),
    });
    assert.equal(res.status, "empty");
    assert.equal(calls.chat, 0);
  });

  await check("TC-EX-D04 原文不足以解释 → not-found（EX-A04）", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider } = fakeProvider(explainJson(false, "资料中未讲述这一点", []));
    const res = await objectiveQuestionHint({
      paper: paperOf(judgeQuestion()),
      questionId: "q1",
      storage: s,
      provider,
      embedder: fakeEmbedder(),
    });
    assert.equal(res.status, "not-found");
    assert.equal(res.answer, undefined, "not-found 不得渲染任何模型文本");
  });

  await check("TC-EX-D05 引文锚不上 → unanchored，展示讲解 + 零引用（EX-A05）", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider } = fakeProvider(explainJson(true, "讲解正文", ["这句话不在原文里"]));
    const res = await objectiveQuestionHint({
      paper: paperOf(judgeQuestion()),
      questionId: "q1",
      storage: s,
      provider,
      embedder: fakeEmbedder(),
    });
    assert.equal(res.status, "unanchored");
    assert.equal(res.citations.length, 0, "锚不上的引文一律丢弃（零伪造）");
    assert.equal(res.answer, "讲解正文", "unanchored 仍展示讲解，但带显式警示");
  });

  await check("TC-EX-D06 命中 → answered + 可锚定引用（UC-01）", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider, calls } = fakeProvider(explainJson(true, "原文把 rerank 放在初排之后[1]。", [SENT1]));
    const res = await objectiveQuestionHint({
      paper: paperOf(judgeQuestion()),
      questionId: "q1",
      storage: s,
      provider,
      embedder: fakeEmbedder(),
    });
    assert.equal(res.status, "answered");
    assert.equal(calls.chat, 1, "一次解释只允许一次模型调用");
    assert.equal(res.citations.length, 1);
    assert.equal(res.citations[0].chapterId, "ch1");
    assert.equal(res.citations[0].inThisChapter, true);
    assert.equal(res.citations[0].quote, SENT1);
    assert.equal(res.question, SENT1, "回显题面供 UI 展示");
  });

  await check("TC-EX-D07 资料已删（章找不到归属）→ empty，不崩不显示裸 id", async () => {
    const s = new SpyStorage();
    await seed(s);
    const { provider } = fakeProvider(explainJson(true, "x", [SENT1]));
    const res = await objectiveQuestionHint({
      paper: paperOf(judgeQuestion({ chapterId: "已删章" })),
      questionId: "q1",
      storage: s,
      provider,
      embedder: fakeEmbedder(),
    });
    assert.equal(res.status, "empty");
  });

  await check("TC-EX-D08 模型抛错 → error（EX-A06）", async () => {
    const s = new SpyStorage();
    await seed(s);
    const provider: AIProvider = {
      kind: "custom",
      isConfigured: () => true,
      chat: () => Promise.reject(new Error("boom")),
    };
    const res = await objectiveQuestionHint({
      paper: paperOf(judgeQuestion()),
      questionId: "q1",
      storage: s,
      provider,
      embedder: fakeEmbedder(),
    });
    assert.equal(res.status, "error");
    assert.ok(res.errorKind !== undefined, "error 态必须带分类供 UI 映射文案");
  });

  // ===== E. 参考答案（本地，零 AI） =====

  await check("TC-EX-E01 referenceOptionText：judge → 对错符号；choice → 字母 + 选项", () => {
    assert.equal(referenceOptionText(judgeQuestion(), zh), "对 ✓");
    assert.equal(referenceOptionText(judgeQuestion({ answer: "false" }), zh), "错 ✗");
    const choice = judgeQuestion({
      type: "choice",
      options: ["甲", "乙", "丙"],
      answer: "1",
    });
    assert.equal(referenceOptionText(choice, zh), "B · 乙");
    assert.equal(
      referenceOptionText(judgeQuestion({ type: "qa", answer: undefined }), zh),
      undefined,
      "主观题没有「标准选项」可言",
    );
    assert.equal(
      referenceOptionText(judgeQuestion({ type: "choice", options: ["甲"], answer: "9" }), zh),
      undefined,
      "越界索引不得渲染成 undefined",
    );
  });

  console.log(results.join("\n"));
  console.log(`\nquiz-explain: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
};

void run();
