/**
 * T5 · 双语字典对齐保障（docs/i18n-design-2026-09.md §7 T5）。
 *
 * 运行（Node 22 + 类型剥离直跑，见 package.json `test:i18n`）：
 *   node --experimental-strip-types --import ./tests/register-loader.mjs tests/i18n-alignment.test.ts
 *
 * 覆盖：
 *  1) zh/en 字典递归结构对齐（缺键 / 多键 / 叶子类型不一 → 抛错）；
 *  2) 叶子不允许空字符串（防漏翻 placeholder）；
 *  3) detectSystemLang 分支（zh-* → zh，其余 → en）；
 *  4) 引擎默认中文不回退 + 注入 en 后产出英文（learning-planner / assessment-engine / loop）。
 */
import assert from "node:assert/strict";
import { zh } from "../src/i18n/messages/zh.ts";
import { en } from "../src/i18n/messages/en.ts";
import { detectSystemLang } from "../src/i18n/detect.ts";
import {
  buildChapterPlan,
  createLearningPlanner,
} from "../src/engine/learning-planner.ts";
import { createAssessmentEngine } from "../src/engine/assessment-engine.ts";
import { runLearningLoop } from "../src/engine/loop.ts";

const HAS_HAN = /[\p{Script=Han}]/u;
const results: string[] = [];
let failures = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ---------------- 1) zh/en 结构对齐 ---------------- */

type Shape = Record<string, unknown>;

function shapeOf(value: unknown): Shape {
  if (value === null || typeof value !== "object") {
    return { $leaf: typeof value === "function" ? "fn" : typeof value };
  }
  const out: Shape = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = shapeOf((value as Record<string, unknown>)[key]);
  }
  return out;
}

check("zh/en 字典递归结构一致（缺键/多键/叶子类型）", () => {
  assert.deepEqual(shapeOf(en), shapeOf(zh), "en 与 zh 结构不齐");
});

/* ---------------- 2) 叶子非空 ---------------- */

function walkLeaves(value: unknown, path: string, lang: "zh" | "en"): void {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && value.trim().length === 0) {
      throw new Error(`[${lang}] 空字符串叶子：${path}`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    walkLeaves(child, path ? `${path}.${key}` : key, lang);
  }
}

check("zh/en 叶子无空字符串", () => {
  walkLeaves(zh, "", "zh");
  walkLeaves(en, "", "en");
});

/* ---------------- 3) detect 分支 ---------------- */

function withNavigator(lang: string, fn: () => void): boolean {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    Object.defineProperty(globalThis, "navigator", {
      value: { language: lang, userAgent: "node-test" },
      configurable: true,
      writable: true,
    });
    fn();
    return true;
  } catch {
    return false; // 当前运行时不允许替换 navigator，跳过该子断言
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as Record<string, unknown>).navigator;
  }
}

check("detectSystemLang：zh-* → zh，其余 → en", () => {
  assert.ok(["zh", "en"].includes(detectSystemLang()), "返回值必须是 zh|en");
  const stubbed = withNavigator("zh-CN", () =>
    assert.equal(detectSystemLang(), "zh"),
  );
  if (stubbed) {
    withNavigator("zh-TW", () => assert.equal(detectSystemLang(), "zh"));
    withNavigator("zh-Hans-SG", () => assert.equal(detectSystemLang(), "zh"));
    withNavigator("en-US", () => assert.equal(detectSystemLang(), "en"));
    withNavigator("ja-JP", () => assert.equal(detectSystemLang(), "en"));
  }
});

/* ---------------- 4) 引擎默认中文 / 注入 en ---------------- */

const GOAL = {
  id: "g-test",
  type: "study",
  title: "测试目标",
  importance: "high",
  requiredUnitIds: ["u1"],
  createdAt: 0,
};
const GRAPH = {
  units: [
    { id: "u1", title: "测试概念", kind: "concept", tags: [], createdAt: 0 },
  ],
  relations: [],
};
const LEARNER = { byUnit: {} };

check("createLearningPlanner() 默认中文（不回退英文）", () => {
  const actions = createLearningPlanner().buildPlan({ goal: GOAL, graph: GRAPH, learnerState: LEARNER });
  assert.ok(actions.length > 0, "应有缺口动作");
  const first = actions[0].reasons[0] ?? "";
  assert.equal(first, zh.engine.goalRequired({ title: GOAL.title, importance: GOAL.importance }));
  assert.ok(HAS_HAN.test(first), "默认应产出中文");
});

check("createLearningPlanner(en) 注入英文", () => {
  const actions = createLearningPlanner(en).buildPlan({
    goal: { ...GOAL, title: "Goal Alpha" },
    graph: { units: [{ id: "u1", title: "Concept A", kind: "concept", tags: [], createdAt: 0 }], relations: [] },
    learnerState: LEARNER,
  });
  const all = actions.flatMap((a) => a.reasons).join(" ");
  assert.ok(!HAS_HAN.test(all), "en 注入后不应含中文");
  assert.ok(all.length > 0, "应产出英文 reason");
});

const CHAPTER = {
  id: "c1",
  order: 1,
  title: "TypeScript 基础",
  status: "learning",
  unitIds: ["u1"],
  documentId: "d1",
};

check("buildChapterPlan() 默认中文 / (en) 英文", () => {
  const zhPlan = buildChapterPlan({ chapters: [CHAPTER], learnerState: LEARNER });
  assert.ok(zhPlan.length > 0);
  assert.equal(
    zhPlan[0].reasons[0],
    zh.engine.chapterNotStarted(CHAPTER.title),
  );
  const enPlan = buildChapterPlan(
    { chapters: [{ ...CHAPTER, title: "TypeScript Basics" }], learnerState: LEARNER },
    en,
  );
  assert.equal(
    enPlan[0].reasons[0],
    en.engine.chapterNotStarted("TypeScript Basics"),
  );
  assert.ok(!HAS_HAN.test(enPlan[0].reasons.join(" ")));
});

const QUESTION = {
  id: "q1",
  unitId: "u1",
  type: "understanding",
  cognitiveLevel: "understand",
  prompt: "Explain",
  referenceAnswer: "ref",
};

check("assessment-engine 未作答 feedback：默认中文 / (en) 英文", async () => {
  const zhEval = await createAssessmentEngine().evaluate(QUESTION, { content: "   " });
  assert.equal(zhEval.feedback, zh.engine.notAnswered);
  const enEval = await createAssessmentEngine(undefined, en).evaluate(QUESTION, { content: "   " });
  assert.equal(enEval.feedback, en.engine.notAnswered);
});

check("loop 无目标错误：默认中文 / (en) 英文", async () => {
  // 空 storage：listGoals 恒空 → seed 空转（save* 均 noop）→ 仍无目标 → 抛错。
  const emptyStorage = {
    listGoals: async () => [],
    saveGoal: async () => {},
    saveGraph: async () => {},
    saveLearnerState: async () => {},
    saveDocument: async () => {},
  } as never;
  await assert.rejects(
    runLearningLoop(emptyStorage, "missing", zh),
    (err: unknown) => err instanceof Error && err.message === zh.engine.goalNotFound,
    "默认应抛中文目标缺失错误",
  );
  await assert.rejects(
    runLearningLoop(emptyStorage, "missing", en),
    (err: unknown) => err instanceof Error && err.message === en.engine.goalNotFound,
    "注入 en 应抛英文目标缺失错误",
  );
});

/* ---------------- 汇总 ---------------- */

console.log(`\n[i18n-alignment] ${results.length - failures}/${results.length} 通过\n`);
for (const line of results) console.log("  " + line);

if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exitCode = 1;
}
