/**
 * 复盘与趋势的派生层（纯函数）—— docs/progress-analytics-design-2026-09.md §4 / §8.1。
 *
 * 输入 = domain 原始对象 + 页面注入的标题解析器（同 `learner/aggregate.ts` 模式）；
 * 输出 = 页面可直接渲染的四块结构。**零 IO / 零 React / 零 i18n**（文案由 UI 映射）。
 *
 * ⚠️ 三条必须守住的口径（方案 §4.3 / §8.5，实施时不得顺手「统一」）：
 * 1. **掌握度趋势用「累积快照」口径** —— 每次判卷把 `perChapter.mastery` 并入累积表，
 *    再算全表均值；**不是**逐卷平均（逐卷平均会因每卷覆盖的章不同而剧烈跳动）。
 * 2. **弱点榜只收「有信号」的章**（`mastery > 0 || attempts > 0`）—— 没学过 ≠ 弱点。
 *    判据与 F1 的 `engine/profile-band.ts` 一致。
 * 3. **时间线的 readiness 分母是「已考章节数」**（不是范围内总章数），并把
 *    `covered/required` 一并输出供 UI 诚实标注。这与 `GoalDetailPage` 的 readiness
 *    口径**不同**，属于刻意保留（方案 §8.5 第 1 行）。
 */
import type { EvidenceEntry, LearnerState, PaperResult } from "../../domain";
import { MASTERY_FLOOR, MASTERY_THRESHOLD } from "../../domain";
// ⚠️ 上限**只从这里导入、不在此重写** —— 否则改上限时两处漂移（F2「两把尺子」的同类陷阱）。
import { EVIDENCE_LOG_MAX } from "../../storage/memory";

const DAY = 86_400_000;

/** 热力图窗口（周）。26 周 ≈ 半年，与 5000 条 evidence 上限配合（方案 §4.3）。 */
export const HEATMAP_WEEKS = 26;
/** 误解因子的封顶条数（≥3 条即满分，避免长尾误解压过掌握度缺口）。 */
export const MISCONCEPTION_CAP = 3;
/** 三因子权重（和为 1）。 */
export const WEAKNESS_WEIGHTS = { gap: 0.5, error: 0.3, misconception: 0.2 } as const;

/* ------------------------------------------------------------------ */
/* 派生结构（仅内存类型；不改任何 domain 类型、不落库）                  */
/* ------------------------------------------------------------------ */

/** 热力图一格：本地时区的一个自然日。 */
export interface ActivityDay {
  /** `YYYY-MM-DD`（本地时区）。 */
  dateKey: string;
  /** 该日 evidence 条数。 */
  count: number;
}

/** 热力图（固定 26 周 × 7 天网格；列 = 周（周一首），行 = 周一..周日）。 */
export interface Heatmap {
  /** 26 列；每列 7 格，`undefined` = 未来日期（今天之后）。 */
  weeks: (ActivityDay | undefined)[][];
  /** 单日最大条数（色阶归一化用；无数据 = 0）。 */
  maxCount: number;
  /** 窗口内总条数。 */
  totalCount: number;
  /** 实际记录覆盖区间（min/max at；无数据 = undefined）。 */
  coveredFrom?: number;
  coveredTo?: number;
  /** 证据条数已达存储上限 → 更早的记录可能已被裁剪（D2 诚实性标注）。 */
  truncated: boolean;
}

/** 趋势上的一个判卷时点。 */
export interface TrendPoint {
  at: number;
  /** **累积快照**口径：当时「已被考过的章」的掌握度均值（0..1）。 */
  avgMastery: number;
  /** 该时点已考过的章数（曲线的样本量）。 */
  chapterCount: number;
}

export interface TrendChapterSeries {
  id: string;
  /**
   * 章标题；**解析不到时为 `undefined`**（章可能已随所属资料一起被删除）。
   *
   * ⚠️ 这里**刻意不回落 `id`**（2026-09-21 口径修正）。趋势读的是**试卷历史**，
   * 历史事实必须保留 —— `id` 与 `points` 一律不动，该章仍可下钻看出曲线；但
   * 「已不存在的章」不该把内部 id 当标题渲染给用户。兜底**文案**由 UI 决定
   * （`/progress` 用 `units.subjectGone`），本模块保持零 i18n。
   */
  title?: string;
  /** 该章的掌握度快照序列（≥2 点才可画线）。 */
  points: { at: number; mastery: number }[];
}

export interface Trend {
  /** 整体平均曲线（按 `createdAt` 升序）。 */
  points: TrendPoint[];
  /** 逐章序列（供下钻；只保留 ≥1 点的章）。 */
  chapters: TrendChapterSeries[];
  /** 参与的判卷份数。 */
  paperCount: number;
}

/** 弱点榜一行（三因子）。 */
export interface WeakItem {
  id: string;
  title: string;
  /** 当前掌握度（0..1）。 */
  mastery: number;
  /** 三因子综合分（0..1，降序用）。 */
  score: number;
  /** 三因子的原始分量（供 UI 展示与解释）。 */
  factors: {
    /** 掌握度缺口（0..1）。 */
    gap: number;
    /** 卷面错误信号（0..1；无试卷 = 0）。 */
    error: number;
    /** 误解标签数（原值，非归一）。 */
    misconceptions: number;
  };
  /** 该章卷面客观分均值（0..1；无试卷 = undefined）。 */
  avgPaperScore?: number;
  /** 误解标签原文（最多展示 3 条由 UI 决定）。 */
  misconceptionTags: string[];
}

/** 目标进度时间线。 */
export interface TimelinePoint {
  at: number;
  /** 当时「已考过的范围内章节」中 ≥ `MASTERY_THRESHOLD` 的占比（0..1）。 */
  readiness: number;
  /** 当时已考过的范围内章节数。 */
  covered: number;
  /** 范围章节总数（分母的另一半，用于诚实标注）。 */
  required: number;
}

export interface ProgressTimeline {
  goalId: string;
  goalTitle: string;
  points: TimelinePoint[];
  /** 截止日（epoch ms；未设置 = undefined）。 */
  deadlineAt?: number;
}

/**
 * 时间线所需的目标字段（`LearningGoal` 的结构子集 —— 直接传 `activeGoal` 即可，
 * 无需调用点做字段映射）。
 *
 * ⚠️ 章范围字段沿用 domain 的 `requiredChapterIds`（方案 §8.1 伪代码曾简写为
 * `chapterIds`，实施期以真实字段名为准，见方案 §14 实施结果）。
 */
export interface TimelineGoal {
  id: string;
  title: string;
  requiredChapterIds?: string[];
  deadlineAt?: number;
}

/* ------------------------------------------------------------------ */
/* 时间工具（本地时区；周首 = 周一）                                    */
/* ------------------------------------------------------------------ */

/**
 * epoch ms → 本地时区 `YYYY-MM-DD`（与用户日历一致，不用 UTC 切分）。
 *
 * 导出供页面格式化「记录覆盖区间」—— 复用同一套时区口径，避免页面另写一份
 * 分桶规则而与热力图错位。
 */
export function dateKeyOf(at: number): string {
  const d = new Date(at);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 本地时区某日 00:00 的 epoch ms。 */
function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 周一 = 0 … 周日 = 6（JS `getDay()` 的周日 = 0 需重映射）。
 *
 * 导出供单测直接断言（`TC-EDGE-15`：周日 → 6）。
 */
export function mondayIndex(at: number): number {
  return (new Date(at).getDay() + 6) % 7;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/* ------------------------------------------------------------------ */
/* [1] 学习活动热力图                                                   */
/* ------------------------------------------------------------------ */

/** 色阶 5 档：0 条 → 0；1 → 1；2-3 → 2；4-5 → 3；≥6 → 4。 */
export function heatLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

/**
 * 按天聚合证据条数，铺成 `weeks × 7` 网格。
 *
 * 末列 = 今天所在周；今天之后的格子为 `undefined`（未来不渲染 —— 画成「0 条」的
 * 浅格会被误读为「学了但没记录」）。`now` 由调用方注入一次，内部所有时间判断共用
 * 同一个基准（方案 §4.4「时间基准唯一」）。
 */
export function buildHeatmap(
  entries: readonly EvidenceEntry[],
  opts: { now: number; weeks?: number },
): Heatmap {
  const weeks = opts.weeks ?? HEATMAP_WEEKS;

  // 1) 分桶：一次 O(n) 遍历，用本地时区 dateKey。
  const byDay = new Map<string, number>();
  for (const e of entries) {
    const k = dateKeyOf(e.at);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }

  // 2) 网格：末列 = 今天所在周；从该周的周一往前推 (weeks - 1) 周。
  const todayStart = startOfDay(opts.now);
  const lastMonday = todayStart - mondayIndex(opts.now) * DAY;
  const grid: (ActivityDay | undefined)[][] = [];
  for (let w = weeks - 1; w >= 0; w -= 1) {
    const colMonday = lastMonday - w * 7 * DAY;
    const col: (ActivityDay | undefined)[] = [];
    for (let d = 0; d < 7; d += 1) {
      const t = colMonday + d * DAY;
      if (t > todayStart) {
        col.push(undefined);
        continue;
      }
      const key = dateKeyOf(t);
      col.push({ dateKey: key, count: byDay.get(key) ?? 0 });
    }
    grid.push(col);
  }

  // 3) 统计与覆盖区间（与网格共用同一个 now）。
  const counts: number[] = [];
  for (const col of grid) {
    for (const day of col) {
      if (day) counts.push(day.count);
    }
  }
  let maxCount = 0;
  let totalCount = 0;
  for (const c of counts) {
    if (c > maxCount) maxCount = c;
    totalCount += c;
  }

  let coveredFrom: number | undefined;
  let coveredTo: number | undefined;
  for (const e of entries) {
    if (coveredFrom === undefined || e.at < coveredFrom) coveredFrom = e.at;
    if (coveredTo === undefined || e.at > coveredTo) coveredTo = e.at;
  }

  return {
    weeks: grid,
    maxCount,
    totalCount,
    ...(coveredFrom !== undefined ? { coveredFrom } : {}),
    ...(coveredTo !== undefined ? { coveredTo } : {}),
    // 条数达到上限 → 更早的可能已被裁剪（D2 诚实性标注，不假装数据完整）。
    truncated: entries.length >= EVIDENCE_LOG_MAX,
  };
}

/* ------------------------------------------------------------------ */
/* [2] 掌握度趋势（累积快照口径）                                        */
/* ------------------------------------------------------------------ */

/**
 * 逐判卷时点的掌握度序列。
 *
 * 口径 = **累积快照**：维护「chapterId → 最新 mastery」的表，每份卷把其覆盖到的章
 * 更新进去，再用**整表均值**作为该时点的纵坐标。这样曲线读作「到此刻为止，我考过的
 * 章平均掌握度」，而不是「这一份卷考得怎么样」。
 *
 * **与弱点榜的差别（刻意不同，勿统一）**：趋势读**试卷历史** → 章即使已被删除，
 * 它的历史序列仍然保留（`id` + `points` 都在，可下钻）；弱点榜读**当前 `byUnit`**
 * → 不可解析的主体直接不入榜（`buildWeakness`）。两者只在**「解析不到」的呈现**
 * 上遵循同一条规矩：**绝不把内部 id 当标题显示**。
 */
export function buildTrend(
  results: readonly PaperResult[],
  titleOf: (chapterId: string) => string | undefined,
): Trend {
  // 输入可能是任意顺序（storage 返回降序）→ 一律按 createdAt 升序重建。
  const ordered = [...results].sort((a, b) => a.createdAt - b.createdAt);

  const snapshot = new Map<string, number>();
  const points: TrendPoint[] = [];
  const series = new Map<string, { at: number; mastery: number }[]>();

  for (const r of ordered) {
    for (const [chapterId, per] of Object.entries(r.perChapter)) {
      snapshot.set(chapterId, per.mastery);
      const s = series.get(chapterId) ?? [];
      s.push({ at: r.createdAt, mastery: per.mastery });
      series.set(chapterId, s);
    }
    let sum = 0;
    for (const v of snapshot.values()) sum += v;
    points.push({
      at: r.createdAt,
      avgMastery: snapshot.size === 0 ? 0 : sum / snapshot.size,
      chapterCount: snapshot.size,
    });
  }

  const chapters: TrendChapterSeries[] = [];
  for (const [id, pts] of series) {
    if (pts.length === 0) continue;
    // ⚠️ 解析不到 → 留 `undefined`，**不回落到 `id`**（见 `TrendChapterSeries.title`）。
    chapters.push({ id, title: titleOf(id), points: pts });
  }

  return { points, chapters, paperCount: ordered.length };
}

/* ------------------------------------------------------------------ */
/* [3] 弱点排行（三因子综合分）                                          */
/* ------------------------------------------------------------------ */

/**
 * 三因子弱点排行：`0.5 × 掌握度缺口 + 0.3 × 卷面错误 + 0.2 × 误解占比`。
 *
 * 与 `/learner` 的 GAPS 的差别：GAPS 只按掌握度升序，会把「掌握度低但只错过一次」
 * 与「掌握度低且反复错、还挂着 3 个误解」同等对待。
 */
export function buildWeakness(
  learner: LearnerState,
  results: readonly PaperResult[],
  titleOf: (chapterId: string) => string | undefined,
  limit = 5,
): WeakItem[] {
  // 1) 卷面分聚合：chapterId → { sum, n }（每份卷里该章出现一次）。
  const paperAgg = new Map<string, { sum: number; n: number }>();
  for (const r of results) {
    for (const [chapterId, per] of Object.entries(r.perChapter)) {
      const cur = paperAgg.get(chapterId) ?? { sum: 0, n: 0 };
      cur.sum += per.score;
      cur.n += 1;
      paperAgg.set(chapterId, cur);
    }
  }

  const items: WeakItem[] = [];
  for (const [id, unit] of Object.entries(learner.byUnit)) {
    // 2) ⚠️ 只收「有信号」的章 —— 没学过（mastery = 0 且 attempts = 0）不是弱点，
    //    它是「未开始」。判据与 F1 的 profile-band.ts 一致。
    if (unit.mastery <= 0 && unit.attempts <= 0) continue;
    const title = titleOf(id);
    // 章已删但 byUnit 残留 → 不可解析的主体不入榜（同 /learner 口径）。
    if (!title) continue;

    const gap = clamp01((MASTERY_FLOOR - unit.mastery) / MASTERY_FLOOR);
    const agg = paperAgg.get(id);
    const avgPaperScore = agg ? agg.sum / agg.n : undefined;
    const error = avgPaperScore === undefined ? 0 : clamp01(1 - avgPaperScore);
    const tags = [...unit.misconceptions];
    const miscon = clamp01(tags.length / MISCONCEPTION_CAP);

    const score =
      WEAKNESS_WEIGHTS.gap * gap +
      WEAKNESS_WEIGHTS.error * error +
      WEAKNESS_WEIGHTS.misconception * miscon;

    // 满分掌握、卷面满分、零误解 → 综合分 0，不算弱点。
    if (score <= 0) continue;

    items.push({
      id,
      title,
      mastery: unit.mastery,
      score,
      factors: { gap, error, misconceptions: tags.length },
      ...(avgPaperScore !== undefined ? { avgPaperScore } : {}),
      misconceptionTags: tags,
    });
  }

  return items.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* [4] 目标进度时间线（基于试卷记录近似重建）                            */
/* ------------------------------------------------------------------ */

/**
 * 目标范围内 readiness 随判卷时点变化。
 *
 * ⚠️ 分母 = **已考章节数**（不是 `requiredChapterIds.length`）。若用总章数作分母，
 * 早期所有点都会被「还没考」压到接近 0，曲线失去信息量；为保持诚实，`covered` 与
 * `required` 一并输出，UI 逐点标注「已考 c/r 章」。
 *
 * 返回 `undefined` 的三种情形：无目标 / 范围为空 / 范围内从未判卷。
 * **单点不返回 undefined** —— 单点也有信息量（UI 画点并引导再测一次）。
 */
export function buildTimeline(
  results: readonly PaperResult[],
  goal: TimelineGoal | undefined,
): ProgressTimeline | undefined {
  if (!goal) return undefined;
  const chapterIds = goal.requiredChapterIds ?? [];
  if (chapterIds.length === 0) return undefined;

  const scope = new Set(chapterIds);
  const ordered = [...results].sort((a, b) => a.createdAt - b.createdAt);

  const snapshot = new Map<string, number>();
  const points: TimelinePoint[] = [];
  for (const r of ordered) {
    let touched = false;
    for (const [chapterId, per] of Object.entries(r.perChapter)) {
      if (!scope.has(chapterId)) continue; // 范围外章节不参与
      snapshot.set(chapterId, per.mastery);
      touched = true;
    }
    // 这份卷没覆盖该目标的任何章 → 不产生点（否则会画出与目标无关的时点）。
    if (!touched) continue;
    let mastered = 0;
    for (const m of snapshot.values()) {
      if (m >= MASTERY_THRESHOLD) mastered += 1;
    }
    const covered = snapshot.size;
    points.push({
      at: r.createdAt,
      readiness: covered === 0 ? 0 : mastered / covered,
      covered,
      required: scope.size,
    });
  }

  if (points.length === 0) return undefined;
  return {
    goalId: goal.id,
    goalTitle: goal.title,
    points,
    ...(goal.deadlineAt !== undefined ? { deadlineAt: goal.deadlineAt } : {}),
  };
}
