/**
 * F6 · 目标级能力评测 —— 六态 / 落库顺序 / 零伪造锚定 / 判定聚合 / 存储级联 单测。
 * （docs/goal-capability-assessment-design-2026-09.md §12 TC-UC01~10 / TC-EDGE-01~13 / TC-REG-01~05）
 *
 * 运行（Node 22 + 类型剥离直跑，见 package.json `test:capability`）：
 *   npm run test:capability
 *
 * 零真实网络 / 零真实模型：AI 一律用假 provider（按调用顺序发预置 JSON）。
 * **不 import 任何 `.tsx` 与 React** —— strip-types 不支持 JSX。
 * 故 TC-REG-04（`HomePage.logToView`）无法在此断言，改由代码复核覆盖（runbook T7 记录）。
 */
import assert from "node:assert/strict";
import type { AIProvider } from "../src/ai/types.ts";
import {
  CAPABILITY_ITEMS_SYSTEM,
  CAPABILITY_SCORE_SYSTEM,
  CAPABILITY_TASKS_SYSTEM,
  buildCapabilityScoreMessages,
  parseCapabilityItemsDraft,
  parseCapabilityScoreDraft,
  parseCapabilityTasksDraft,
  toIndexedItems,
} from "../src/ai/capability.ts";
import { PIPELINE_LIMITS } from "../src/ai/pipeline-core.ts";
import type { CapabilityItem, CapabilityReport, Chapter, LearningGoal, SourceDocument } from "../src/domain/index.ts";
import { capabilityItemId, snapshotItems } from "../src/domain/index.ts";
import {
  buildReport,
  CAPABILITY_LIMITS,
  CAPABILITY_THRESHOLD,
  capabilityStatsOf,
  clampScore,
  coverageGaps,
  createGoalPaper,
  createRetakePaper,
  normalizeWeights,
  overallScore,
  scoreOfItem,
  verdictOf,
} from "../src/engine/index.ts";
import { evidenceActionKey } from "../src/features/evidence-label.ts";
import {
  anchorCapabilityEvidence,
  latestCapabilityReport,
  listGoalCapabilityItems,
  listGoalCapabilityReports,
  listGoalCapabilityRuns,
  objectiveStageOf,
  proposeCapabilityItems,
  saveCapabilityItemsForGoal,
  saveManualCapabilityItems,
  startCapabilityRun,
  submitCapabilityRun,
} from "../src/features/goals/capability-service.ts";
import { zh } from "../src/i18n/messages/zh.ts";
import { en } from "../src/i18n/messages/en.ts";
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

/* ---------------- fixtures ---------------- */

const NOW = 1_700_000_000_000;

const DOC: SourceDocument = {
  id: "d1",
  title: "检索技术资料",
  format: "txt",
  importedAt: 1,
  status: "ready",
  textPreview: "检索质量决定回答上限。",
};
const DOC2: SourceDocument = {
  id: "d2",
  title: "第二份资料",
  format: "txt",
  importedAt: 2,
  status: "ready",
  textPreview: "另一份资料的正文。",
};

function mkChapter(
  documentId: string,
  id: string,
  order: number,
  keyPoints: string[] = ["检索质量", "分块粒度"],
): Chapter {
  return {
    id,
    documentId,
    order,
    title: `第 ${order} 章`,
    contentRef: { start: 0, end: 10 },
    keyPoints,
    unitIds: [],
    status: "learning",
    createdAt: 1,
  };
}

/** d1：三章（满足阶段 1 出卷的 ≥3 章条件）。d2：两章（跨文档干扰项回归用）。 */
const CH1 = mkChapter("d1", "c1", 1);
const CH2 = mkChapter("d1", "c2", 2, ["重排序", "初筛"]);
const CH3 = mkChapter("d1", "c3", 3, ["召回率", "精确率"]);
const CH4 = mkChapter("d2", "c4", 1, ["第二份资料要点 A"]);
const CH5 = mkChapter("d2", "c5", 2, ["第二份资料要点 B"]);

const GOAL: LearningGoal = {
  id: "g1",
  type: "career",
  title: "成为检索工程师",
  importance: "high",
  requiredUnitIds: [],
  requiredChapterIds: ["c1", "c2", "c3"],
  createdAt: 1,
};
const GOAL2: LearningGoal = {
  id: "g2",
  type: "study",
  title: "另一个目标",
  importance: "medium",
  requiredUnitIds: [],
  requiredChapterIds: ["c4"],
  createdAt: 1,
};
/** 空范围目标（用于 TC-EDGE-02 的全库无章分支）。 */
const GOAL_EMPTY: LearningGoal = {
  id: "g-empty",
  type: "personal",
  title: "空范围目标",
  importance: "low",
  requiredUnitIds: [],
  createdAt: 1,
};

async function seeded(): Promise<InMemoryStorage> {
  const store = new InMemoryStorage();
  await store.saveDocument(DOC);
  await store.saveDocument(DOC2);
  await store.saveChapters(DOC.id, [CH1, CH2, CH3]);
  await store.saveChapters(DOC2.id, [CH4, CH5]);
  await store.saveGoal(GOAL);
  await store.saveGoal(GOAL2);
  return store;
}

/** 只装章、不装目标的存储（TC-EDGE-02 用）。 */
async function chaptersOnly(): Promise<InMemoryStorage> {
  const store = new InMemoryStorage();
  await store.saveDocument(DOC);
  await store.saveChapters(DOC.id, [CH1, CH2, CH3]);
  return store;
}

/** 假 provider：按 `chat` 调用顺序依次返回预置 JSON（用尽 → 抛错）。 */
function queuedProvider(replies: readonly string[]): {
  provider: AIProvider;
  calls: { chat: number };
} {
  const calls = { chat: 0 };
  const provider: AIProvider = {
    kind: "custom",
    isConfigured: () => true,
    chat: async () => {
      const reply = replies[calls.chat];
      calls.chat += 1;
      if (reply === undefined) throw new Error("测试未预置该次调用的回复");
      return { content: reply };
    },
  };
  return { provider, calls };
}

/** 未配置 provider（阻断门）。 */
function deadProvider(): AIProvider {
  return {
    kind: "custom",
    isConfigured: () => false,
    chat: () => Promise.reject(new Error("不应被调用")),
  };
}

/** 已配置但调用即失败（模拟「评分时 AI 失效」）。 */
function throwingProvider(): AIProvider {
  return { ...queuedProvider([]).provider, chat: () => Promise.reject(new Error("模型挂了")) };
}

const ITEMS_REPLY_3 = JSON.stringify({
  items: [
    { label: "能拆解检索需求", description: "能把模糊需求拆成可验证的子问题" },
    { label: "能选择分块策略", description: "能按语料特征决定块粒度" },
    { label: "能评估检索质量", description: "能用指标判断召回与精确的取舍" },
  ],
});
const ITEMS_REPLY_8 = JSON.stringify({
  items: Array.from({ length: 8 }, (_, i) => ({ label: `能力项 ${i + 1}` })),
});
const ITEMS_REPLY_DIRTY = JSON.stringify({
  items: [{ label: "能拆解检索需求" }, { label: "能拆解检索需求" }, { label: "  " }, { label: "能评估检索质量" }],
});

const TASKS_REPLY = JSON.stringify({
  tasks: [
    {
      prompt: "给一个模糊的检索需求，写出你的拆解与取舍。",
      deliverableHint: "分点作答，给出理由",
      itemIndexes: [1],
      criteria: ["说明拆解步骤", "给出取舍理由"],
    },
    {
      prompt: "给一份语料，说明你如何选择分块粒度并如何评估效果。",
      deliverableHint: "给出策略与指标",
      itemIndexes: [2, 3],
      criteria: ["说明块粒度选择依据", "给出质量评估口径"],
    },
  ],
});

/** 作答原文（≥ answerMinChars），且含可逐字锚定的句子。 */
const ANSWER_1 =
  "我先把需求拆成三个可验证的子问题，再按语料特征选择分块策略，最后用离线指标评估召回与精确的取舍。";
const ANSWER_2 =
  "我会先看语料的段落结构与术语密度，再按块粒度选择切分策略，最后用带标注的问题集评估检索质量。";
const QUOTE_1 = "按块粒度选择切分策略";
const QUOTE_2 = "用带标注的问题集评估检索质量";

function scoreReply(): string {
  return JSON.stringify({
    scores: [
      { itemIndex: 1, score: 0.9, rationale: "拆解清晰", quotes: [QUOTE_1] },
      { itemIndex: 2, score: 0.85, rationale: "粒度依据充分", quotes: [QUOTE_2] },
      { itemIndex: 3, score: 0.8, rationale: "评估口径完整", quotes: [QUOTE_2] },
    ],
  });
}

/** 直接切片校验引用区间（零伪造的硬断言）。 */
function assertSlicesBack(text: string, quote: string, start: number, end: number): void {
  assert.equal(text.slice(start, end), quote);
}

/* ---------------- 主流程 ---------------- */

async function main(): Promise<void> {
  /* ===== TC-UC01 · AI 提炼能力项 ===== */

  await check("TC-UC01-01 提炼 3 项 → ok / source=ai / 已落库", async () => {
    const store = await seeded();
    const { provider, calls } = queuedProvider([ITEMS_REPLY_3]);
    const out = await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(out.status, "ok");
    if (out.status !== "ok") return;
    assert.equal(out.data.items.length, 3);
    assert.equal(out.data.truncated, false);
    assert.ok(out.data.items.every((i) => i.source === "ai"));
    assert.equal(calls.chat, 1);
    assert.equal((await store.listCapabilityItems(GOAL.id)).length, 3);
  });

  await check("TC-UC01-02 提炼 8 项 → 截断到 6 且 truncated=true", async () => {
    const store = await seeded();
    const { provider } = queuedProvider([ITEMS_REPLY_8]);
    const out = await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(out.status, "ok");
    if (out.status !== "ok") return;
    assert.equal(out.data.items.length, PIPELINE_LIMITS.capabilityItemMax);
    assert.equal(out.data.truncated, true);
  });

  await check("TC-UC01-03 空 label 丢弃 + 重复 label 去重", async () => {
    const store = await seeded();
    const { provider } = queuedProvider([ITEMS_REPLY_DIRTY]);
    const out = await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(out.status, "ok");
    if (out.status !== "ok") return;
    assert.equal(out.data.items.length, 2);
    assert.deepEqual(
      out.data.items.map((i) => i.label),
      ["能拆解检索需求", "能评估检索质量"],
    );
  });

  await check("TC-UC01-04 空 items → error{parse} 且不覆盖已有清单", async () => {
    const store = await seeded();
    const manual = await saveManualCapabilityItems({
      goalId: GOAL.id,
      labels: ["既有能力 A"],
      storage: store,
      now: NOW,
    });
    assert.equal(manual.status, "ok");
    const { provider } = queuedProvider([JSON.stringify({ items: [] })]);
    const out = await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(out.status, "error");
    if (out.status !== "error") return;
    assert.equal(out.errorKind, "parse");
    const kept = await store.listCapabilityItems(GOAL.id);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].label, "既有能力 A");
  });

  await check("TC-UC01-05 解析：非对象输入 → 空草稿（绝不抛错）", () => {
    assert.deepEqual(parseCapabilityItemsDraft(null), { items: [] });
    assert.deepEqual(parseCapabilityItemsDraft("字符串"), { items: [] });
  });

  /* ===== TC-UC02 · 手动维护 ===== */

  await check("TC-UC02-01 saveManualCapabilityItems 三项落库（manual / weight 1 / 默认阈值）", async () => {
    const store = await seeded();
    const out = await saveManualCapabilityItems({
      goalId: GOAL.id,
      labels: ["A 能力", "B 能力", "C 能力"],
      storage: store,
      now: NOW,
    });
    assert.equal(out.status, "ok");
    if (out.status !== "ok") return;
    assert.equal(out.data.length, 3);
    assert.ok(out.data.every((i) => i.source === "manual"));
    assert.ok(out.data.every((i) => i.weight === 1));
    assert.ok(out.data.every((i) => i.threshold === CAPABILITY_THRESHOLD));
    assert.deepEqual(
      out.data.map((i) => i.createdAt),
      [NOW, NOW + 1, NOW + 2],
    );
  });

  await check("TC-UC02-02 空串被跳过；全部空 → no-items；超上限 → error{generic}", async () => {
    const store = await seeded();
    const mixed = await saveManualCapabilityItems({
      goalId: GOAL.id,
      labels: ["有效项", "   ", ""],
      storage: store,
      now: NOW,
    });
    assert.equal(mixed.status, "ok");
    if (mixed.status === "ok") assert.equal(mixed.data.length, 1);

    const empty = await saveManualCapabilityItems({
      goalId: GOAL.id,
      labels: ["  ", ""],
      storage: store,
      now: NOW,
    });
    assert.equal(empty.status, "no-items");

    const tooMany = await saveManualCapabilityItems({
      goalId: GOAL.id,
      labels: Array.from({ length: CAPABILITY_LIMITS.maxItems + 1 }, (_, i) => `项 ${i}`),
      storage: store,
      now: NOW,
    });
    assert.equal(tooMany.status, "error");
    if (tooMany.status === "error") assert.equal(tooMany.errorKind, "generic");
  });

  await check("TC-UC02-03 同 label 重存保留既有 weight / threshold", async () => {
    const store = await seeded();
    const first = await saveManualCapabilityItems({
      goalId: GOAL.id,
      labels: ["可调项"],
      storage: store,
      now: NOW,
    });
    assert.equal(first.status, "ok");
    if (first.status !== "ok") return;
    const tuned: CapabilityItem = { ...first.data[0], weight: 3, threshold: 0.5 };
    const saved = await saveCapabilityItemsForGoal(GOAL.id, [tuned], store);
    assert.equal(saved.status, "ok");
    const again = await saveManualCapabilityItems({
      goalId: GOAL.id,
      labels: ["可调项", "新增项"],
      storage: store,
      now: NOW + 100,
    });
    assert.equal(again.status, "ok");
    if (again.status !== "ok") return;
    const kept = again.data.find((i) => i.label === "可调项");
    assert.equal(kept?.weight, 3);
    assert.equal(kept?.threshold, 0.5);
  });

  /* ===== TC-UC03 · 完整两阶段评测 ===== */

  await check("TC-UC03-01 端到端：报告逐项有 verdict / overall 有值 / 卷已落库 / run=scored", async () => {
    const store = await seeded();
    const { provider, calls } = queuedProvider([
      ITEMS_REPLY_3,
      TASKS_REPLY,
      scoreReply(),
      scoreReply(),
    ]);
    const proposed = await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(proposed.status, "ok");
    const started = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(started.status, "ok");
    if (started.status !== "ok") return;
    const { run, paperId } = started.data;
    assert.ok(paperId, "范围 3 章应出客观卷");
    assert.equal(run.tasks.length, 2);
    assert.equal(run.status, "draft");

    // 阶段 1 判卷结果（模拟用户已答完客观卷）
    await store.savePaperResult({
      paperId: paperId!,
      totalScore: 0.72,
      perChapter: {},
      wrongQuestions: [],
      createdAt: NOW,
    });

    const submitted = await submitCapabilityRun({
      runId: run.id,
      answers: { [run.tasks[0].id]: ANSWER_1, [run.tasks[1].id]: ANSWER_2 },
      storage: store,
      provider,
      now: NOW,
    });
    assert.equal(submitted.status, "ok");
    if (submitted.status !== "ok") return;
    const { report, run: scored } = submitted.data;
    assert.equal(scored.status, "scored");
    assert.equal(report.items.length, 3);
    assert.ok(report.items.every((s) => s.verdict === "pass"));
    assert.equal(report.approved, true);
    assert.ok(report.overall !== undefined);
    assert.equal(report.objective?.paperId, paperId);
    assert.equal(report.objective?.totalScore, 0.72);
    assert.equal(report.uncoveredItemIds.length, 0);
    assert.equal(calls.chat, 4); // 提炼 1 + 出任务 1 + 逐任务评分 2

    // 引用可切片还原（零伪造）：每条 quote 必须能在某份作答里逐字找到
    for (const s of report.items) {
      for (const q of s.evidence) {
        assert.ok(
          ANSWER_1.includes(q.quote) || ANSWER_2.includes(q.quote),
          `引文无法在作答原文中定位：${q.quote}`,
        );
      }
    }
  });

  await check("TC-UC03-02 证据流末行 = capability / subjectKind=goal / delta=0", async () => {
    const store = await seeded();
    const { provider } = queuedProvider([ITEMS_REPLY_3, TASKS_REPLY, scoreReply(), scoreReply()]);
    await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    const started = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(started.status, "ok");
    if (started.status !== "ok") return;
    const run = started.data.run;
    const out = await submitCapabilityRun({
      runId: run.id,
      answers: { [run.tasks[0].id]: ANSWER_1, [run.tasks[1].id]: ANSWER_2 },
      storage: store,
      provider,
      now: NOW,
    });
    assert.equal(out.status, "ok");
    if (out.status !== "ok") return;
    const evidence = await store.listEvidence();
    const last = evidence[0];
    assert.equal(last.kind, "capability");
    assert.equal(last.subjectKind, "goal");
    assert.equal(last.subjectId, GOAL.id);
    assert.equal(last.delta, 0);
    assert.equal(last.sourceId, out.data.report.id);
    assert.equal(last.verdict, "pass");
  });

  /* ===== TC-UC04 · 零伪造引用 ===== */

  await check("TC-UC04-01 一条可锚一条不可锚 → 只留可锚那条，区间切片还原原文", () => {
    const answer = `先写清楚背景。${QUOTE_1}。再补一句总结。`;
    const perTask = anchorCapabilityEvidence({
      taskId: "t1",
      answer,
      draft: {
        scores: [
          {
            itemId: "cap_x",
            score: 0.7,
            rationale: "部分覆盖",
            quotes: [QUOTE_1, "被改写过的句子"],
          },
        ],
      },
    });
    assert.equal(perTask.length, 1);
    assert.equal(perTask[0].evidence.length, 1);
    assertSlicesBack(answer, perTask[0].evidence[0].quote, perTask[0].evidence[0].start, perTask[0].evidence[0].end);
    assert.equal(perTask[0].unanchored, undefined);
  });

  await check("TC-UC04-02 全部锚不上 → evidence 空 + unanchored，分数与理由保留", () => {
    const perTask = anchorCapabilityEvidence({
      taskId: "t1",
      answer: "这段作答里没有任何被引用的句子。",
      draft: {
        scores: [
          { itemId: "cap_x", score: 0.6, rationale: "勉强覆盖", quotes: ["不存在的句子 A", "不存在的句子 B"] },
        ],
      },
    });
    assert.equal(perTask[0].evidence.length, 0);
    assert.equal(perTask[0].unanchored, true);
    assert.equal(perTask[0].score, 0.6);
    assert.equal(perTask[0].rationale, "勉强覆盖");
  });

  await check("TC-UC04-03 模型输出越界 itemIndex → 丢该条；clamp 越界分", () => {
    const items = [{ id: "cap_a" }, { id: "cap_b" }];
    const draft = parseCapabilityScoreDraft(
      { scores: [
        { itemIndex: 9, score: 0.9, quotes: [] },
        { itemIndex: 1, score: 1.6, quotes: [] },
        { itemIndex: 2, score: -0.4, quotes: ["  ", "x"] },
        { itemIndex: 2, score: 0.5, quotes: [] },
      ] },
      items,
    );
    assert.equal(draft.scores.length, 2);
    assert.equal(draft.scores[0].itemId, "cap_a");
    assert.equal(draft.scores[0].score, 1);
    assert.equal(draft.scores[1].itemId, "cap_b");
    assert.equal(draft.scores[1].score, 0);
    assert.deepEqual(draft.scores[1].quotes, ["x"]);
  });

  await check("TC-UC04-04 模型越出 rubric 给分 → 丢弃（防「假因果」）", () => {
    const answer = `作答里含 ${QUOTE_1}。`;
    const perTask = anchorCapabilityEvidence({
      taskId: "t1",
      answer,
      itemIds: ["cap_a"], // 本任务只考察 cap_a
      draft: {
        scores: [
          { itemId: "cap_a", score: 0.8, quotes: [QUOTE_1] },
          { itemId: "cap_b", score: 0.95, quotes: [QUOTE_1] }, // 越权 → 丢
        ],
      },
    });
    assert.equal(perTask.length, 1);
    assert.equal(perTask[0].itemId, "cap_a");
  });

  /* ===== TC-UC05 · 覆盖缺口 ===== */

  await check("TC-UC05-01 4 项只覆盖 3 项 → unknown 不进分母 / uncovered=1", () => {
    const items = ["a", "b", "c", "d"].map((k, i) => ({
      id: `cap_${k}`,
      label: `能力 ${k}`,
      weight: 1,
      threshold: 0.8,
      createdAt: i,
    }));
    const perTask = [
      { taskId: "t1", itemId: "cap_a", score: 0.9, evidence: [] },
      { taskId: "t1", itemId: "cap_b", score: 0.85, evidence: [] },
      { taskId: "t1", itemId: "cap_c", score: 0.4, evidence: [] },
    ];
    const report = buildReport({ goalId: "g", runId: "r", items, perTask, now: NOW });
    assert.equal(report.uncoveredItemIds.length, 1);
    assert.equal(report.uncoveredItemIds[0], "cap_d");
    const d = report.items.find((s) => s.itemId === "cap_d");
    assert.equal(d?.verdict, "unknown");
    assert.equal(d?.score, undefined);
    // 分母 = 3（a/b/c），不是 4
    assert.ok(Math.abs((report.overall ?? 0) - (0.9 + 0.85 + 0.4) / 3) < 1e-9);
    assert.equal(report.approved, false);
  });

  await check("TC-UC05-02 无任何覆盖 → 全 unknown / overall undefined / approved false", () => {
    const items = [{ id: "cap_a", label: "A", weight: 1, threshold: 0.8, createdAt: 0 }];
    const report = buildReport({ goalId: "g", runId: "r", items, perTask: [], now: NOW });
    assert.equal(report.items[0].verdict, "unknown");
    assert.equal(report.overall, undefined);
    assert.equal(report.approved, false);
    assert.equal(overallScore(items, report.items), undefined);
    assert.deepEqual(coverageGaps(items, []), ["cap_a"]);
  });

  await check("TC-UC05-03 纯函数：聚合 / 判定边界 / 权重归一 / clamp", () => {
    // 跨任务算术平均
    const agg = scoreOfItem(
      [
        { taskId: "t1", itemId: "a", score: 0.6 },
        { taskId: "t2", itemId: "a", score: 1 },
      ],
      "a",
    );
    assert.equal(agg?.score, 0.8);
    assert.deepEqual(agg?.fromTaskIds, ["t1", "t2"]);
    assert.equal(scoreOfItem([], "a"), undefined);
    // 阈值含等号
    assert.equal(verdictOf(0.8, 0.8), "pass");
    assert.equal(verdictOf(0.79, 0.8), "fail");
    assert.equal(verdictOf(undefined, 0.8), "unknown");
    // 权重全 0 → 均分
    const w = normalizeWeights([
      { id: "a", label: "A", weight: 0, threshold: 0.8 },
      { id: "b", label: "B", weight: 0, threshold: 0.8 },
    ]);
    assert.deepEqual(w.map((i) => i.weight), [0.5, 0.5]);
    // clamp
    assert.equal(clampScore(-1), 0);
    assert.equal(clampScore(2), 1);
    assert.equal(clampScore(Number.NaN), 0);
  });

  /* ===== TC-UC06 · 无 AI 诚实降级（零写入） ===== */

  await check("TC-UC06-01 未配置 AI → 提炼与发起均 no-ai，且零写入", async () => {
    const store = await seeded();
    const dead = deadProvider();
    const a = await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider: dead, now: NOW });
    const b = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider: dead, now: NOW });
    assert.equal(a.status, "no-ai");
    assert.equal(b.status, "no-ai");
    assert.equal((await store.listCapabilityItems(GOAL.id)).length, 0);
    assert.equal((await store.listCapabilityRuns(GOAL.id)).length, 0);
    assert.equal((await store.listPapers()).length, 0);
  });

  await check("TC-UC06-02 提交时 AI 失效 → run 不落库（保留原 draft）", async () => {
    const store = await seeded();
    const { provider } = queuedProvider([ITEMS_REPLY_3, TASKS_REPLY]);
    await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    const started = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(started.status, "ok");
    if (started.status !== "ok") return;
    const run = started.data.run;
    const out = await submitCapabilityRun({
      runId: run.id,
      answers: { [run.tasks[0].id]: ANSWER_1, [run.tasks[1].id]: ANSWER_2 },
      storage: store,
      provider: deadProvider(),
      now: NOW,
    });
    assert.equal(out.status, "no-ai");
    const persisted = await store.getCapabilityRun(run.id);
    assert.equal(persisted?.status, "draft");
    assert.equal(persisted?.submittedAt, undefined);
    assert.equal((await store.listCapabilityReports(GOAL.id)).length, 0);
  });

  /* ===== TC-UC07 · 重评 ===== */

  await check("TC-UC07-01 加 1 项后重评 → 两份报告，旧报告仍按旧快照渲染", async () => {
    const store = await seeded();
    const { provider } = queuedProvider([
      ITEMS_REPLY_3,
      TASKS_REPLY,
      scoreReply(),
      scoreReply(),
      TASKS_REPLY,
      scoreReply(),
      scoreReply(),
    ]);
    await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    const first = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(first.status, "ok");
    if (first.status !== "ok") return;
    const r1 = await submitCapabilityRun({
      runId: first.data.run.id,
      answers: { [first.data.run.tasks[0].id]: ANSWER_1, [first.data.run.tasks[1].id]: ANSWER_2 },
      storage: store,
      provider,
      now: NOW,
    });
    assert.equal(r1.status, "ok");
    if (r1.status !== "ok") return;

    // 追加一项能力项 → 重评
    const items = await store.listCapabilityItems(GOAL.id);
    await saveCapabilityItemsForGoal(
      GOAL.id,
      [...items, { ...items[0], id: capabilityItemId(GOAL.id, "新增能力"), label: "新增能力", createdAt: NOW + 9 }],
      store,
    );
    const second = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW + 50 });
    assert.equal(second.status, "ok");
    if (second.status !== "ok") return;
    const r2 = await submitCapabilityRun({
      runId: second.data.run.id,
      answers: { [second.data.run.tasks[0].id]: ANSWER_1, [second.data.run.tasks[1].id]: ANSWER_2 },
      storage: store,
      provider,
      now: NOW + 60,
    });
    assert.equal(r2.status, "ok");
    if (r2.status !== "ok") return;

    const reports = await listGoalCapabilityReports(GOAL.id, store);
    assert.equal(reports.length, 2);
    assert.equal(reports[0].id, r2.data.report.id); // createdAt 降序
    const old = reports.find((r) => r.id === r1.data.report.id);
    assert.equal(old?.items.length, 3); // 旧报告仍是旧框架
    assert.equal(r2.data.report.items.length, 4);
    assert.equal((await latestCapabilityReport(GOAL.id, store))?.items.length, 4);
  });

  /* ===== TC-UC08 · 目标删除级联 ===== */

  await check("TC-UC08-01 deleteGoal 级联清 items/runs/reports，其他目标不受影响", async () => {
    const store = await seeded();
    const { provider } = queuedProvider([ITEMS_REPLY_3, TASKS_REPLY, scoreReply(), scoreReply()]);
    await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    const started = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(started.status, "ok");
    if (started.status !== "ok") return;
    await submitCapabilityRun({
      runId: started.data.run.id,
      answers: { [started.data.run.tasks[0].id]: ANSWER_1, [started.data.run.tasks[1].id]: ANSWER_2 },
      storage: store,
      provider,
      now: NOW,
    });
    // g2 也放一点数据
    await saveManualCapabilityItems({ goalId: GOAL2.id, labels: ["另一个目标的能力"], storage: store, now: NOW });
    assert.equal((await store.listCapabilityItems(GOAL.id)).length, 3);
    assert.equal((await store.listCapabilityRuns(GOAL.id)).length, 1);
    assert.equal((await store.listCapabilityReports(GOAL.id)).length, 1);

    await store.deleteGoal(GOAL.id);
    assert.equal((await store.listCapabilityItems(GOAL.id)).length, 0);
    assert.equal((await store.listCapabilityRuns(GOAL.id)).length, 0);
    assert.equal((await store.listCapabilityReports(GOAL.id)).length, 0);
    assert.equal((await store.listCapabilityItems(GOAL2.id)).length, 1);
    assert.deepEqual((await store.listGoals()).map((g) => g.id).sort(), ["g2"]);
  });

  await check("TC-REG-05 无能力数据的目标删除 → 空操作不抛错（幂等）", async () => {
    const store = await seeded();
    await store.deleteGoal(GOAL2.id);
    await store.deleteGoal(GOAL2.id); // 二次删除同样不抛
    await store.deleteCapabilityDataByGoal(GOAL2.id);
    assert.equal((await store.listCapabilityItems(GOAL2.id)).length, 0);
  });

  /* ===== TC-UC09 / UC10 · 摘要与证据接线 ===== */

  await check("TC-UC09-01 capabilityStatsOf 与报告同源（rate / uncovered）", () => {
    const items = ["a", "b", "c"].map((k, i) => ({
      id: `cap_${k}`,
      label: k,
      weight: 1,
      threshold: 0.8,
      createdAt: i,
    }));
    const report = buildReport({
      goalId: "g",
      runId: "r",
      items,
      perTask: [
        { taskId: "t1", itemId: "cap_a", score: 0.9, evidence: [] },
        { taskId: "t1", itemId: "cap_b", score: 0.5, evidence: [] },
      ],
      now: NOW,
    });
    const stats = capabilityStatsOf(report);
    assert.equal(stats.total, 3);
    assert.equal(stats.passed, 1);
    assert.ok(Math.abs(stats.rate - 1 / 3) < 1e-9);
    assert.equal(stats.uncovered, 1);
    assert.equal(stats.approved, false);
    // 无报告 → 中性零值（UI「尚未评测」）
    assert.deepEqual(capabilityStatsOf(undefined), {
      total: 0,
      passed: 0,
      rate: 0,
      approved: false,
      uncovered: 0,
    });
  });

  await check("TC-UC10-01 evidenceActionKey('capability') 映射 + zh/en 键齐备", () => {
    assert.equal(evidenceActionKey("capability"), "capability");
    assert.equal(zh.units.action.capability.length > 0, true);
    assert.equal(en.units.action.capability.length > 0, true);
  });

  /* ===== TC-EDGE · 边界与回归 ===== */

  await check("TC-EDGE-01 能力项 0 项发起评测 → no-items，不建 run", async () => {
    const store = await seeded();
    const { provider, calls } = queuedProvider([TASKS_REPLY]);
    const out = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(out.status, "no-items");
    assert.equal(calls.chat, 0);
    assert.equal((await store.listCapabilityRuns(GOAL.id)).length, 0);
    assert.equal((await store.listPapers()).length, 0);
  });

  await check("TC-EDGE-02 未圈定范围且全库无章 → no-material", async () => {
    const store = new InMemoryStorage();
    await store.saveGoal(GOAL_EMPTY);
    const { provider } = queuedProvider([ITEMS_REPLY_3]);
    const out = await proposeCapabilityItems({
      goalId: GOAL_EMPTY.id,
      storage: store,
      provider,
      now: NOW,
    });
    assert.equal(out.status, "no-material");
  });

  await check("TC-EDGE-02b 显式范围已失效（章不存在）→ no-scope", async () => {
    const store = new InMemoryStorage(); // 无任何文档 / 章
    await store.saveGoal(GOAL);
    const { provider } = queuedProvider([ITEMS_REPLY_3]);
    const out = await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(out.status, "no-scope");
  });

  await check("TC-EDGE-03 范围 ≥3 章 → 出卷且 scope.mode = final-test", async () => {
    const store = await seeded();
    const { provider } = queuedProvider([ITEMS_REPLY_3, TASKS_REPLY]);
    await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    const out = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(out.status, "ok");
    if (out.status !== "ok") return;
    const papers = await store.listPapers();
    assert.equal(papers.length, 1);
    assert.equal(papers[0].scope.mode, "final-test");
    assert.deepEqual(papers[0].scope.chapterIds, ["c1", "c2", "c3"]);
    assert.equal(papers[0].id, out.data.paperId);
    // 「客观摸底卷」：不出主观题（本地可判，不依赖 AI 批改）
    assert.ok(papers[0].questions.every((q) => q.type === "choice" || q.type === "judge"));
  });

  await check("TC-EDGE-04 范围 <3 章 → 无 paperId，run 仍返回（阶段 1 skipped）", async () => {
    const store = await seeded();
    await store.saveGoal({ ...GOAL, id: "g-small", requiredChapterIds: ["c1", "c2"] });
    const { provider } = queuedProvider([ITEMS_REPLY_3, TASKS_REPLY]);
    await proposeCapabilityItems({ goalId: "g-small", storage: store, provider, now: NOW });
    const out = await startCapabilityRun({ goalId: "g-small", storage: store, provider, now: NOW });
    assert.equal(out.status, "ok");
    if (out.status !== "ok") return;
    assert.equal(out.data.paperId, undefined);
    assert.equal(out.data.run.paperId, undefined);
    const stage = await objectiveStageOf(out.data.run, store);
    assert.equal(stage.status, "skipped");
    assert.equal((await store.listPapers()).length, 0);
  });

  await check("TC-EDGE-09 部分任务空作答 → 允许提交，空任务项按「依据不足」计 0", async () => {
    const store = await seeded();
    const { provider } = queuedProvider([ITEMS_REPLY_3, TASKS_REPLY, scoreReply()]);
    await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    const started = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(started.status, "ok");
    if (started.status !== "ok") return;
    const run = started.data.run;
    // 任务 1 空作答（不调 AI）；任务 2 正常作答
    const out = await submitCapabilityRun({
      runId: run.id,
      answers: { [run.tasks[0].id]: "", [run.tasks[1].id]: ANSWER_2 },
      storage: store,
      provider,
      now: NOW,
    });
    assert.equal(out.status, "ok");
    if (out.status !== "ok") return;
    const item2 = out.data.report.items.find((s) => s.itemId === run.tasks[0].rubric[0].itemId);
    assert.equal(item2?.score, 0);
    assert.equal(item2?.verdict, "fail");
    assert.equal(item2?.unanchored, true);
    assert.equal(item2?.evidence.length, 0);
  });

  await check("TC-EDGE-09b 全部任务作答均低于下限 → error{generic}", async () => {
    const store = await seeded();
    const { provider } = queuedProvider([ITEMS_REPLY_3, TASKS_REPLY]);
    await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    const started = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(started.status, "ok");
    if (started.status !== "ok") return;
    const run = started.data.run;
    const out = await submitCapabilityRun({
      runId: run.id,
      answers: { [run.tasks[0].id]: "太短", [run.tasks[1].id]: "也太短" },
      storage: store,
      provider,
      now: NOW,
    });
    assert.equal(out.status, "error");
    if (out.status === "error") assert.equal(out.errorKind, "generic");
  });

  await check("TC-EDGE-10 评分中途失败 → error，但 run 已 collected 且作答完整", async () => {
    const store = await seeded();
    const { provider } = queuedProvider([ITEMS_REPLY_3, TASKS_REPLY]);
    await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    const started = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(started.status, "ok");
    if (started.status !== "ok") return;
    const run = started.data.run;
    const out = await submitCapabilityRun({
      runId: run.id,
      answers: { [run.tasks[0].id]: ANSWER_1, [run.tasks[1].id]: ANSWER_2 },
      storage: store,
      provider: throwingProvider(),
      now: NOW,
    });
    assert.equal(out.status, "error");
    if (out.status === "error") assert.equal(out.errorKind, "fetch");
    const persisted = await store.getCapabilityRun(run.id);
    assert.equal(persisted?.status, "collected");
    assert.equal(persisted?.answers[run.tasks[0].id], ANSWER_1);
    assert.equal(persisted?.answers[run.tasks[1].id], ANSWER_2);
    assert.equal((await store.listCapabilityReports(GOAL.id)).length, 0);
  });

  await check("TC-EDGE-11 capabilityItemId 确定性（同 goal + 同 label 同 id）", () => {
    assert.equal(capabilityItemId("g1", "能力 A"), capabilityItemId("g1", "能力 A"));
    assert.notEqual(capabilityItemId("g1", "能力 A"), capabilityItemId("g2", "能力 A"));
    assert.notEqual(capabilityItemId("g1", "能力 A"), capabilityItemId("g1", "能力 A "));
  });

  await check("TC-EDGE-12 报告同 id 重复保存 → upsert，不产生重复行", async () => {
    const store = await seeded();
    const report: CapabilityReport = {
      id: "cap_report_x",
      goalId: GOAL.id,
      runId: "r1",
      items: [],
      approved: false,
      uncoveredItemIds: [],
      createdAt: NOW,
    };
    await store.saveCapabilityReport(report);
    await store.saveCapabilityReport({ ...report, overall: 0.5 });
    const list = await store.listCapabilityReports(GOAL.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].overall, 0.5);
  });

  await check("TC-EDGE-13 阶段 1 pending 时提交 → 照常出报告，判定不受影响", async () => {
    const store = await seeded();
    const { provider } = queuedProvider([ITEMS_REPLY_3, TASKS_REPLY, scoreReply(), scoreReply()]);
    await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    const started = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(started.status, "ok");
    if (started.status !== "ok") return;
    const run = started.data.run;
    const stage = await objectiveStageOf(run, store);
    assert.equal(stage.status, "pending"); // 卷已建、未判卷
    const out = await submitCapabilityRun({
      runId: run.id,
      answers: { [run.tasks[0].id]: ANSWER_1, [run.tasks[1].id]: ANSWER_2 },
      storage: store,
      provider,
      now: NOW,
    });
    assert.equal(out.status, "ok");
    if (out.status !== "ok") return;
    // 报告不合成客观分；「阶段 1 未完成」由 objectiveStageOf(run) 承载
    assert.equal(out.data.report.objective, undefined);
    assert.ok(out.data.report.items.every((s) => s.verdict === "pass"));
    assert.equal((await objectiveStageOf(out.data.run, store)).status, "pending");
  });

  await check("TC-EDGE-14 阶段 1 已判卷 → 报告 objective 记录参考分（不入判定）", async () => {
    const store = await seeded();
    const { provider } = queuedProvider([ITEMS_REPLY_3, TASKS_REPLY, scoreReply(), scoreReply()]);
    await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    const started = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(started.status, "ok");
    if (started.status !== "ok") return;
    const run = started.data.run;
    await store.savePaperResult({
      paperId: run.paperId!,
      totalScore: 0.2,
      perChapter: {},
      wrongQuestions: [],
      createdAt: NOW,
    });
    const out = await submitCapabilityRun({
      runId: run.id,
      answers: { [run.tasks[0].id]: ANSWER_1, [run.tasks[1].id]: ANSWER_2 },
      storage: store,
      provider,
      now: NOW,
    });
    assert.equal(out.status, "ok");
    if (out.status !== "ok") return;
    const done = await objectiveStageOf(out.data.run, store);
    assert.equal(done.status, "done");
    if (done.status === "done") assert.equal(done.totalScore, 0.2);
    // 客观分极低但能力全达标 → 加权总分只由能力项构成（防假因果）
    assert.equal(out.data.report.objective?.totalScore, 0.2);
    assert.ok((out.data.report.overall ?? 0) > 0.8);
    assert.equal(out.data.report.approved, true);
  });

  await check("TC-EDGE-08 模型任务引用全越界 → 整条任务丢弃", () => {
    const items = [{ id: "cap_a" }, { id: "cap_b" }, { id: "cap_c" }];
    const draft = parseCapabilityTasksDraft(
      {
        tasks: [
          { prompt: "越界任务", itemIndexes: [9], criteria: ["c"] },
          { prompt: "合法任务", itemIndexes: [1, 9, 2], criteria: ["c1", "c2"] },
          { prompt: "无 rubric", itemIndexes: [1], criteria: [] },
        ],
      },
      items,
    );
    assert.equal(draft.tasks.length, 1);
    assert.equal(draft.tasks[0].prompt, "合法任务");
    assert.deepEqual(draft.tasks[0].itemIds, ["cap_a", "cap_b"]);
    assert.equal(draft.tasks[0].criteria.length, 2);
  });

  await check("TC-EDGE-15 任务条目数 / criteria 数 / 题面长度均被上限截断", () => {
    const items = Array.from({ length: 4 }, (_, i) => ({ id: `cap_${i}` }));
    const draft = parseCapabilityTasksDraft(
      {
        tasks: Array.from({ length: PIPELINE_LIMITS.capabilityTaskMax + 3 }, (_, i) => ({
          prompt: `任务 ${i}`,
          itemIndexes: [1],
          criteria: ["a", "b", "c", "d", "e", "f"],
        })),
      },
      items,
    );
    assert.equal(draft.tasks.length, PIPELINE_LIMITS.capabilityTaskMax);
    assert.equal(draft.tasks[0].criteria.length, PIPELINE_LIMITS.capabilityTaskCriteriaMax);
  });

  await check("TC-EDGE-16 提示词：能力项编号 1-based，且不含任何偏移量字段", () => {
    const snapshots = snapshotItems([
      {
        id: "cap_a",
        goalId: "g1",
        label: "能力 A",
        weight: 1,
        threshold: 0.8,
        source: "manual",
        createdAt: 0,
      },
    ]);
    const indexed = toIndexedItems(snapshots);
    assert.equal(indexed[0].index, 1);
    assert.equal(indexed[0].id, "cap_a");
    const msgs = buildCapabilityScoreMessages({
      goalTitle: "目标",
      items: indexed,
      tasks: [{ index: 1, prompt: "题面", criteria: ["要点"], answer: "作答" }],
    });
    assert.equal(msgs.length, 2);
    const body = msgs[1].content;
    assert.ok(body.includes("1. 能力 A"));
    assert.ok(!body.includes("start"));
    assert.ok(!body.includes("offset"));
    assert.ok(CAPABILITY_ITEMS_SYSTEM.includes("JSON"));
    assert.ok(CAPABILITY_TASKS_SYSTEM.includes("itemIndexes"));
    assert.ok(CAPABILITY_SCORE_SYSTEM.includes("quotes"));
  });

  /* ===== TC-REG · 回归 ===== */

  await check("TC-REG-01 跑完整评测后 LearnerState 逐字节不变（决策 D5 硬断言）", async () => {
    const store = await seeded();
    const before = JSON.stringify(await store.getLearnerState());
    const { provider } = queuedProvider([ITEMS_REPLY_3, TASKS_REPLY, scoreReply(), scoreReply()]);
    await proposeCapabilityItems({ goalId: GOAL.id, storage: store, provider, now: NOW });
    const started = await startCapabilityRun({ goalId: GOAL.id, storage: store, provider, now: NOW });
    assert.equal(started.status, "ok");
    if (started.status !== "ok") return;
    const run = started.data.run;
    await submitCapabilityRun({
      runId: run.id,
      answers: { [run.tasks[0].id]: ANSWER_1, [run.tasks[1].id]: ANSWER_2 },
      storage: store,
      provider,
      now: NOW,
    });
    assert.equal(JSON.stringify(await store.getLearnerState()), before);
  });

  await check("TC-REG-02 createRetakePaper 行为不变（题量 / 题型 / 干扰项按文档分组）", () => {
    // 跨两文档的补考卷：每章 3 客观、无主观、难度降一档
    const paper = createRetakePaper({
      chapters: [CH1, CH4],
      docChapters: new Map([
        ["d1", [CH1, CH2, CH3]],
        ["d2", [CH4, CH5]],
      ]),
      now: NOW,
    });
    assert.equal(paper.questions.length, 6);
    assert.equal(paper.scope.mode, "retake");
    assert.deepEqual(paper.scope.chapterIds, ["c1", "c4"]);
    assert.ok(paper.questions.every((q) => q.type === "choice" || q.type === "judge"));
    // 干扰项必须来自「各章自己的文档」：d1 的选项不得出现 d2 的要点
    const d1Options = paper.questions
      .filter((q) => q.chapterId === "c1")
      .flatMap((q) => q.options ?? []);
    assert.ok(!d1Options.includes("第二份资料要点 A"));
    const d2Options = paper.questions
      .filter((q) => q.chapterId === "c4")
      .flatMap((q) => q.options ?? []);
    assert.ok(!d2Options.includes("检索质量"));
  });

  await check("TC-REG-02b createGoalPaper = 分组出卷的 final-test 特化", () => {
    const paper = createGoalPaper({
      chapters: [CH1, CH2, CH3, CH4],
      docChapters: new Map([
        ["d1", [CH1, CH2, CH3]],
        ["d2", [CH4, CH5]],
      ]),
      allowSubjective: false,
      now: NOW,
    });
    assert.equal(paper.scope.mode, "final-test");
    // `sortChaptersByOrder` 只按 order 排序（同 order 保持输入序，跨文档会交错）
    assert.deepEqual(paper.scope.chapterIds, ["c1", "c4", "c2", "c3"]);
    assert.ok(paper.questions.length >= 15);
    assert.ok(paper.questions.every((q) => q.type !== "qa" && q.type !== "application"));
    // 空输入 → 空卷不抛错
    assert.equal(createGoalPaper({ chapters: [], now: NOW }).questions.length, 0);
  });

  await check("TC-REG-03 evidenceActionKey 四个旧 kind 映射不变", () => {
    assert.equal(evidenceActionKey("assessment"), "assessment");
    assert.equal(evidenceActionKey("review"), "review-points");
    assert.equal(evidenceActionKey("restatement"), "restatement");
    assert.equal(evidenceActionKey("card"), "card");
  });

  await check("TC-REG-06 只读包装与能力项快照形状", async () => {
    const store = await seeded();
    await saveManualCapabilityItems({ goalId: GOAL.id, labels: ["甲"], storage: store, now: NOW });
    const items = await listGoalCapabilityItems(GOAL.id, store);
    assert.equal(items.length, 1);
    assert.equal(items[0].goalId, GOAL.id);
    assert.equal((await listGoalCapabilityRuns(GOAL.id, store)).length, 0);
    assert.equal((await listGoalCapabilityReports(GOAL.id, store)).length, 0);
    assert.equal((await latestCapabilityReport(GOAL.id, store)), undefined);
    // chaptersOnly 存储：确认 fixture 未污染断言
    assert.equal((await listGoalCapabilityItems(GOAL.id, await chaptersOnly())).length, 0);
  });
}

await main();

for (const line of results) console.log(line);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
