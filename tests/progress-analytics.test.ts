/**
 * F3 · 复盘与趋势 `analytics.ts` 单测（docs/progress-analytics-design-2026-09.md §12）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:progress
 *
 * 覆盖：热力图分桶与色阶（UC-01）· 趋势累积快照（UC-02）· 弱点三因子（UC-03）·
 * 时间线范围过滤与除零（UC-04）· 回归 2 条（REG）· 边界 16 条（EDGE）。
 *
 * ⚠️ 两条本文件特有的纪律：
 * 1. **时间基准唯一**：所有 `at` 由固定 `NOW` 派生，绝不取真实时钟；
 * 2. **时区不写死**：分桶断言一律用**相对断言**（先算 `mondayIndex(NOW)` 再定位行），
 *    绝不写死某列的绝对索引 —— 否则非 UTC+8 的机器会假红（方案 §11.2）。
 */
import assert from "node:assert/strict";
import {
  buildHeatmap,
  buildTimeline,
  buildTrend,
  buildWeakness,
  heatLevel,
  mondayIndex,
  HEATMAP_WEEKS,
  MISCONCEPTION_CAP,
} from "../src/features/progress/analytics.ts";
import { EVIDENCE_LOG_MAX, InMemoryStorage } from "../src/storage/memory.ts";
import { MASTERY_FLOOR } from "../src/domain/plan.ts";
import type { ActivityDay } from "../src/features/progress/analytics.ts";
import type { EvidenceEntry, EvidenceKind } from "../src/domain/evidence.ts";
import type { LearnerState, UnitMastery } from "../src/domain/learner.ts";
import type { PaperResult } from "../src/domain/quiz.ts";

const DAY = 86_400_000;
/** 固定「现在」（本地时区 2026-09-15 12:00 —— 查表为**周二**）。 */
const NOW = new Date("2026-09-15T12:00:00").getTime();

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

/* ---------------- 夹具 ---------------- */

/** 本地时区 `YYYY-MM-DD`（测试内独立实现，不复用被测模块的私有函数）。 */
function keyOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ev(at: number, subjectId = "c1", kind: EvidenceKind = "review"): EvidenceEntry {
  return { at, kind, subjectId, delta: 0 };
}

function paper(
  createdAt: number,
  perChapter: Record<string, { score: number; previousMastery: number; mastery: number }>,
): PaperResult {
  return { paperId: `p${createdAt}`, totalScore: 0, perChapter, wrongQuestions: [], createdAt };
}

function unit(
  mastery: number,
  opts: { attempts?: number; misconceptions?: string[] } = {},
): UnitMastery {
  return {
    mastery,
    confidence: mastery,
    attempts: opts.attempts ?? 1,
    correctCount: 1,
    cognitiveLevel: "understand",
    misconceptions: opts.misconceptions ?? [],
    applicationAbility: 0,
    interviewAbility: 0,
  };
}

function lstate(byUnit: Record<string, UnitMastery>): LearnerState {
  return { byUnit };
}

/** 网格内所有已渲染的格子（含 0 条）。 */
function cells(hm: ReturnType<typeof buildHeatmap>): ActivityDay[] {
  const out: ActivityDay[] = [];
  for (const col of hm.weeks) {
    for (const day of col) {
      if (day) out.push(day);
    }
  }
  return out;
}

function cellOf(hm: ReturnType<typeof buildHeatmap>, dateKey: string): ActivityDay | undefined {
  return cells(hm).find((d) => d.dateKey === dateKey);
}

/** 章标题解析器：只为 c1/c2/c3 提供标题（其余视为脏 key）。 */
const TITLES: Record<string, string> = { c1: "第一章", c2: "第二章", c3: "第三章" };
const titleOf = (id: string): string | undefined => TITLES[id];

/* ---------------- UC-01 学习活动热力图 ---------------- */

await check("TC-UC01-01 同一天 3 条 evidence → 该日 count 3，其余为 0", () => {
  const d = new Date("2026-09-15T09:00:00").getTime();
  const hm = buildHeatmap([ev(d), ev(d + 3600_000), ev(d + 7200_000)], { now: NOW });
  const cell = cellOf(hm, keyOf(NOW));
  assert.ok(cell, "今天应有格子");
  assert.equal(cell.count, 3);
  assert.equal(cells(hm).filter((c) => c.count > 0).length, 1, "只有一天有记录");
  assert.equal(hm.totalCount, 3);
  assert.equal(hm.maxCount, 3);
});

await check("TC-UC01-02 色阶 5 档：0/1/2/3/5/6 → 0/1/2/2/3/4", () => {
  assert.equal(heatLevel(0), 0);
  assert.equal(heatLevel(1), 1);
  assert.equal(heatLevel(2), 2);
  assert.equal(heatLevel(3), 2);
  assert.equal(heatLevel(5), 3);
  assert.equal(heatLevel(6), 4);
  assert.equal(heatLevel(99), 4);
});

await check("TC-UC01-03 默认窗口 26 周 × 每列 7 格", () => {
  const hm = buildHeatmap([], { now: NOW });
  assert.equal(hm.weeks.length, HEATMAP_WEEKS);
  assert.equal(hm.weeks.length, 26);
  for (const col of hm.weeks) assert.equal(col.length, 7);
});

await check("TC-UC01-04 今天之后的格子为 undefined（相对断言，不写死列号）", () => {
  const hm = buildHeatmap([ev(NOW)], { now: NOW });
  const mi = mondayIndex(NOW);
  const lastCol = hm.weeks[hm.weeks.length - 1];
  for (let d = 0; d < 7; d += 1) {
    if (d > mi) assert.equal(lastCol[d], undefined, `今天之后（行 ${d}）不应渲染`);
    else assert.ok(lastCol[d], `今天及之前（行 ${d}）应渲染`);
  }
  // 今天那条落在最后一列的「今天所在行」。
  assert.equal(lastCol[mi]?.count, 1);
});

await check("TC-UC01-05 空 entries → maxCount/totalCount 0、covered 区间 undefined", () => {
  const hm = buildHeatmap([], { now: NOW });
  assert.equal(hm.maxCount, 0);
  assert.equal(hm.totalCount, 0);
  assert.equal(hm.coveredFrom, undefined);
  assert.equal(hm.coveredTo, undefined);
  assert.equal(hm.truncated, false);
});

/* ---------------- UC-02 掌握度趋势 ---------------- */

await check("TC-UC02-01 第 2 份卷只含 1 章 → chapterCount 仍为 2（累积口径）", () => {
  const t = buildTrend(
    [paper(NOW - DAY, { c1: { score: 0.4, previousMastery: 0, mastery: 0.4 } }),
     paper(NOW, { c2: { score: 0.6, previousMastery: 0, mastery: 0.6 } })],
    titleOf,
  );
  assert.equal(t.points.length, 2);
  assert.equal(t.points[0].chapterCount, 1);
  assert.equal(t.points[1].chapterCount, 2, "累积，不是本卷覆盖数");
});

await check("TC-UC02-02 输入降序 → 输出按 at 升序", () => {
  const t = buildTrend(
    [paper(NOW, { c1: { score: 0.5, previousMastery: 0, mastery: 0.5 } }),
     paper(NOW - 2 * DAY, { c1: { score: 0.2, previousMastery: 0, mastery: 0.2 } }),
     paper(NOW - DAY, { c1: { score: 0.3, previousMastery: 0, mastery: 0.3 } })],
    titleOf,
  );
  assert.deepEqual(t.points.map((p) => p.at), [NOW - 2 * DAY, NOW - DAY, NOW]);
});

await check("TC-UC02-03 同一章两卷 0.3 → 0.5：series 2 点且快照取后者", () => {
  const t = buildTrend(
    [paper(NOW - DAY, { c1: { score: 0.3, previousMastery: 0, mastery: 0.3 } }),
     paper(NOW, { c1: { score: 0.5, previousMastery: 0.3, mastery: 0.5 } })],
    titleOf,
  );
  const series = t.chapters.find((c) => c.id === "c1");
  assert.ok(series);
  assert.equal(series.points.length, 2);
  assert.equal(series.points[0].mastery, 0.3);
  assert.equal(series.points[1].mastery, 0.5);
  assert.equal(t.points[1].avgMastery, 0.5, "累积表被后者覆盖");
});

await check("TC-UC02-04 单份卷 → 1 个点（页面据此画单点）", () => {
  const t = buildTrend([paper(NOW, { c1: { score: 0.5, previousMastery: 0, mastery: 0.5 } })], titleOf);
  assert.equal(t.points.length, 1);
  assert.equal(t.paperCount, 1);
});

// ⚠️ 与弱点榜的**数据口径**刻意不同（趋势读「试卷历史」→ 章删了序列仍在；
// 弱点榜读「当前 byUnit」→ 不可解析的主体不入视图，见 TC-REG-02），但两者在
// **「解析不到」的呈现**上遵循同一条规矩：**绝不把内部 id 当标题**。
// 2026-09-21 口径修正：原实现 `titleOf(id) ?? id` 会让 `/progress` 趋势下拉
// 直接显示 `chp-1e79433b`（真实库取证：已随资料删除的章仍留在 2 份卷的 perChapter）。
await check("TC-UC02-05 试卷里章已删 → 序列与历史点保留，但 title 留空（不回落裸 id）", () => {
  const t = buildTrend([paper(NOW, { ghost: { score: 0.5, previousMastery: 0, mastery: 0.5 } })], titleOf);
  assert.equal(t.chapters.length, 1, "历史序列仍保留（仍可下钻看曲线）");
  assert.equal(t.chapters[0].id, "ghost");
  assert.equal(t.chapters[0].title, undefined, "解析不到 → 必须留空，不得回落成 id");
  assert.equal(t.chapters[0].points.length, 1, "历史点不丢");
});

/* ---------------- UC-03 弱点排行（三因子） ---------------- */

await check("TC-UC03-01 A(0.2/卷面0.3/0误解) 排在 B(0.2/无卷/3误解) 之前", () => {
  const items = buildWeakness(
    lstate({ c1: unit(0.2), c2: unit(0.2, { misconceptions: ["m1", "m2", "m3"] }) }),
    [paper(NOW, { c1: { score: 0.3, previousMastery: 0, mastery: 0.2 } })],
    titleOf,
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "c1", "A 应在前");
  const gapA = items[0].factors.gap;
  assert.ok(Math.abs(items[0].score - (0.5 * gapA + 0.3 * 0.7)) < 1e-9);
  assert.ok(Math.abs(items[1].score - (0.5 * gapA + 0.2 * 1)) < 1e-9);
});

await check("TC-UC03-02 limit 5、8 个候选 → 返回 5 条且降序", () => {
  const byUnit: Record<string, UnitMastery> = {};
  for (let i = 0; i < 8; i += 1) byUnit[`c${i}`] = unit(0.1 * (i + 1));
  const items = buildWeakness(lstate(byUnit), [], (id) => `标题 ${id}`, 5);
  assert.equal(items.length, 5);
  for (let i = 1; i < items.length; i += 1) {
    assert.ok(items[i - 1].score >= items[i].score, "必须降序");
  }
});

await check("TC-UC03-03 titleOf 返回 undefined → 不入榜", () => {
  const items = buildWeakness(lstate({ ghost: unit(0.1) }), [], titleOf);
  assert.equal(items.length, 0);
});

/* ---------------- UC-04 目标进度时间线 ---------------- */

await check("TC-UC04-01 范围 3 章、2 章被考且 1 章达标 → 0.5 / 2 / 3", () => {
  const tl = buildTimeline(
    [paper(NOW, {
      c1: { score: 0.9, previousMastery: 0, mastery: 0.9 },
      c2: { score: 0.3, previousMastery: 0, mastery: 0.3 },
    })],
    { id: "g1", title: "目标", requiredChapterIds: ["c1", "c2", "c3"] },
  );
  assert.ok(tl);
  assert.equal(tl.points.length, 1);
  assert.equal(tl.points[0].readiness, 0.5);
  assert.equal(tl.points[0].covered, 2);
  assert.equal(tl.points[0].required, 3);
});

await check("TC-UC04-02 范围外的章不参与 readiness（covered 不变）", () => {
  const tl = buildTimeline(
    [paper(NOW, {
      c1: { score: 0.9, previousMastery: 0, mastery: 0.9 },
      zz: { score: 0.1, previousMastery: 0, mastery: 0.1 },
    })],
    { id: "g1", title: "目标", requiredChapterIds: ["c1", "c2"] },
  );
  assert.ok(tl);
  assert.equal(tl.points[0].covered, 1, "范围外的 zz 不计入");
  assert.equal(tl.points[0].readiness, 1);
});

await check("TC-UC04-03 requiredChapterIds 为空 → undefined", () => {
  assert.equal(buildTimeline([paper(NOW, { c1: { score: 0.9, previousMastery: 0, mastery: 0.9 } })], { id: "g", title: "t", requiredChapterIds: [] }), undefined);
  assert.equal(buildTimeline([paper(NOW, {})], { id: "g", title: "t" }), undefined);
});

await check("TC-UC04-04 无 deadline → 仍产点且 deadlineAt undefined", () => {
  const tl = buildTimeline([paper(NOW, { c1: { score: 0.9, previousMastery: 0, mastery: 0.9 } })], { id: "g", title: "t", requiredChapterIds: ["c1"] });
  assert.ok(tl);
  assert.equal(tl.deadlineAt, undefined);
});

/* ---------------- 回归 ---------------- */

await check("TC-REG-01 四个 build* 不修改入参", () => {
  const entries = [ev(NOW), ev(NOW - DAY)];
  const papers = [paper(NOW, { c1: { score: 0.3, previousMastery: 0, mastery: 0.3 } })];
  const st = lstate({ c1: unit(0.3, { misconceptions: ["m"] }) });
  const goal = { id: "g", title: "t", requiredChapterIds: ["c1"] };

  const snapE = JSON.stringify(entries);
  const snapP = JSON.stringify(papers);
  const snapS = JSON.stringify(st);
  const snapG = JSON.stringify(goal);

  buildHeatmap(entries, { now: NOW });
  buildTrend(papers, titleOf);
  buildWeakness(st, papers, titleOf);
  buildTimeline(papers, goal);

  assert.equal(JSON.stringify(entries), snapE);
  assert.equal(JSON.stringify(papers), snapP);
  assert.equal(JSON.stringify(st), snapS);
  assert.equal(JSON.stringify(goal), snapG);
});

await check("TC-REG-02 byUnit 脏 key 不出现在任何输出", () => {
  // 脏 key 仅存在于 byUnit（试卷记录里没有它）—— 弱点榜读 byUnit，故必须过滤。
  const st = lstate({ ghost: unit(0.2), c1: unit(0.3) });
  const papers = [paper(NOW, { c1: { score: 0.2, previousMastery: 0, mastery: 0.3 } })];
  const items = buildWeakness(st, papers, titleOf);
  assert.deepEqual(items.map((i) => i.id), ["c1"]);
  const t = buildTrend(papers, titleOf);
  assert.equal(t.chapters.some((c) => c.id === "ghost"), false);
});

/* ---------------- 边界 ---------------- */

await check("TC-EDGE-01 全部 evidence 同一天 → maxCount === totalCount", () => {
  const hm = buildHeatmap([ev(NOW), ev(NOW - 1000), ev(NOW - 2000)], { now: NOW });
  assert.equal(hm.maxCount, hm.totalCount);
  assert.equal(cells(hm).filter((c) => c.count > 0).length, 1);
});

await check("TC-EDGE-02 跨年（12/31 与 1/1）分到不同 dateKey", () => {
  const dec = new Date("2025-12-31T10:00:00").getTime();
  const jan = new Date("2026-01-01T10:00:00").getTime();
  const hm = buildHeatmap([ev(dec), ev(jan)], { now: new Date("2026-01-05T12:00:00").getTime() });
  assert.notEqual(keyOf(dec), keyOf(jan));
  assert.equal(cellOf(hm, keyOf(dec))?.count, 1);
  assert.equal(cellOf(hm, keyOf(jan))?.count, 1);
  assert.equal(hm.totalCount, 2);
});

await check("TC-EDGE-03 entries 达上限 → truncated true", () => {
  const many: EvidenceEntry[] = [];
  for (let i = 0; i < EVIDENCE_LOG_MAX; i += 1) many.push(ev(NOW - i * DAY));
  assert.equal(buildHeatmap(many, { now: NOW }).truncated, true);
});

await check("TC-EDGE-04 entries 差 1 条 → truncated false", () => {
  const many: EvidenceEntry[] = [];
  for (let i = 0; i < EVIDENCE_LOG_MAX - 1; i += 1) many.push(ev(NOW - i * DAY));
  assert.equal(buildHeatmap(many, { now: NOW }).truncated, false);
});

await check("TC-EDGE-05 results 为空 → 空曲线", () => {
  const t = buildTrend([], titleOf);
  assert.deepEqual(t.points, []);
  assert.equal(t.paperCount, 0);
  assert.deepEqual(t.chapters, []);
});

await check("TC-EDGE-06 perChapter 空对象 → 出点但 chapterCount 0，且不 NaN", () => {
  const t = buildTrend([paper(NOW, {})], titleOf);
  assert.equal(t.points.length, 1);
  assert.equal(t.points[0].chapterCount, 0);
  assert.equal(Number.isNaN(t.points[0].avgMastery), false);
  assert.equal(t.points[0].avgMastery, 0);
});

await check("TC-EDGE-07 mastery 0 且 attempts 0 → 不入弱点榜", () => {
  const items = buildWeakness(lstate({ c1: unit(0, { attempts: 0 }) }), [], titleOf);
  assert.equal(items.length, 0, "未开始 ≠ 弱点");
});

await check("TC-EDGE-08 满分掌握 + 卷面 1.0 + 零误解 → score 0 不入榜", () => {
  const items = buildWeakness(
    lstate({ c1: unit(1) }),
    [paper(NOW, { c1: { score: 1, previousMastery: 1, mastery: 1 } })],
    titleOf,
  );
  assert.equal(items.length, 0);
});

await check(`TC-EDGE-09 ${MISCONCEPTION_CAP} 条误解即封顶`, () => {
  const capped = buildWeakness(lstate({ c1: unit(0.5, { misconceptions: ["a", "b", "c"] }) }), [], titleOf);
  const long = buildWeakness(
    lstate({ c1: unit(0.5, { misconceptions: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] }) }),
    [],
    titleOf,
  );
  assert.equal(capped[0].factors.misconceptions, 3);
  assert.equal(long[0].factors.misconceptions, 10, "原值仍如实上报");
  assert.ok(Math.abs(capped[0].score - long[0].score) < 1e-9, "综合分因封顶而相同");
});

await check("TC-EDGE-10 mastery 恰为 MASTERY_FLOOR → gap 0（不是负值）", () => {
  const items = buildWeakness(
    lstate({ c1: unit(MASTERY_FLOOR, { misconceptions: ["m"] }) }),
    [],
    titleOf,
  );
  assert.equal(items[0].factors.gap, 0);
});

await check("TC-EDGE-11 goal undefined → undefined，不抛", () => {
  assert.equal(buildTimeline([paper(NOW, { c1: { score: 0.5, previousMastery: 0, mastery: 0.5 } })], undefined), undefined);
});

await check("TC-EDGE-12 所有卷都不含范围内章 → undefined", () => {
  const tl = buildTimeline(
    [paper(NOW, { zz: { score: 0.5, previousMastery: 0, mastery: 0.5 } })],
    { id: "g", title: "t", requiredChapterIds: ["c1"] },
  );
  assert.equal(tl, undefined);
});

await check("TC-EDGE-13 时间线只有 1 点 → 仍返回（不是 undefined）", () => {
  const tl = buildTimeline(
    [paper(NOW, { c1: { score: 0.9, previousMastery: 0, mastery: 0.9 } })],
    { id: "g", title: "t", requiredChapterIds: ["c1", "c2"] },
  );
  assert.ok(tl);
  assert.equal(tl.points.length, 1);
});

await check("TC-EDGE-14 同 at 的两份卷 → 两点同横坐标，不丢点不除零", () => {
  const t = buildTrend(
    [paper(NOW, { c1: { score: 0.2, previousMastery: 0, mastery: 0.2 } }),
     paper(NOW, { c2: { score: 0.8, previousMastery: 0, mastery: 0.8 } })],
    titleOf,
  );
  assert.equal(t.points.length, 2);
  assert.equal(t.points[0].at, t.points[1].at);
  assert.equal(t.points[1].avgMastery, 0.5);
  assert.equal(Number.isNaN(t.points[1].avgMastery), false);
});

await check("TC-EDGE-15 mondayIndex：周日 = 6、周一 = 0", () => {
  assert.equal(mondayIndex(new Date("2026-09-20T12:00:00").getTime()), 6, "周日 → 6");
  assert.equal(mondayIndex(new Date("2026-09-14T12:00:00").getTime()), 0, "周一 → 0");
  assert.equal(mondayIndex(new Date("2026-09-15T12:00:00").getTime()), 1, "周二 → 1");
});

await check("TC-EDGE-16 append 超上限 → 长度封顶且保留最新", async () => {
  const s = new InMemoryStorage();
  for (let i = 0; i <= EVIDENCE_LOG_MAX; i += 1) {
    await s.appendEvidence(ev(i, `c${i}`));
  }
  const list = await s.listEvidence();
  assert.equal(list.length, EVIDENCE_LOG_MAX, "长度恰好为上限");
  // listEvidence 按 at 降序 → 首条 at = 最大值，末条 = 被保留的最旧一条。
  assert.equal(list[0].at, EVIDENCE_LOG_MAX, "最新一条在");
  assert.equal(list[list.length - 1].at, 1, "at = 0 的最旧一条已被丢弃");
});

/* ---------------- 汇总 ---------------- */

console.log(`\n[progress-analytics] ${results.length - failures}/${results.length} 通过\n`);
for (const line of results) console.log("  " + line);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
