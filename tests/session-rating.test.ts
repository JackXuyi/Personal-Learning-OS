/**
 * 自评写入口径 —— 「四档自评只做调度、不动掌握度」的回归锁。
 *
 * 被锁的口径来自 `stores/useLoopStore.ts::submitAnswer` 的 rating 分支：修前误用
 * `applyRating`（比 `applyKeyPointRating` 多一行 `mastery += step`），与
 * `ChapterReaderPage.tsx::markReviewed`（用 `applyKeyPointRating` + 证据 `delta: 0`）
 * 形成「同一自评动作、两个入口、两种掌握度后果」—— 破坏 V2 双证据原则
 * （章 mastery 的唯一写方是卷面）。
 *
 * 运行（Node 22 + 类型剥离直跑，见 package.json `test:rating`）：
 *   npm run test:rating
 *
 * 两层断言：
 *   ① **引擎层**（纯函数）：真值一律取自 `nextReviewInDays` / `ratingStep`,
 *      不写死数字 —— 常量改了测试不该跟着改（「两把尺子」）。
 *   ② **源码层**：`useLoopStore` 虽是 `.ts`，但它 import zustand/React 生态，
 *      strip-types 直跑会拖入 React；`DeltaBadge` 是 `.tsx`，根本跑不了。
 *      这两处的口径因此用与 `flashcard.test.ts::TC-REG-01` **同一手法**锁死
 *      （读源码 + 正则）—— 本仓库处理「UI 层不变量」的既有惯例。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { LearnerState, SelfRating } from "../src/domain/index.ts";
import {
  applyKeyPointRating,
  applyRating,
  emptyUnit,
  nextReviewInDays,
  ratingStep,
} from "../src/engine/learner-model.ts";
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

/* ---------------- fixtures ---------------- */

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
const RATINGS: readonly SelfRating[] = ["forget", "hard", "good", "easy"];

/** 目标章已有**卷面**证据（attempts>0）；另有一章用于验证「只动目标章」。 */
function stateOf(): LearnerState {
  return {
    byUnit: {
      "ch-1": {
        ...emptyUnit(T0),
        mastery: 0.62,
        confidence: 0.4,
        attempts: 2,
        correctCount: 1,
        lastReviewedAt: T0 - DAY,
        nextReviewAt: T0,
      },
      "ch-2": { ...emptyUnit(T0), mastery: 0.3, attempts: 1, correctCount: 0 },
    },
  };
}

/** 浮点比较（mastery / confidence 都是 0..1 的累加值）。 */
function near(a: number, b: number, msg: string): void {
  assert.ok(Math.abs(a - b) < 1e-9, `${msg}（实际 ${a}，期望 ${b}）`);
}

/**
 * 读源码并**剥掉注释** —— 源码断言只针对代码。
 *
 * 不这么做的话，注释里为了说明「不能用 `delta >= 0` 判涨」而写出的那个字面量
 * 会被自己的正则命中（实测踩过）。注释引用某种写法是**说明**，不是缺陷。
 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

async function main() {
  /* ---------- ① 引擎层：自评的四条不变量 ---------- */

  await check("TC-RATE-01 自评不动 mastery / attempts / correctCount（四档全覆盖）", () => {
    for (const r of RATINGS) {
      const u = applyKeyPointRating(stateOf(), "ch-1", r, T0 + DAY).byUnit["ch-1"];
      assert.equal(u.mastery, 0.62, `${r}：mastery 不得移动`);
      assert.equal(u.attempts, 2, `${r}：attempts 不得增加`);
      assert.equal(u.correctCount, 1, `${r}：correctCount 不得增加`);
    }
  });

  await check("TC-RATE-02 自评只写调度与置信度（间隔取真源 nextReviewInDays）", () => {
    for (const r of RATINGS) {
      const at = T0 + 5 * DAY;
      const u = applyKeyPointRating(stateOf(), "ch-1", r, at).byUnit["ch-1"];
      assert.equal(u.lastReviewedAt, at, `${r}：lastReviewedAt 应写提交时刻`);
      assert.equal(u.nextReviewAt, at + nextReviewInDays(r) * DAY, `${r}：间隔应为 nextReviewInDays`);
      assert.notEqual(u.confidence, 0.4, `${r}：confidence 应有微调`);
      assert.ok(u.confidence >= 0 && u.confidence <= 1, `${r}：confidence 必须留在 [0,1]`);
    }
  });

  await check("TC-RATE-03 对照：applyRating 会移动 mastery（= 本修复的根据）", () => {
    const r: SelfRating = "good";
    const moved = applyRating(stateOf(), "ch-1", r, T0 + DAY).byUnit["ch-1"];
    const kept = applyKeyPointRating(stateOf(), "ch-1", r, T0 + DAY).byUnit["ch-1"];
    near(moved.mastery, 0.62 + ratingStep(r), "applyRating 应把 mastery 推高一个 step");
    // 「同一自评动作、两个入口、两种后果」的**量化**证据：差值恰为一个 step。
    near(moved.mastery - kept.mastery, ratingStep(r), "两个入口的 mastery 差额应恰为一个 step");
    near(kept.mastery, 0.62, "applyKeyPointRating 应原地不动");
  });

  await check("TC-RATE-04 只动目标章，邻章逐字段不变", () => {
    const next = applyKeyPointRating(stateOf(), "ch-1", "good", T0 + DAY);
    assert.deepEqual(next.byUnit["ch-2"], stateOf().byUnit["ch-2"]);
  });

  await check("TC-RATE-05 自评不再产生「mastery>0 而 attempts=0」的伪证据形状", () => {
    // 这条直接护住 `bandForChapter` / planner 的 `examined = attempts > 0` 判定：
    // 自评不是卷面证据，不能把「从未考过的章」伪装成「有证据」。
    const next = applyKeyPointRating({ byUnit: {} }, "ch-new", "easy", T0);
    const u = next.byUnit["ch-new"];
    assert.equal(u.mastery, 0, "从未考过的章自评后 mastery 仍应为 0");
    assert.equal(u.attempts, 0, "attempts 应保持 0");
    assert.ok((u.nextReviewAt ?? 0) > T0, "但必须已排入复习队列（自评的真实产出）");
  });

  /* ---------- ② 源码层：两处 UI 不变量（.tsx / React 生态不可直跑） ---------- */

  await check("TC-RATE-06 submitAnswer 的 rating 分支走 applyKeyPointRating（源码零 applyRating）", () => {
    const src = codeOf("src/stores/useLoopStore.ts");
    assert.ok(!/\bapplyRating\s*\(/.test(src), "不得使用会移动 mastery 的 applyRating");
    assert.ok(/applyKeyPointRating\s*\(/.test(src), "rating 分支必须走 applyKeyPointRating");
  });

  await check("TC-RATE-07 DeltaBadge 三态：不得用 delta >= 0 把 0 判成「涨」", () => {
    const src = codeOf("src/components/DeltaBadge.tsx");
    assert.ok(!/delta\s*>=\s*0/.test(src), "0 不是「涨」—— 不得用 delta >= 0");
    assert.ok(/delta\s*===\s*0/.test(src), "必须显式区分 delta === 0 的中性态");
    assert.ok(/delta\s*>\s*0/.test(src), "上涨态应为 delta > 0");
  });

  await check("TC-RATE-08 中性态文案键存在且非空（中英成对由 test:i18n 另锁）", () => {
    assert.equal(typeof zh.common.delta.unchanged, "string");
    assert.ok(zh.common.delta.unchanged.length > 0, "unchanged 文案不得为空");
  });

  /* ---------- ③ 死代码的口径（防止下次再按旧注释去找调用方） ---------- */

  await check("TC-RATE-09 ratingStep / applyRating 标注为「当前零消费方」且 UI 确实不再引用", () => {
    // ⚠️ 本条**要看注释**（前两条相反）→ 用未剥注释的原文。
    const raw = readFileSync("src/engine/learner-model.ts", "utf8");
    assert.ok(/当前零消费方/.test(raw), "ratingStep / applyRating 的注释须写明零消费方");
    for (const f of ["src/stores/useLoopStore.ts", "src/components/DeltaBadge.tsx"]) {
      assert.ok(!/\bratingStep\s*\(/.test(codeOf(f)), `${f} 不应调用 ratingStep`);
    }
  });
}

await main();

for (const line of results) console.log(line);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
