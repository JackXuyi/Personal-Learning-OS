/**
 * 出卷题量配额单测（内容驱动：每个要点 2 题）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:quiz
 *
 * 覆盖三块：
 *   1) `objectiveQuotaFor` —— 逐要点定量 + [4,12] 收敛 + 无要点章保底；
 *   2) `createPaper` —— 覆盖优先（每个要点都被考到）、题型交替、判断真假交替、
 *      选择题干扰项按题轮转、补考降档、综合测维持 15–20 总量；
 *   3) **防漂移**：`plannedQuota`（UI 预览）与实际出卷题量逐格相等 ——
 *      「UI 说 10 题、实际出 6 题」这类两把尺子必须由测试挡死。
 */
import assert from "node:assert/strict";
import { createPaper, objectiveQuotaFor, plannedQuota } from "../src/engine/quiz-engine.ts";
import type { Chapter, LearnerState, PaperMode } from "../src/domain";

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

/** 章：`points` 个要点（要点内容 = 章 id + 序号，便于断言覆盖与干扰项来源）。 */
function chapter(id: string, order: number, points: number, documentId = "d1"): Chapter {
  return {
    id,
    documentId,
    order,
    title: `${id} 标题`,
    contentRef: { start: 0, end: 1000 },
    keyPoints: Array.from({ length: points }, (_, i) => `${id}-要点${i + 1}`),
    unitIds: [],
    status: "not-started",
    createdAt: 1,
  };
}

/** 有证据且 band 2（mastery 0.5）→ 主观题可出（band>1）。 */
function evidenced(ids: string[]): LearnerState {
  return {
    byUnit: Object.fromEntries(
      ids.map((id) => [id, { mastery: 0.5, attempts: 1 } as never]),
    ),
  } as LearnerState;
}

const MODES: PaperMode[] = ["unit-test", "stage-test", "retake", "final-test"];

async function main() {
  /* ============ 1) 单章配额 ============ */

  await check("TC-Q-01 每要点 2 题：3 要点 → 6 题", () => {
    assert.equal(objectiveQuotaFor(chapter("c1", 1, 3)), 6);
    assert.equal(objectiveQuotaFor(chapter("c2", 1, 5)), 10);
  });

  await check("TC-Q-02 下限 4：1–2 个要点也至少 4 题", () => {
    assert.equal(objectiveQuotaFor(chapter("c1", 1, 1)), 4);
    assert.equal(objectiveQuotaFor(chapter("c2", 1, 2)), 4);
  });

  await check("TC-Q-03 上限 12：要点过多时收敛（合并章不再无限膨胀）", () => {
    assert.equal(objectiveQuotaFor(chapter("c1", 1, 6)), 12);
    assert.equal(objectiveQuotaFor(chapter("c2", 1, 8)), 12);
  });

  await check("TC-Q-04 无要点章（只有标题）→ 保底 3 题（= 改动前行为）", () => {
    assert.equal(objectiveQuotaFor(chapter("c1", 1, 0)), 3);
  });

  /* ============ 2) 出卷行为 ============ */

  await check("TC-Q-05 单元测：5 要点 → 10 题，且每个要点都被考到", () => {
    const ch = chapter("c1", 1, 5);
    const paper = createPaper({
      scope: { chapterIds: ["c1"], mode: "unit-test" },
      chapters: [ch],
      allChapters: [ch],
    });
    assert.equal(paper.questions.length, 10);
    // 选择题题干不含要点，但正确项必落在 options 里：每个要点都应作为正确项出现 1 次。
    const corrects = paper.questions
      .filter((q) => q.type === "choice")
      .map((q) => q.options?.[Number(q.answer)]);
    for (const kp of ch.keyPoints) {
      assert.ok(corrects.includes(kp), `要点未被考到：${kp}`);
    }
  });

  await check("TC-Q-06 每个要点先选后判（题型交替，同要点成对出现）", () => {
    const ch = chapter("c1", 1, 3);
    const paper = createPaper({
      scope: { chapterIds: ["c1"], mode: "unit-test" },
      chapters: [ch],
      allChapters: [ch],
    });
    assert.deepEqual(
      paper.questions.map((q) => q.type),
      ["choice", "judge", "choice", "judge", "choice", "judge"],
    );
  });

  await check("TC-Q-07 判断题真假交替：不再「一律答真」", () => {
    const ch = chapter("c1", 1, 5);
    const paper = createPaper({
      scope: { chapterIds: ["c1"], mode: "unit-test" },
      chapters: [ch],
      allChapters: [ch, chapter("c2", 2, 3)],
    });
    const answers = paper.questions.filter((q) => q.type === "judge").map((q) => q.answer);
    assert.deepEqual(answers, ["true", "false", "true", "false", "true"]);
  });

  await check("TC-Q-08 伪陈述取自**其他章**要点（本章要点不得当假题）", () => {
    const ch = chapter("c1", 1, 3);
    const other = chapter("c2", 2, 3);
    const paper = createPaper({
      scope: { chapterIds: ["c1"], mode: "unit-test" },
      chapters: [ch],
      allChapters: [ch, other],
    });
    const falses = paper.questions.filter((q) => q.type === "judge" && q.answer === "false");
    assert.ok(falses.length > 0);
    for (const q of falses) {
      assert.ok(
        other.keyPoints.some((kp) => q.prompt.includes(kp)),
        `假题陈述不来自其他章：${q.prompt}`,
      );
    }
  });

  await check("TC-Q-09 干扰项按题轮转：同章多道选择题不再复用同一组选项", () => {
    const ch = chapter("c1", 1, 5);
    const paper = createPaper({
      scope: { chapterIds: ["c1"], mode: "unit-test" },
      chapters: [ch],
      allChapters: [ch, chapter("c2", 2, 5), chapter("c3", 3, 5)],
    });
    const wrongSets = paper.questions
      .filter((q) => q.type === "choice")
      .map((q) =>
        (q.options ?? [])
          .filter((_, i) => String(i) !== q.answer)
          .sort()
          .join("|"),
      );
    assert.ok(new Set(wrongSets).size > 1, `所有选择题干扰项完全相同：${wrongSets[0]}`);
  });

  await check("TC-Q-10 范围外无同文档章时用中性兜底句补齐 3 个干扰项", () => {
    const ch = chapter("c1", 1, 3);
    const paper = createPaper({
      scope: { chapterIds: ["c1"], mode: "unit-test" },
      chapters: [ch],
      allChapters: [ch],
    });
    const first = paper.questions.find((q) => q.type === "choice");
    assert.equal(first?.options?.length, 4);
  });

  await check("TC-Q-11 主观题规则不变：band>1 且有 AI → 单元测 +2 / 阶段测每章 +1 / 补考 0", () => {
    const c1 = chapter("c1", 1, 2);
    const c2 = chapter("c2", 2, 2);
    const state = evidenced(["c1", "c2"]);
    const unit = createPaper({
      scope: { chapterIds: ["c1"], mode: "unit-test" },
      chapters: [c1],
      allChapters: [c1, c2],
      learnerState: state,
      allowSubjective: true,
    });
    assert.equal(unit.questions.length, 4 + 2);
    const stage = createPaper({
      scope: { chapterIds: ["c1", "c2"], mode: "stage-test" },
      chapters: [c1, c2],
      allChapters: [c1, c2],
      learnerState: state,
      allowSubjective: true,
    });
    assert.equal(stage.questions.length, 4 + 4 + 2);
    const retake = createPaper({
      scope: { chapterIds: ["c1"], mode: "retake" },
      chapters: [c1],
      allChapters: [c1, c2],
      learnerState: state,
      allowSubjective: true,
    });
    assert.equal(retake.questions.length, 4);
    assert.ok(retake.questions.every((q) => q.type === "choice" || q.type === "judge"));
  });

  await check("TC-Q-12 补考卷难度降一档（band2 → 客观难度 1）", () => {
    const ch = chapter("c1", 1, 2);
    const paper = createPaper({
      scope: { chapterIds: ["c1"], mode: "retake" },
      chapters: [ch],
      allChapters: [ch],
      learnerState: evidenced(["c1"]),
    });
    assert.ok(paper.questions.every((q) => q.difficulty === 1));
  });

  await check("TC-Q-13 综合测配额不变：总 clamp(3n,15,20)", () => {
    const chapters = Array.from({ length: 8 }, (_, i) => chapter(`c${i + 1}`, i + 1, 5));
    const paper = createPaper({
      scope: { chapterIds: chapters.map((c) => c.id), mode: "final-test" },
      chapters,
      allChapters: chapters,
    });
    assert.equal(paper.questions.length, 20);
    assert.equal(plannedQuota({ mode: "final-test", chapters }).total, 20);
  });

  /* ============ 3) 防漂移：UI 预览 = 实际出卷 ============ */

  await check("TC-Q-14 plannedQuota 与实际题量逐格相等（四种卷型 × 有无主观）", () => {
    const chapters = [chapter("c1", 1, 5), chapter("c2", 2, 3), chapter("c3", 3, 0)];
    const state = evidenced(chapters.map((c) => c.id));
    for (const mode of MODES) {
      for (const allowSubjective of [false, true]) {
        const ids =
          mode === "unit-test" ? ["c1"] : mode === "final-test" ? [] : chapters.map((c) => c.id);
        // 综合测要求多章（canCreatePaperMode 的校验在服务层，这里直接给出全部章）。
        const scopeChapters =
          mode === "unit-test" ? [chapters[0]] : chapters;
        const paper = createPaper({
          scope: { chapterIds: ids.length > 0 ? ids : scopeChapters.map((c) => c.id), mode },
          chapters: scopeChapters,
          allChapters: chapters,
          learnerState: state,
          allowSubjective,
        });
        const planned = plannedQuota({
          mode,
          chapters: scopeChapters,
          allowSubjective,
          learnerState: state,
        });
        assert.equal(
          planned.total,
          paper.questions.length,
          `${mode} / allowSubjective=${allowSubjective}：预览 ${planned.total} ≠ 实际 ${paper.questions.length}`,
        );
      }
    }
  });

  await check("TC-Q-15 plannedQuota 与 createPaper 的章序无关（乱序输入同样成立）", () => {
    const chapters = [chapter("c1", 1, 5), chapter("c2", 2, 3), chapter("c3", 3, 2)];
    const shuffled = [chapters[2], chapters[0], chapters[1]];
    const planned = plannedQuota({ mode: "stage-test", chapters: shuffled });
    assert.equal(planned.total, 10 + 6 + 4);
  });

  await check("TC-Q-16 无要点章保底 3 题（createPaper 与预览一致）", () => {
    const ch = chapter("c1", 1, 0);
    const paper = createPaper({
      scope: { chapterIds: ["c1"], mode: "unit-test" },
      chapters: [ch],
      allChapters: [ch],
    });
    assert.equal(paper.questions.length, 3);
    assert.deepEqual(
      paper.questions.map((q) => q.type),
      ["choice", "judge", "choice"],
    );
    assert.equal(plannedQuota({ mode: "unit-test", chapters: [ch] }).total, 3);
  });

  await check("TC-Q-17 空范围 → 0 题（不抛错）", () => {
    assert.deepEqual(plannedQuota({ mode: "unit-test", chapters: [] }), {
      objective: 0,
      subjective: 0,
      total: 0,
    });
    const paper = createPaper({
      scope: { chapterIds: [], mode: "unit-test" },
      chapters: [],
    });
    assert.equal(paper.questions.length, 0);
  });

  process.stdout.write(`${results.join("\n")}\n`);
  process.stdout.write(`\n${results.length - failures}/${results.length} 通过\n`);
  if (failures > 0) process.exit(1);
}

void main();
