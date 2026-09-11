/**
 * 资料卡（列表页）状态派生单测 —— S1–S6 卡片样式优化（2026-09-11）的数据面。
 *
 * 运行：npm run test:card（已并入 npm run test:library 串联）
 *
 * 覆盖：
 *  - docStatus 优先级：未切分 → 到期待复习 → 已达标 → 进行中
 *    （关键不变式：**已达标但复习到期 → reviewDue**，不得显示 mastered）；
 *  - nextReviewOf：无排期返回 undefined（卡面诚实降级）；多章取最早排期。
 *
 * 纯函数 + 注入 now，无网络、无 provider。
 */
import assert from "node:assert/strict";
import { MASTERY_THRESHOLD } from "../src/domain/plan.ts";
import type { Chapter } from "../src/domain/chapter.ts";
import type { LearnerState } from "../src/domain/learner.ts";
import { docStatus, nextReviewOf } from "../src/features/learn/library/shared.ts";

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

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;

function chapter(id: string, order: number): Chapter {
  return {
    id,
    documentId: "doc-1",
    order,
    title: `章 ${order}`,
    contentRef: { start: 0, end: 10 },
    keyPoints: [],
    unitIds: [],
    status: "not-started",
    createdAt: NOW,
  };
}

/** 造一份学习者状态：mastery 用达标线本身，避免依赖具体阈值数值。 */
function learner(entries: Record<string, { mastery?: number; nextReviewAt?: number }>): LearnerState {
  const byUnit: LearnerState["byUnit"] = {};
  for (const [id, v] of Object.entries(entries)) {
    byUnit[id] = {
      mastery: v.mastery ?? 0,
      confidence: 0,
      attempts: 0,
      correctCount: 0,
      cognitiveLevel: "remember",
      misconceptions: [],
      applicationAbility: 0,
      interviewAbility: 0,
      ...(v.nextReviewAt !== undefined ? { nextReviewAt: v.nextReviewAt } : {}),
    };
  }
  return { byUnit };
}

/* ---------------- docStatus ---------------- */

check("无章 → unsplit（即使有排期也不看）", () => {
  assert.equal(docStatus([], learner({ a: { mastery: 1, nextReviewAt: NOW - DAY } }), NOW), "unsplit");
});

check("部分章达标、无排期 → learning", () => {
  const chapters = [chapter("a", 1), chapter("b", 2)];
  const state = learner({ a: { mastery: MASTERY_THRESHOLD }, b: { mastery: 0 } });
  assert.equal(docStatus(chapters, state, NOW), "learning");
});

check("全部达标、无排期 → mastered", () => {
  const chapters = [chapter("a", 1), chapter("b", 2)];
  const state = learner({
    a: { mastery: MASTERY_THRESHOLD },
    b: { mastery: MASTERY_THRESHOLD },
  });
  assert.equal(docStatus(chapters, state, NOW), "mastered");
});

check("全部达标但复习已到期 → reviewDue（优先于 mastered）", () => {
  const chapters = [chapter("a", 1), chapter("b", 2)];
  const state = learner({
    a: { mastery: MASTERY_THRESHOLD, nextReviewAt: NOW - DAY },
    b: { mastery: MASTERY_THRESHOLD },
  });
  assert.equal(docStatus(chapters, state, NOW), "reviewDue");
});

check("排期在未来 → 仍是 mastered（未到期不打扰）", () => {
  const chapters = [chapter("a", 1)];
  const state = learner({ a: { mastery: MASTERY_THRESHOLD, nextReviewAt: NOW + DAY } });
  assert.equal(docStatus(chapters, state, NOW), "mastered");
});

check("learner 缺失 → learning（不误判达标/到期）", () => {
  assert.equal(docStatus([chapter("a", 1)], undefined, NOW), "learning");
});

/* ---------------- nextReviewOf ---------------- */

check("无任何排期 → undefined（卡面不显示复习徽标）", () => {
  const chapters = [chapter("a", 1), chapter("b", 2)];
  assert.equal(nextReviewOf(chapters, learner({ a: { mastery: 1 } })), undefined);
  assert.equal(nextReviewOf(chapters, undefined), undefined);
});

check("多章取最早排期（含已过期）", () => {
  const chapters = [chapter("a", 1), chapter("b", 2), chapter("c", 3)];
  const state = learner({
    a: { mastery: 1, nextReviewAt: NOW + 3 * DAY },
    b: { mastery: 1, nextReviewAt: NOW - 2 * DAY },
    c: { mastery: 1, nextReviewAt: NOW + 5 * DAY },
  });
  assert.equal(nextReviewOf(chapters, state), NOW - 2 * DAY);
});

/* ---------------- 输出 ---------------- */

console.log("\n[library-card-status]");
for (const r of results) console.log(`  ${r}`);
console.log(`\n${results.length - failures}/${results.length} 通过`);
if (failures > 0) process.exit(1);
