/**
 * 复盘与趋势的图表组件 —— 折线（趋势 / 时间线）= **recharts**，热力图 = **react-activity-calendar**。
 * 换库方案与决策记录：docs/progress-chart-library-design-2026-09.md。
 *
 * 约定（三条，实施时不得放宽）：
 * 1. 组件只吃 analytics **已算好的结构** —— 不取数、不算数、不读 storage；
 * 2. **不取 `Date.now()`**：时间一律由 props 传入，日期/数字格式化由页面注入
 *    （组件不碰 i18n，文案全部来自调用方）；
 * 3. ⚠️ **本文件的原第 3 条「不引图表库：热力图 = 网格、趋势 = 一条折线、时间线 =
 *    折线 + 竖线（方案 §3.3 —— 这个规模引 recharts + d3 传递依赖不划算）」已于
 *    2026-09-29 被 docs/progress-chart-library-design-2026-09.md 推翻**。两句论据
 *    **均已失效**：d3 早已随 `mermaid` / `@xyflow/react` 进入依赖树；recharts 3.x 的
 *    d3 由 `victory-vendor` 内含、不在直接依赖里。现三块全走库，代价（新增直接依赖
 *    与包体，已实测登记在 runbook）与收益（内建 Tooltip / ReferenceLine / 坐标层）
 *    见该方案 §3.3。
 *
 * ⚠️ 色值纪律：一律**不传色值**。折线 / 参考线 / 点的 `stroke` / `fill` 走
 * `currentColor`，颜色由 `className`（Tailwind 文本色类）提供；热力图格子走
 * `main.css` 的 `.plos-heat[data-level]`。色值真源仍是 `src/styles/main.css`。
 * **不得**给两库传 `stroke="var(--x)"`（presentation attribute 的 `var()` 行为
 * 规范未定，方案 G26）。
 */
import { cloneElement } from "react";
import type { ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ActivityCalendar } from "react-activity-calendar";
import type { Heatmap, ProgressTimeline } from "./analytics";
import { HEAT_MAX_LEVEL, toActivityCells } from "./chart-adapters";
import type { LineSeries, RefLine } from "./chart-adapters";
import { toLineSeries, toReferenceLines } from "./chart-adapters";

const CELL = 11;
const GAP = 2;
/** 色阶 fillOpacity（索引即 `heatLevel` 档位；0 档另有专门处理）。 */
const HEAT_OPACITY = [0.5, 0.15, 0.35, 0.6, 1] as const;

/* ------------------------------------------------------------------ */
/* [1] 学习活动热力图                                                   */
/* ------------------------------------------------------------------ */

/**
 * 26 周活动热力图 —— 渲染交给 `react-activity-calendar`（换库方案 §8.3a）。
 *
 * ⚠️ 三个「必须显式关掉」的库默认值（都来自拆包实测，方案 G18–G20）：
 * - `weekStart={1}`：库默认 0（周日），PLOS 是周一首；
 * - `colorScheme="light"`：库默认跟随系统 `prefers-color-scheme`，暗色系统会串色；
 * - `showTotalCount={false}`：库默认渲染「N activities in YYYY」，与页面
 *   「近 26 周 · N 条」重复。
 *
 * 色阶分工（避免同一规则散两处）：**颜色**（用哪个 token）走 `main.css` 的
 * `.plos-heat[data-level]`；**透明度档位**（色阶语义）仍由本文件的 `HEAT_OPACITY`
 * 经 `renderBlock` 注入 —— 两边各只有一份真源。
 *
 * 图例**保留自绘**（偏离 P2，runbook 有登记）：`showColorLegend={false}` +
 * 沿用现有 12 行 span —— 零 CSS、零 `renderColorLegend`、位置与现状一致。
 */
export function DiscoveryHeatmap({
  heatmap,
  labelOf,
  legend,
}: {
  heatmap: Heatmap;
  /** `YYYY-MM-DD` → tooltip 文案（页面注入；组件不碰 i18n）。 */
  labelOf: (dateKey: string, count: number) => string;
  legend: { less: string; more: string };
}) {
  const cells = toActivityCells(heatmap);

  // ⚠️ 库对空 data 直接 `throw`（G19，不是渲染空图）⇒ 必须在这里拦住。
  // 正常路径走不到（页面在无记录时已切空态）—— 这是防御性兜底。
  if (cells.length === 0) {
    return <div data-testid="progress-heatmap" />;
  }

  return (
    <div data-testid="progress-heatmap">
      {/*
       * 库容器是 `width: max-content`（不吃 viewBox 自适应）⇒ 不再铺满卡片宽度
       * （方案 §7.4 变化 5，D4=A 已知悉；`blockSize` 观感由目测确认后再调）。
       */}
      <ActivityCalendar
        data={cells}
        weekStart={1}
        colorScheme="light"
        minLevel={0}
        maxLevel={HEAT_MAX_LEVEL}
        blockSize={CELL}
        blockMargin={GAP}
        blockRadius={2}
        showTotalCount={false}
        showColorLegend={false}
        showMonthLabels={false}
        showWeekdayLabels={false}
        tooltips={{ activity: { text: (a) => labelOf(a.date, a.count) } }}
        renderBlock={(block, activity) =>
          // ① `style: {}` 清掉库的内联描边（cloneElement 对 props 浅合并，style 整体替换）；
          // ② `className: "plos-heat"` 供 main.css 的 `fill` 覆盖库的 attribute 色；
          // ③ `fillOpacity` 沿用 HEAT_OPACITY（透明度档位的真源仍是这一份数组）。
          cloneElement(block, {
            className: "plos-heat",
            fillOpacity: HEAT_OPACITY[activity.level],
            style: {},
          })
        }
      />
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-ink-3">
        <span className="flex items-center gap-1">
          <span>{legend.less}</span>
          {HEAT_OPACITY.map((op, lv) => (
            <span
              key={lv}
              className={`inline-block h-2.5 w-2.5 rounded-sm bg-current ${
                lv === 0 ? "text-line" : "text-primary"
              }`}
              style={{ opacity: op }}
            />
          ))}
          <span>{legend.more}</span>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 折线图共用画布（趋势 / 时间线同构，配置只写一次）                     */
/* ------------------------------------------------------------------ */

/** y 轴刻度（0..1；含 0.6 / 0.8 两条语义线，与方案 §7.1 线框一致）。 */
const Y_TICKS: number[] = [0, 0.4, 0.6, 0.8, 1];

/** 折线区块高度 —— ⚠️ `ResponsiveContainer` 要求父容器有**确定高度**（方案 §7.4 变化 1）。 */
const CHART_BOX = "h-44 w-full text-line"; // text-line 同时给网格线兜底色（见下）

/** y 轴百分比标签（0 / 40 / 60 / 80 / 100）。 */
function pctLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * 单点时给 x 域加 1ms 边距。
 *
 * `domain` 两端相等会让 recharts 得到零宽区间，点会贴到轴的一端；加 1ms（对月级
 * 时间轴无视觉影响）只为让区间非零、点落在正中。
 */
function xDomainOf(series: LineSeries): [number, number] {
  return series.isSinglePoint
    ? [series.xDomain[0] - 1, series.xDomain[1] + 1]
    : series.xDomain;
}

/**
 * 折线画布：网格 + 双轴 + tooltip 的配置在趋势与时间线之间**必须一致**，
 * 故只写一次；曲线与附加标记由 `children` 决定。
 *
 * ⚠️ 三个「不许让库自作主张」的点：
 * 1. x 轴 `type="number"` + **显式 domain/ticks** —— 不许用 `scale="time"` 让 recharts
 *    自选 nice 刻度（会破坏「首中尾 3 刻度」的现口径）；
 * 2. y 轴固定 `[0, 1]` + 显式 ticks（掌握度本身有界，自适应缩放会放大噪声）；
 * 3. `isAnimationActive={false}` 由调用方给（D4：动画关）。
 */
function LineCanvas({
  series,
  refs,
  axisLabelOf,
  children,
}: {
  series: LineSeries;
  refs: RefLine[];
  axisLabelOf: (at: number) => string;
  children: ReactNode;
}) {
  return (
    <div className={CHART_BOX}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series.data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          {/*
           * ⚠️ 水平网格线（D4 选择「网格开」）。CartesianGrid **不合并 className**
           * （库源码硬写 `className="recharts-cartesian-grid"`），故色只能经 `stroke`
           * 走 `currentColor`，继承自本组件根 div 的 `text-line`。
           */}
          <CartesianGrid vertical={false} stroke="currentColor" />

          {/*
           * ⚠️ 必须显式传 `stroke`：CartesianAxis 把 `stroke` 当作刻度文字的 `fill`
           * （库源码 `{ stroke: 'none', fill: stroke }`），不传就是库自带的 `#666`。
           */}
          <XAxis
            dataKey="at"
            type="number"
            domain={xDomainOf(series)}
            ticks={series.xTicks}
            tickFormatter={axisLabelOf}
            tickLine={false}
            axisLine={{ stroke: "currentColor" }}
            stroke="currentColor"
            className="text-ink-3"
          />
          <YAxis
            domain={[0, 1]}
            ticks={Y_TICKS}
            width={34}
            tickFormatter={pctLabel}
            tickLine={false}
            axisLine={{ stroke: "currentColor" }}
            stroke="currentColor"
            className="text-ink-3"
          />

          {/*
           * 悬停 tooltip（D5=B）：位置与渲染由库负责（**不手写浮层**），只注入文案 ——
           * 第一行 = x 轴日期（`labelFormatter`），第二行 = 数值（`formatter` 返回
           * `[值, null]`，name 为 null 时库不渲染名称与分隔符）。
           */}
          <Tooltip
            labelFormatter={(label) => axisLabelOf(Number(label))}
            formatter={(value) => [
              typeof value === "number" ? value.toFixed(2) : String(value),
              null,
            ]}
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              whiteSpace: "nowrap",
            }}
            labelStyle={{ color: "var(--color-ink-2)", marginBottom: 2 }}
            itemStyle={{ color: "var(--color-ink-1)", padding: 0 }}
            cursor={{ stroke: "currentColor", strokeDasharray: "3 3" }}
          />

          {/* 语义参考线：`tone` 仍是 Tailwind 类 → className + currentColor（零色值）。 */}
          {refs.map((r) => (
            <ReferenceLine
              key={`${r.y}-${r.tone}`}
              y={r.y}
              className={r.tone}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray={r.dashed ? "3 3" : undefined}
            />
          ))}

          {children}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 折线本身（单点不画线；点一律由调用方用 `ReferenceDot` 逐个画，见下）。 */
function SeriesLine() {
  return (
    <Line
      type="linear" /* ⚠️ 不用 monotone：平滑曲线会改变「折线」的数据表达 */
      dataKey="value"
      className="text-primary"
      stroke="currentColor"
      strokeWidth={2}
      dot={false} /* 点改由 ReferenceDot 画（需要按值分档时 Line 无法逐点着色） */
      isAnimationActive={false} /* D4：入场动画关 */
    />
  );
}

/* ------------------------------------------------------------------ */
/* [2] 掌握度趋势折线                                                   */
/* ------------------------------------------------------------------ */

/**
 * y 轴固定 0..1（掌握度本身就是有界量，自适应缩放会放大噪声）。
 * `< 2` 个点时只画圆点不画折线 —— 单点没有「趋势」可言，页面另附引导语。
 */
export function TrendChart({
  points,
  lines,
  axisLabelOf,
}: {
  points: { at: number; value: number }[];
  /** 语义参考线（如 0.6 及格 / 0.8 达标）；`tone` 为 Tailwind 文本色类。 */
  lines: { value: number; dashed?: boolean; tone: string }[];
  axisLabelOf: (at: number) => string;
}) {
  const series = toLineSeries(points);
  if (!series) return null;

  return (
    <div data-testid="progress-trend">
      <LineCanvas series={series} refs={toReferenceLines(lines)} axisLabelOf={axisLabelOf}>
        {series.isSinglePoint ? null : <SeriesLine />}
        {series.data.map((p, i) => (
          <ReferenceDot
            key={i}
            x={p.at}
            y={p.value}
            r={3}
            className="text-primary"
            fill="currentColor"
            stroke="none"
          />
        ))}
      </LineCanvas>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* [3] 目标进度时间线                                                   */
/* ------------------------------------------------------------------ */

/**
 * readiness 折线 + 截止日竖线。
 *
 * ⚠️ x 轴右端取 `max(最后判卷, now, deadline)` —— **把截止日纳入范围**，
 * 这样「曲线离截止还有多远」这条核心信息（UC-04）始终可见；若按方案 §8.3 伪代码的
 * 注释只取 `max(最后判卷, now)`，未来截止日会被一律裁到右端，标记退化为装饰
 * （偏离登记见方案 §14）。
 */
export function TimelineChart({
  timeline,
  now,
  deadlineLabel,
  axisLabelOf,
}: {
  timeline: ProgressTimeline;
  /** mount 时取的固定基准（页面透传，组件不取时钟）。 */
  now: number;
  deadlineLabel: string;
  axisLabelOf: (at: number) => string;
}) {
  const pts = timeline.points;
  if (pts.length === 0) return null;

  // 右端至少到 now 与 deadline（G4 的刻意口径），点本身的范围由 toLineSeries 取。
  const rightEdge = Math.max(now, timeline.deadlineAt ?? 0, ...pts.map((p) => p.at));
  const series = toLineSeries(
    pts.map((p) => ({ at: p.at, value: p.readiness })),
    { extendRightTo: rightEdge },
  );
  if (!series) return null;

  return (
    <div data-testid="progress-timeline">
      <LineCanvas series={series} refs={[]} axisLabelOf={axisLabelOf}>
        {timeline.deadlineAt !== undefined ? (
          <ReferenceLine
            x={timeline.deadlineAt}
            className="text-state-failed"
            stroke="currentColor"
            strokeWidth={1}
            label={{
              value: deadlineLabel,
              position: "insideTopRight",
              fill: "currentColor",
              fontSize: 9,
            }}
          />
        ) : null}
        {series.isSinglePoint ? null : <SeriesLine />}
        {/* 点色随 readiness 变档：达标（≥1）走 state-mastered，其余随主线。 */}
        {series.data.map((p, i) => (
          <ReferenceDot
            key={i}
            x={p.at}
            y={p.value}
            r={3}
            className={pts[i].readiness >= 1 ? "text-state-mastered" : "text-primary"}
            fill="currentColor"
            stroke="none"
          />
        ))}
      </LineCanvas>
    </div>
  );
}
