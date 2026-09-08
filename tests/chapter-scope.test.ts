/**
 * U1 · runChapterLoop activeGoal 作用域裁剪单测（docs/ui-workbench-plan-2026-09.md §7.3）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:scope
 *
 * 覆盖：
 *  1) 无目标范围（requiredChapterIds 为空）→ 回退全库章（现状行为）；
 *  2) 传 goalId + 目标带章范围 → 章计划/就绪度只覆盖目标章（读取路径裁剪）；
 *  3) 裁剪只影响章集合，learner 衰减视图与 action 归属均在范围内。
 */
import assert from "node:assert/strict";
import { InMemoryStorage } from "../src/storage/memory.ts";
import type { SourceDocument } from "../src/domain/document.ts";
import type { Chapter } from "../src/domain/chapter.ts";
import type { LearningGoal } from "../src/domain/goal.ts";
import type { LearnerState } from "../src/domain/learner.ts";
import { runChapterLoop } from "../src/engine/loop.ts";

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

function doc(id: string, title: string): SourceDocument {
  return { id, title, format: "markdown", importedAt: 1, status: "ready", source: "test" };
}

function chapter(id: string, documentId: string, order: number, title: string): Chapter {
  return {
    id,
    documentId,
    order,
    title,
    contentRef: { start: 0, end: 1 },
    keyPoints: ["point"],
    unitIds: [],
    status: "not-started",
    createdAt: 1,
  };
}

function goal(id: string, requiredChapterIds?: string[]): LearningGoal {
  return {
    id,
    type: "career",
    title: `目标 ${id}`,
    importance: "medium",
    requiredUnitIds: [],
    requiredChapterIds,
    createdAt: 1,
  };
}

/** 两文档五章夹具：docA = [a1,a2]，docB = [b1,b2,b3]。 */
async function buildStorage(): Promise<{
  s: InMemoryStorage;
  goals: [LearningGoal, LearningGoal];
}> {
  const s = new InMemoryStorage();
  await s.saveDocument(doc("docA", "RAG from Scratch"));
  await s.saveDocument(doc("docB", "DDIA"));
  await s.saveChapters("docA", [
    chapter("a1", "docA", 1, "Retrieval"),
    chapter("a2", "docA", 2, "Embedding"),
  ]);
  await s.saveChapters("docB", [
    chapter("b1", "docB", 1, "Replication"),
    chapter("b2", "docB", 2, "Partitioning"),
    chapter("b3", "docB", 3, "Transactions"),
  ]);
  // 注意顺序：g-all 在前 —— 无显式 goalId 时应回退到它（全库范围）。
  const gAll = goal("g-all");
  const gScope = goal("g-scope", ["a1", "a2", "b1"]);
  await s.saveGoal(gAll);
  await s.saveGoal(gScope);
  return { s, goals: [gAll, gScope] };
}

function masteryState(masteries: Record<string, number>): LearnerState {
  const byUnit = Object.fromEntries(
    Object.entries(masteries).map(([id, mastery]) => [
      id,
      {
        mastery,
        confidence: Math.round(mastery * 100) / 100,
        attempts: 3,
        correctCount: 2,
        cognitiveLevel: "understand" as const,
        misconceptions: [],
        lastReviewedAt: 0,
        lastAssessmentAt: 0,
        applicationAbility: mastery,
        interviewAbility: mastery,
      },
    ]),
  );
  return { byUnit };
}

const run = async () => {
  await check("无目标范围 → 回退全库章（total=5，两文档全保留）", async () => {
    const { s } = await buildStorage();
    const snap = await runChapterLoop(s);
    assert.equal(snap.goal?.id, "g-all");
    assert.equal(snap.total, 5);
    assert.equal(snap.chaptersByDoc.docA?.length, 2);
    assert.equal(snap.chaptersByDoc.docB?.length, 3);
  });

  await check("传 goalId + 章范围 → 只覆盖目标章（total=3，docB 仅留 b1）", async () => {
    const { s } = await buildStorage();
    const snap = await runChapterLoop(s, undefined, "g-scope");
    assert.equal(snap.goal?.id, "g-scope");
    assert.equal(snap.total, 3);
    assert.equal(snap.chaptersByDoc.docA?.length, 2);
    assert.equal(snap.chaptersByDoc.docB?.length, 1);
    assert.equal(snap.chaptersByDoc.docB?.[0].id, "b1");
  });

  await check("裁剪范围外章不进 mastered / actions", async () => {
    const { s } = await buildStorage();
    await s.saveLearnerState(masteryState({ a1: 0.9, b1: 0.85, b2: 0.95 }));
    const snap = await runChapterLoop(s, undefined, "g-scope");
    // 范围内 a1(0.9)、b1(0.85) 达标；范围外的 b2(0.95) 不计入。
    assert.equal(snap.total, 3);
    assert.equal(snap.mastered, 2);
    const allowed = new Set(["a1", "a2", "b1"]);
    for (const action of snap.actions) assert.ok(allowed.has(action.unitId));
  });

  console.log(results.join("\n"));
  console.log(`\nchapter-scope: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
};

void run();
