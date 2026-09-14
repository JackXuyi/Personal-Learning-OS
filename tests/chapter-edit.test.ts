/**
 * 章节人工编辑 单测（docs/chapter-edit-design-2026-09.md §12）。
 *
 * 运行：npm run test:chapters
 *
 * 覆盖：
 *  A. 引擎原语 —— renameChapter / mergeChapterRange / reorderChapters / renumberChapters
 *     （含三处原语缺陷的修复断言：中间章要点保留、unitIds 并集、refs 对齐）；
 *  B. 掌握度局部迁移 —— remapMasteryOnChapterEdit（关键：未涉及的键完全不变）；
 *  C. 服务层 —— applyChapterEdit 的短路、落库、错误类型（注入 InMemoryStorage）；
 *  D. 边界 —— 单章合并、切片契约、章数不变量。
 */
import assert from "node:assert/strict";
import type { Chapter, KeyPointRef, UnitMastery } from "../src/domain/index.ts";
import {
  MERGED_KEY_POINTS_CAP,
  mergeChapterRange,
  renameChapter,
  reorderChapters,
  renumberChapters,
} from "../src/engine/chapter-edit-engine.ts";
import {
  applyChapterEdit,
  ChapterEditError,
} from "../src/features/learn/chapter-edit-service.ts";
import { remapMasteryOnChapterEdit } from "../src/features/learn/resplit-mastery.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";

// ------------------------------------------------------------- 构造工具

/** 5 章文档正文：每章 100 字符，字符互不相同（便于切片契约断言）。 */
const TEXT = "a".repeat(100) + "b".repeat(100) + "c".repeat(100) + "d".repeat(100) + "e".repeat(100);

/** 造章：contentRef 按 order 连续排布（章 i 占 [100(i-1), 100i)）。 */
function ch(id: string, order: number, over: Partial<Chapter> = {}): Chapter {
  return {
    id,
    documentId: "doc1",
    order,
    title: `第 ${order} 章`,
    contentRef: { start: (order - 1) * 100, end: order * 100 },
    keyPoints: [`P${order}`],
    unitIds: [`u${order}`],
    status: "not-started",
    createdAt: 1000 + order,
    ...over,
  };
}

/** 5 章（c1..c5，order 1..5）。 */
function fiveChapters(): Chapter[] {
  return [ch("c1", 1), ch("c2", 2), ch("c3", 3), ch("c4", 4), ch("c5", 5)];
}

function ref(point: string, start = 0, end = 5): KeyPointRef {
  return { point, quote: point, start, end };
}

function unit(over: Partial<UnitMastery> = {}): UnitMastery {
  return {
    mastery: 0.5,
    confidence: 0.5,
    attempts: 1,
    correctCount: 1,
    cognitiveLevel: "remember",
    misconceptions: [],
    applicationAbility: 0.5,
    interviewAbility: 0.5,
    ...over,
  };
}

/** 记录写库次数的存储（验证「无变化短路」不写盘）。 */
class CountingStorage extends InMemoryStorage {
  chapterSaves = 0;
  learnerSaves = 0;
  /** 清空计数：setup 阶段的预置写入不应计入断言。 */
  resetCounters(): void {
    this.chapterSaves = 0;
    this.learnerSaves = 0;
  }
  async saveChapters(documentId: string, chapters: Chapter[]): Promise<void> {
    this.chapterSaves += 1;
    return super.saveChapters(documentId, chapters);
  }
  async saveLearnerState(state: { byUnit: Record<string, UnitMastery> }): Promise<void> {
    this.learnerSaves += 1;
    return super.saveLearnerState(state);
  }
}

// ============================================================ A. 引擎原语

function testRenumber(): void {
  const cs = fiveChapters().map((c) => ({ ...c, order: 99 }));
  const out = renumberChapters(cs);
  assert.deepEqual(out.map((c) => c.order), [1, 2, 3, 4, 5]);
  // 其余字段不动。
  assert.deepEqual(out.map((c) => c.id), ["c1", "c2", "c3", "c4", "c5"]);
}

function testRenameApplies(): void {
  const cs = fiveChapters();
  const out = renameChapter(cs, "c2", "新标题");
  assert.equal(out[1].title, "新标题");
  // 其余章逐字段不变（浅比较引用即可：未命中的章原样返回）。
  assert.equal(out[0], cs[0]);
  assert.equal(out[2], cs[2]);
  assert.equal(out[1].order, 2);
  assert.deepEqual(out[1].contentRef, cs[1].contentRef);
  // 入参不被修改。
  assert.equal(cs[1].title, "第 2 章");
}

function testRenameBlankFallsBack(): void {
  const cs = fiveChapters();
  assert.equal(renameChapter(cs, "c1", "   ")[0].title, "第 1 章");
}

function testRenameUnknownIdIsNoop(): void {
  const cs = fiveChapters();
  const out = renameChapter(cs, "ghost", "x");
  assert.deepEqual(out.map((c) => c.title), cs.map((c) => c.title));
}

function testMergeAdjacentIdsAndRange(): void {
  const cs = fiveChapters();
  const r = mergeChapterRange(cs, "c2", "c3");
  assert.equal(r.chapters.length, 4);
  assert.equal(r.merged?.id, "c2"); // 保留首章 id
  assert.deepEqual(r.absorbedIds, ["c3"]);
  assert.deepEqual(r.merged?.contentRef, { start: 100, end: 300 });
  assert.deepEqual(r.chapters.map((c) => c.order), [1, 2, 3, 4]); // order 重写连续
  assert.deepEqual(r.chapters.map((c) => c.id), ["c1", "c2", "c4", "c5"]);
}

function testMergeKeyPointsUnionDedupe(): void {
  // 注意：要点须通过质量门（hasMeaningfulText 要求 ≥2 个字母/数字），故用双字符。
  const cs = [
    ch("c1", 1, { keyPoints: ["AA", "BB"] }),
    ch("c2", 2, { keyPoints: ["BB", "CC"] }),
  ];
  const m = mergeChapterRange(cs, "c1", "c2").merged!;
  assert.deepEqual(m.keyPoints, ["AA", "BB", "CC"]); // 去重且保序
}

function testMergeUnitIdsUnion(): void {
  const cs = [
    ch("c1", 1, { unitIds: ["u1", "u2"] }),
    ch("c2", 2, { unitIds: ["u2", "u3"] }),
  ];
  const m = mergeChapterRange(cs, "c1", "c2").merged!;
  assert.deepEqual([...m.unitIds].sort(), ["u1", "u2", "u3"]); // 缺陷 #2 修复
}

function testMergeKeyPointRefsStayInSync(): void {
  const cs = [
    ch("c1", 1, { keyPoints: ["AA", "BB"], keyPointRefs: [ref("AA"), ref("BB", 10, 15)] }),
    ch("c2", 2, { keyPoints: ["BB", "CC"], keyPointRefs: [ref("CC", 20, 25)] }),
  ];
  const m = mergeChapterRange(cs, "c1", "c2").merged!;
  assert.deepEqual(m.keyPoints, ["AA", "BB", "CC"]);
  // 缺陷 #3 修复：refs 与 keyPoints 逐条对齐，无脱同步。
  assert.deepEqual(m.keyPointRefs?.map((r) => r.point), ["AA", "BB", "CC"]);
}

function testMergeDropsStaleRefsWhenNoKeyPoints(): void {
  const cs = [
    ch("c1", 1, { keyPoints: [], keyPointRefs: [ref("孤儿")] }),
    ch("c2", 2, { keyPoints: [] }),
  ];
  const m = mergeChapterRange(cs, "c1", "c2").merged!;
  assert.deepEqual(m.keyPoints, []);
  assert.equal(m.keyPointRefs, undefined); // 不留首章旧 refs
}

function testMergeStatusTakesLowest(): void {
  const cs = [
    ch("c1", 1, { status: "mastered" }),
    ch("c2", 2, { status: "retake" }),
  ];
  assert.equal(mergeChapterRange(cs, "c1", "c2").merged?.status, "retake");
}

function testMergeCreatedAtTakesEarliest(): void {
  const cs = [ch("c1", 1, { createdAt: 500 }), ch("c2", 2, { createdAt: 100 })];
  assert.equal(mergeChapterRange(cs, "c1", "c2").merged?.createdAt, 100);
}

function testMergeKeepsMiddleChapterKeyPoints(): void {
  // 勾选第 2、4 章 → 第 3 章未被勾选但一并合并，其要点必须保留（缺陷 #1 修复）。
  const cs = fiveChapters();
  const r = mergeChapterRange(cs, "c2", "c4");
  assert.equal(r.chapters.length, 3);
  assert.deepEqual(r.absorbedIds, ["c3", "c4"]);
  assert.deepEqual(r.merged?.keyPoints, ["P2", "P3", "P4"]);
  assert.deepEqual(r.merged?.contentRef, { start: 100, end: 400 });
}

function testMergeKeyPointsCap(): void {
  const many = Array.from({ length: 10 }, (_, i) => `要点 ${i}`);
  const cs = [ch("c1", 1, { keyPoints: many }), ch("c2", 2, { keyPoints: [] })];
  const m = mergeChapterRange(cs, "c1", "c2").merged!;
  assert.equal(m.keyPoints.length, MERGED_KEY_POINTS_CAP);
}

function testMergeReversedRangeIsNoop(): void {
  const cs = fiveChapters();
  const r = mergeChapterRange(cs, "c5", "c2");
  assert.equal(r.merged, undefined);
  assert.deepEqual(r.absorbedIds, []);
  assert.equal(r.chapters, cs); // 同一引用，未改数据
}

function testReorderFull(): void {
  const cs = fiveChapters();
  const out = reorderChapters(cs, ["c3", "c1", "c2"]);
  assert.deepEqual(out.map((c) => c.id), ["c3", "c1", "c2", "c4", "c5"]); // 未列出的附后
  assert.deepEqual(out.map((c) => c.order), [1, 2, 3, 4, 5]);
}

function testReorderPartialKeepsRelativeOrder(): void {
  const cs = fiveChapters();
  const out = reorderChapters(cs, ["c2"]);
  assert.deepEqual(out.map((c) => c.id), ["c2", "c1", "c3", "c4", "c5"]);
  assert.deepEqual(out.map((c) => c.order), [1, 2, 3, 4, 5]);
}

function testReorderIgnoresUnknownId(): void {
  const cs = fiveChapters();
  const out = reorderChapters(cs, ["ghost", "c1"]);
  assert.deepEqual(out.map((c) => c.id), ["c1", "c2", "c3", "c4", "c5"]);
}

// ============================================================ B. 掌握度局部迁移

function testRemapMergesAndKeepsOthers(): void {
  const state = {
    byUnit: {
      c2: unit({ mastery: 0.9, attempts: 3, correctCount: 3 }),
      c3: unit({ mastery: 0.4, attempts: 2, correctCount: 1 }),
      c9: unit({ mastery: 0.7, attempts: 8, correctCount: 5 }),
    },
  };
  const r = remapMasteryOnChapterEdit(state, { keepId: "c2", absorbedIds: ["c3"] });
  assert.equal(r.carried, 1);
  assert.equal(r.dropped, 1);
  assert.equal(r.state.byUnit.c2.mastery, 0.9); // max
  assert.equal(r.state.byUnit.c2.attempts, 5); // sum
  assert.equal(r.state.byUnit.c3, undefined); // 被吞键删除
  // 关键回归点：未涉及的键完全不变。
  assert.deepEqual(r.state.byUnit.c9, state.byUnit.c9);
  assert.deepEqual(Object.keys(r.state.byUnit).sort(), ["c2", "c9"]);
}

function testRemapAbsorbedWithoutRecordIsNoop(): void {
  const state = { byUnit: { c9: unit() } };
  const r = remapMasteryOnChapterEdit(state, { keepId: "c2", absorbedIds: ["c3"] });
  assert.equal(r.carried, 0);
  assert.equal(r.dropped, 0);
  assert.equal(r.state, state); // 原引用，零改动
}

function testRemapUndefinedMergeIsNoop(): void {
  const state = { byUnit: { c1: unit() } };
  assert.equal(remapMasteryOnChapterEdit(state, undefined).state, state);
}

// ============================================================ C. 服务层

async function testServiceShortCircuitsOnUnchangedReorder(): Promise<void> {
  const storage = new CountingStorage();
  const cs = fiveChapters();
  await storage.saveChapters("doc1", cs);
  storage.resetCounters();
  const r = await applyChapterEdit(
    { id: "doc1", textPreview: TEXT },
    { storage, chapters: cs, edit: { kind: "reorder", orderedIds: ["c1", "c2", "c3", "c4", "c5"] } },
  );
  assert.equal(r.chunks, 0);
  assert.equal(storage.chapterSaves, 0); // 顺序未变 → 不写库
  assert.equal(storage.learnerSaves, 0);
}

async function testServiceShortCircuitsOnUnchangedRename(): Promise<void> {
  const storage = new CountingStorage();
  const cs = fiveChapters();
  await storage.saveChapters("doc1", cs);
  storage.resetCounters();
  const r = await applyChapterEdit(
    { id: "doc1", textPreview: TEXT },
    { storage, chapters: cs, edit: { kind: "rename", chapterId: "c2", title: "第 2 章" } },
  );
  assert.equal(r.chunks, 0);
  assert.equal(storage.chapterSaves, 0);
}

async function testServiceRenamePersistsAndRebuildsChunks(): Promise<void> {
  const storage = new CountingStorage();
  await storage.saveChapters("doc1", fiveChapters());
  storage.resetCounters();
  const r = await applyChapterEdit(
    { id: "doc1", textPreview: TEXT },
    {
      storage,
      chapters: await storage.listChapters("doc1"),
      edit: { kind: "rename", chapterId: "c2", title: "改过的标题" },
    },
  );
  assert.equal(r.chapters[1].title, "改过的标题");
  assert.equal(storage.chapterSaves, 1);
  assert.ok(r.chunks > 0); // chunk 已重建
  const chunks = await storage.listChunksByDocument("doc1");
  const forC2 = chunks.filter((c) => c.chapterId === "c2");
  assert.ok(forC2.length > 0);
  assert.equal(forC2[0].metadata?.heading, "改过的标题"); // heading 已更新
}

async function testServiceMergePersistsMastery(): Promise<void> {
  const storage = new CountingStorage();
  await storage.saveChapters("doc1", fiveChapters());
  await storage.saveLearnerState({
    byUnit: { c2: unit({ mastery: 0.9 }), c3: unit({ mastery: 0.4 }), c9: unit({ mastery: 0.7 }) },
  });

  const r = await applyChapterEdit(
    { id: "doc1", textPreview: TEXT },
    {
      storage,
      chapters: await storage.listChapters("doc1"),
      edit: { kind: "merge", fromId: "c2", toId: "c3" },
    },
  );

  assert.equal(r.absorbed, 1);
  assert.equal(r.carriedMastery, 1);
  assert.equal(r.droppedMastery, 1);

  // 落库后的章节与返回值一致。
  const persisted = await storage.listChapters("doc1");
  assert.deepEqual(persisted.map((c) => c.id), r.chapters.map((c) => c.id));
  assert.equal(persisted.length, 4);

  // 掌握度已迁移，且未涉及的键保留。
  const learner = await storage.getLearnerState();
  assert.equal(learner.byUnit.c2.mastery, 0.9);
  assert.equal(learner.byUnit.c3, undefined);
  assert.deepEqual(learner.byUnit.c9, unit({ mastery: 0.7 }));
}

async function testServiceRejectsInvalidEdits(): Promise<void> {
  const storage = new CountingStorage();
  const cs = fiveChapters();

  await assert.rejects(
    () => applyChapterEdit({ id: "doc1", textPreview: TEXT }, { storage, chapters: [], edit: { kind: "rename", chapterId: "c1", title: "x" } }),
    (e: unknown) => e instanceof ChapterEditError && e.kind === "no-chapters",
  );
  await assert.rejects(
    () => applyChapterEdit({ id: "doc1", textPreview: TEXT }, { storage, chapters: cs, edit: { kind: "rename", chapterId: "ghost", title: "x" } }),
    (e: unknown) => e instanceof ChapterEditError && e.kind === "chapter-not-found",
  );
  await assert.rejects(
    () => applyChapterEdit({ id: "doc1", textPreview: TEXT }, { storage, chapters: cs, edit: { kind: "merge", fromId: "c2", toId: "c2" } }),
    (e: unknown) => e instanceof ChapterEditError && e.kind === "invalid-range",
  );
  assert.equal(storage.chapterSaves, 0); // 校验失败不写任何数据
}

// ============================================================ D. 边界

function testSliceContractAfterMerge(): void {
  const cs = fiveChapters();
  const m = mergeChapterRange(cs, "c2", "c4").merged!;
  const slice = TEXT.slice(m.contentRef.start, m.contentRef.end);
  // 区间并集 == 区间内各章正文按序拼接（原文零丢失）。
  assert.equal(slice, TEXT.slice(cs[1].contentRef.start, cs[3].contentRef.end));
}

function testChapterCountInvariants(): void {
  const cs = fiveChapters();
  assert.equal(renameChapter(cs, "c1", "x").length, cs.length); // rename 不变
  assert.equal(reorderChapters(cs, ["c3"]).length, cs.length); // reorder 不变
  const m = mergeChapterRange(cs, "c2", "c4");
  assert.equal(m.chapters.length, cs.length - m.absorbedIds.length); // merge 减被吞数
}

// ------------------------------------------------------------- 执行

const tests: [string, () => Promise<void> | void][] = [
  ["A/renumberChapters 重写 order 1..n", testRenumber],
  ["A/renameChapter 应用新标题", testRenameApplies],
  ["A/renameChapter 空白回退原名", testRenameBlankFallsBack],
  ["A/renameChapter 未知 id 不抛错", testRenameUnknownIdIsNoop],
  ["A/mergeChapterRange 相邻合并（id/range/order）", testMergeAdjacentIdsAndRange],
  ["A/mergeChapterRange keyPoints 并集去重", testMergeKeyPointsUnionDedupe],
  ["A/mergeChapterRange unitIds 并集（缺陷 #2）", testMergeUnitIdsUnion],
  ["A/mergeChapterRange refs 与 keyPoints 对齐（缺陷 #3）", testMergeKeyPointRefsStayInSync],
  ["A/mergeChapterRange 无要点时清空 refs", testMergeDropsStaleRefsWhenNoKeyPoints],
  ["A/mergeChapterRange status 取最低（保守）", testMergeStatusTakesLowest],
  ["A/mergeChapterRange createdAt 取最早", testMergeCreatedAtTakesEarliest],
  ["A/mergeChapterRange 中间章要点保留（缺陷 #1）", testMergeKeepsMiddleChapterKeyPoints],
  ["A/mergeChapterRange keyPoints 截断至上限", testMergeKeyPointsCap],
  ["A/mergeChapterRange 反向区间原样返回", testMergeReversedRangeIsNoop],
  ["A/reorderChapters 全量重排", testReorderFull],
  ["A/reorderChapters 部分列表保持相对顺序", testReorderPartialKeepsRelativeOrder],
  ["A/reorderChapters 未知 id 忽略", testReorderIgnoresUnknownId],
  ["B/remap 合并保留章且其他键不变", testRemapMergesAndKeepsOthers],
  ["B/remap 被吞章无记录则零改动", testRemapAbsorbedWithoutRecordIsNoop],
  ["B/remap merge 为 undefined 则零改动", testRemapUndefinedMergeIsNoop],
  ["C/服务层 顺序未变短路不写盘", testServiceShortCircuitsOnUnchangedReorder],
  ["C/服务层 标题未变短路不写盘", testServiceShortCircuitsOnUnchangedRename],
  ["C/服务层 重命名落库并重建 chunk", testServiceRenamePersistsAndRebuildsChunks],
  ["C/服务层 合并落库并迁移掌握度", testServiceMergePersistsMastery],
  ["C/服务层 非法编辑抛类型化错误且不写盘", testServiceRejectsInvalidEdits],
  ["D/切片契约：合并区间 == 各章正文拼接", testSliceContractAfterMerge],
  ["D/章数不变量（rename/merge/reorder）", testChapterCountInvariants],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ❌ ${name}`);
    console.error(err);
  }
}
if (failed > 0) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log(`\n全部 ${tests.length} 项通过`);
