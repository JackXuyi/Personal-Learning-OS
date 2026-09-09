/**
 * U2 · 计划动作耗时预估 estimateEtaMin 单测（docs/ui-workbench-plan-2026-09.md §7.4）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:eta
 *
 * 覆盖：
 *  1) chapter-quiz → 卷模式时长常量（unit-test = 8 分钟）；
 *  2) retake-quiz → 卷模式时长常量（retake = 5 分钟）；
 *  3) learn-chapter 无章信息 → 回退 12；
 *  4) learn-chapter 短章 → clamp 下限 5；
 *  5) learn-chapter 超长章 → clamp 上限 40；
 *  6) review-points 无章信息 → 回退 5；
 *  7) review-points 常规章（按 ~800 字/分）→ 取整；
 *  8) 其它 kind → 兜底 8。
 */
import assert from "node:assert/strict";
import { estimateEtaMin } from "../src/features/plan/chapter-action.ts";
import type { Chapter } from "../src/domain/chapter.ts";
import type { NextAction } from "../src/domain/plan.ts";

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

function action(kind: NextAction["kind"]): NextAction {
  return {
    id: `a-${kind}`,
    kind,
    unitId: "c1",
    priority: 0,
    reasons: [],
    createdAt: 1,
  };
}

function chapterOf(chars: number): Chapter {
  return {
    id: "c1",
    documentId: "d1",
    order: 1,
    title: "测试章",
    contentRef: { start: 0, end: chars },
    keyPoints: ["要点"],
    unitIds: [],
    status: "not-started",
    createdAt: 1,
  };
}

async function main() {
  await check("chapter-quiz → 8 min（unit-test 模式时长）", () => {
    assert.equal(estimateEtaMin(action("chapter-quiz"), undefined), 8);
  });
  await check("retake-quiz → 5 min（retake 模式时长）", () => {
    assert.equal(estimateEtaMin(action("retake-quiz"), undefined), 5);
  });
  await check("learn-chapter 无章 → 回退 12", () => {
    assert.equal(estimateEtaMin(action("learn-chapter"), undefined), 12);
  });
  await check("learn-chapter 短章（1400 字 → /350=4）→ clamp 下限 5", () => {
    assert.equal(estimateEtaMin(action("learn-chapter"), chapterOf(1400)), 5);
  });
  await check("learn-chapter 超长章（20000 字）→ clamp 上限 40", () => {
    assert.equal(estimateEtaMin(action("learn-chapter"), chapterOf(20_000)), 40);
  });
  await check("review-points 无章 → 回退 5", () => {
    assert.equal(estimateEtaMin(action("review-points"), undefined), 5);
  });
  await check("review-points 8000 字 → 约 10 分钟", () => {
    assert.equal(estimateEtaMin(action("review-points"), chapterOf(8000)), 10);
  });
  await check("其它 kind（remediation 概念层）→ 兜底 8", () => {
    assert.equal(estimateEtaMin(action("remediation"), undefined), 8);
  });
}

await main();

for (const line of results) console.log(line);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
