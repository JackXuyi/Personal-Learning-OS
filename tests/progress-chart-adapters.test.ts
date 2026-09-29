/**
 * F3 · `/progress` 图表适配器单测（docs/progress-chart-library-design-2026-09.md §12）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:chart
 *
 * 为什么只测这一层：两个库（recharts / react-activity-calendar）都需要 DOM，
 * node 跑不了 JSX ⇒ 换渲染层**不会红任何既有单测**，渲染回归靠「契约 grep +
 * 本文件的适配器断言 + 用户目测」三段式兜住（方案 §11.1）。
 *
 * ⚠️ 本文件特有的纪律：
 * 1. **时间基准唯一**：所有 `at` 由固定常量派生，绝不取真实时钟；
 * 2. **断言只锁方案要求**：不为「顺手更严」加断言（过严的断言会诱发错误的
 *    生产代码「修复」）；
 * 3. **不 import 第三方包**：适配器对两库零依赖，测试亦然。
 */
import assert from "node:assert/strict";
import {
  clampHeatLevel,
  toActivityCells,
  toLineSeries,
  toReferenceLines,
  HEAT_MAX_LEVEL,
} from "../src/features/progress/chart-adapters.ts";
import type { ActivityDay, Heatmap } from "../src/features/progress/analytics.ts";

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

/** 最小 `Heatmap` 组装（统计字段按网格现算，避免夹具与断言脱节）。 */
function heat(weeks: (ActivityDay | undefined)[][]): Heatmap {
  const counts: number[] = [];
  for (const col of weeks) {
    for (const day of col) if (day) counts.push(day.count);
  }
  let maxCount = 0;
  let totalCount = 0;
  for (const c of counts) {
    if (c > maxCount) maxCount = c;
    totalCount += c;
  }
  return { weeks, maxCount, totalCount, truncated: false };
}

/** 一周（7 格）的简写：`n` 为 `undefined` 表示未来格。 */
function week(days: (number | undefined)[]): (ActivityDay | undefined)[] {
  return days.map((count, i) =>
    count === undefined ? undefined : { dateKey: `2026-01-${String(i + 1).padStart(2, "0")}`, count },
  );
}

/* ---------------- [1] 热力图 → 活动序列 ---------------- */

await check("TC-CELL-01 未来格不产行（undefined 直接跳过）", () => {
  const h = heat([
    [ { dateKey: "2026-09-21", count: 2 }, { dateKey: "2026-09-22", count: 0 }, undefined, undefined, undefined, undefined, undefined ],
    [ { dateKey: "2026-09-28", count: 5 }, undefined, undefined, undefined, undefined, undefined, undefined ],
  ]);
  const cells = toActivityCells(h);
  assert.equal(cells.length, 3, "只有 3 个已过去的格");
  assert.deepEqual(
    cells.map((c) => c.date),
    ["2026-09-21", "2026-09-22", "2026-09-28"],
    "不含未来日期",
  );
});

await check("TC-CELL-02 档位与 heatLevel 一致（0/1/2/3/4 全覆盖）", () => {
  // heatLevel: 0 → 0；1 → 1；2-3 → 2；4-5 → 3；≥6 → 4
  const h = heat([[0, 1, 2, 3, 4, 5, 6].map((count, i) => ({ dateKey: `2026-01-0${i + 1}`, count }))]);
  const cells = toActivityCells(h);
  assert.deepEqual(cells.map((c) => c.level), [0, 1, 2, 2, 3, 3, 4], "档位映射与 heatLevel 一致");
  assert.deepEqual(cells.map((c) => c.count), [0, 1, 2, 3, 4, 5, 6], "count 原样透传（tooltip 要用）");
});

await check("TC-CELL-03 全 undefined 网格 → 空数组（页面据此不挂载库组件）", () => {
  const h = heat([week([undefined, undefined, undefined, undefined, undefined, undefined, undefined])]);
  assert.deepEqual(toActivityCells(h), [], "返回空数组，调用方不得挂载 ActivityCalendar（库对空 data 会 throw）");
});

await check("TC-CELL-04 空网格（weeks: []）→ 空数组", () => {
  assert.deepEqual(toActivityCells(heat([])), []);
});

await check("TC-CELL-05 ⚠️ 日期严格升序（库的 fillHoles 取首末条作区间端点，逆序会抛）", () => {
  const h = heat([
    [ { dateKey: "2026-09-21", count: 1 }, undefined, undefined, undefined, undefined, undefined, undefined ],
    [ { dateKey: "2026-09-28", count: 1 }, { dateKey: "2026-09-29", count: 1 }, undefined, undefined, undefined, undefined, undefined ],
  ]);
  const dates = toActivityCells(h).map((c) => c.date);
  for (let i = 1; i < dates.length; i += 1) {
    assert.ok(dates[i - 1] < dates[i], `第 ${i} 条 ${dates[i - 1]} 应早于 ${dates[i]}`);
  }
});

await check("TC-CELL-06 clampHeatLevel 夹住越界与非法值（库对越界 level 抛 RangeError）", () => {
  assert.equal(clampHeatLevel(-3), 0, "负值 → 0");
  assert.equal(clampHeatLevel(HEAT_MAX_LEVEL + 5), HEAT_MAX_LEVEL, "超上限 → 上限");
  assert.equal(clampHeatLevel(2.4), 2, "取整");
  assert.equal(clampHeatLevel(Number.NaN), 0, "NaN → 0（不把非法值透给库）");
  assert.equal(clampHeatLevel(Number.POSITIVE_INFINITY), HEAT_MAX_LEVEL, "+Infinity → 上限");
  assert.equal(clampHeatLevel(Number.NEGATIVE_INFINITY), 0, "-Infinity → 0");
  assert.equal(clampHeatLevel(3), 3, "合法档位原样返回");
});

/* ---------------- [2] 折线 → recharts 入参 ---------------- */

await check("TC-LINE-01 空序列 → undefined（调用方返回 null，与现状一致）", () => {
  assert.equal(toLineSeries([]), undefined);
});

await check("TC-LINE-02 单点 → isSinglePoint 且 xDomain 两端相等、只一个刻度", () => {
  const s = toLineSeries([{ at: 1000, value: 0.5 }]);
  assert.ok(s, "非空序列必有值");
  assert.equal(s.isSinglePoint, true);
  assert.deepEqual(s.xDomain, [1000, 1000]);
  assert.deepEqual(s.xTicks, [1000], "单点只给一个刻度（三个同值刻度会叠成黑边）");
  assert.deepEqual(s.data, [{ at: 1000, value: 0.5 }]);
});

await check("TC-LINE-03 三点 → xTicks = 首 / 中 / 尾（现口径）", () => {
  const s = toLineSeries([
    { at: 100, value: 0.2 },
    { at: 200, value: 0.4 },
    { at: 300, value: 0.6 },
  ]);
  assert.ok(s);
  assert.equal(s.isSinglePoint, false);
  assert.deepEqual(s.xDomain, [100, 300]);
  assert.deepEqual(s.xTicks, [100, 200, 300], "首中尾三刻度");
});

await check("TC-LINE-04 乱序输入 → 域按极值算，中点仍居中", () => {
  const s = toLineSeries([
    { at: 300, value: 0.6 },
    { at: 100, value: 0.2 },
    { at: 200, value: 0.4 },
  ]);
  assert.ok(s);
  assert.deepEqual(s.xDomain, [100, 300], "域取极值，与输入顺序无关");
  assert.deepEqual(s.xTicks, [100, 200, 300]);
});

await check("TC-LINE-05 extendRightTo 把 x 域右端扩展（时间线纳入 now / 未来截止日，G4）", () => {
  const s = toLineSeries([{ at: 100, value: 0.5 }, { at: 200, value: 0.8 }], { extendRightTo: 500 });
  assert.ok(s);
  assert.deepEqual(s.xDomain, [100, 500], "右端扩到 500");
  assert.deepEqual(s.xTicks, [100, 300, 500], "刻度随域重算");
  assert.equal(s.isSinglePoint, false);
});

await check("TC-LINE-06 extendRightTo 小于最大值时不缩域，等于最大值时无变化", () => {
  const a = toLineSeries([{ at: 100, value: 0 }, { at: 400, value: 1 }], { extendRightTo: 200 });
  assert.ok(a);
  assert.deepEqual(a.xDomain, [100, 400], "更小的 extendRightTo 不得缩域");

  const b = toLineSeries([{ at: 100, value: 0 }, { at: 400, value: 1 }], { extendRightTo: 400 });
  assert.ok(b);
  assert.deepEqual(b.xDomain, [100, 400], "相等时不变");
});

await check("TC-LINE-07 纯函数：不改写调用方的数组", () => {
  const input = [{ at: 100, value: 0.2 }, { at: 300, value: 0.6 }];
  const snapshot = JSON.stringify(input);
  const s = toLineSeries(input);
  assert.ok(s);
  assert.equal(JSON.stringify(input), snapshot, "入参未被修改");
  assert.notEqual(s.data, input, "data 是新数组（不复用引用）");
});

/* ---------------- [3] 参考线规整 ---------------- */

await check("TC-REF-01 dashed 默认 true，显式 false 才实线", () => {
  const refs = toReferenceLines([
    { value: 0.6, tone: "text-ink-3" },
    { value: 0.8, tone: "text-state-mastered", dashed: false },
    { value: 0.5, tone: "text-primary", dashed: true },
  ]);
  assert.deepEqual(refs, [
    { y: 0.6, dashed: true, tone: "text-ink-3" },
    { y: 0.8, dashed: false, tone: "text-state-mastered" },
    { y: 0.5, dashed: true, tone: "text-primary" },
  ]);
});

await check("TC-REF-02 tone 原样透传（仍是 Tailwind 类名，色值走 currentColor）", () => {
  const refs = toReferenceLines([{ value: 0.6, tone: "text-state-failed" }]);
  assert.equal(refs[0].tone, "text-state-failed", "不得在此把类名翻成色值");
  assert.equal(refs[0].y, 0.6, "value → y 改名");
});

await check("TC-REF-03 空数组 → 空数组（页面仍渲染坐标系）", () => {
  assert.deepEqual(toReferenceLines([]), []);
});

/* ---------------- 汇总 ---------------- */

console.log(`\n[progress-chart-adapters] ${results.length - failures}/${results.length} 通过\n`);
for (const line of results) console.log("  " + line);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
