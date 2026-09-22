/**
 * 资料删除级联 · 同族实体回收守卫（2026-09-22）。
 *
 * 背景：`deleteDocumentCascade` 长期只清 chunk/向量、试卷、概念与资料本体
 * （章节与批注由适配器的 `forgetDocument` 兜底）。同族的 6 项**派生学习资产**
 * 被漏在库里 —— 逐项证据与拍板过程见 `docs/document-cascade-cleanup-2026-09.md`：
 *
 *   ① 复述记录（含用户手写原文）  ② 自测卡调度状态  ③ 章级掌握度 `learner.byUnit`
 *   ④ 小节 `Section`             ⑤ 目标范围里的悬空章 id  ⑥ 社区包溯源 `documentIds`
 *
 * ⚠️ 本文件**同时**锁一条**反面口径**：证据流（`plos.evidence`）**不得**被级联删除。
 * 它是行为历史 —— 热力图按 `at` 逐日计数（`analytics.ts:38`）、F9 记忆按 `kind` 分布
 * （`memory-facts.ts:163`）—— 按主体删等于**回溯改写已经发生的事实**。
 * 它的孤儿行改由消费侧兜底（`HomePage::logToView` 跳过解析不到的章级行）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:cascade
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type {
  CardState,
  Chapter,
  EvidenceEntry,
  LearningGoal,
  Paper,
  Restatement,
  Section,
  SourceDocument,
  UnitMastery,
} from "../src/domain/index.ts";
import type { ImportedPackRecord } from "../src/storage/types.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import {
  deleteDocumentCascade,
  previewDeleteCascade,
} from "../src/features/learn/document-cascade.ts";

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

function doc(id: string): SourceDocument {
  return {
    id,
    title: `资料 ${id}`,
    format: "md",
    importedAt: 1,
    status: "ready",
    textPreview: "正文",
  };
}

function chapter(id: string, documentId: string, order: number): Chapter {
  return {
    id,
    documentId,
    order,
    title: `章 ${id}`,
    contentRef: { start: 0, end: 10 },
    keyPoints: [],
    unitIds: [],
    status: "not-started",
    createdAt: 1,
  };
}

function section(id: string, chapterId: string, documentId: string): Section {
  return {
    id,
    chapterId,
    documentId,
    title: `小节 ${id}`,
    level: 2,
    index: 1,
    contentRef: { start: 0, end: 5 },
    createdAt: 1,
  };
}

function restatement(id: string, documentId: string, chapterId: string): Restatement {
  return {
    id,
    documentId,
    chapterId,
    // 刻意带上用户原文：这一项**含用户手写内容**，与批注同级。
    text: "这是我自己的复述，删资料不该无声吞掉它。",
    createdAt: 1,
  };
}

function cardState(cardId: string, chapterId: string, documentId: string): CardState {
  return {
    cardId,
    chapterId,
    documentId,
    lastReviewedAt: 1,
    reps: 3,
    lastRating: "good",
    lapses: 0,
  };
}

function unit(mastery: number): UnitMastery {
  return {
    mastery,
    confidence: 0,
    attempts: 0,
    correctCount: 0,
    cognitiveLevel: "remember",
    misconceptions: [],
    applicationAbility: 0,
    interviewAbility: 0,
  };
}

function paper(id: string, chapterIds: string[]): Paper {
  return {
    id,
    scope: { chapterIds, mode: "unit-test" },
    title: `试卷 ${id}`,
    questions: [],
    status: "done",
    createdAt: 1,
  };
}

function goal(id: string, requiredChapterIds: string[]): LearningGoal {
  return {
    id,
    type: "study",
    title: `目标 ${id}`,
    importance: "high",
    requiredUnitIds: [],
    requiredChapterIds,
    createdAt: 1,
  };
}

function pack(contentHash: string, documentIds: string[]): ImportedPackRecord {
  return {
    contentHash,
    title: `包 ${contentHash}`,
    importedAt: 1,
    documentIds,
    counts: {
      documents: 0,
      chapters: 0,
      sections: 0,
      chunks: 0,
      knowledgeUnits: 0,
      knowledgeRelations: 0,
      chars: 0,
    },
  };
}

function evidence(entry: Partial<EvidenceEntry> & { at: number; subjectId: string }): EvidenceEntry {
  return { kind: "assessment", delta: 0, ...entry };
}

/**
 * 造两库：doc-a（被删）、doc-b（旁观者）。
 * 每一项都**成对**写入 —— 只有成对才验得出「只清该清的」。
 */
async function seed(): Promise<InMemoryStorage> {
  const s = new InMemoryStorage();
  await s.saveDocument(doc("doc-a"));
  await s.saveDocument(doc("doc-b"));
  await s.saveChapters("doc-a", [
    chapter("chp-a1", "doc-a", 1),
    chapter("chp-a2", "doc-a", 2),
  ]);
  await s.saveChapters("doc-b", [chapter("chp-b1", "doc-b", 1)]);

  await s.saveSections([
    section("sec-a1", "chp-a1", "doc-a"),
    section("sec-a2", "chp-a2", "doc-a"),
    section("sec-b1", "chp-b1", "doc-b"),
  ]);
  await s.saveRestatement(restatement("rst-a", "doc-a", "chp-a1"));
  await s.saveRestatement(restatement("rst-b", "doc-b", "chp-b1"));
  await s.saveCardState(cardState("card-a", "chp-a1", "doc-a"));
  await s.saveCardState(cardState("card-b", "chp-b1", "doc-b"));
  await s.saveLearnerState({
    byUnit: { "chp-a1": unit(0.9), "chp-a2": unit(0.4), "chp-b1": unit(0.2) },
  });
  await s.savePaper(paper("paper-a", ["chp-a1"]));
  await s.saveGoal(goal("goal-mixed", ["chp-a1", "chp-b1"]));
  // 只圈了 doc-a 的章 → 清理后范围会变空（**必须不动**，见 TC-CASC-06）
  await s.saveGoal(goal("goal-only-a", ["chp-a1"]));
  await s.saveImportedPack(pack("hash-1", ["doc-a", "doc-b"]));

  // 证据流：章级两条（一条指向被删资料、一条指向旁观资料）+ 目标级一条
  await s.appendEvidence(evidence({ at: 1, subjectId: "chp-a1", delta: 0.3, sourceId: "paper-a" }));
  await s.appendEvidence(evidence({ at: 2, kind: "review", subjectId: "chp-b1" }));
  await s.appendEvidence(
    evidence({ at: 3, kind: "capability", subjectId: "goal-mixed", subjectKind: "goal", verdict: "pass" }),
  );
  return s;
}

/* ---------------- ① 级联回收：该清的清 ---------------- */

async function main() {
  await check("TC-CASC-01 资料本体 / 章节 / 试卷：既有能力不回归", async () => {
    const s = await seed();
    await deleteDocumentCascade("doc-a", s);
    assert.equal(await s.getDocument("doc-a"), undefined, "资料本体应删除");
    assert.equal((await s.listChapters("doc-a")).length, 0, "章节应级联删除");
    assert.equal((await s.listPapers()).some((p) => p.id === "paper-a"), false, "该资料试卷应删除");
    assert.ok(await s.getDocument("doc-b"), "旁观资料必须原样保留");
    assert.equal((await s.listChapters("doc-b")).length, 1, "旁观资料章节必须原样保留");
  });

  await check("TC-CASC-02 复述记录：本资料清除、他资料零改动", async () => {
    const s = await seed();
    await deleteDocumentCascade("doc-a", s);
    const rest = await s.listAllRestatements();
    assert.deepEqual(rest.map((r) => r.id), ["rst-b"], "只应剩旁观资料的复述");
  });

  await check("TC-CASC-03 自测卡状态：本资料清除、他资料零改动", async () => {
    const s = await seed();
    await deleteDocumentCascade("doc-a", s);
    const cards = await s.listCardStates();
    assert.deepEqual(Object.keys(cards), ["card-b"], "只应剩旁观资料的卡");
  });

  await check("TC-CASC-04 章级掌握度：本资料章键清除、他资料章键保留", async () => {
    const s = await seed();
    await deleteDocumentCascade("doc-a", s);
    const learner = await s.getLearnerState();
    assert.deepEqual(Object.keys(learner.byUnit).sort(), ["chp-b1"]);
    assert.equal(learner.byUnit["chp-b1"]?.mastery, 0.2, "旁观资料的掌握度数值不得被改写");
  });

  await check("TC-CASC-05 小节：本资料清除、他资料零改动", async () => {
    const s = await seed();
    await deleteDocumentCascade("doc-a", s);
    assert.equal((await s.listSections("chp-a1")).length, 0);
    assert.equal((await s.listSections("chp-a2")).length, 0);
    assert.equal((await s.listSections("chp-b1")).length, 1);
  });

  await check("TC-CASC-06 目标范围：剔悬空章 id，但**剔空则不动**（防语义翻转）", async () => {
    const s = await seed();
    await deleteDocumentCascade("doc-a", s);
    const goals = new Map((await s.listGoals()).map((g) => [g.id, g]));
    assert.deepEqual(
      goals.get("goal-mixed")?.requiredChapterIds,
      ["chp-b1"],
      "混合范围应剔除悬空 id、保留存活 id",
    );
    // ⚠️ 这条是**反向**断言：`scopeOf` 把空 requiredChapterIds 读作「全库回退」
    // （goal-util.ts:46），剔空会把限定目标静默变成全局目标。
    assert.deepEqual(
      goals.get("goal-only-a")?.requiredChapterIds,
      ["chp-a1"],
      "剔空会翻转成全库目标 —— 此时必须原地不动",
    );
  });

  await check("TC-CASC-07 社区包溯源：剔掉被删资料，包记录本身保留", async () => {
    const s = await seed();
    await deleteDocumentCascade("doc-a", s);
    const packs = await s.listImportedPacks();
    assert.equal(packs.length, 1, "包记录应保留（另一半职责是去重提示）");
    assert.deepEqual(packs[0]?.documentIds, ["doc-b"]);
  });

  /* ---------------- ② 反面口径：证据流必须原样保留 ---------------- */

  await check("TC-CASC-08 证据流：一条都不能少（行为历史不随资料回收）", async () => {
    const s = await seed();
    const before = await s.listEvidence();
    await deleteDocumentCascade("doc-a", s);
    const after = await s.listEvidence();
    assert.equal(after.length, before.length, "证据行数不得变化");
    assert.equal(after.length, 3);
    assert.ok(
      after.some((e) => e.subjectId === "chp-a1"),
      "指向被删章的旧证据**必须保留** —— 它是已经发生过的学习行为",
    );
  });

  await check("TC-CASC-09 源码守卫：级联模块不得碰证据流", () => {
    // 剥注释：文件头大段注释里**刻意**写了 listEvidence 作为反面引用（同 no-rawid-label 的坑）。
    const src = readFileSync("src/features/learn/document-cascade.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(src, /listEvidence/, "级联不得读写证据流");
    assert.doesNotMatch(src, /deleteEvidence/, "级联不得引入证据删除（口径见文件头）");
  });

  /* ---------------- ③ 消费侧：幽灵行收口 ---------------- */

  await check("TC-CASC-10 首页证据行：章解析不到即跳过，且先过滤再截断", () => {
    const src = readFileSync("src/features/home/HomePage.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.match(
      src,
      /if \(!chapter\) return undefined;/,
      "logToView 必须在章解析不到时返回 undefined（不得回落裸 id、也不得占位）",
    );
    assert.doesNotMatch(
      src,
      /:\s*m\.units\.subjectGone;/,
      "logToView 不得再用 subjectGone 占位（该键仍归 /progress 趋势与旧组装兜底用）",
    );
    const filterAt = src.indexOf(".filter((v): v is EvidenceView => v !== undefined)");
    const sliceAt = src.indexOf(".slice(0, 6)");
    assert.ok(filterAt >= 0, "loadRecentEvidence 必须先过滤 undefined 行");
    assert.ok(sliceAt >= 0, "仍要保留 ≤6 行的截断");
    assert.ok(
      filterAt < sliceAt,
      "顺序不可颠倒：先 slice 再 filter 会让幽灵行白占掉真实行的名额",
    );
  });

  /* ---------------- ④ 只读与幂等 ---------------- */

  await check("TC-CASC-11 previewDeleteCascade 是纯只读，不清任何东西", async () => {
    const s = await seed();
    const report = await previewDeleteCascade("doc-a", s);
    assert.equal(report.chapters, 2);
    assert.equal(report.papers, 1);
    assert.equal((await s.listAllRestatements()).length, 2, "预检不得删复述");
    assert.equal(Object.keys(await s.listCardStates()).length, 2, "预检不得删卡状态");
    assert.equal((await s.listSections("chp-a1")).length, 1, "预检不得删小节");
    assert.equal(Object.keys((await s.getLearnerState()).byUnit).length, 3);
  });

  await check("TC-CASC-12 对不存在的资料调用是幂等空操作", async () => {
    const s = await seed();
    await deleteDocumentCascade("doc-missing", s);
    assert.equal((await s.listAllRestatements()).length, 2);
    assert.equal(Object.keys((await s.getLearnerState()).byUnit).length, 3);
    assert.deepEqual(
      (await s.listGoals()).find((g) => g.id === "goal-mixed")?.requiredChapterIds,
      ["chp-a1", "chp-b1"],
      "无章可剔时目标范围不得被改写",
    );
  });

  /* ---------------- 汇总 ---------------- */

  for (const r of results) console.log(r);
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  if (failures > 0) process.exitCode = 1;
}

await main();
