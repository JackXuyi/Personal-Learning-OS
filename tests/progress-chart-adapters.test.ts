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
  MIN_X_WINDOW_MS,
} from "../src/features/progress/chart-adapters.ts";
import type { ActivityDay, Heatmap } from "../src/features/progress/analytics.ts";

const results: string[] = [];
let failures = 0;

/** 固定时间基准（**不取真实时钟**）；量级与真实 epoch 一致，便于最小窗断言。 */
const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

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

await check("TC-LINE-02 单点 → isSinglePoint；x 域仍是完整最小窗（右端 = 该点）", () => {
  const s = toLineSeries([{ at: T0, value: 0.5 }]);
  assert.ok(s, "非空序列必有值");
  assert.equal(s.isSinglePoint, true);
  assert.deepEqual(
    s.xDomain,
    [T0 - MIN_X_WINDOW_MS, T0],
    "最小 15 日窗：右端锚在点上，左端回退补齐（不做居中特例）",
  );
  assert.deepEqual(s.xTicks, [T0 - MIN_X_WINDOW_MS, T0 - MIN_X_WINDOW_MS / 2, T0], "窗口够宽，仍给首中尾三刻度");
  assert.deepEqual(s.data, [{ at: T0, value: 0.5 }]);
});

await check("TC-LINE-03 三点跨 20 日 → xTicks = 首 / 中 / 尾（现口径），域不动", () => {
  const s = toLineSeries([
    { at: T0, value: 0.2 },
    { at: T0 + 10 * DAY, value: 0.4 },
    { at: T0 + 20 * DAY, value: 0.6 },
  ]);
  assert.ok(s);
  assert.equal(s.isSinglePoint, false);
  assert.deepEqual(s.xDomain, [T0, T0 + 20 * DAY], "跨度已 ≥ 15 日 ⇒ 最小窗不介入");
  assert.deepEqual(s.xTicks, [T0, T0 + 10 * DAY, T0 + 20 * DAY], "首中尾三刻度");
});

await check("TC-LINE-04 乱序输入 → 域按极值算，中点仍居中", () => {
  const s = toLineSeries([
    { at: T0 + 20 * DAY, value: 0.6 },
    { at: T0, value: 0.2 },
    { at: T0 + 10 * DAY, value: 0.4 },
  ]);
  assert.ok(s);
  assert.deepEqual(s.xDomain, [T0, T0 + 20 * DAY], "域取极值，与输入顺序无关");
  assert.deepEqual(s.xTicks, [T0, T0 + 10 * DAY, T0 + 20 * DAY]);
});

await check("TC-LINE-05 extendRightTo 把 x 域右端扩展（时间线纳入 now / 未来截止日，G4）", () => {
  const s = toLineSeries([{ at: T0, value: 0.5 }, { at: T0 + 2 * DAY, value: 0.8 }], {
    extendRightTo: T0 + 30 * DAY,
  });
  assert.ok(s);
  assert.deepEqual(s.xDomain, [T0, T0 + 30 * DAY], "右端扩到指定值（跨度 30 日 ⇒ 左端不回退）");
  assert.deepEqual(s.xTicks, [T0, T0 + 15 * DAY, T0 + 30 * DAY], "刻度随域重算");
  assert.equal(s.isSinglePoint, false);
});

await check("TC-LINE-06 extendRightTo 小于最大值时不缩域，等于最大值时无变化", () => {
  const a = toLineSeries([{ at: T0, value: 0 }, { at: T0 + 20 * DAY, value: 1 }], {
    extendRightTo: T0 + 5 * DAY,
  });
  assert.ok(a);
  assert.deepEqual(a.xDomain, [T0, T0 + 20 * DAY], "更小的 extendRightTo 不得缩域");

  const b = toLineSeries([{ at: T0, value: 0 }, { at: T0 + 20 * DAY, value: 1 }], {
    extendRightTo: T0 + 20 * DAY,
  });
  assert.ok(b);
  assert.deepEqual(b.xDomain, [T0, T0 + 20 * DAY], "相等时不变");
});

await check("TC-LINE-08 ⚠️ 最小时间窗：跨度 3 日 → 左端回退到 15 日（右端 = 末点不动）", () => {
  const s = toLineSeries([{ at: T0, value: 0.3 }, { at: T0 + 3 * DAY, value: 0.9 }]);
  assert.ok(s);
  assert.equal(s.xDomain[1], T0 + 3 * DAY, "右端仍是末次判卷（不右移到 now）");
  assert.equal(
    s.xDomain[1] - s.xDomain[0],
    MIN_X_WINDOW_MS,
    "跨度刚好补齐到 15 日",
  );
  assert.equal(s.xDomain[0], T0 + 3 * DAY - MIN_X_WINDOW_MS, "补的是左端");
  assert.deepEqual(s.data, [{ at: T0, value: 0.3 }, { at: T0 + 3 * DAY, value: 0.9 }], "数据点不因扩窗而增删");
});

await check("TC-LINE-09 最小窗边界：恰好 15 日不扩、15 日 + 1ms 不扩", () => {
  const exact = toLineSeries([{ at: T0, value: 0 }, { at: T0 + MIN_X_WINDOW_MS, value: 1 }]);
  assert.ok(exact);
  assert.deepEqual(exact.xDomain, [T0, T0 + MIN_X_WINDOW_MS], "恰好 15 日：不动（边界不误扩）");

  const over = toLineSeries([{ at: T0, value: 0 }, { at: T0 + MIN_X_WINDOW_MS + 1, value: 1 }]);
  assert.ok(over);
  assert.deepEqual(over.xDomain, [T0, T0 + MIN_X_WINDOW_MS + 1], "超过 15 日：不动");
});

await check("TC-LINE-10 最小窗与 extendRightTo 并存：右端取 extendRightTo，左端按 15 日回退", () => {
  const s = toLineSeries([{ at: T0 + 2 * DAY, value: 0.5 }], {
    extendRightTo: T0 + 2 * DAY,
  });
  assert.ok(s);
  assert.equal(s.xDomain[1], T0 + 2 * DAY, "右端 = extendRightTo（此处与点同值）");
  assert.equal(s.xDomain[1] - s.xDomain[0], MIN_X_WINDOW_MS, "左端仍补齐到 15 日");
  assert.equal(s.isSinglePoint, true, "单点标记不受扩窗影响（调用方据此不画线）");
});

await check("TC-LINE-07 纯函数：不改写调用方的数组", () => {
  const input = [{ at: T0, value: 0.2 }, { at: T0 + 20 * DAY, value: 0.6 }];
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
