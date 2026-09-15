/**
 * F5-2 · 费曼式复述 —— 锚定不变式 / 覆盖率 / 档位 / 阻断门 / 存储往返 单测。
 * （docs/learn-feynman-restatement-design-2026-09.md §12 TC-UC01~11 / TC-EDGE-01~10 / TC-REG-01~03）
 *
 * 运行（Node 22 + 类型剥离直跑，见 package.json `test:restatement`）：
 *   npm run test:restatement
 *
 * 零真实网络 / 零真实模型：AI 用假 provider。**不 import 任何 `.tsx` 与 store 状态** ——
 * 纯 `.ts` 链路（strip-types 不支持 JSX）。
 */
import assert from "node:assert/strict";
import type { AIProvider } from "../src/ai/types.ts";
import { AiProviderError } from "../src/ai/types.ts";
import { PIPELINE_LIMITS } from "../src/ai/pipeline-core.ts";
import {
  RESTATEMENT_SYSTEM,
  buildRestatementMessages,
  parseRestatementDraft,
} from "../src/ai/restatement.ts";
import type { Chapter, LearnerProfile, Restatement, SourceDocument } from "../src/domain/index.ts";
import { emptyUnit } from "../src/engine/learner-model.ts";
import { evidenceActionKey } from "../src/features/evidence-label.ts";
import {
  MIN_RESTATEMENT_CHARS,
  anchorRestatement,
  checkRestatement,
  coverageOf,
  listChapterRestatements,
  ratingForCoverage,
  removeRestatement,
  scheduleRestatementReview,
} from "../src/features/learn/restatement-service.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import { LocalStorageAdapter } from "../src/storage/local.ts";

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

/* ---------------- fixtures ---------------- */

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

/** 第 1 章正文（对照基准）。 */
const CH1_BODY =
  "检索质量决定回答上限。重排序在初筛之后按相关性重新排序。块过大会稀释语义，过小则割裂上下文。";
/** 第 2 章正文（验证"只返回本章记录"）。 */
const CH2_BODY = "第二段正文，仅用于验证历史记录按章过滤。";
const TEXT_PREVIEW = `${CH1_BODY}\n${CH2_BODY}`;

/** 可在第 1 章正文逐字定位的三条引文。 */
const Q_COVER = "检索质量决定回答上限";
const Q_MISS = "块过大会稀释语义";
const Q_EVIDENCE = "重排序在初筛之后按相关性重新排序";
/** 复述里"讲岔了"的那句话（用于 errors[].quote，锚回复述文本）。 */
const MISREAD_QUOTE = "重排就是重新检索一遍";
/** 用户复述（≥ minChars，且含 MISREAD_QUOTE）。 */
const RESTATEMENT = "我的理解：重排就是重新检索一遍，检索质量决定回答上限。";

const DOC: SourceDocument = {
  id: "d1",
  title: "测试资料",
  format: "txt",
  importedAt: 1,
  status: "ready",
  textPreview: TEXT_PREVIEW,
};

function mkChapter(id: string, order: number, start: number, end: number): Chapter {
  return {
    id,
    documentId: DOC.id,
    order,
    title: `第 ${order} 章`,
    contentRef: { start, end },
    keyPoints: ["检索质量", "分块粒度"],
    unitIds: [],
    status: "learning",
    createdAt: 1,
  };
}

const CH1 = mkChapter("c1", 1, 0, CH1_BODY.length);
const CH2 = mkChapter("c2", 2, CH1_BODY.length + 1, TEXT_PREVIEW.length);

/** 预置 doc + 两章 的存储。 */
async function seeded(): Promise<InMemoryStorage> {
  const store = new InMemoryStorage();
  await store.saveDocument(DOC);
  await store.saveChapters(DOC.id, [CH1, CH2]);
  return store;
}

/** 记数的存储：断言「零落库」（D6-B 阻断门 / no-body）用。 */
class CountingStorage extends InMemoryStorage {
  saves = 0;
  override async saveRestatement(record: Restatement): Promise<void> {
    this.saves += 1;
    await super.saveRestatement(record);
  }
}

async function countingSeeded(doc: SourceDocument = DOC): Promise<CountingStorage> {
  const store = new CountingStorage();
  await store.saveDocument(doc);
  await store.saveChapters(doc.id, [CH1, CH2]);
  return store;
}

/** 假 provider：预置 JSON 回复 / 抛错 / 未配置，并记录 chat 调用次数。 */
function fakeProvider(
  opts: { reply?: string; configured?: boolean; throws?: Error } = {},
): { provider: AIProvider; calls: { chat: number } } {
  const calls = { chat: 0 };
  const provider: AIProvider = {
    kind: "custom",
    isConfigured: () => opts.configured ?? true,
    chat: async () => {
      calls.chat += 1;
      if (opts.throws) throw opts.throws;
      return { content: opts.reply ?? "{}" };
    },
  };
  return { provider, calls };
}

/** 一份「三组齐全、引文全部可锚」的模型产出。 */
function fullDraft(): string {
  return JSON.stringify({
    covered: [{ point: "检索决定上限", quote: Q_COVER }],
    missed: [{ point: "分块粒度影响召回", quote: Q_MISS }],
    errors: [
      {
        quote: MISREAD_QUOTE,
        correction: "重排不重新检索，只对初筛结果重新排序",
        evidence: Q_EVIDENCE,
      },
    ],
    advice: "补上「分块粒度」这一节。",
  });
}

/* ---------------- 用例 ---------------- */

async function main() {
  /* ============ UC-01 · 正常复述 → 三组反馈 ============ */

  await check("TC-UC01-01 正常 draft：status=ok、三组非空、偏移落在章正文内", async () => {
    const store = await seeded();
    const { provider } = fakeProvider({ reply: fullDraft() });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
      now: NOW,
    });

    assert.equal(res.status, "ok");
    const f = res.record?.feedback;
    assert.ok(f, "ok 必须有 feedback");
    assert.equal(f.covered.length, 1);
    assert.equal(f.missed.length, 1);
    assert.equal(f.errors.length, 1);

    // covered / missed：偏移为**章内相对偏移**，且能切回 verbatim 原文
    for (const p of [...f.covered, ...f.missed]) {
      assert.ok(p.start >= 0 && p.end <= CH1_BODY.length, "偏移必须落在本章正文内");
      assert.ok(p.end > p.start);
      assert.equal(CH1_BODY.slice(p.start, p.end), p.quote, "偏移必须由 locateQuote 反查");
    }
    // errors：quote 锚回复述文本；evidence 锚回章正文
    const e = f.errors[0];
    assert.equal(RESTATEMENT.slice(e.start, e.end), MISREAD_QUOTE);
    assert.ok(e.evidence, "evidence 必须存在（缺则整条丢弃）");
    assert.equal(CH1_BODY.slice(e.evidence.start, e.evidence.end), Q_EVIDENCE);

    assert.equal(f.truncated, false);
    assert.equal(f.coverage, 1 / 2);
    assert.equal(res.rating, "hard");
  });

  await check("TC-UC01-02 advice 保留且 ≤ restatementAdviceMaxChars", async () => {
    const store = await seeded();
    const { provider } = fakeProvider({ reply: fullDraft() });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    const advice = res.record?.feedback?.advice;
    assert.equal(advice, "补上「分块粒度」这一节。");
    assert.ok((advice ?? "").length <= PIPELINE_LIMITS.restatementAdviceMaxChars);
  });

  await check("TC-UC01-03 先落文本 + 后回填 feedback 是**同 id upsert**（不产生重复记录）", async () => {
    const store = await seeded();
    const { provider } = fakeProvider({ reply: fullDraft() });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    const list = await store.listRestatements(CH1.id);
    assert.equal(list.length, 1, "两次 saveRestatement 应为同一条记录");
    assert.equal(list[0].id, res.record?.id);
    assert.ok(list[0].feedback, "回填后的记录应带 feedback");
  });

  /* ============ UC-02 · 遗漏 → missed ============ */

  await check("TC-UC02-01 missed 引文可锚 → 保留，偏移来自 locateQuote", async () => {
    const store = await seeded();
    const { provider } = fakeProvider({ reply: fullDraft() });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    const missed = res.record?.feedback?.missed ?? [];
    assert.equal(missed.length, 1);
    assert.equal(missed[0].point, "分块粒度影响召回");
    assert.equal(CH1_BODY.slice(missed[0].start, missed[0].end), Q_MISS);
  });

  await check("TC-UC02-02 missed 引文被改写（锚不上）→ 丢弃该条，其余不变", async () => {
    const store = await seeded();
    const reply = JSON.stringify({
      covered: [{ point: "检索决定上限", quote: Q_COVER }],
      missed: [{ point: "分块粒度", quote: "这段文字被模型改写了根本不在原文里" }],
      errors: [],
    });
    const { provider } = fakeProvider({ reply });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    assert.equal(res.status, "ok");
    assert.equal(res.record?.feedback?.missed.length, 0, "锚不上即丢弃（零伪造引用）");
    assert.equal(res.record?.feedback?.covered.length, 1);
  });

  /* ============ UC-03 · 讲岔了 → errors 双目标锚定 ============ */

  await check("TC-UC03-01 errors 双引文皆可锚 → 保留（quote→复述、evidence→章正文）", async () => {
    const store = await seeded();
    const { provider } = fakeProvider({ reply: fullDraft() });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    const e = res.record?.feedback?.errors[0];
    assert.ok(e);
    assert.equal(RESTATEMENT.slice(e.start, e.end), MISREAD_QUOTE, "quote 偏移 ∈ 复述文本");
    assert.ok(e.evidence);
    assert.equal(CH1_BODY.slice(e.evidence.start, e.evidence.end), Q_EVIDENCE, "evidence 偏移 ∈ 章正文");
  });

  await check("TC-UC03-02 errors.quote 锚不上复述文本 → 丢弃", async () => {
    const store = await seeded();
    const reply = JSON.stringify({
      covered: [{ point: "检索决定上限", quote: Q_COVER }],
      missed: [],
      errors: [
        {
          quote: "这句话根本不在我的复述里",
          correction: "某些更正",
          evidence: Q_EVIDENCE,
        },
      ],
    });
    const { provider } = fakeProvider({ reply });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    assert.equal(res.record?.feedback?.errors.length, 0);
  });

  await check("TC-UC03-03 errors.evidence 锚不上章正文 → 丢弃（无原文依据不可展示）", async () => {
    const store = await seeded();
    const reply = JSON.stringify({
      covered: [{ point: "检索决定上限", quote: Q_COVER }],
      missed: [],
      errors: [
        {
          quote: MISREAD_QUOTE,
          correction: "某些更正",
          evidence: "这段依据不在本章正文里",
        },
      ],
    });
    const { provider } = fakeProvider({ reply });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    assert.equal(res.record?.feedback?.errors.length, 0);
  });

  /* ============ UC-04 · 无正文快照 ============ */

  await check("TC-UC04-01 无 textPreview → no-body 且 saveRestatement 零调用", async () => {
    const noBodyDoc: SourceDocument = { ...DOC, textPreview: "" };
    const store = await countingSeeded(noBodyDoc);
    const { provider, calls } = fakeProvider({ reply: fullDraft() });
    const res = await checkRestatement({
      documentId: noBodyDoc.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    assert.equal(res.status, "no-body");
    assert.equal(res.record, undefined);
    assert.equal(store.saves, 0, "零落库");
    assert.equal(calls.chat, 0, "不进 AI");
  });

  /* ============ UC-05 · 未配置 AI → 直接阻断（D6-B） ============ */

  await check("TC-UC05-01 未配置 → no-ai、record undefined、零落库、零调用", async () => {
    const store = await countingSeeded();
    const { provider, calls } = fakeProvider({ configured: false });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    assert.equal(res.status, "no-ai");
    assert.equal(res.record, undefined, "D6-B：无 AI 不产生任何记录");
    assert.equal(store.saves, 0, "阻断门必须在落库之前");
    assert.equal(calls.chat, 0);
  });

  await check("TC-UC05-02 未配置 → 存储中没有任何新增记录", async () => {
    const store = await seeded();
    const { provider } = fakeProvider({ configured: false });
    await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    assert.equal((await store.listRestatements(CH1.id)).length, 0);
  });

  await check("TC-UC05-03 未配置 AI，但历史复述仍可读（阻断只挡新建）", async () => {
    const store = await seeded();
    await store.saveRestatement({
      id: "rst-old",
      documentId: DOC.id,
      chapterId: CH1.id,
      text: "一条历史复述",
      createdAt: 1,
    });
    const list = await listChapterRestatements(CH1.id, store);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "rst-old");
  });

  /* ============ UC-06 · 解析 / 调用失败 ============ */

  await check("TC-UC06-01 chat 抛 request-failed → error/parse，记录仍在（无 feedback）", async () => {
    const store = await seeded();
    const { provider, calls } = fakeProvider({
      throws: new AiProviderError("request-failed", "输出无法解析"),
    });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    assert.equal(res.status, "error");
    assert.equal(res.errorKind, "parse");
    assert.ok(res.record, "文本已落库 → record 保留，可重试");
    assert.equal(res.record?.feedback, undefined);
    assert.equal(calls.chat, 1);
    const stored = await store.listRestatements(CH1.id);
    assert.equal(stored.length, 1, "复述文本仍在存储中");
  });

  /* ============ UC-07 · 一条都没锚上 ============ */

  await check("TC-UC07-01 全部引文锚不上 → partial、coverage undefined、advice 保留", async () => {
    const store = await seeded();
    const reply = JSON.stringify({
      covered: [{ point: "编造的要点", quote: "这段文字不在原文里" }],
      missed: [{ point: "编造的遗漏", quote: "这段也不在原文里" }],
      errors: [],
      advice: "先补分块粒度。",
    });
    const { provider } = fakeProvider({ reply });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    assert.equal(res.status, "partial");
    assert.equal(res.rating, undefined);
    const f = res.record?.feedback;
    assert.ok(f);
    assert.equal(f.coverage, undefined, "不产伪覆盖率");
    assert.equal(f.advice, "先补分块粒度。");
  });

  /* ============ UC-08 / UC-09 · 历史列表与删除 ============ */

  await check("TC-UC08-01 同章两条 → createdAt 降序", async () => {
    const store = await seeded();
    await store.saveRestatement({ id: "r1", documentId: DOC.id, chapterId: CH1.id, text: "早", createdAt: 100 });
    await store.saveRestatement({ id: "r2", documentId: DOC.id, chapterId: CH1.id, text: "晚", createdAt: 200 });
    const list = await listChapterRestatements(CH1.id, store);
    assert.deepEqual(
      list.map((r) => r.id),
      ["r2", "r1"],
    );
  });

  await check("TC-UC08-02 只返回本章记录", async () => {
    const store = await seeded();
    await store.saveRestatement({ id: "r1", documentId: DOC.id, chapterId: CH1.id, text: "甲", createdAt: 1 });
    await store.saveRestatement({ id: "r2", documentId: DOC.id, chapterId: CH2.id, text: "乙", createdAt: 2 });
    const list = await listChapterRestatements(CH1.id, store);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "r1");
  });

  await check("TC-UC09-01 removeRestatement 只删目标，其余不变", async () => {
    const store = await seeded();
    await store.saveRestatement({ id: "r1", documentId: DOC.id, chapterId: CH1.id, text: "甲", createdAt: 1 });
    await store.saveRestatement({ id: "r2", documentId: DOC.id, chapterId: CH1.id, text: "乙", createdAt: 2 });
    await removeRestatement("r1", store);
    const list = await listChapterRestatements(CH1.id, store);
    assert.deepEqual(
      list.map((r) => r.id),
      ["r2"],
    );
  });

  /* ============ UC-10 · 按复述安排复习（D3-A） ============ */

  await check("TC-UC10-01 调度写回：nextReviewAt 更新，mastery / attempts 不变", async () => {
    const store = new InMemoryStorage();
    await store.saveLearnerState({
      byUnit: {
        c1: { ...emptyUnit(1), mastery: 0.42, attempts: 3, correctCount: 2, confidence: 0.4 },
      },
    });
    await scheduleRestatementReview({
      chapterId: "c1",
      rating: "good",
      sourceId: "rst-1",
      storage: store,
      now: NOW,
    });
    const after = await store.getLearnerState();
    const unit = after.byUnit.c1;
    assert.equal(unit.mastery, 0.42, "复述绝不改掌握度（唯一写方仍是卷面）");
    assert.equal(unit.attempts, 3);
    assert.equal(unit.correctCount, 2);
    assert.equal(unit.lastReviewedAt, NOW);
    assert.equal(unit.nextReviewAt, NOW + 4 * DAY, "good → 4 天后");
  });

  await check("TC-UC10-02 调度写回：evidence 新增 kind=restatement、delta=0", async () => {
    const store = new InMemoryStorage();
    await store.saveLearnerState({ byUnit: { c1: emptyUnit(1) } });
    await scheduleRestatementReview({
      chapterId: "c1",
      rating: "hard",
      sourceId: "rst-9",
      storage: store,
      now: NOW,
    });
    const rows = (await store.listEvidence()).filter((e) => e.kind === "restatement");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subjectId, "c1");
    assert.equal(rows[0].verdict, "hard");
    assert.equal(rows[0].delta, 0);
    assert.equal(rows[0].sourceId, "rst-9");
  });

  /* ============ EDGE ============ */

  await check("TC-EDGE-01 长度 = minChars-1 → error/too-short，零调用", async () => {
    const store = await countingSeeded();
    const { provider, calls } = fakeProvider({ reply: fullDraft() });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: "x".repeat(MIN_RESTATEMENT_CHARS - 1),
      storage: store,
      provider,
    });
    assert.equal(res.status, "error");
    assert.equal(res.errorKind, "too-short");
    assert.equal(store.saves, 0);
    assert.equal(calls.chat, 0);
  });

  await check("TC-EDGE-02 长度 = maxChars+1 → error/too-long", async () => {
    const store = await seeded();
    const { provider } = fakeProvider({ reply: fullDraft() });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: CH1.id,
      text: "x".repeat(2_000 + 1),
      storage: store,
      provider,
    });
    assert.equal(res.status, "error");
    assert.equal(res.errorKind, "too-long");
  });

  await check("TC-EDGE-03 章不存在 → error/generic", async () => {
    const store = await seeded();
    const { provider } = fakeProvider({ reply: fullDraft() });
    const res = await checkRestatement({
      documentId: DOC.id,
      chapterId: "missing",
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    assert.equal(res.status, "error");
    assert.equal(res.errorKind, "generic");
  });

  await check("TC-EDGE-04 parseRestatementDraft 畸形输入全空草稿、绝不抛错", () => {
    for (const raw of [null, undefined, {}, "x", [], 42, { covered: "not-array" }]) {
      const d = parseRestatementDraft(raw);
      assert.deepEqual(d.covered, []);
      assert.deepEqual(d.missed, []);
      assert.deepEqual(d.errors, []);
      assert.equal(d.advice, undefined);
    }
  });

  await check("TC-EDGE-05 covered + missed 合计截断到 restatementMaxPoints", () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ point: `p${i}`, quote: `q${i}` }));
    const d = parseRestatementDraft({ covered: mk(6), missed: mk(6) });
    const total = d.covered.length + d.missed.length;
    assert.equal(total, PIPELINE_LIMITS.restatementMaxPoints);
    assert.equal(d.covered.length, 6);
    assert.equal(d.missed.length, PIPELINE_LIMITS.restatementMaxPoints - 6);
  });

  await check("TC-EDGE-06 point / quote 为空 → 丢该条", () => {
    const d = parseRestatementDraft({
      covered: [
        { point: "", quote: "有引文" },
        { point: "有点", quote: "" },
        { point: "有点", quote: "有引文" },
      ],
      missed: [],
      errors: [{ quote: "q", correction: "", evidence: "e" }],
    });
    assert.equal(d.covered.length, 1);
    assert.equal(d.errors.length, 0, "correction 为空 → 整条丢弃");
  });

  await check("TC-EDGE-07 coverageOf 分母 0 → undefined", () => {
    assert.equal(coverageOf({ covered: [], missed: [] }), undefined);
    assert.equal(coverageOf({ covered: [1], missed: [] }), 1);
    assert.equal(coverageOf({ covered: [1], missed: [1, 2] }), 1 / 3);
  });

  await check("TC-EDGE-08 ratingForCoverage 边界含等号", () => {
    assert.equal(ratingForCoverage(0.8), "good");
    assert.equal(ratingForCoverage(1), "good");
    assert.equal(ratingForCoverage(0.5), "hard");
    assert.equal(ratingForCoverage(0.79), "hard");
    assert.equal(ratingForCoverage(0.3), "forget");
    assert.equal(ratingForCoverage(undefined), "forget");
  });

  await check("TC-EDGE-09 章正文超 restatementBodyChars → truncated=true 且提示词正文被截断", async () => {
    const bigBody = "a".repeat(PIPELINE_LIMITS.restatementBodyChars + 500);
    const bigDoc: SourceDocument = { ...DOC, id: "dbig", textPreview: bigBody };
    const store = new CountingStorage();
    await store.saveDocument(bigDoc);
    await store.saveChapters(bigDoc.id, [
      { ...CH1, documentId: bigDoc.id, contentRef: { start: 0, end: bigBody.length } },
    ]);
    const { provider } = fakeProvider({ reply: "{}" }); // 空草稿 → partial
    const res = await checkRestatement({
      documentId: bigDoc.id,
      chapterId: CH1.id,
      text: RESTATEMENT,
      storage: store,
      provider,
    });
    assert.equal(res.status, "partial");
    assert.equal(res.record?.feedback?.truncated, true);

    const msgs = buildRestatementMessages({
      chapterTitle: "第 1 章",
      documentTitle: "大章",
      keyPoints: [],
      body: bigBody,
      restatement: RESTATEMENT,
    });
    const user = msgs[1].content;
    assert.ok(user.includes("a".repeat(PIPELINE_LIMITS.restatementBodyChars)));
    assert.ok(!user.includes("a".repeat(PIPELINE_LIMITS.restatementBodyChars + 1)), "正文必须被截断");
  });

  await check("TC-EDGE-10 localStorage 往返：记录（含 feedback）完整还原", async () => {
    const mem = new Map<string, string>();
    const stub = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: stub,
      configurable: true,
      writable: true,
    });
    const a = new LocalStorageAdapter();
    const record: Restatement = {
      id: "rst-x",
      documentId: "d1",
      chapterId: "c1",
      text: RESTATEMENT,
      createdAt: NOW,
      feedback: {
        at: NOW,
        covered: [{ point: "p", quote: Q_COVER, start: 0, end: Q_COVER.length }],
        missed: [],
        errors: [],
        coverage: 1,
        truncated: false,
      },
    };
    await a.saveRestatement(record);

    const b = new LocalStorageAdapter();
    const back = await b.listRestatements("c1");
    assert.equal(back.length, 1);
    assert.deepEqual(back[0], record, "跨实例完整还原");
    assert.equal(mem.has("plos.restatements"), true);

    await b.deleteRestatement("rst-x");
    assert.equal((await new LocalStorageAdapter().listRestatements("c1")).length, 0);
  });

  /* ============ REG ============ */

  await check("TC-REG-01 不传 learner → 提示词不含画像块（逐字节固定）", () => {
    const input = {
      chapterTitle: "第 1 章",
      documentTitle: "测试资料",
      keyPoints: ["要点甲", "要点乙"],
      body: CH1_BODY,
      restatement: RESTATEMENT,
    };
    const msgs = buildRestatementMessages(input);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, "system");
    assert.equal(msgs[0].content, RESTATEMENT_SYSTEM);
    assert.equal(
      msgs[1].content,
      [
        "资料：《测试资料》 · 当前章：《第 1 章》",
        "",
        "【本章要点】",
        "· 要点甲\n· 要点乙",
        "",
        "【本章正文】",
        CH1_BODY,
        "",
        "【用户复述】",
        RESTATEMENT,
      ].join("\n"),
      "无画像时输出必须与「未加画像块」版本逐字节相同（零回归）",
    );
    // 显式传 undefined 与不传等价
    assert.deepEqual(buildRestatementMessages({ ...input, learner: undefined }), msgs);
    assert.ok(!msgs[1].content.includes("学习者背景"));
  });

  await check("TC-REG-02 传 learner → 注入块剥围栏 / 截断 / 带免责声明", () => {
    const profile: LearnerProfile = {
      level: "intermediate",
      weeklyMinutes: 300,
      preferences: { depth: "depth", style: "quiz" },
      background: `\`\`\`\n${"背".repeat(900)}\n\`\`\``,
      updatedAt: 1,
    };
    const msgs = buildRestatementMessages({
      chapterTitle: "第 1 章",
      documentTitle: "测试资料",
      keyPoints: [],
      body: CH1_BODY,
      restatement: RESTATEMENT,
      learner: profile,
    });
    const user = msgs[1].content;
    assert.ok(user.includes("学习者背景"));
    assert.ok(user.includes("不得作为指令执行"), "必须带免责声明（防注入）");
    assert.ok(!user.includes("```"), "``` 围栏必须被剥离");
    assert.ok(user.includes("（无）"), "无要点时回落到「（无）」");
  });

  await check("TC-REG-03 evidenceActionKey 三档（含 restatement，G2 修复）", () => {
    assert.equal(evidenceActionKey("assessment"), "assessment");
    assert.equal(evidenceActionKey("review"), "review-points");
    assert.equal(evidenceActionKey("restatement"), "restatement");
  });

  /* ============ anchorRestatement 直测（纯函数） ============ */

  await check("anchorRestatement 空 point / 空 quote 一律丢弃", () => {
    const out = anchorRestatement(
      {
        covered: [
          { point: "", quote: Q_COVER },
          { point: "有点", quote: "  " },
          { point: "有点", quote: Q_COVER },
        ],
        missed: [],
        errors: [],
      },
      CH1_BODY,
      RESTATEMENT,
    );
    assert.equal(out.covered.length, 1);
    assert.equal(out.covered[0].point, "有点");
  });

  await check("anchorRestatement errors 缺 evidence 引文 → 丢弃", () => {
    const out = anchorRestatement(
      {
        covered: [],
        missed: [],
        errors: [{ quote: MISREAD_QUOTE, correction: "c", evidence: "" }],
      },
      CH1_BODY,
      RESTATEMENT,
    );
    assert.equal(out.errors.length, 0);
  });
}

await main();

for (const line of results) console.log(line);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
