/**
 * 复盘与趋势（/progress）—— 把已记下来的证据流变成看得见的轨迹。
 *
 * 设计见 docs/progress-analytics-design-2026-09.md（§4 架构 / §5 流程 / §7 线框）。
 *
 * ⚠️ 本页是**纯只读**：不写 `LearnerState`、不写 `EvidenceEntry`、不新增任何 key。
 * 四块的数字全部来自 `analytics.ts` 的纯派生（`buildHeatmap` / `buildTrend` /
 * `buildWeakness` / `buildTimeline`），页面只做「加载 → 编排 → 空态 → 跳转」。
 *
 * ⚠️ 「时间基准唯一」：`now` 在 mount 时**只取一次**并透传给所有 build* 与图表，
 * 页面内不再出现第二个 `Date.now()`（跨零点会让同屏数字互相矛盾）。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, Card, Section } from "../../components/primitives";
import { buttonVariants } from "../../components/ui/button";
import { PageContainer } from "../../components/layout/AppShell";
import { cn } from "../../lib/utils";
import type { EvidenceEntry, LearnerState, LearningGoal, PaperResult } from "../../domain";
import { MASTERY_FLOOR, MASTERY_THRESHOLD } from "../../domain";
import { applyForgetting } from "../../engine";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { useI18n } from "../../i18n";
import type { ChapterRow } from "../goals/goal-util";
import { loadChapterRows } from "../goals/goal-util";
import {
  buildHeatmap,
  buildTimeline,
  buildTrend,
  buildWeakness,
  dateKeyOf,
  HEATMAP_WEEKS,
} from "./analytics";
import { DiscoveryHeatmap, TimelineChart, TrendChart } from "./charts";

/** 一次 `Promise.all` 的加载结果（与 LearnerPage 同构：页面直连 storage）。 */
interface Loaded {
  entries: EvidenceEntry[];
  results: PaperResult[];
  /** 遗忘衰减后的视图（与 /learner、Today、Plan 同口径）。 */
  learner: LearnerState;
  rows: ChapterRow[];
  goals: LearningGoal[];
}

export default function ProgressPage() {
  const { m } = useI18n();
  const pg = m.progress;
  const activeGoal = useLoopStore((s) => s.activeGoal);
  const [data, setData] = useState<Loaded | undefined>();
  /** ⚠️ 时间基准：mount 时取一次，向下透传（方案 §4.4）。 */
  const [now] = useState(() => Date.now());
  /** 趋势下钻选中的章 id；空串 = 整体平均。不进 URL（保持单一路由）。 */
  const [chapterId, setChapterId] = useState("");

  useEffect(() => {
    void (async () => {
      const [entries, results, ls, rows, goals] = await Promise.all([
        storage.listEvidence(),
        storage.listPaperResults(),
        storage.getLearnerState(),
        loadChapterRows(storage),
        storage.listGoals(),
      ]);
      setData({ entries, results, learner: applyForgetting(ls, now), rows, goals });
    })();
  }, [now]);

  if (!data) {
    return (
      <PageContainer>
        <Card>
          <p className="text-sm text-ink-3">{pg.loading}</p>
        </Card>
      </PageContainer>
    );
  }

  const chapterIndex = new Map(data.rows.map((r) => [r.chapter.id, r]));
  const titleOf = (id: string): string | undefined => {
    const ch = chapterIndex.get(id);
    if (!ch) return undefined;
    return `${ch.docTitle} · ${ch.chapter.title?.trim() || m.chapter.ordinal(ch.chapter.order)}`;
  };
  /** 图表 x 轴刻度（月/日；中英通用，故不走字典）。 */
  const axisLabelOf = (at: number): string => {
    const d = new Date(at);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  // ⚠️ 全空：**不渲染四块空坐标系** —— 空白图表是最糟的空态
  //    （用户分不清「没数据」与「加载失败」，方案 §7.2.1）。
  if (data.entries.length === 0 && data.results.length === 0) {
    return (
      <PageContainer>
        <header>
          <h1 className="text-xl font-semibold text-ink-1">{pg.title}</h1>
          <p className="mt-0.5 text-sm text-ink-2">{pg.subtitle}</p>
        </header>
        <Card className="mt-6 border-dashed">
          <p className="text-lg font-semibold text-ink-1">{pg.emptyTitle}</p>
          <p className="mt-1 text-sm text-ink-2">{pg.emptyDesc}</p>
          <Link to="/plan" className={cn(buttonVariants({ variant: "default" }), "mt-4 rounded-lg")}>
            {pg.emptyAction}
          </Link>
        </Card>
      </PageContainer>
    );
  }

  const heatmap = buildHeatmap(data.entries, { now });
  const trend = buildTrend(data.results, titleOf);
  const weakness = buildWeakness(data.learner, data.results, titleOf, 5);
  const timeline = buildTimeline(data.results, activeGoal);

  // 下钻选中章；选中的章若已不在序列里（数据变化）则退回整体。
  const selected = chapterId === "" ? undefined : trend.chapters.find((c) => c.id === chapterId);
  const trendPoints = selected
    ? selected.points.map((p) => ({ at: p.at, value: p.mastery }))
    : trend.points.map((p) => ({ at: p.at, value: p.avgMastery }));

  return (
    <PageContainer>
      <header>
        <h1 className="text-xl font-semibold text-ink-1">{pg.title}</h1>
        <p className="mt-0.5 text-sm text-ink-2">{pg.subtitle}</p>
      </header>

      {/* [1] 目标进度时间线 —— 仅有目标且范围内有判卷时渲染 */}
      <Section
        title={pg.timelineTitle}
        className="mt-8"
        action={
          timeline ? (
            <span className="text-xs tabular-nums text-ink-3">
              {pg.timelineCovered(
                timeline.points[timeline.points.length - 1].covered,
                timeline.points[timeline.points.length - 1].required,
              )}
            </span>
          ) : undefined
        }
      />
      {timeline ? (
        <Card className="mt-3">
          <TimelineChart
            timeline={timeline}
            now={now}
            deadlineLabel={pg.timelineDeadline}
            axisLabelOf={axisLabelOf}
          />
          <p className="mt-2 text-xs text-ink-3">ⓘ {pg.timelineNotice}</p>
        </Card>
      ) : (
        <p className="mt-2 text-sm text-ink-3">
          {data.goals.length === 0 ? pg.timelineNoGoal : pg.timelineNoPapers}
        </p>
      )}

      {/* [2] 学习活动热力图 */}
      <Section
        title={pg.heatmapTitle}
        className="mt-8"
        action={
          <span className="text-xs tabular-nums text-ink-3">
            {pg.heatmapCaption(HEATMAP_WEEKS, heatmap.totalCount)}
          </span>
        }
      />
      {data.entries.length === 0 ? (
        <p className="mt-2 text-sm text-ink-3">{pg.heatmapEmpty}</p>
      ) : (
        <Card className="mt-3">
          {heatmap.truncated ? (
            <p className="mb-2 text-xs text-state-failed">⚠ {pg.heatmapTruncated}</p>
          ) : null}
          <DiscoveryHeatmap
            heatmap={heatmap}
            labelOf={(dateKey, count) => pg.heatmapCell(dateKey, count)}
            legend={{ less: pg.heatmapLegendLess, more: pg.heatmapLegendMore }}
          />
          {heatmap.coveredFrom !== undefined && heatmap.coveredTo !== undefined ? (
            <p className="mt-2 text-xs tabular-nums text-ink-3">
              {pg.heatmapRange(dateKeyOf(heatmap.coveredFrom), dateKeyOf(heatmap.coveredTo))}
            </p>
          ) : null}
        </Card>
      )}

      {/* [3] 掌握度趋势（含章节下钻） */}
      <Section
        title={pg.trendTitle}
        className="mt-8"
        action={
          <span className="flex items-center gap-3">
            <span className="text-xs tabular-nums text-ink-3">
              {pg.trendCaption(trend.paperCount, trend.chapters.length)}
            </span>
            {trend.chapters.length > 0 ? (
              <select
                value={chapterId}
                onChange={(e) => setChapterId(e.target.value)}
                aria-label={pg.trendChapterLabel}
                className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2"
              >
                <option value="">{pg.trendAllChapters}</option>
                {trend.chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {/* 章已随资料删除 → 兜底文案（**绝不显示裸 id**，同 D7-A 章侧口径）。 */}
                    {c.title ?? m.units.subjectGone}
                  </option>
                ))}
              </select>
            ) : null}
          </span>
        }
      />
      {data.results.length === 0 ? (
        <p className="mt-2 text-sm text-ink-3">{pg.trendEmpty}</p>
      ) : (
        <Card className="mt-3">
          <TrendChart
            points={trendPoints}
            lines={[
              { value: MASTERY_FLOOR, tone: "text-ink-3" },
              { value: MASTERY_THRESHOLD, tone: "text-state-mastered" },
            ]}
            axisLabelOf={axisLabelOf}
          />
          {trendPoints.length < 2 ? (
            <p className="mt-2 text-xs text-ink-3">{pg.trendSinglePoint}</p>
          ) : null}
          <p className="mt-2 text-xs text-ink-3">ⓘ {pg.trendNotice}</p>
        </Card>
      )}

      {/* [4] 最该补的（三因子综合分） */}
      <Section title={pg.weaknessTitle} className="mt-8" />
      {weakness.length === 0 ? (
        <p className="mt-2 text-sm text-ink-3">{pg.weaknessEmpty}</p>
      ) : (
        <div className="mt-2">
          {weakness.map((w) => (
            <Link
              key={w.id}
              to={`/learn/${w.id}`}
              className="group flex items-center justify-between gap-3 border-b border-line py-3 last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink-1 group-hover:text-primary">
                  {w.title}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <span className="tabular-nums">
                    {pg.weaknessMastery(Math.round(w.mastery * 100))}
                  </span>
                  <span className="tabular-nums">
                    {w.avgPaperScore !== undefined
                      ? pg.weaknessPaper(Math.round(w.avgPaperScore * 100))
                      : pg.weaknessNoPaper}
                  </span>
                  {w.factors.misconceptions > 0 ? (
                    <span>{pg.weaknessMisconceptions(w.factors.misconceptions)}</span>
                  ) : null}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="w-24">
                  <Bar value={w.mastery} target={MASTERY_THRESHOLD} />
                </span>
                <span className="text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {pg.weaknessGo}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
