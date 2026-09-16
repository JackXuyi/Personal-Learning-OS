/**
 * 复盘与趋势的图表组件（手写 SVG）—— docs/progress-analytics-design-2026-09.md §8.3。
 *
 * 约定（三条，实施时不得放宽）：
 * 1. 组件只吃 analytics **已算好的结构** —— 不取数、不算数、不读 storage；
 * 2. **不取 `Date.now()`**：时间一律由 props 传入，日期/数字格式化由页面注入
 *    （组件不碰 i18n，文案全部来自调用方）；
 * 3. 不引图表库：热力图 = 网格、趋势 = 一条折线、时间线 = 折线 + 竖线
 *    （方案 §3.3 —— 这个规模引 recharts + d3 传递依赖不划算）。
 */
import type { Heatmap, ProgressTimeline } from "./analytics";
import { heatLevel } from "./analytics";

const CELL = 11;
const GAP = 2;
/** 色阶 fillOpacity（索引即 `heatLevel` 档位；0 档另有专门处理）。 */
const HEAT_OPACITY = [0.5, 0.15, 0.35, 0.6, 1] as const;

/* ------------------------------------------------------------------ */
/* [1] 学习活动热力图                                                   */
/* ------------------------------------------------------------------ */

/**
 * 26 周 × 7 天网格。列 = 周（周一首），行 = 周一..周日。
 *
 * 空格（0 条）用 `text-line` 浅底而非留白 —— 留白会被误读为「学了但没记录」；
 * 未来日期由 analytics 输出 `undefined`，这里直接不渲染。
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
  const cols = heatmap.weeks.length;
  const width = cols * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  return (
    <div data-testid="progress-heatmap">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
        {heatmap.weeks.map((col, x) =>
          col.map((day, y) => {
            // 未来日期：不渲染（画成 0 条会谎报「那天学了但没记录」）。
            if (!day) return null;
            const level = heatLevel(day.count);
            return (
              <rect
                key={`${x}-${y}`}
                x={x * (CELL + GAP)}
                y={y * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2}
                fill="currentColor"
                fillOpacity={HEAT_OPACITY[level]}
                className={level === 0 ? "text-line" : "text-primary"}
              >
                <title>{labelOf(day.dateKey, day.count)}</title>
              </rect>
            );
          }),
        )}
      </svg>
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
/* 折线图共用坐标映射（趋势 / 时间线同构，实现只写一次）                 */
/* ------------------------------------------------------------------ */

const W = 600;
const H = 160;
const PAD = { t: 8, r: 8, b: 20, l: 34 };
/** y 轴刻度（0..1；含 0.6 / 0.8 两条语义线，与方案 §7.1 线框一致）。 */
const Y_TICKS = [0, 0.4, 0.6, 0.8, 1] as const;

const SPAN_X = W - PAD.l - PAD.r;
const SPAN_Y = H - PAD.t - PAD.b;

/** x 轴线性映射；跨度 0（单点）时居中，避免除零。 */
function xAt(at: number, minX: number, maxX: number): number {
  return maxX === minX
    ? PAD.l + SPAN_X / 2
    : PAD.l + ((at - minX) / (maxX - minX)) * SPAN_X;
}

/** y 轴映射（0..1 → 底部..顶部）。 */
function yAt(value: number): number {
  return PAD.t + (1 - value) * SPAN_Y;
}

function pctLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** y 轴刻度 + 左侧标签（0 / 40 / 60 / 80 / 100）。 */
function YAxis() {
  return (
    <>
      {Y_TICKS.map((v) => (
        <text
          key={v}
          x={PAD.l - 6}
          y={yAt(v)}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={9}
          fill="currentColor"
          className="text-ink-3"
        >
          {pctLabel(v)}
        </text>
      ))}
    </>
  );
}

/** x 轴首 / 中 / 尾三个刻度标签（跨度 0 时只画居中的那一个）。 */
function XAxis({ minX, maxX, labelOf }: { minX: number; maxX: number; labelOf: (at: number) => string }) {
  const mid = (minX + maxX) / 2;
  const ticks =
    maxX === minX
      ? [{ at: mid, anchor: "middle" as const }]
      : [
          { at: minX, anchor: "start" as const },
          { at: mid, anchor: "middle" as const },
          { at: maxX, anchor: "end" as const },
        ];
  return (
    <>
      {ticks.map((t, i) => (
        <text
          key={i}
          x={xAt(t.at, minX, maxX)}
          y={H - 6}
          textAnchor={t.anchor}
          fontSize={9}
          fill="currentColor"
          className="text-ink-3"
        >
          {labelOf(t.at)}
        </text>
      ))}
    </>
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
  if (points.length === 0) return null;
  const xs = points.map((p) => p.at);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);

  return (
    <svg data-testid="progress-trend" viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      <YAxis />
      {lines.map((l) => (
        <line
          key={l.value}
          x1={PAD.l}
          x2={W - PAD.r}
          y1={yAt(l.value)}
          y2={yAt(l.value)}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray={l.dashed === false ? undefined : "3 3"}
          className={l.tone}
        />
      ))}
      {points.length >= 2 ? (
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-primary"
          points={points.map((p) => `${xAt(p.at, minX, maxX)},${yAt(p.value)}`).join(" ")}
        />
      ) : null}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={xAt(p.at, minX, maxX)}
          cy={yAt(p.value)}
          r={3}
          fill="currentColor"
          className="text-primary"
        />
      ))}
      <XAxis minX={minX} maxX={maxX} labelOf={axisLabelOf} />
    </svg>
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

  const xs = pts.map((p) => p.at);
  const minX = Math.min(...xs);
  const lastAt = Math.max(...xs);
  const maxX = Math.max(lastAt, now, timeline.deadlineAt ?? 0);
  const deadlineX = timeline.deadlineAt !== undefined ? xAt(timeline.deadlineAt, minX, maxX) : undefined;

  return (
    <svg data-testid="progress-timeline" viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      <YAxis />
      {deadlineX !== undefined ? (
        <>
          <line
            x1={deadlineX}
            x2={deadlineX}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="currentColor"
            strokeWidth={1}
            className="text-state-failed"
          />
          <text
            x={deadlineX - 3}
            y={PAD.t + 9}
            textAnchor="end"
            fontSize={9}
            fill="currentColor"
            className="text-state-failed"
          >
            {deadlineLabel}
          </text>
        </>
      ) : null}
      {pts.length >= 2 ? (
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-primary"
          points={pts.map((p) => `${xAt(p.at, minX, maxX)},${yAt(p.readiness)}`).join(" ")}
        />
      ) : null}
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={xAt(p.at, minX, maxX)}
          cy={yAt(p.readiness)}
          r={3}
          fill="currentColor"
          className={p.readiness >= 1 ? "text-state-mastered" : "text-primary"}
        />
      ))}
      <XAxis minX={minX} maxX={maxX} labelOf={axisLabelOf} />
    </svg>
  );
}
