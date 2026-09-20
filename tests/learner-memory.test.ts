/**
 * 学习者记忆（F9）单测 —— docs/learner-memory-design-2026-09.md §12 的全部用例。
 *
 * 运行：`npm run test:memory`（已串入 `npm run test:library`）
 *
 * 策略（§11.1 / §11.2）：
 * - **零真实 AI**：所有 AI 用例注入假 provider（`chat` 返回固定 JSON）；
 *   纯函数（`mergeMemoryDoc` / `parseMemoryDoc` / `parseMemoryDraft` / `buildMemoryContextBlock`）直接测。
 * - **零真实存储**：`InMemoryStorage`（`storage/memory.ts`）。
 * - **零真实文件**：磁盘通道只在 `cargo test --lib` 内测（T18）。
 * - 三条**硬断言**的主战场：① 三条管道不传记忆 → 逐字节不变；② 用户改过的行 5 轮不变；
 *   ③ 用户删掉的行 5 轮不复活。
 *
 * ⚠️ 本文件**不得** import 任何 `.tsx` 与 store（strip-types 不支持 JSX；store 会拖入 React）。
 * ⚠️ 不变量断言用**逐字节比对**（`assert.equal` 于序列化字符串），不用 `deepEqual` 的宽松匹配。
 */
import assert from "node:assert/strict";
import type {
  Annotation,
  CardStateMap,
  EvidenceEntry,
  GeneratedEntry,
  LearnerProfile,
  MemoryDocMeta,
  MemoryDocScaffold,
  MemoryEntry,
  PaperQuestion,
  Restatement,
} from "../src/domain/index.ts";
import {
  EMPTY_MEMORY_META,
  MEMORY_LIMITS,
  aiEntryKey,
  categoryOfKey,
  emptyMemoryDoc,
  memoryFingerprint,
  normalizeMemoryText,
  parseMemoryDoc,
  pruneMemoryDocForClear,
} from "../src/domain/memory.ts";
import { annotationId } from "../src/domain/annotation.ts";
import { capabilityItemId } from "../src/domain/capability.ts";
import { hashId } from "../src/lib/hash.ts";
import { deriveChapterCards } from "../src/engine/flashcard-engine.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import type { MergeStats } from "../src/features/memory/memory-doc-merge.ts";
import { mergeMemoryDoc, memoryDiffs } from "../src/features/memory/memory-doc-merge.ts";
import type { MemoryFactTexts } from "../src/features/memory/memory-facts.ts";
import {
  deriveAllFacts,
  deriveCadence,
  deriveOutputHabit,
  deriveReviewRhythm,
  deriveStudyMode,
  studyStyleMismatch,
} from "../src/features/memory/memory-facts.ts";
import type { MemorySignals } from "../src/features/memory/memory-signals.ts";
import {
  MEMORY_AI_MIN_SAMPLES,
  MemoryRunError,
  prepareAiRun,
  runMemoryAi,
} from "../src/features/memory/memory-import.ts";
import { collectSamples } from "../src/features/memory/memory-samples.ts";
import {
  applyAiEntries,
  clearMemoryDoc,
  externalChangeAt,
  loadMemory,
  loadMemoryEntries,
  markFileSaved,
  refreshFromFacts,
  restoreDismissed,
  saveUserDoc,
  useSystemVersion,
} from "../src/features/memory/memory-service.ts";
import { parseMemoryDraft } from "../src/ai/memory-pipeline.ts";
import { lastMergedPrefixOf, reportLinesOf, scaffoldOf } from "../src/features/memory/memory-texts.ts";
import { zh } from "../src/i18n/messages/zh.ts";
import { en } from "../src/i18n/messages/en.ts";
import {
  buildMemoryContextBlock,
  hasMemoryContext,
} from "../src/ai/learner-context.ts";
import { buildQuizGenMessages } from "../src/ai/pipelines.ts";
import { buildChapterQaMessages } from "../src/ai/chapter-qa.ts";
import { buildRestatementMessages } from "../src/ai/restatement.ts";
import type { AIProvider } from "../src/ai/types.ts";

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

// ===== 固定量（时间基准唯一：同一组用例内所有 now 都是它，便于逐字节断言）=====

const NOW = new Date(2026, 8, 17, 21, 30).getTime();
const DAY = 86_400_000;
const HOUR = 3_600_000;

const SCAFFOLD: MemoryDocScaffold = {
  title: "学习者记忆",
  intro: "这份文档由 PLOS 根据你的学习记录整理，你可以直接修改。\n删掉一行 = 你不同意它，系统不会再写回来。",
  manualHeading: "我的补充",
  headings: {
    identity: "基本信息",
    domain: "知识领域",
    preference: "偏好与方式",
    cognition: "认知特征",
    cadence: "学习节奏",
    "goal-intent": "学习意图",
  },
};
const LAST_MERGED_PREFIX = "最后整理：";
const TEXTS = { scaffold: SCAFFOLD, lastMergedPrefix: LAST_MERGED_PREFIX };

/** 通道 A 的文案表（测试用固定中文；生产由 i18n 注入）。 */
const FACTS: MemoryFactTexts = {
  cadenceWindow: (window, minutes) => `你常在 ${window} 学习，单次约 ${minutes} 分钟。`,
  cadenceWindowOnly: (window) => `你常在 ${window} 学习。`,
  reviewOnTime: () => "你的复习基本按时。",
  reviewLate: (latency) => `你的复习通常滞后约 ${latency}。`,
  reviewOverdue: () => "你的复习常拖到逾期。",
  latency: (ms) => `${Math.round(ms / HOUR)} 小时`,
  studyModeQuiz: (b) => `你以测验驱动为主（${b}）。`,
  studyModeReview: (b) => `你以复习驱动为主（${b}）。`,
  studyModeCard: (b) => `你以卡片自测为主（${b}）。`,
  studyModeRestatement: (b) => `你以复述驱动为主（${b}）。`,
  studyModeCapability: (b) => `你以能力评测为主（${b}）。`,
  kindLabel: {
    assessment: "测验",
    review: "复习",
    card: "卡片",
    restatement: "复述",
    capability: "能力评测",
  },
  outputCoverage: (pct) => `你的复述通常能覆盖到 ${pct}% 的要点。`,
  outputDensity: (per) => `平均每章划线 ${per} 处。`,
  outputNoteRatio: (pct) => `其中 ${pct}% 带笔记。`,
};

// ===== 构造辅助 =====

function g(key: string, category: GeneratedEntry["category"], text: string): GeneratedEntry {
  return { key, category, text };
}

function metaOf(over: Partial<MemoryDocMeta> = {}): MemoryDocMeta {
  return { lastWritten: {}, dismissed: [], lastMergedAt: 0, ...over };
}

/** 合并入口（固定 scaffold / 时间基准，避免每个用例重抄六个参数）。 */
function merge(input: {
  doc: string;
  generated: readonly GeneratedEntry[];
  meta?: MemoryDocMeta;
  now?: number;
}) {
  return mergeMemoryDoc({
    doc: input.doc,
    generated: input.generated,
    meta: input.meta ?? EMPTY_MEMORY_META,
    scaffold: SCAFFOLD,
    lastMergedPrefix: LAST_MERGED_PREFIX,
    now: input.now ?? NOW,
  });
}

function at(base: number, h: number, m: number): number {
  return base + (h * 60 + m) * 60_000;
}

function evidenceFixture(at_: number[], kind: EvidenceEntry["kind"] = "review"): EvidenceEntry[] {
  return at_.map((t, i) => ({
    at: t,
    kind,
    subjectId: `ch${i}`,
    delta: 0,
    verdict: "good",
  })) as unknown as EvidenceEntry[];
}

/**
 * 20 条证据 / 跨度 7 天 / 会话时长中位数 20 分钟。
 *
 * 构法：8 天里 4 个「10 分钟会话」（10:00–10:10）、4 个「30 分钟会话」（20:00–20:30），
 * 外加 4 条孤立的 12:00 事件补足 20 条 —— 孤立事件不成段（不产生时长），
 * 故时长样本恰为 `[10,30,10,30,10,30,10,30]` → 中位数 20 分钟（手算值，TC-UC02-02）。
 */
function cadenceEvidence(): EvidenceEntry[] {
  const times: number[] = [];
  [1, 2, 3, 4, 5, 6, 7, 8].forEach((d, i) => {
    const base = new Date(2026, 8, d).getTime();
    if (i % 2 === 0) times.push(at(base, 10, 0), at(base, 10, 10));
    else times.push(at(base, 20, 0), at(base, 20, 30));
  });
  [1, 2, 3, 4].forEach((d) => times.push(at(new Date(2026, 8, d).getTime(), 12, 0)));
  return evidenceFixture(times);
}

/** 24 条 / 跨度 7 天 / 全部落在 22 点（每天 3 条，22:00–22:20 共 20 分钟）。 */
function lateNightEvidence(): EvidenceEntry[] {
  const times: number[] = [];
  for (let d = 1; d <= 8; d++) {
    const base = new Date(2026, 8, d).getTime();
    times.push(at(base, 22, 0), at(base, 22, 10), at(base, 22, 20));
  }
  return evidenceFixture(times);
}

function signalsFixture(over: Partial<MemorySignals> = {}): MemorySignals {
  return {
    evidence: [],
    cards: {} as CardStateMap,
    learner: { byUnit: {} },
    annotations: [],
    restatements: [],
    goals: [],
    chapterCount: 0,
    ...over,
  } as unknown as MemorySignals;
}

function cardsFixture(spec: readonly { reps: number; delayMs: number; noNext?: boolean }[]): CardStateMap {
  const map: CardStateMap = {};
  spec.forEach((s, i) => {
    map[`card_${i}`] = {
      cardId: `card_${i}`,
      chapterId: "ch1",
      documentId: "doc1",
      ...(s.noNext ? {} : { nextReviewAt: NOW - s.delayMs }),
      lastReviewedAt: NOW,
      reps: s.reps,
      lastRating: "good",
      lapses: 0,
    };
  });
  return map;
}

/** 假 provider（零真实网络）：`chat` 返回固定 content。 */
function fakeProvider(content: string, configured = true): AIProvider {
  return {
    kind: "builtin",
    isConfigured: () => configured,
    chat: async () => ({ content }),
  } as unknown as AIProvider;
}

const SAMPLE_ID = "ann_1";
const SAMPLE_TEXT = "今天读了偏差处理一章，CAPA 的写法还是不太熟，明天再看一遍。";

/** 文档 fixture：五态样例齐备（未动行 / 改过行 / 手写行 / 用户自定义节 / 降级行）。 */
const DOC = [
  "# 学习者记忆",
  "",
  "> 这份文档由 PLOS 根据你的学习记录整理，你可以直接修改。",
  `> ${LAST_MERGED_PREFIX}2026-09-01 10:00 <!--t:1756692000000-->`,
  "",
  "## 我的补充",
  "",
  "- 我一般先看目录，再回头抠细节。",
  "",
  "## 学习节奏 <!--s:cadence-->",
  "",
  "- 你常在 22:00–01:00 学习，单次约 47 分钟。<!--m:cadence-window-->",
  "- 你的复习基本按时。<!--m:cadence-review-->",
  "",
  "## 我的笔记",
  "",
  "- 这一节是我自己加的，系统不要动。",
  "",
].join("\n");

const SYSTEM_WINDOW = "你常在 22:00–01:00 学习，单次约 47 分钟。";
const SYSTEM_REVIEW = "你的复习基本按时。";

// =========================================================================
// T0：hashId 抽取的零回归（R7 —— 改坏会让既有卡片/批注/能力项 id 静默成孤儿）
// =========================================================================

async function run() {
  await check("T0-1 hashId 与三处旧实现同输入同输出（TC-EDGE-14）", () => {
    // 期望值由**改动前的 djb2 实现**独立算得（见 runbook 验证录像），
    // 故这条断言锁的是「输入拼接格式与算法都没变」，而不是「跟现在的实现自洽」。
    assert.equal(hashId("abc"), "3772q3");
    assert.equal(hashId("偏差处理"), "1b661rg");
    assert.equal(hashId(""), "45h");
    assert.equal(hashId("\u0000"), "3t0l");
  });

  await check("T0-2 三处内容派生 id 数值不变（TC-UC12-02/03）", () => {
    assert.equal(annotationId("doc-1", 10, 20), "ann_6hf470");
    assert.equal(annotationId("doc-1", 0, 7), "ann_5oi00w");
    assert.equal(capabilityItemId("goal-1", "能独立完成偏差分级"), "cap_1tnkha8");
    const chapter = {
      id: "ch1",
      documentId: "doc1",
      order: 1,
      title: "偏差处理",
      contentRef: { start: 0, end: 20 },
      keyPoints: ["偏差分级", "根本原因调查"],
      keyPointRefs: [
        { point: "偏差分级", quote: "偏差分为次要、主要、重大三级。", start: 0, end: 17 },
        { point: "根本原因调查", quote: "重大偏差需要启动根本原因调查。", start: 18, end: 35 },
      ],
    };
    assert.deepEqual(
      deriveChapterCards(chapter as never, "doc-1").map((c) => c.id),
      ["card_1gxfu2z", "card_1skmvot"],
    );
  });

  // =========================================================================
  // 解析（§4.3.1 文档格式契约）
  // =========================================================================

  await check("P1 抬头引用块不产出条目、`<!--t:-->` 可解析（TC-EDGE-08）", () => {
    const doc = [
      "# 学习者记忆",
      "> 规则说明：以下是给你的说明，不是记忆。",
      "> - [认知] 假条目（引用块里，必须被忽略）",
      `> ${LAST_MERGED_PREFIX}2026-09-01 10:00 <!--t:1756692000000-->`,
      "",
      "- 真实的手写行",
    ].join("\n");
    const parsed = parseMemoryDoc(doc);
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].text, "真实的手写行");
    assert.equal(parsed.entries[0].key, undefined);
    assert.equal(parsed.lastMergedAt, 1756692000000);
  });

  await check("P2 系统行 / 手写行 / 降级行一次解析（TC-EDGE-06、TC-UC05-01）", () => {
    const doc = [
      "## 学习节奏 <!--s:cadence-->",
      "",
      `- ${SYSTEM_WINDOW}<!--m:cadence-window-->`,
      "- 用户手写的一行",
      "- 键被改坏的一行 <!--m:!!!-->",
    ].join("\n");
    const { entries, manualIndexes } = parseMemoryDoc(doc);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].key, "cadence-window");
    assert.equal(entries[0].category, "cadence");
    assert.equal(entries[1].key, undefined);
    assert.equal(entries[2].key, undefined, "非法键 → 降级为手写行");
    assert.equal(entries[2].text, "键被改坏的一行", "残留标记必须剥掉（不进提示词）");
    assert.deepEqual(manualIndexes, [1, 2]);
  });

  await check("P3 重复键：解析层如实报告两行，合并层只认第一行（TC-EDGE-07）", () => {
    const doc = [
      `- 系统那份<!--m:cadence-review-->`,
      `- 我复制了一行<!--m:cadence-review-->`,
    ].join("\n");
    const { entries } = parseMemoryDoc(doc);
    // 解析层是**纯行扫描**：它照实报告文档里有什么，不做「谁是正主」的裁决
    // （裁决在合并器，因为只有那里才知道 lastWritten）。两行都有合法键 → 都带 key。
    assert.equal(entries.length, 2);
    assert.equal(entries[0].key, "cadence-review");
    assert.equal(entries[1].key, "cadence-review");

    // 合并层：`sysLine` 取第一个 → 只有第一行参与更新，第二行**一字不动**
    const meta = metaOf({ lastWritten: { "cadence-review": "系统那份" } });
    const out = merge({
      doc,
      meta,
      generated: [g("cadence-review", "cadence", "你的复习基本按时。")],
    });
    assert.equal(out.stats.updated, 1);
    assert.ok(out.doc.includes("我复制了一行<!--m:cadence-review-->"), "第二行不得被改");
    assert.equal(
      out.doc.split("<!--m:cadence-review-->").length - 1,
      2,
      "不得把重复行静默删掉（用户内容优先保留）",
    );
  });

  await check("P4 空文档 / 只有骨架 → 无条目（TC-EDGE-09）", () => {
    assert.deepEqual(parseMemoryDoc("").entries, []);
    assert.deepEqual(parseMemoryDoc(emptyMemoryDoc(SCAFFOLD)).entries, []);
    assert.equal(buildMemoryContextBlock(parseMemoryDoc("").entries), undefined);
  });

  // =========================================================================
  // 骨架与指纹
  // =========================================================================

  await check("S1 骨架不含正文占位句（否则占位句会被当成用户的话注入）", () => {
    const doc = emptyMemoryDoc(SCAFFOLD);
    assert.ok(doc.startsWith("# 学习者记忆"));
    assert.ok(doc.includes(`## ${SCAFFOLD.manualHeading}`));
    for (const line of doc.split("\n")) {
      if (!line.trim()) continue;
      const isStructure = line.startsWith("#") || line.startsWith(">");
      assert.ok(isStructure, `骨架里出现了非结构行：${line}`);
    }
    assert.equal(parseMemoryDoc(doc).entries.length, 0);
  });

  await check("S2 normalizeMemoryText 全角转半角 + 折叠空白 + 小写（TC-UC12-04）", () => {
    assert.equal(normalizeMemoryText("  偏差　处理  ABC "), "偏差 处理 abc");
    assert.equal(normalizeMemoryText("ＡＢＣ１２３"), "abc123");
  });

  await check("S3 指纹与 AI 条目键内容派生稳定（TC-UC07-03）", () => {
    assert.equal(memoryFingerprint("cognition", "先术语后因果"), memoryFingerprint("cognition", "  先术语后因果  "));
    assert.equal(aiEntryKey("cognition", "先术语后因果"), aiEntryKey("cognition", "先术语后因果"));
    assert.notEqual(aiEntryKey("cognition", "A"), aiEntryKey("preference", "A"), "类别参与指纹");
    assert.equal(categoryOfKey(aiEntryKey("goal-intent", "想转做临床")), "goal-intent");
  });

  // =========================================================================
  // 合并器（本方案的承重墙）
  // =========================================================================

  await check("M1 空文档 + 3 条 → 骨架 + 3 标记行（TC-UC02-07）", () => {
    const generated = [
      g("cadence-window", "cadence", "你常在 22:00–01:00 学习。"),
      g("cadence-review", "cadence", "你的复习基本按时。"),
      g("pref-study-mode", "preference", "你以测验驱动为主。"),
    ];
    const out = merge({ doc: "", generated });
    assert.equal(out.stats.added, 3);
    assert.equal(out.stats.updated, 0);
    assert.equal(Object.keys(out.meta.lastWritten).length, 3);
    for (const item of generated) assert.ok(out.doc.includes(`<!--m:${item.key}-->`), item.key);
    assert.ok(out.doc.includes("<!--s:cadence-->"));
    assert.ok(out.doc.includes("<!--s:preference-->"));
    assert.ok(out.doc.includes(LAST_MERGED_PREFIX));
    assert.equal(out.meta.lastMergedAt, NOW);
  });

  await check("M2 幂等：同 generated / 同 now 再跑 → 逐字节不变、updated=0（TC-UC02-08）", () => {
    const generated = [g("cadence-window", "cadence", "你常在 22:00–01:00 学习。")];
    const first = merge({ doc: "", generated });
    const second = merge({ doc: first.doc, generated, meta: first.meta });
    assert.equal(second.doc, first.doc, "二次整理必须逐字节不变");
    assert.equal(second.stats.updated, 0);
    assert.equal(second.stats.added, 0);
  });

  await check("M3 未动行 → 原地替换 + updated（五态第 1 格）", () => {
    const meta = metaOf({ lastWritten: { "cadence-window": SYSTEM_WINDOW } });
    const out = merge({
      doc: DOC,
      meta,
      generated: [g("cadence-window", "cadence", "你常在 22:00–01:00 学习，单次约 55 分钟。")],
    });
    assert.equal(out.stats.updated, 1);
    assert.ok(out.doc.includes("单次约 55 分钟。"));
    assert.ok(!out.doc.includes("单次约 47 分钟。"));
    assert.equal(out.meta.lastWritten["cadence-window"], "你常在 22:00–01:00 学习，单次约 55 分钟。");
  });

  await check("M4 用户改过 → 永久冻结：5 轮不变、lastWritten 保持系统值（硬断言②）", () => {
    const userText = "我睡得晚，一般十一点后才有空看两页。";
    const edited = DOC.replace(SYSTEM_WINDOW, userText);
    assert.ok(edited.includes(userText));
    const meta = metaOf({ lastWritten: { "cadence-window": SYSTEM_WINDOW, "cadence-review": SYSTEM_REVIEW } });

    let doc = edited;
    let currentMeta = meta;
    for (let round = 1; round <= 5; round++) {
      const out = merge({
        doc,
        meta: currentMeta,
        // 每轮换一种说法（模拟系统不断推出新的措辞）
        generated: [g("cadence-window", "cadence", `你常在 22:00–01:00 学习（第 ${round} 轮）。`)],
      });
      assert.equal(out.stats.keptMine, 1, `第 ${round} 轮应判定为「用户改过」`);
      assert.equal(out.stats.updated, 0, `第 ${round} 轮不得更新该行`);
      assert.ok(out.doc.includes(userText), `第 ${round} 轮用户文本必须逐字节保留`);
      assert.equal(
        out.meta.lastWritten["cadence-window"],
        SYSTEM_WINDOW,
        `第 ${round} 轮 lastWritten 不得被改写（否则下轮就不再判为「改过」）`,
      );
      currentMeta = out.meta;
      // ⚠️ 只把「用户那一行」带到下一轮，验证的是行级冻结而非整篇不可变
      doc = out.doc;
    }
  });

  await check("M5 用户删掉 → 进 dismissed；再跑 5 轮不复活（硬断言③）", () => {
    const deleted = DOC.split("\n")
      .filter((l) => !l.includes("<!--m:cadence-window-->"))
      .join("\n");
    const meta = metaOf({ lastWritten: { "cadence-window": SYSTEM_WINDOW } });

    const first = merge({
      doc: deleted,
      meta,
      generated: [g("cadence-window", "cadence", "你常在 22:00–01:00 学习。")],
    });
    assert.equal(first.stats.dismissedNow, 1);
    assert.deepEqual(first.meta.dismissed, ["cadence-window"]);
    assert.ok(!first.doc.includes("cadence-window"), "被删的键不得写回");

    let doc = first.doc;
    let currentMeta = first.meta;
    for (let round = 1; round <= 5; round++) {
      const out = merge({
        doc,
        meta: currentMeta,
        generated: [g("cadence-window", "cadence", `换个说法的第 ${round} 轮。`)],
      });
      assert.equal(out.stats.skippedDismissed, 1, `第 ${round} 轮应跳过（墓碑）`);
      assert.equal(out.stats.added, 0, `第 ${round} 轮不得新增`);
      assert.ok(!out.doc.includes("cadence-window"), `第 ${round} 轮不得复活`);
      assert.ok(!out.doc.includes("换个说法的"), `第 ${round} 轮不得写回任何变形`);
      doc = out.doc;
      currentMeta = out.meta;
    }
  });

  await check("M6 恢复被删 → 下轮写回文档（TC-UC04-03）", async () => {
    const store = new InMemoryStorage();
    const signals = signalsFixture({ evidence: lateNightEvidence() });
    const opts = { now: NOW, facts: FACTS, ...TEXTS };

    // ① 先制造墓碑：文档里删掉那一行，而系统**仍然推出**同一个键
    await saveUserDoc(store, DOC);
    await store.saveMemoryMeta(metaOf({ lastWritten: { "cadence-window": SYSTEM_WINDOW } }));
    const deleted = DOC.split("\n")
      .filter((l) => !l.includes("<!--m:cadence-window-->"))
      .join("\n");
    await saveUserDoc(store, deleted);
    await refreshFromFacts(store, signals, opts);
    assert.deepEqual((await store.getMemoryMeta()).dismissed, ["cadence-window"]);

    // ② 恢复 → 下轮必须写回
    await restoreDismissed(store);
    const meta = await store.getMemoryMeta();
    assert.deepEqual(meta.dismissed, []);
    assert.equal(meta.lastWritten["cadence-window"], undefined, "必须同时删掉 lastWritten 记录");

    const stats = await refreshFromFacts(store, signals, opts);
    assert.equal(stats.added, 1, "恢复后该键应作为新条目写回");
    assert.ok((await store.getMemoryDoc()).includes("<!--m:cadence-window-->"));
  });

  await check("M7 useSystemVersion：交回系统后下轮被替换（TC-UC04-04）", async () => {
    const store = new InMemoryStorage();
    const userText = "我睡得晚，十一点后才有空。";
    await saveUserDoc(store, DOC.replace(SYSTEM_WINDOW, userText));
    await store.saveMemoryMeta(metaOf({ lastWritten: { "cadence-window": SYSTEM_WINDOW } }));

    const before = await store.getMemoryDoc();
    assert.ok(before.includes(userText));
    await useSystemVersion(store, "cadence-window", userText);

    const stats = await refreshFromFacts(store, signalsFixture({ evidence: lateNightEvidence() }), {
      now: NOW,
      facts: FACTS,
      ...TEXTS,
    });
    assert.equal(stats.updated, 1);
    const after = await store.getMemoryDoc();
    assert.ok(!after.includes(userText), "用户文本应被系统值替换");
    assert.ok(after.includes("你常在 22:00–01:00 学习"), `实际：${after}`);
  });

  await check("M7b useSystemVersion：已删的行不得被重新埋葬", async () => {
    const store = new InMemoryStorage();
    await saveUserDoc(store, DOC);
    await store.saveMemoryMeta(metaOf({ lastWritten: { "cadence-window": SYSTEM_WINDOW }, dismissed: ["cadence-window"] }));
    await useSystemVersion(store, "cadence-window", "");
    const meta = await store.getMemoryMeta();
    assert.deepEqual(meta.dismissed, []);
    assert.equal(meta.lastWritten["cadence-window"], undefined);
  });

  await check("M8 标记被删 → 降级行保留 + 该节新增一条系统行（TC-UC03-02）", () => {
    const degraded = DOC.replace(`<!--m:cadence-window-->`, "");
    const meta = metaOf({ lastWritten: { "cadence-window": SYSTEM_WINDOW } });
    const out = merge({
      doc: degraded,
      meta,
      generated: [g("cadence-window", "cadence", "你常在 22:00–01:00 学习。")],
    });
    const parsed = parseMemoryDoc(out.doc);
    const manual = parsed.entries.filter((e) => e.key === undefined).map((e) => e.text);
    assert.ok(manual.includes(SYSTEM_WINDOW), "降级行必须仍在文档里（不静默删除用户内容）");
    assert.ok(parsed.entries.some((e) => e.key === "cadence-window"), "该节末尾新增系统行");
  });

  await check("M9 每类行数上限 → 只淘汰最旧的系统行，用户行不动（TC-EDGE-01）", () => {
    const systemRows = [1, 2, 3, 4, 5].map((n) => g(`ai-cognition-${n}`, "cognition", `系统观察 ${n}`));
    const userRow = "- 我自己写的认知笔记";
    const doc = [
      "# 学习者记忆",
      "",
      "## 认知特征 <!--s:cognition-->",
      "",
      userRow,
      "## 我的笔记",
      "",
      "- 自定义节内容",
    ].join("\n");
    // 先铺 5 条系统行（分两轮，保证 lastWritten 顺序稳定）
    const first = merge({ doc, generated: systemRows.slice(0, 4) });
    const second = merge({ doc: first.doc, meta: first.meta, generated: systemRows });

    const parsed = parseMemoryDoc(second.doc);
    const cognition = parsed.entries.filter((e) => e.category === "cognition" && e.key);
    assert.equal(cognition.length, MEMORY_LIMITS.maxLinesPerCategory, "每类系统行不超过上限");
    assert.equal(second.stats.trimmed, 1);
    assert.ok(second.doc.includes(userRow), "手写行不参与淘汰");
    assert.ok(second.doc.includes("- 自定义节内容"), "用户自定义节不参与淘汰");
  });

  await check("M10 用户自定义节 + 手写行 → 5 轮逐字不变（TC-UC05-03）", () => {
    let doc = DOC;
    let meta = EMPTY_MEMORY_META;
    for (let round = 1; round <= 5; round++) {
      const out = merge({
        doc,
        meta,
        generated: [g(`ai-cognition-${round}`, "cognition", `第 ${round} 轮的新观察`)],
      });
      assert.ok(out.doc.includes("## 我的笔记"), `第 ${round} 轮自定义节标题丢失`);
      assert.ok(out.doc.includes("- 这一节是我自己加的，系统不要动。"), `第 ${round} 轮自定义节内容被改`);
      assert.ok(out.doc.includes("- 我一般先看目录，再回头抠细节。"), `第 ${round} 轮手写行丢失`);
      doc = out.doc;
      meta = out.meta;
    }
  });

  await check("M11 文档达上限 → 停止新增、不删用户内容（TC-UC05-04）", () => {
    const big = "- " + "长".repeat(MEMORY_LIMITS.docMaxChars - 20);
    const doc = ["# 学习者记忆", "", "## 我的补充", "", big].join("\n");
    const out = merge({ doc, generated: [g("cadence-review", "cadence", "你常复习。")] });
    assert.ok(out.doc.includes(big), "用户内容一字不能删");
    assert.ok(!out.doc.includes("<!--m:cadence-review-->"), "到顶后不得新增");
    assert.equal(out.stats.trimmed, 0, "trimmed 只统计淘汰，不统计容量拦截");
  });

  await check("M12 memoryDiffs：用户改过 vs 系统新值（TC-UC03-03）", () => {
    const userText = "我睡得晚，十一点后才有空。";
    const edited = DOC.replace(SYSTEM_WINDOW, userText);
    const meta = metaOf({ lastWritten: { "cadence-window": SYSTEM_WINDOW } });
    const generated = [g("cadence-window", "cadence", "你常在 22:00–01:00 学习。")];
    const diffs = memoryDiffs(parseMemoryDoc(edited), generated, meta);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].key, "cadence-window");
    assert.equal(diffs[0].mine, userText);
    assert.equal(diffs[0].theirs, "你常在 22:00–01:00 学习。");
    // 用户没动过 → 不是差异
    assert.deepEqual(memoryDiffs(parseMemoryDoc(DOC), generated, meta), []);
  });

  // =========================================================================
  // 通道 A：确定性派生（含门槛边界与手算数值）
  // =========================================================================

  await check("F1 门槛边界：19 条 / 6 天不产出，20 条 / 7 天产出（TC-UC02-03、TC-EDGE-02）", () => {
    const thin = evidenceFixture(
      Array.from({ length: 19 }, (_, i) => at(new Date(2026, 8, 1).getTime(), 22, 0) + Math.floor((i * 6 * DAY) / 19)),
    );
    assert.equal(deriveCadence(signalsFixture({ evidence: thin }), NOW, FACTS), undefined);
    const ok = evidenceFixture(
      Array.from({ length: 20 }, (_, i) => at(new Date(2026, 8, 1).getTime(), 22, 0) + Math.floor((i * 7 * DAY) / 19)),
    );
    assert.ok(deriveCadence(signalsFixture({ evidence: ok }), NOW, FACTS));
  });

  await check("F2 活跃时段：集中在 22 时 → 22:00–01:00，跨零点正确（TC-UC02-01、TC-EDGE-03）", () => {
    const fact = deriveCadence(signalsFixture({ evidence: lateNightEvidence() }), NOW, FACTS);
    assert.ok(fact);
    assert.equal(fact.key, "cadence-window");
    assert.equal(fact.category, "cadence");
    assert.ok(fact.text.includes("22:00–01:00"), `实际：${fact.text}`);
    // 全部落在同一小时也不能出现 -1 时
    const same = evidenceFixture(
      Array.from({ length: 21 }, (_, i) => at(new Date(2026, 8, 1).getTime(), 0, 30) + Math.floor((i * 7 * DAY) / 20)),
    );
    const zero = deriveCadence(signalsFixture({ evidence: same }), NOW, FACTS);
    assert.ok(zero && zero.text.includes("00:00–03:00"), zero?.text);
  });

  await check("F3 单次时长 = 段时长中位数（手算 20 分钟；间隔 > 30 分钟切段）（TC-UC02-02）", () => {
    const fact = deriveCadence(signalsFixture({ evidence: cadenceEvidence() }), NOW, FACTS);
    assert.ok(fact);
    assert.ok(fact.text.includes("单次约 20 分钟"), `实际：${fact.text}`);
  });

  await check("F4 复习遵守度门槛与分档（TC-UC02-05/06、TC-EDGE-04）", () => {
    const exactly15 = signalsFixture({
      cards: cardsFixture(Array.from({ length: 5 }, () => ({ reps: 3, delayMs: HOUR }))),
    });
    assert.ok(deriveReviewRhythm(exactly15, FACTS), "reps 合计恰好 15 → 达标（门槛是 ≥）");

    const low = signalsFixture({ cards: cardsFixture([{ reps: 14, delayMs: 0 }]) });
    assert.equal(deriveReviewRhythm(low, FACTS), undefined, "reps 合计 14 < 15 → 不产出");

    const late = signalsFixture({ cards: cardsFixture([{ reps: 20, delayMs: HOUR }]) });
    const fact = deriveReviewRhythm(late, FACTS);
    assert.ok(fact && fact.text.includes("滞后"), fact?.text);

    const overdue = signalsFixture({ cards: cardsFixture([{ reps: 20, delayMs: 3 * DAY }]) });
    assert.ok(deriveReviewRhythm(overdue, FACTS)!.text.includes("逾期"));

    const onTime = signalsFixture({ cards: cardsFixture([{ reps: 20, delayMs: -HOUR }]) });
    assert.ok(deriveReviewRhythm(onTime, FACTS)!.text.includes("按时"));

    // nextReviewAt 缺失 → 跳过该卡（不用 undefined 参与减法 → 不产生 NaN）
    const missing = signalsFixture({ cards: cardsFixture([{ reps: 20, delayMs: 0, noNext: true }]) });
    assert.equal(deriveReviewRhythm(missing, FACTS), undefined);
  });

  await check("F5 学习方式：占比最高者为主（含占比明细）（UC-02）", () => {
    const evidence = [
      ...evidenceFixture(Array.from({ length: 12 }, (_, i) => NOW - i * HOUR), "assessment"),
      ...evidenceFixture(Array.from({ length: 5 }, (_, i) => NOW - i * HOUR), "review"),
      ...evidenceFixture(Array.from({ length: 3 }, (_, i) => NOW - i * HOUR), "card"),
    ];
    const fact = deriveStudyMode(signalsFixture({ evidence }), FACTS);
    assert.ok(fact);
    assert.equal(fact.category, "preference");
    assert.ok(fact.text.includes("测验驱动为主"), fact.text);
    assert.ok(fact.text.includes("测验 12 / 复习 5 / 卡片 3"), fact.text);
    // 门槛：19 条 → 不产出
    assert.equal(deriveStudyMode(signalsFixture({ evidence: evidenceFixture(Array.from({ length: 19 }, (_, i) => NOW - i * HOUR)) }), FACTS), undefined);
  });

  await check("F6 输出习惯：复述 <3 不产出；chapterCount=0 不做除零（TC-UC02-04、TC-EDGE-05）", () => {
    const none = signalsFixture({ restatements: [] });
    assert.equal(deriveOutputHabit(none, FACTS), undefined);

    const restatements = [
      { id: "r1", documentId: "d", chapterId: "c", text: "a", createdAt: 1, feedback: { at: 1, covered: [], missed: [], errors: [], coverage: 0.6 } },
      { id: "r2", documentId: "d", chapterId: "c", text: "b", createdAt: 2, feedback: { at: 2, covered: [], missed: [], errors: [], coverage: 0.6 } },
      { id: "r3", documentId: "d", chapterId: "c", text: "c", createdAt: 3, feedback: { at: 3, covered: [], missed: [], errors: [], coverage: 0.7 } },
    ] as unknown as Restatement[];
    const zeroChapters = deriveOutputHabit(
      signalsFixture({ restatements, annotations: [], chapterCount: 0 }),
      FACTS,
    );
    assert.ok(zeroChapters);
    assert.ok(zeroChapters.text.includes("覆盖到 60%"), zeroChapters.text);
    assert.ok(!zeroChapters.text.includes("平均每章"), "分母为 0 时划线密度整段不产出");

    const withChapters = deriveOutputHabit(
      signalsFixture({
        restatements,
        chapterCount: 2,
        annotations: [
          { id: "a1", documentId: "d", chapterId: "c", quote: "q", start: 0, end: 1, note: "有笔记", createdAt: 1, updatedAt: 1 },
          { id: "a2", documentId: "d", chapterId: "c", quote: "q", start: 2, end: 3, note: "", createdAt: 1, updatedAt: 1 },
        ] as unknown as Annotation[],
      }),
      FACTS,
    );
    assert.ok(withChapters!.text.includes("平均每章划线 1 处"), withChapters!.text);
    assert.ok(withChapters!.text.includes("50% 带笔记"), withChapters!.text);
  });

  await check("F7 数据不足 → deriveAllFacts 全空（TC-UC01-01）", () => {
    assert.deepEqual(deriveAllFacts(signalsFixture({ evidence: evidenceFixture([NOW]) }), NOW, FACTS), []);
    // 20 条证据（全是 review）→ 恰好两条达标：活跃时段 + 学习方式
    //（复习遵守度要 reps ≥ 15、输出习惯要复述 ≥ 3，两条都未达 → 不产）
    assert.deepEqual(
      deriveAllFacts(signalsFixture({ evidence: cadenceEvidence() }), NOW, FACTS).map((f) => f.key),
      ["cadence-window", "pref-study-mode"],
    );
  });

  await check("F8 声明画像冲突提示：只提示、不改声明（TC-UC08-01/02）", () => {
    const evidence = evidenceFixture(Array.from({ length: 20 }, (_, i) => NOW - i * HOUR), "assessment");
    const declared: LearnerProfile = { preferences: { style: "reading", depth: "depth" } } as unknown as LearnerProfile;
    const mismatch = studyStyleMismatch(signalsFixture({ evidence }), declared);
    assert.ok(mismatch);
    assert.equal(mismatch.declared, "reading");
    assert.equal(mismatch.observed, "quiz");

    const agree: LearnerProfile = { preferences: { style: "quiz", depth: "depth" } } as unknown as LearnerProfile;
    assert.equal(studyStyleMismatch(signalsFixture({ evidence }), agree), undefined);
    assert.equal(studyStyleMismatch(signalsFixture({ evidence }), undefined), undefined, "无声明不制造冲突");
  });

  // =========================================================================
  // 服务层（含 D13-B 清库裁剪与跨实体不变式）
  // =========================================================================

  await check("SV1 空库 → loadMemoryEntries 返回 []（TC-UC01-02）", async () => {
    const store = new InMemoryStorage();
    assert.deepEqual(await loadMemoryEntries(store), []);
    const loaded = await loadMemory(store);
    assert.equal(loaded.doc, "");
    assert.deepEqual(loaded.meta, EMPTY_MEMORY_META);
  });

  await check("SV2 saveUserDoc 原样落库、不过合并器（用户文本逐字节保存）", async () => {
    const store = new InMemoryStorage();
    const weird = "# 我的写法\r\n\r\n* 用星号也行 <!--m:cadence-review-->\n\n随便乱来的一堆空行\n\n\n";
    await saveUserDoc(store, weird);
    assert.equal(await store.getMemoryDoc(), weird);
    assert.deepEqual(await store.getMemoryMeta(), EMPTY_MEMORY_META, "手动编辑不动 meta");
  });

  await check("SV3 clearMemoryDoc：文档空 + meta 空态 + 其他实体逐字节不变（TC-UC10-01）", async () => {
    const store = new InMemoryStorage();
    await store.saveRestatement({ id: "r1", documentId: "d", chapterId: "c", text: "复述", createdAt: 1 } as Restatement);
    await store.saveAnnotation({
      id: "a1",
      documentId: "d",
      chapterId: "c",
      quote: "原文",
      start: 0,
      end: 2,
      note: "笔记",
      createdAt: 1,
      updatedAt: 1,
    } as Annotation);

    const restBefore = JSON.stringify(await store.listAllRestatements());
    const annBefore = JSON.stringify(await store.listAllAnnotations());
    const learnerBefore = JSON.stringify(await store.getLearnerState());

    await saveUserDoc(store, DOC);
    await store.saveMemoryMeta(metaOf({ lastWritten: { "cadence-window": SYSTEM_WINDOW }, dismissed: ["x"] }));
    await clearMemoryDoc(store);

    assert.equal(await store.getMemoryDoc(), "");
    assert.deepEqual(await store.getMemoryMeta(), EMPTY_MEMORY_META);
    assert.equal(JSON.stringify(await store.listAllRestatements()), restBefore);
    assert.equal(JSON.stringify(await store.listAllAnnotations()), annBefore);
    assert.equal(JSON.stringify(await store.getLearnerState()), learnerBefore);
  });

  await check("SV4 连续打开页面 3 次：除时间戳外文档稳定（决策「打开即整理」）", async () => {
    const store = new InMemoryStorage();
    const signals = signalsFixture({ evidence: cadenceEvidence() });
    const docs: string[] = [];
    for (let i = 1; i <= 3; i++) {
      await refreshFromFacts(store, signals, { now: NOW + i * 60_000, facts: FACTS, ...TEXTS });
      docs.push(await store.getMemoryDoc());
    }
    const strip = (s: string) => s.replace(/<!--t:\d+-->/, "").replace(/最后整理：[\d\- :]+/, "");
    assert.equal(strip(docs[2]), strip(docs[1]));
    assert.equal(strip(docs[1]), strip(docs[0]));
    assert.deepEqual(
      parseMemoryDoc(docs[2]).entries.map((e) => e.key),
      // 文档顺序 = 节顺序（`MEMORY_CATEGORIES`：… preference → … → cadence …），
      // 不是派生顺序 —— 两处顺序刻意不同，别把任一处的期望抄到另一处
      ["pref-study-mode", "cadence-window"],
      "两条达标项必须都已落进文档，且三轮下来不重复新增",
    );
  });

  await check("D13-B clearAll：清系统未动行、留用户手写与改过的行、留 dismissed", async () => {
    const store = new InMemoryStorage();
    const userText = "我睡得晚，十一点后才有空。";
    const meta = metaOf({
      lastWritten: { "cadence-window": SYSTEM_WINDOW, "cadence-review": SYSTEM_REVIEW },
      dismissed: ["ai-cognition-zzz"],
    });
    // 系统未动行：cadence-review 保留在文档里；cadence-window 被用户改成 userText
    const doc = DOC.replace(SYSTEM_WINDOW, userText);
    const pruned = pruneMemoryDocForClear(doc, meta);
    assert.ok(pruned.doc.includes(userText), "用户改过的行必须保留");
    assert.ok(pruned.doc.includes("- 我一般先看目录，再回头抠细节。"), "手写行必须保留");
    assert.ok(!pruned.doc.includes("cadence-review"), "系统未动过 + 已失去依据的行应被清掉");
    assert.equal(pruned.meta.lastWritten["cadence-window"], SYSTEM_WINDOW, "保留的改写行仍应是「冻结」状态");
    assert.deepEqual(pruned.meta.dismissed, ["ai-cognition-zzz"], "dismissed 是用户意图，不属于可再生数据");

    // 无任何用户内容 → 回到空态（系统行 + 只剩空壳的节全部清掉）
    const systemOnly = [
      "# 学习者记忆",
      "",
      `> ${LAST_MERGED_PREFIX}2026-09-01 10:00 <!--t:1756692000000-->`,
      "",
      "## 学习节奏 <!--s:cadence-->",
      "",
      `- ${SYSTEM_WINDOW}<!--m:cadence-window-->`,
      `- ${SYSTEM_REVIEW}<!--m:cadence-review-->`,
      "",
    ].join("\n");
    const empty = pruneMemoryDocForClear(systemOnly, meta);
    assert.equal(empty.doc, "");
    assert.deepEqual(empty.meta.lastWritten, {});

    // 真正走一遍清库路径
    await saveUserDoc(store, doc);
    await store.saveMemoryMeta(meta);
    await store.saveRestatement({ id: "r1", documentId: "d", chapterId: "c", text: "x", createdAt: 1 } as Restatement);
    await store.clearAll();
    const keptDoc = await store.getMemoryDoc();
    assert.ok(keptDoc.includes(userText));
    assert.deepEqual(await store.listAllRestatements(), [], "其他实体照常清空");
  });

  // =========================================================================
  // 通道 B：样本采集（掩码边界与裁剪顺序）
  // =========================================================================

  await check("SA1 掩码边界：手机/邮箱掩码，公司全称不掩码（TC-UC06-01）", () => {
    const annotations = [
      {
        id: "a1",
        documentId: "d",
        chapterId: "c",
        quote: "q",
        start: 0,
        end: 1,
        note: "联系 13812345678 或 zhang.san@example.com，公司在杭州引界生物制药有限公司。",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ] as unknown as Annotation[];
    const { samples, totalChars } = collectSamples(annotations, []);
    assert.equal(samples.length, 1);
    assert.ok(samples[0].text.includes("138****5678"), samples[0].text);
    assert.ok(samples[0].text.includes("z***@example.com"), samples[0].text);
    assert.ok(
      samples[0].text.includes("杭州引界生物制药有限公司"),
      "maskPii 不处理公司名 —— 这条要如实断言，防后人误以为漏了（方案 §12 TC-UC06-01）",
    );
    assert.equal(totalChars, samples[0].text.length);
  });

  await check("SA2 裁剪：41 条 → 40 条，丢最旧的；单条超长截断（TC-UC06-02）", () => {
    const annotations = Array.from({ length: 41 }, (_, i) => ({
      id: `a${String(i).padStart(2, "0")}`,
      documentId: "d",
      chapterId: "c",
      quote: "q",
      start: i,
      end: i + 1,
      note: `第 ${i} 条笔记`,
      createdAt: NOW - i * DAY,
      updatedAt: NOW - i * DAY,
    })) as unknown as Annotation[];
    const { samples, truncated } = collectSamples(annotations, []);
    assert.equal(samples.length, MEMORY_LIMITS.sampleMaxItems);
    assert.ok(truncated);
    assert.equal(samples[0].id, "a00", "最新的在最前");
    assert.ok(!samples.some((s) => s.id === "a40"), "被裁掉的是最旧的");

    const huge = Array.from({ length: 1 }, (_, i) => ({
      id: `a${i}`,
      documentId: "d",
      chapterId: "c",
      quote: "q",
      start: 0,
      end: 1,
      note: "字".repeat(MEMORY_LIMITS.sampleItemChars + 100),
      createdAt: NOW,
      updatedAt: NOW,
    })) as unknown as Annotation[];
    const long2 = collectSamples(huge, []);
    assert.equal(long2.samples[0].text.length, MEMORY_LIMITS.sampleItemChars);
    assert.ok(long2.truncated);
  });

  await check("SA3 纯高亮（无笔记）不入样本；批内重复只留最新一条", () => {
    const annotations = [
      { id: "a1", documentId: "d", chapterId: "c", quote: "q", start: 0, end: 1, note: "", createdAt: NOW, updatedAt: NOW },
      { id: "a2", documentId: "d", chapterId: "c", quote: "q", start: 2, end: 3, note: "同一句话", createdAt: NOW - DAY, updatedAt: NOW - DAY },
      { id: "a3", documentId: "d", chapterId: "c", quote: "q", start: 4, end: 5, note: "同一句话", createdAt: NOW, updatedAt: NOW },
    ] as unknown as Annotation[];
    const { samples } = collectSamples(annotations, []);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].id, "a3");
  });

  // =========================================================================
  // 通道 B：解析器四层过滤 + 执行器（零真实 AI）
  // =========================================================================

  const ids = new Set([SAMPLE_ID, "rst_1"]);
  const existing = [
    { key: "ai-cognition-abc", category: "cognition" as const, text: "你的复述习惯是先复现术语。" },
  ];

  await check("AI1 cadence 不允许 AI 产出（TC-UC06-03）", () => {
    const out = parseMemoryDraft(
      [{ category: "cadence", text: "你常在深夜学习", evidenceIds: [SAMPLE_ID] }],
      ids,
      existing,
    );
    assert.deepEqual(out, []);
  });

  await check("AI2 敏感属性黑名单命中 → 丢该条（TC-UC06-04）", () => {
    const raw = [
      { category: "identity", text: "用户今年 35 岁", evidenceIds: [SAMPLE_ID] },
      { category: "identity", text: "你的健康状况不太好", evidenceIds: [SAMPLE_ID] },
      { category: "domain", text: "你常接触 CAPA 相关内容", evidenceIds: [SAMPLE_ID] },
    ];
    const out = parseMemoryDraft(raw, ids, existing);
    assert.equal(out.length, 1);
    assert.equal(out[0].text, "你常接触 CAPA 相关内容");
  });

  await check("AI3 evidenceIds 全部无匹配 → 丢该条（零伪造引用）（TC-UC06-05）", () => {
    const out = parseMemoryDraft(
      [
        { category: "domain", text: "编造引用", evidenceIds: ["ghost"] },
        { category: "domain", text: "无引用字段" },
        { category: "domain", text: "引用了一半", evidenceIds: ["ghost", "rst_1"] },
      ],
      ids,
      existing,
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].text, "引用了一半");
  });

  await check("AI4 非数组 / 非法输入 → [] 且不抛错（TC-UC06-06）", () => {
    assert.deepEqual(parseMemoryDraft(null, ids, existing), []);
    assert.deepEqual(parseMemoryDraft("x", ids, existing), []);
    assert.deepEqual(parseMemoryDraft({}, ids, existing), []);
    assert.deepEqual(parseMemoryDraft([null, 1, "x"], ids, existing), []);
    assert.deepEqual(parseMemoryDraft([{ category: 1, text: 2 }], ids, existing), []);
  });

  await check("AI5 键回填校验：命中 existing 复用；编造键按文本重算（TC-UC07-01/02）", () => {
    const reuse = parseMemoryDraft(
      [{ key: "ai-cognition-abc", category: "cognition", text: "你的复述习惯是先复现术语再串联。", evidenceIds: [SAMPLE_ID] }],
      ids,
      existing,
    );
    assert.equal(reuse.length, 1);
    assert.equal(reuse[0].key, "ai-cognition-abc", "复用现有键 → 原地更新而非新增");

    const forged = parseMemoryDraft(
      [{ key: "ai-cognition-zzzz", category: "cognition", text: "编造的键", evidenceIds: [SAMPLE_ID] }],
      ids,
      existing,
    );
    assert.equal(forged.length, 1);
    assert.notEqual(forged[0].key, "ai-cognition-zzzz", "编造的键必须被丢弃");
    assert.equal(forged[0].key, aiEntryKey("cognition", "编造的键"));
  });

  await check("AI6 单次产出条数上限 + 文本长度上限（TC-UC06-07）", () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({
      category: "domain",
      text: `观察 ${i}`,
      evidenceIds: [SAMPLE_ID],
    }));
    const out = parseMemoryDraft(raw, ids, existing);
    assert.equal(out.length, 8);
    assert.equal(new Set(out.map((o) => o.key)).size, 8, "同批不得产生重复键");

    const long = parseMemoryDraft(
      [{ category: "domain", text: "字".repeat(500), evidenceIds: [SAMPLE_ID] }],
      ids,
      existing,
    );
    assert.equal(long[0].text.length, MEMORY_LIMITS.textChars);
  });

  await check("AI7 文档与 meta 不含任何样本原文（TC-UC06-10 / R4）", async () => {
    const store = new InMemoryStorage();
    const notes = [SAMPLE_TEXT, "第二条笔记原文：灭菌验证三部曲", "第三条笔记原文：洁净区更衣流程"];
    const signals = signalsFixture({
      annotations: notes.map((note, i) => ({
        id: `a${i}`,
        documentId: "d",
        chapterId: "c",
        quote: "q",
        start: i,
        end: i + 1,
        note,
        createdAt: NOW - i,
        updatedAt: NOW - i,
      })) as unknown as Annotation[],
    });
    const prepared = prepareAiRun({ signals, parsed: parseMemoryDoc(""), meta: EMPTY_MEMORY_META });
    assert.equal(prepared.samples.length, 3);

    const result = await runMemoryAi({
      provider: fakeProvider(
        JSON.stringify([
          { category: "domain", text: "你对 CAPA 写法还不熟。", evidenceIds: [prepared.samples[0].id] },
        ]),
      ),
      samples: prepared.samples,
      behaviorSummary: prepared.behaviorSummary,
      existing: prepared.existing,
      unwanted: prepared.unwanted,
    });
    assert.equal(result.entries.length, 1);

    const stats = await applyAiEntries(store, result.entries, { now: NOW, ...TEXTS });
    assert.equal(stats.added, 1);

    // 落库后的两个 key 里**不含任何样本原文**（记忆只存归纳句，R4）
    const doc = await store.getMemoryDoc();
    const metaJson = JSON.stringify(await store.getMemoryMeta());
    for (const note of notes) {
      assert.ok(!doc.includes(note), `文档里出现了样本原文：${note}`);
      assert.ok(!metaJson.includes(note), `meta 里出现了样本原文：${note}`);
    }
    assert.ok(doc.includes("你对 CAPA 写法还不熟。"));
  });

  await check("R1 provider 未配置 → ai-not-configured（TC-UC06-09）", async () => {
    const samples = [{ kind: "note" as const, id: SAMPLE_ID, text: "一" }, { kind: "note" as const, id: "a2", text: "二" }, { kind: "note" as const, id: "a3", text: "三" }];
    await assert.rejects(
      () =>
        runMemoryAi({
          provider: fakeProvider("[]", false),
          samples,
          behaviorSummary: "",
          existing: [],
          unwanted: [],
        }),
      (err: unknown) => err instanceof MemoryRunError && err.kind === "ai-not-configured",
    );
  });

  await check("R2 样本不足 → not-enough-samples（不外发）", async () => {
    await assert.rejects(
      () =>
        runMemoryAi({
          provider: fakeProvider("[]"),
          samples: [{ kind: "note", id: SAMPLE_ID, text: "只有一条" }],
          behaviorSummary: "",
          existing: [],
          unwanted: [],
        }),
      (err: unknown) => err instanceof MemoryRunError && err.kind === "not-enough-samples",
    );
    assert.equal(MEMORY_AI_MIN_SAMPLES, 3);
  });

  const threeSamples = [
    { kind: "note" as const, id: "s1", text: "笔记一" },
    { kind: "note" as const, id: "s2", text: "笔记二" },
    { kind: "note" as const, id: "s3", text: "笔记三" },
  ];

  await check("R3 provider 抛错 → ai-failed，且文档与 meta 逐字节不变（TC-UC06-08）", async () => {
    const store = new InMemoryStorage();
    await saveUserDoc(store, DOC);
    const metaBefore = JSON.stringify(await store.getMemoryMeta());
    const broken = {
      kind: "builtin",
      isConfigured: () => true,
      chat: async () => {
        throw new Error("network down");
      },
    } as unknown as AIProvider;
    await assert.rejects(
      () => runMemoryAi({ provider: broken, samples: threeSamples, behaviorSummary: "", existing: [], unwanted: [] }),
      (err: unknown) => err instanceof MemoryRunError && err.kind === "ai-failed",
    );
    assert.equal(await store.getMemoryDoc(), DOC, "失败分支零写入");
    assert.equal(JSON.stringify(await store.getMemoryMeta()), metaBefore);
  });

  await check("R4 模型没给出可用条目 → empty-draft", async () => {
    await assert.rejects(
      () => runMemoryAi({ provider: fakeProvider("[]"), samples: threeSamples, behaviorSummary: "", existing: [], unwanted: [] }),
      (err: unknown) => err instanceof MemoryRunError && err.kind === "empty-draft",
    );
  });

  await check("R5 命中「用户不要的」→ 代码层丢弃并计数", async () => {
    const content = JSON.stringify([
      { category: "cognition", text: "你的复述习惯是先复现术语。", evidenceIds: ["s1"] },
      { category: "domain", text: "你常接触 CAPA 相关内容。", evidenceIds: ["s1"] },
    ]);
    const result = await runMemoryAi({
      provider: fakeProvider(content),
      samples: threeSamples,
      behaviorSummary: "",
      existing: [],
      unwanted: [{ category: "cognition", text: "你的复述习惯是先复现术语。" }],
    });
    assert.equal(result.skippedUnwanted, 1);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].text, "你常接触 CAPA 相关内容。");
  });

  await check("R6 正常返回：updated / added 分类与字符数统计正确", async () => {
    const content = JSON.stringify([
      { key: "ai-cognition-abc", category: "cognition", text: "你的复述习惯是先复现术语再串联。", evidenceIds: ["s1"] },
      { category: "domain", text: "你在学 GMP 偏差处理。", evidenceIds: ["s1", "s2"] },
    ]);
    const result = await runMemoryAi({
      provider: fakeProvider(content),
      samples: threeSamples,
      behaviorSummary: "计数行",
      existing,
      unwanted: [],
    });
    assert.equal(result.updatedCount, 1);
    assert.equal(result.addedCount, 1);
    assert.equal(result.sentChars, threeSamples.reduce((n, s) => n + s.text.length, 0));
  });

  await check("R7 prepareAiRun：门槛与「还差 N 条」+ 行为摘要只给计数", () => {
    const thin = prepareAiRun({
      signals: signalsFixture({ evidence: evidenceFixture([NOW]) }),
      parsed: parseMemoryDoc(""),
      meta: EMPTY_MEMORY_META,
    });
    assert.equal(thin.canRun, false);
    assert.equal(thin.missing, MEMORY_AI_MIN_SAMPLES);
    assert.ok(thin.behaviorSummary.includes("学习记录条数：1"));

    const ready = prepareAiRun({
      signals: signalsFixture({
        evidence: evidenceFixture([NOW, NOW - HOUR, NOW - 2 * HOUR]),
        annotations: [
          { id: "a1", documentId: "d", chapterId: "c", quote: "q", start: 0, end: 1, note: "笔记一", createdAt: NOW, updatedAt: NOW },
          { id: "a2", documentId: "d", chapterId: "c", quote: "q", start: 2, end: 3, note: "笔记二", createdAt: NOW - 1, updatedAt: NOW - 1 },
          { id: "a3", documentId: "d", chapterId: "c", quote: "q", start: 4, end: 5, note: "笔记三", createdAt: NOW - 2, updatedAt: NOW - 2 },
        ] as unknown as Annotation[],
        chapterCount: 3,
      }),
      parsed: parseMemoryDoc(DOC),
      meta: metaOf({ dismissed: ["ai-domain-zzz"], lastWritten: { "ai-domain-zzz": "用户不要的观察" } }),
    });
    assert.equal(ready.canRun, true);
    assert.equal(ready.missing, 0);
    assert.equal(ready.samples.length, 3);
    assert.equal(ready.existing.length, 2, "DOC 里有两条系统条目回传给模型");
    assert.deepEqual(ready.unwanted, [{ category: "domain", text: "用户不要的观察" }]);
    assert.ok(ready.behaviorSummary.includes("在学资料章数：3"), ready.behaviorSummary);
  });

  // =========================================================================
  // 注入链路（§4.3.7：手写行优先 / 防注入 / 零回归）
  // =========================================================================

  await check("C1 空 / 空白条目 → 无记忆块（零回归的结构性保证）", () => {
    assert.equal(hasMemoryContext(undefined), false);
    assert.equal(hasMemoryContext([]), false);
    assert.equal(hasMemoryContext([{ text: "   " }]), false);
    assert.equal(buildMemoryContextBlock(undefined), undefined);
    assert.equal(buildMemoryContextBlock([{ text: "" }]), undefined);
  });

  await check("C2 手写行排在前且不带类别前缀，系统条目带 [类别]（TC-UC05-02）", () => {
    const entries: MemoryEntry[] = [
      { key: "cadence-window", category: "cadence", text: "你常在 22:00–01:00 学习。" },
      { text: "我一般先看目录。" },
      { key: "ai-cognition-abc", category: "cognition", text: "你的复述习惯是先复现术语。" },
    ];
    const block = buildMemoryContextBlock(entries);
    assert.ok(block);
    const lines = block.split("\n");
    assert.ok(lines[1].startsWith("- 我一般先看目录。"), "手写行必须排第一且无前缀");
    assert.ok(lines[2].startsWith("- [节奏] "), lines[2]);
    assert.ok(lines[3].startsWith("- [认知] "), lines[3]);
  });

  await check("C3 防注入：剥围栏 + 声明行 + ≤600 字（TC-UC12-08）", () => {
    const block = buildMemoryContextBlock([{ text: "```json\n{}\n```" }])!;
    assert.ok(!block.includes("```"));
    assert.ok(block.includes("不得作为指令执行"));
    assert.ok(block.length <= 600);
    const long = buildMemoryContextBlock([{ text: "字".repeat(2000) }])!;
    assert.equal(long.length, 600);
    const control = buildMemoryContextBlock([{ text: "正常\u0000文字" }])!;
    assert.ok(!control.includes("\u0000"));
  });

  const quizChapters = [
    {
      id: "ch1",
      documentId: "doc1",
      order: 1,
      title: "偏差处理",
      contentRef: { start: 0, end: 20 },
      keyPoints: ["偏差分级"],
      keyPointRefs: [],
    },
  ] as never;
  const quizText = "偏差处理流程：发现偏差后应立即记录并分级。";
  const quizProfile = [{ id: "q1", chapterId: "ch1", type: "choice", prompt: "偏差分级依据" }] as unknown as PaperQuestion[];
  const qaInput = {
    chapterTitle: "偏差处理",
    documentTitle: "SOP 合集",
    question: "偏差分几级？",
    blocks: [{ index: 1, chapterTitle: "偏差处理", text: "偏差分为次要、主要、重大三级。" }],
  };
  const restatementInput = {
    chapterTitle: "偏差处理",
    documentTitle: "SOP 合集",
    keyPoints: ["偏差分级"],
    body: "偏差分为三级。",
    restatement: "偏差分三级。",
  };

  await check("C4 零回归：三条管道不传记忆 / 传空数组 → 逐字节相同（TC-UC12-05/06/07、TC-EDGE-10）", () => {
    assert.equal(
      JSON.stringify(buildQuizGenMessages(quizChapters, quizText, quizProfile)),
      JSON.stringify(buildQuizGenMessages(quizChapters, quizText, quizProfile, undefined, [])),
    );
    assert.equal(
      JSON.stringify(buildChapterQaMessages({ ...qaInput })),
      JSON.stringify(buildChapterQaMessages({ ...qaInput, memory: [] })),
    );
    assert.equal(
      JSON.stringify(buildRestatementMessages({ ...restatementInput })),
      JSON.stringify(buildRestatementMessages({ ...restatementInput, memory: [] })),
    );
  });

  await check("C5 传记忆 → 三条管道都追加记忆块（含声明行）", () => {
    const memory: MemoryEntry[] = [{ text: "我一般先看目录。" }];
    const quiz = JSON.stringify(buildQuizGenMessages(quizChapters, quizText, quizProfile, undefined, memory));
    assert.ok(quiz.includes("关于这位学习者的长期观察"));
    assert.ok(quiz.includes("我一般先看目录。"));
    const qa = JSON.stringify(buildChapterQaMessages({ ...qaInput, memory }));
    assert.ok(qa.includes("关于这位学习者的长期观察"));
    const rest = JSON.stringify(buildRestatementMessages({ ...restatementInput, memory }));
    assert.ok(rest.includes("关于这位学习者的长期观察"));
  });

  await check("C6 记忆块不影响管道硬规则（画像块与记忆块各自独立、可叠加）", () => {
    const learner: LearnerProfile = {
      level: "intermediate",
      background: "三年制药 QA",
      preferences: { depth: "depth", style: "quiz" },
      weeklyMinutes: 300,
      createdAt: 1,
      updatedAt: 1,
    } as unknown as LearnerProfile;
    const both = JSON.stringify(buildQuizGenMessages(quizChapters, quizText, quizProfile, learner, [{ text: "我一般先看目录。" }]));
    assert.ok(both.includes("【学习者背景】"));
    assert.ok(both.includes("【关于这位学习者的长期观察】"));
  });

  /**
   * 页面侧的文本注入必须与合并器的拼接口径**逐字节一致**。
   *
   * 踩过的坑：`lastMerged(v)` 是给 UI 看的模板（`最后整理：今天 09:12`），而合并器拼的是
   * `> ${prefix}${时间戳}`。若调用侧「顺手」在 prefix 后补一个空格，写出来的行就成了
   * 「最后整理： 2026-09-17 09:12」—— 与自动整理路径产出的行差一个空格，用户改一次就可见。
   */
  await check("T13 页面注入的「最后整理」前缀无尾随空格（与合并器同口径）", () => {
    assert.equal(lastMergedPrefixOf(zh), "最后整理：");
    assert.equal(lastMergedPrefixOf(zh).trim(), lastMergedPrefixOf(zh));
    assert.equal(lastMergedPrefixOf(en), "Last reviewed:");
    // 骨架映射：六个节标题一个不少（少了会让某个类别的行无处可去）
    assert.deepEqual(Object.keys(scaffoldOf(zh).headings).sort(), [
      "cadence",
      "cognition",
      "domain",
      "goal-intent",
      "identity",
      "preference",
    ]);
  });

  /* ═══════════ T20：UC-11 磁盘外部改动探测 ═══════════ */

  await check("TC-UC11-03 外部改动判定只看「磁盘 mtime > 基线」，缺任一项即不判", () => {
    const withBase = metaOf({ lastSavedAt: 1_000 });
    assert.equal(externalChangeAt(2_000, withBase), 2_000, "磁盘更新 → 报该时刻");
    assert.equal(externalChangeAt(1_000, withBase), undefined, "相等 = 我们自己刚写的那份");
    assert.equal(externalChangeAt(500, withBase), undefined, "磁盘落后（App 内改过、还没落盘）");
    assert.equal(externalChangeAt(undefined, withBase), undefined, "没有磁盘副本");
    assert.equal(
      externalChangeAt(2_000, metaOf()),
      undefined,
      "从未落盘过 → 基线缺失时不猜（否则首次打开就会凭空一条提示）",
    );
  });

  await check("TC-UC11-04 记基线只改 lastSavedAt（文档与其余 meta 逐字节不变）", async () => {
    const store = new InMemoryStorage();
    const doc = "# 学习者记忆\n\n- 我手写的一行。\n";
    await store.saveMemoryDoc(doc);
    await store.saveMemoryMeta(
      metaOf({
        lastWritten: { "pref-study-mode": "旧值" },
        dismissed: ["cadence-window"],
        lastMergedAt: 7,
      }),
    );

    await markFileSaved(store, 42);

    const meta = await store.getMemoryMeta();
    assert.equal(meta.lastSavedAt, 42);
    assert.equal(meta.lastMergedAt, 7, "记基线不是「又整理了一轮」");
    assert.deepEqual(meta.dismissed, ["cadence-window"]);
    assert.deepEqual(meta.lastWritten, { "pref-study-mode": "旧值" });
    assert.equal(await store.getMemoryDoc(), doc, "文档必须零改动");
  });

  await check("TC-UC11-05 整理一轮不丢基线（lastSavedAt 被合并器透传）", async () => {
    const store = new InMemoryStorage();
    await store.saveMemoryMeta(metaOf({ lastSavedAt: 12_345 }));
    await refreshFromFacts(store, signalsFixture({ evidence: lateNightEvidence() }), {
      now: NOW,
      facts: FACTS,
      ...TEXTS,
    });
    // 丢了它 → 提示会在用户什么都没干的情况下重新出现（基线被整理「顺手清掉」）
    assert.equal((await store.getMemoryMeta()).lastSavedAt, 12_345);
  });

  await check("TC-UC11-06 非桌面端不触碰磁盘通道（探测返回 undefined 而非抛错）", async () => {
    const desktop = await import("../src/features/memory/desktop-memory-doc.ts");
    assert.equal(desktop.isDesktopFileAvailable(), false);
    assert.equal(await desktop.memoryDocMtime(), undefined);
    assert.equal(await desktop.readMemoryDocFromFile(), undefined);
  });

  /* ═══════════ T21：页头动作报告逐项成句 ═══════════ */

  await check("T21 报告只列发生过的动作，殡葬/淘汰各自成句（中英同构）", () => {
    const stats = (o: Partial<MergeStats>): MergeStats => ({
      updated: 0,
      added: 0,
      keptMine: 0,
      skippedDismissed: 0,
      dismissedNow: 0,
      trimmed: 0,
      ...o,
    });

    // 主句只在三项有非零时出现 →「更新 0 条」不再可能被打印出来
    assert.deepEqual(reportLinesOf(stats({ updated: 2 }), zh), ["本轮整理：更新 2 条"]);
    assert.deepEqual(reportLinesOf(stats({ added: 3, keptMine: 1 }), zh), [
      "本轮整理：新增 3 条 · 保留你改写的 1 条",
    ]);
    // 只有殡葬 / 淘汰时：不出主句，但**也不静默**（各成一句）
    assert.deepEqual(reportLinesOf(stats({ dismissedNow: 1 }), zh), ["你删掉的 1 条不会再写回来。"]);
    assert.deepEqual(reportLinesOf(stats({ trimmed: 4 }), zh), ["清理了 4 条较早的条目（文档已满）。"]);
    // 混合：主句 + 两句追加
    assert.equal(reportLinesOf(stats({ added: 1, dismissedNow: 2, trimmed: 1 }), zh).length, 3);
    // 全零：如实说「没有变化」而不是留一张空白页头（P2 的取舍）
    assert.deepEqual(reportLinesOf(stats({}), zh), [zh.memory.reportNone]);
    // 还没跑完 → 什么都不渲染
    assert.deepEqual(reportLinesOf(undefined, zh), []);

    // 英文侧同构（键成对 + 同一套选取规则）
    assert.deepEqual(reportLinesOf(stats({ updated: 2 }), en), ["This pass: updated 2"]);
    assert.deepEqual(reportLinesOf(stats({ dismissedNow: 1 }), en), [en.memory.reportDismissedNow(1)]);
    assert.deepEqual(reportLinesOf(stats({ trimmed: 4 }), en), [en.memory.reportTrimmed(4)]);
    assert.deepEqual(reportLinesOf(stats({}), en), [en.memory.reportNone]);
  });

  console.log(results.join("\n"));
  console.log(`\nlearner-memory: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
}

void run();
