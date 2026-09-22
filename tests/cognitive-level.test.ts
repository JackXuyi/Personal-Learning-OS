/**
 * 「认知层级只有一把尺子」守卫（2026-09-22，隐性债 #11 收口）。
 *
 * 背景：`UnitMastery.cognitiveLevel` 一直被引擎写盘（`learner-model.ts`），却被
 * **唯一关心层级的界面** `AssessmentSession` 无视 —— 后者由 `mastery` **重新推导**
 * 会话起始档位。同一规则两处实现＝两把尺子：`mastery ∈ (0, 0.5)` 时引擎判「记忆」、
 * 界面从「理解」起步。老账「`cognitiveLevel` 零消费」只描述了症状，没说清根因。
 *
 * 收口：次序真源收归 `domain::COGNITIVE_ORDER`（此前 `learner-model.ts` 与
 * `resplit-mastery.ts` **各存一份副本**），测评会话起始档位改读持久化值。
 *
 * 运行（Node 22 + 类型剥离直跑，见 package.json `test:cognitive`）：
 *   npm run test:cognitive
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CognitiveLevel, LearnerState } from "../src/domain/learner.ts";
import {
  COGNITIVE_BASE_LEVEL,
  COGNITIVE_ORDER,
  SESSION_LEVEL_COUNT,
  cognitiveIndexOf,
  sessionLevelIndexOf,
} from "../src/domain/learner.ts";
import { applyEvaluation, applyPaperResult, emptyUnit } from "../src/engine/learner-model.ts";

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

/* ---------------- 源码读取 ---------------- */

/** 读源码并剥掉注释 —— 注释里的**反面引用**会被正则误命中（本仓库已踩过）。 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const LEARNER_MODEL = "src/engine/learner-model.ts";
const RESPLIT = "src/features/learn/resplit-mastery.ts";
const SESSION = "src/features/assessment/AssessmentSession.tsx";
const LOOP = "src/engine/loop.ts";

const NOW = 1_700_000_000_000;
const emptyState: LearnerState = { byUnit: {} };

async function main() {
  /* ---------- ① 次序真源 ---------- */

  await check("TC-COG-01 COGNITIVE_ORDER 是 6 档且由低到高（次序真源）", () => {
    assert.deepEqual(
      [...COGNITIVE_ORDER],
      ["remember", "understand", "apply", "analyze", "evaluate", "create"],
      "次序一旦变动，引擎推进 / 合并取最高 / 会话起始档位三处会同时错位",
    );
  });

  await check("TC-COG-02 初值档 = 次序首档", () => {
    assert.equal(COGNITIVE_BASE_LEVEL, COGNITIVE_ORDER[0], "初值必须与次序首档一致");
  });

  await check("TC-COG-03 cognitiveIndexOf 逐档正确，且未知 / 缺省回退 0（绝不 -1）", () => {
    COGNITIVE_ORDER.forEach((level, i) => {
      assert.equal(cognitiveIndexOf(level), i, `${level} 的序号应为 ${i}`);
    });
    // 返回负数会让调用方的 sort / max 静默把未知档排到最前或最后。
    assert.equal(cognitiveIndexOf(undefined), 0, "缺省应回退 0");
    assert.equal(cognitiveIndexOf("nonsense" as CognitiveLevel), 0, "未知值应回退 0");
    assert.ok(cognitiveIndexOf(undefined) >= 0, "不得返回 -1");
  });

  await check("TC-COG-04 sessionLevelIndexOf 钳到会话覆盖面（前三档）", () => {
    assert.equal(SESSION_LEVEL_COUNT, 3, "会话覆盖面应为 3 档");
    assert.equal(sessionLevelIndexOf("remember"), 0);
    assert.equal(sessionLevelIndexOf("understand"), 1);
    assert.equal(sessionLevelIndexOf("apply"), 2);
    // analyze+ 不在自适应循环内 → 钳到末档，而不是回落到第 0 档。
    assert.equal(sessionLevelIndexOf("analyze"), 2, "越界应钳到末档");
    assert.equal(sessionLevelIndexOf("evaluate"), 2);
    assert.equal(sessionLevelIndexOf("create"), 2);
    assert.equal(sessionLevelIndexOf(undefined), 0);
  });

  await check("TC-COG-05 会话三档 = 次序真源的前 3 档（覆盖面不得脱离真源）", () => {
    assert.deepEqual([...COGNITIVE_ORDER.slice(0, SESSION_LEVEL_COUNT)], [
      "remember",
      "understand",
      "apply",
    ]);
  });

  /* ---------- ② 引擎写路径真的写（持久化值可信） ---------- */

  await check("TC-COG-06 空单元初值 = COGNITIVE_BASE_LEVEL", () => {
    assert.equal(emptyUnit(NOW).cognitiveLevel, COGNITIVE_BASE_LEVEL);
  });

  await check("TC-COG-07 卷面写回：首次高分（0.9）把层级从「记忆」推到「理解」", () => {
    const next = applyPaperResult(
      emptyState,
      "c1",
      { score: 0.9, evidenceCorrect: 1, evidenceTotal: 1 },
      NOW,
    );
    // smoothedMastery(0.9, 0) = 0.585 → correct 且 after ≥ 0.5 且当前是首档 → 理解。
    assert.equal(next.byUnit.c1?.cognitiveLevel, "understand");
  });

  await check("TC-COG-08 测评写回：首次答对不足以晋级（after < 0.5 留在「记忆」）", () => {
    const next = applyEvaluation(
      emptyState,
      "u1",
      { questionId: "e1", correct: true, misconceptionsDetected: [] },
      NOW,
    );
    assert.equal(next.byUnit.u1?.cognitiveLevel, "remember");
  });

  /* ---------- ③ 源码守卫：副本与重推都不得复活 ---------- */

  await check("TC-COG-09 learner-model.ts 不再自留 COGNITIVE_ORDER 副本", () => {
    const src = codeOf(LEARNER_MODEL);
    assert.doesNotMatch(src, /const\s+COGNITIVE_ORDER\b/, "次序副本已删除，不得再定义");
    assert.match(src, /cognitiveIndexOf/, "应改为引用共享的序号函数");
  });

  await check("TC-COG-10 resplit-mastery.ts 不再自留 COGNITIVE_ORDER 副本", () => {
    const src = codeOf(RESPLIT);
    assert.doesNotMatch(src, /const\s+COGNITIVE_ORDER\b/, "次序副本已删除，不得再定义");
    assert.match(src, /cognitiveIndexOf\(/, "合并取最高应走共享的序号函数");
  });

  await check("TC-COG-11 AssessmentSession 起始档位读持久化值，不再按 mastery 重推", () => {
    const src = codeOf(SESSION);
    assert.match(src, /sessionLevelIndexOf\(/, "起始档位应走共享函数");
    assert.match(src, /cognitiveByUnit\[unit\.id\]/, "应读快照透传的持久化认知层级");
    // 旧的两把尺子写法：本地的 levelIndexOf 与「由 mastery 推理解档」。
    assert.doesNotMatch(src, /function\s+levelIndexOf/, "本地序号函数应已删除");
    assert.doesNotMatch(src, /levelIndexOf\("understand"\)/, "旧的 mastery 重推分支应已删除");
    assert.doesNotMatch(src, /from\s*>=\s*0\.8/, "旧的 mastery 阈值分支应已删除");
    // 会话覆盖面仍与次序真源一致（这里是字面量，靠断言锁住）。
    assert.match(
      src,
      /LEVEL_ORDER[^=]*=\s*\[\s*"remember"\s*,\s*"understand"\s*,\s*"apply"\s*\]/,
      "会话三档应仍是 remember / understand / apply",
    );
  });

  await check("TC-COG-12 LoopSnapshot 透传 cognitiveByUnit 且兜底走初值常量", () => {
    const src = codeOf(LOOP);
    assert.match(src, /cognitiveByUnit:\s*Record<string,\s*CognitiveLevel>/, "快照应声明该字段");
    assert.match(src, /cognitiveByUnit\[unit\.id\]\s*=/, "runLearningLoop 应填充它");
    assert.doesNotMatch(src, /\?\?\s*"remember"/, "兜底不得硬编码字面量，应走 COGNITIVE_BASE_LEVEL");
  });

  /* ---------------- 汇总 ---------------- */

  for (const r of results) console.log(r);
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  if (failures > 0) process.exitCode = 1;
}

await main();
