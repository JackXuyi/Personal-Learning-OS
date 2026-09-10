/**
 * 资料详情页 · 出卷建议 单测（docs/library-detail-page-design-2026-09.md §11.1）。
 *
 * 运行：npm run test:library
 *
 * 覆盖（TC-UC08-01 / TC-UC08-02 / TC-EDGE-02）：
 *  1) attempts = 0 → 单元测（never）；
 *  2) mastery 0.24（低于及格线且测过）→ 补考卷（failed）+ 难度 1；
 *  3) 0.6 ≤ mastery < 0.8 → 单元测（weak）；
 *  4) 0.8 ≤ mastery < 0.9 → 阶段测（near）；
 *  5) mastery ≥ 0.9 → mastered；
 *  6) 无 LearnerState → 等同未学（never），不抛错；
 *  7) recommendDocPaper：全章达标 → 综合测；否则 undefined；无章 → undefined。
 *
 * 阈值与 band 均复用 domain/plan.ts 与 engine/quiz-engine，测试同时充当
 * 「推荐口径与出卷引擎同源」的回归保护 —— 阈值若被改动，这里会先炸。
 */
import assert from "node:assert/strict";
import {
  MASTERY_MASTERED,
  recommendDocPaper,
  recommendPaper,
} from "../src/features/learn/paper-advice.ts";
import { MASTERY_FLOOR, MASTERY_THRESHOLD } from "../src/domain/plan.ts";
import type { Chapter } from "../src/domain/chapter.ts";
import type { LearnerState, UnitMastery } from "../src/domain/learner.ts";

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

function chapterOf(id: string): Chapter {
  return {
    id,
    documentId: "doc-1",
    order: 1,
    title: `章 ${id}`,
    contentRef: { start: 0, end: 100 },
    keyPoints: [],
    unitIds: [],
    status: "not-started",
    createdAt: 1,
  };
}

function unitOf(mastery: number, attempts: number): UnitMastery {
  return {
    mastery,
    confidence: mastery,
    attempts,
    correctCount: Math.round(attempts * mastery),
    cognitiveLevel: "understand",
    misconceptions: [],
    applicationAbility: 0,
    interviewAbility: 0,
  };
}

function learnerOf(entries: Record<string, UnitMastery>): LearnerState {
  return { byUnit: entries };
}

await check("attempts = 0 → 单元测（never）", () => {
  const a = recommendPaper({ chapter: chapterOf("c1"), learner: undefined });
  assert.equal(a.mode, "unit-test");
  assert.equal(a.reason, "never");
  assert.equal(a.band, 1);
});

await check("mastery 0.24 且测过 → 补考卷（failed）· 难度 1", () => {
  const a = recommendPaper({
    chapter: chapterOf("c1"),
    learner: learnerOf({ c1: unitOf(0.24, 3) }),
  });
  assert.equal(a.mode, "retake");
  assert.equal(a.reason, "failed");
  assert.equal(a.band, 1);
});

await check("0.6 ≤ mastery < 0.8 → 单元测（weak）", () => {
  const a = recommendPaper({
    chapter: chapterOf("c1"),
    learner: learnerOf({ c1: unitOf((MASTERY_FLOOR + MASTERY_THRESHOLD) / 2, 2) }),
  });
  assert.equal(a.mode, "unit-test");
  assert.equal(a.reason, "weak");
});

await check("0.8 ≤ mastery < 0.9 → 阶段测（near）", () => {
  const a = recommendPaper({
    chapter: chapterOf("c1"),
    learner: learnerOf({ c1: unitOf((MASTERY_THRESHOLD + MASTERY_MASTERED) / 2, 2) }),
  });
  assert.equal(a.mode, "stage-test");
  assert.equal(a.reason, "near");
});

await check("mastery ≥ 0.9 → mastered（不再推荐新卷）", () => {
  const a = recommendPaper({
    chapter: chapterOf("c1"),
    learner: learnerOf({ c1: unitOf(0.95, 3) }),
  });
  assert.equal(a.reason, "mastered");
});

await check("边界：恰好等于及格线 / 达标线不落错档", () => {
  const atFloor = recommendPaper({
    chapter: chapterOf("c1"),
    learner: learnerOf({ c1: unitOf(MASTERY_FLOOR, 1) }),
  });
  assert.equal(atFloor.reason, "weak", "恰好在及格线应算已及格");
  const atThreshold = recommendPaper({
    chapter: chapterOf("c2"),
    learner: learnerOf({ c2: unitOf(MASTERY_THRESHOLD, 1) }),
  });
  assert.equal(atThreshold.reason, "near", "恰好在达标线应算已达标");
});

await check("无 LearnerState / 该章无记录 → never，不抛错（TC-EDGE-02）", () => {
  assert.equal(recommendPaper({ chapter: chapterOf("c1"), learner: null }).reason, "never");
  assert.equal(
    recommendPaper({ chapter: chapterOf("c9"), learner: learnerOf({}) }).reason,
    "never",
  );
});

await check("recommendDocPaper：全章达标 → 综合测（allMastered）", () => {
  const chapters = [chapterOf("c1"), chapterOf("c2")];
  const doc = recommendDocPaper({
    chapters,
    learner: learnerOf({ c1: unitOf(0.92, 2), c2: unitOf(0.96, 2) }),
  });
  assert.ok(doc, "应给出资料级建议");
  assert.equal(doc.mode, "final-test");
  assert.equal(doc.reason, "allMastered");
});

await check("recommendDocPaper：有章未达标 → undefined", () => {
  const chapters = [chapterOf("c1"), chapterOf("c2")];
  assert.equal(
    recommendDocPaper({
      chapters,
      learner: learnerOf({ c1: unitOf(0.95, 2), c2: unitOf(0.5, 2) }),
    }),
    undefined,
  );
  assert.equal(recommendDocPaper({ chapters: [], learner: undefined }), undefined);
});

console.log(results.join("\n"));
if (failures > 0) {
  console.error(`\n[library-paper-advice] ${results.length - failures}/${results.length} 通过`);
  process.exit(1);
}
console.log(`\n[library-paper-advice] ${results.length}/${results.length} 通过`);
