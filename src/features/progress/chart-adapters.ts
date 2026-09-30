/**
 * `/progress` 图表适配器 —— 纯函数，**零 React / 零 IO / 零 i18n**。
 *
 * 职责边界：`analytics.ts` 是口径真源（PLOS 私有），本文件只做**形状翻译** ——
 * 把派生结构翻成第三方图表包吃得下的入参，并把两库的边界条件挡在组件之外。
 * 全程不取 `Date.now()`、不读 storage、不碰 i18n（与 `charts.tsx` 同纪律）。
 *
 * ⚠️ 本文件是渲染层之外**唯一的纯逻辑**，因此也是 node 单测（`npm run test:chart`）
 * 唯一能覆盖的部分 —— 两个库都需要 DOM，node 跑不了 JSX。
 *
 * ⚠️ 色值**不在此文件**：两库的配色一律走 CSS（折线 `className` + `currentColor`；
 * 热力图 `.plos-heat[data-level]` + `fill: var(--color-*)`），色值真源仍是
 * `src/styles/main.css`。
 */
import type { Heatmap } from "./analytics";
import { heatLevel } from "./analytics";

/* ------------------------------------------------------------------ */
/* [1] 热力图 → react-activity-calendar                                */
/* ------------------------------------------------------------------ */

/** 色阶上限（对齐 `heatLevel` 的 5 档 0..4，也是库的 `maxLevel`）。 */
export const HEAT_MAX_LEVEL = 4;

/**
 * 一格活动。**自持类型，刻意不 import `react-activity-calendar`** ——
 * 让本文件（以及跑它的 node 单测）对第三方包零依赖；结构上可赋给库的 `Activity`
 * （`level` 更窄，是 `number` 的子类型）。
 */
export interface ActivityCell {
  /** `YYYY-MM-DD`（本地时区，与 `analytics.dateKeyOf` 同口径）。 */
  date: string;
  count: number;
  /** ⚠️ 必须落在 `[0, HEAT_MAX_LEVEL]`：越界会让库抛 `RangeError` ⇒ 整页白屏。 */
  level: 0 | 1 | 2 | 3 | 4;
}

/**
 * 色阶兜底：把档位夹到 `[0, 4]`。
 *
 * `heatLevel` 本身只返回 0..4，这里是**防御性**的 —— 库对越界 `level` 直接抛
 * `RangeError`（未捕获即整页白屏，库源码 `validateActivities`），
 * 白屏的代价远大于一次冗余 clamp。
 */
export function clampHeatLevel(level: number): ActivityCell["level"] {
  // ⚠️ 只特判 NaN（它参与任何比较都为假，会在下面的夹取里**穿过去**）。
  // `±Infinity` 不需要特判：`Math.round(±Infinity)` 仍是 ±Infinity，
  // 自然被 `<= 0` / `>= HEAT_MAX_LEVEL` 夹到两端 —— 这正是 clamp 的语义。
  if (Number.isNaN(level)) return 0;
  const n = Math.round(level);
  if (n <= 0) return 0;
  if (n >= HEAT_MAX_LEVEL) return HEAT_MAX_LEVEL;
  return n as ActivityCell["level"];
}

/**
 * 网格 → 活动序列。
 *
 * ⚠️ 三条必须守住的约束（前两条来自库源码实测，违反即整页白屏）：
 * 1. **不产未来格**：`heatmap.weeks` 里的 `undefined` 即「今天之后」。库的
 *    `fillHoles` 只填充首条→末条之间的日子，**不给行就天然不渲染**，与现口径
 *    （未来画成「0 条」会谎报「学了但没记录」）一致。
 * 2. **保持日期升序**：库取首/末条作填充区间的端点，逆序会让 `date-fns` 的
 *    `eachDayOfInterval(start > end)` 抛错。本函数按 `weeks`（由旧到新）逐列、
 *    列内按周一→周日遍历，**天然升序**；`test:chart` 有断言锁住这个不变量。
 * 3. **level 必须 clamp**（见 `clampHeatLevel`）。
 *
 * 返回空数组时**调用方不得挂载库组件** —— 库对空 `data` 直接
 * `throw new Error('Activity data must not be empty.')`。
 */
export function toActivityCells(heatmap: Heatmap): ActivityCell[] {
  const cells: ActivityCell[] = [];
  for (const col of heatmap.weeks) {
    for (const day of col) {
      if (!day) continue; // 未来格：不产行（库便不渲染该格）。
      cells.push({
        date: day.dateKey,
        count: day.count,
        level: clampHeatLevel(heatLevel(day.count)),
      });
    }
  }
  return cells;
}

/* ------------------------------------------------------------------ */
/* [2] 折线 → recharts                                                 */
/* ------------------------------------------------------------------ */

/** 折线入参：recharts `LineChart` 的 `data` + **显式**的 x 定义域与刻度。 */
export interface LineSeries {
  data: { at: number; value: number }[];
  /** x 轴定义域。 ⚠️ 显式给出 —— 不许让 recharts 自选 nice 刻度（会破坏现口径）；
   *  跨度恒 ≥ `MIN_X_WINDOW_MS`（最小时间窗，见该常量）。 */
  xDomain: [number, number];
  /** x 轴刻度 = 首 / 中 / 尾（现口径）；域为零宽时退化成一个（最小窗下不可达，防御性）。 */
  xTicks: number[];
  /** 单点退化：**不画线、只画点**（现口径，页面另附引导语）。 */
  isSinglePoint: boolean;
}

/**
 * x 轴**最小时间窗 = 15 日**（2026-09-29 用户要求「折线至少展示 15 日的数据」）。
 *
 * 判卷点稀疏时（如实测样本：8 次判卷集中在 13 天内），按「首末点」取域会让横轴
 * 过窄 —— 用户读不出「日」尺度的密度。不足 15 日时**向左扩展**补齐，数据点因此
 * 靠右分布；**右端语义刻意不动**：
 * - 趋势图右端 = 末次判卷（不右移到 `now`：本组件不取时钟，页面的 `now` 只喂时间线）；
 * - 时间线右端 = `max(now, deadline)`（G4 刻意口径，`extendRightTo` 已表达）。
 *
 * 单点也走同一规则（15 日窗的右端 = 该点）—— 不给单点做居中特例：与时间线的
 * 「右端锚定」保持一致，避免同一坐标系出现两套锚定语义。
 */
export const MIN_X_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;

/**
 * 点序列 → 折线入参。
 *
 * - 空序列 → `undefined`（调用方据此返回 `null`，与现状一致）；
 * - 单点 → `isSinglePoint` 为真（调用方不画线）、`xTicks` 随最小窗给 3 个；
 * - `opts.extendRightTo`：把 x 域右端**至少**扩展到该值。时间线用它把 `now` 与
 *   未来截止日纳入范围（方案 G4 的刻意口径：「曲线离截止还有多远」必须可见）；
 * - 跨度不足 `MIN_X_WINDOW_MS` → 左端回退到 `右端 - MIN_X_WINDOW_MS`。
 */
export function toLineSeries(
  points: readonly { at: number; value: number }[],
  opts: { extendRightTo?: number } = {},
): LineSeries | undefined {
  if (points.length === 0) return undefined;

  let min = points[0].at;
  let max = points[0].at;
  for (const p of points) {
    if (p.at < min) min = p.at;
    if (p.at > max) max = p.at;
  }
  if (opts.extendRightTo !== undefined && opts.extendRightTo > max) {
    max = opts.extendRightTo;
  }
  // 最小时间窗：跨度不足 15 日 → 左端回退（右端不再变）。
  if (max - min < MIN_X_WINDOW_MS) min = max - MIN_X_WINDOW_MS;

  return {
    data: [...points],
    xDomain: [min, max],
    // 域零宽只可能出现在窗口为 0 的假设下（防御性保留：三个同值刻度会叠成黑边）。
    xTicks: min === max ? [min] : [min, min + (max - min) / 2, max],
    isSinglePoint: points.length < 2,
  };
}

/** 语义参考线（y 值 + 是否虚线 + Tailwind 文本色类）。 */
export interface RefLine {
  y: number;
  /** 默认虚线；仅显式 `dashed: false` 时为实线（现状口径）。 */
  dashed: boolean;
  /** `tone` 为 Tailwind 文本色类（如 `text-state-mastered`），走 `currentColor`。 */
  tone: string;
}

/** 规整参考线：只把 `dashed` 的默认值补上，其余原样透传（不动 `tone` 语义）。 */
export function toReferenceLines(
  lines: readonly { value: number; dashed?: boolean; tone: string }[],
): RefLine[] {
  return lines.map((l) => ({ y: l.value, dashed: l.dashed !== false, tone: l.tone }));
}
