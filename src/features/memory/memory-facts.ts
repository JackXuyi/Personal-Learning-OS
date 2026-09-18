/**
 * 通道 A：**确定性派生**（F9）—— 零 AI、零外发，打开页面即自动整理。
 * 方案：docs/learner-memory-design-2026-09.md §4.3.5（四条规则 + 五条护栏）。
 *
 * 全部纯函数（`now` 由入口注入、`facts` 文案由 i18n 注入）→ `tests/learner-memory.test.ts`
 * 可直接覆盖**门槛边界**与**算法数值**。
 *
 * 五条护栏（全部代码层）：
 * 1. **最小样本门槛**：`MEMORY_FACT_MIN_SAMPLES` 不达标 → **不产出该条**
 *    （不是产出后打个标 —— 用 3 条记录断言「你常在深夜学习」是编造，不是推断）。
 * 2. **时间基准唯一**：`now` 只从入口进来一次（跨零点会让两个数字自相矛盾）。
 * 3. **`cadence` 与 `preference` 的边界**：`cadence` 只描述**时间与频次**，不描述「为什么」；
 *    一旦句子变成解释性的（含「因为」「说明你」）就是越界。
 * 4. **观察跨度下限**：`spanDays` 不达标连「活跃时段」都不产出。
 * 5. **同一规则一个键**：规则键与概念一一对应，**不因措辞变化而换键** ——
 *    这是行级三态合并（`memory-doc-merge.ts`）能工作的前提（措辞更新走「原地替换」）。
 *
 * ⚠️ 文案（`facts`）由 UI 经 i18n 注入：这些句子会被**写进用户的文档**，
 * 与「服务层只产分类」并不冲突 —— 它们不是 UI 文案，而是**用户资产的内容**，
 * 与 F4 单章 Markdown 的 `pointsHeading` 同性质（方案 §13 偏差表有记录）。
 */
import type { EvidenceKind, LearnerProfile, StudyStyle } from "../../domain";
import { MEMORY_FACT_MIN_SAMPLES, type GeneratedEntry, type MemoryFactKey } from "../../domain";
import type { MemorySignals } from "./memory-signals";

export type DerivedFact = GeneratedEntry;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
/** 会话切段阈值（相邻两条证据间隔超过它就算新的一次学习）。 */
const SESSION_GAP_MS = 30 * MS_PER_MINUTE;
/** 复习滞后分档：≤ 0 按时；≤ 1 天略滞后；> 1 天拖到逾期。 */
const LATE_TOLERANCE_MS = MS_PER_DAY;

/**
 * 通道 A 的文案（**由 UI 从 i18n 注入**）。
 *
 * 为什么走注入而不是模块内硬编码：这些句子会被写进用户磁盘上的 `.md` 文件，
 * 英文用户拿到中文事实会莫名其妙；同时「已存在的文档不因切语言而重写」
 * （合并器护栏 ②）意味着只有**新建**事实才用当前语言 —— 两件事都要求文案从外部来。
 */
export interface MemoryFactTexts {
  cadenceWindow(window: string, minutes: number): string;
  cadenceWindowOnly(window: string): string;
  reviewOnTime(): string;
  reviewLate(latency: string): string;
  reviewOverdue(): string;
  /** 滞后时长的人类可读化（分钟 / 小时 / 天）。 */
  latency(ms: number): string;
  studyModeQuiz(breakdown: string): string;
  studyModeReview(breakdown: string): string;
  studyModeCard(breakdown: string): string;
  studyModeRestatement(breakdown: string): string;
  studyModeCapability(breakdown: string): string;
  kindLabel: Record<EvidenceKind, string>;
  outputCoverage(pct: number): string;
  outputDensity(perChapter: number): string;
  outputNoteRatio(pct: number): string;
}

/** 证据种类固定顺序（计数与并列判定的兜底顺序，保证同数据同结论）。 */
const KIND_ORDER: readonly EvidenceKind[] = [
  "assessment",
  "review",
  "card",
  "restatement",
  "capability",
];

/**
 * 活跃时段 + 单次时长（`cadence-window`）。
 *
 * ① 把 `EvidenceEntry.at` 转本地小时，取**众数小时所在的 3 小时窗口**（跨零点正确）；
 * ② 同一天内按「相邻间隔 > 30 分钟切段」聚类，取段时长**中位数** → 「单次约 N 分钟」。
 */
export function deriveCadence(
  signals: MemorySignals,
  now: number,
  facts: MemoryFactTexts,
): DerivedFact | undefined {
  const { evidence } = signals;
  const gate = MEMORY_FACT_MIN_SAMPLES["cadence-window"];
  if (evidence.length < gate.evidence) return undefined;
  if (spanDays(evidence) < gate.spanDays) return undefined;

  const hours = new Array<number>(24).fill(0);
  for (const e of evidence) hours[new Date(e.at).getHours()]++;

  /**
   * 众数 3 小时窗口（跨零点用取模）。
   *
   * ⚠️ **并列时的取法是本函数的语义关键**：24 个小时里有 3 个窗口都覆盖峰值小时
   * （如全部集中在 22 时 → 20/21/22 三个窗口计数相同）。若取「第一个最大值」，
   * 结论会变成 `20:00–23:00` —— 而用户真正想知道的是「我 22 点后学」。
   * 故并列时**优先取「起点 = 峰值小时」的那个窗口**；峰值小时本身取最早者
   * （`indexOf(max)`），保证同数据同结论、跨零点不出 `-1` 时。
   */
  const peakHour = hours.indexOf(Math.max(...hours));
  let bestHour = 0;
  let bestCount = -1;
  for (let h = 0; h < 24; h++) {
    const count = hours[h] + hours[(h + 1) % 24] + hours[(h + 2) % 24];
    if (count > bestCount || (count === bestCount && h === peakHour)) {
      bestCount = count;
      bestHour = h;
    }
  }
  const window = `${pad2(bestHour)}:00–${pad2((bestHour + 3) % 24)}:00`;

  const minutes = medianSessionMinutes(evidence, now);
  return {
    key: "cadence-window",
    category: "cadence",
    text:
      minutes === undefined
        ? facts.cadenceWindowOnly(window)
        : facts.cadenceWindow(window, minutes),
  };
}

/**
 * 复习遵守度（`cadence-review`）：`delay = lastReviewedAt − nextReviewAt` 的中位数。
 *
 * 三等分：`≤ 0` 按时；`(0, 1 天]` 略滞后；`> 1 天` 拖到逾期。
 * ⚠️ `nextReviewAt` 缺失或 `reps < 1` 的卡**跳过**（不参与分母）—— 否则
 * `undefined` 参与减法会产出 `NaN` 中位数（TC-EDGE-04）。
 */
export function deriveReviewRhythm(
  signals: MemorySignals,
  facts: MemoryFactTexts,
): DerivedFact | undefined {
  const cards = Object.values(signals.cards);
  const totalReps = cards.reduce((sum, c) => sum + c.reps, 0);
  if (totalReps < MEMORY_FACT_MIN_SAMPLES["cadence-review"].cardReps) return undefined;

  const delays = cards
    .filter((c) => c.reps >= 1 && typeof c.nextReviewAt === "number")
    .map((c) => c.lastReviewedAt - (c.nextReviewAt as number));
  const delay = median(delays);
  if (delay === undefined) return undefined;

  let text: string;
  if (delay <= 0) text = facts.reviewOnTime();
  else if (delay <= LATE_TOLERANCE_MS) text = facts.reviewLate(facts.latency(delay));
  else text = facts.reviewOverdue();

  return { key: "cadence-review", category: "cadence", text };
}

/**
 * 学习方式（`pref-study-mode`）：按 `EvidenceKind` 计数，占比最高者为主。
 *
 * ⚠️ 输出**只描述行为分布**（「以测验驱动为主」），不下「为什么」的判断 ——
 * 与 F1 声明画像的冲突提示另走 `studyStyleMismatch`（D7：声明优先，冲突只提示不改）。
 */
export function deriveStudyMode(
  signals: MemorySignals,
  facts: MemoryFactTexts,
): DerivedFact | undefined {
  if (signals.evidence.length < MEMORY_FACT_MIN_SAMPLES["pref-study-mode"].evidence) {
    return undefined;
  }
  const counts = countByKind(signals.evidence);
  const leader = leaderKind(counts);
  if (!leader) return undefined;

  const breakdown = KIND_ORDER.filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => `${facts.kindLabel[k]} ${counts[k]}`)
    .join(" / ");

  const template: Record<EvidenceKind, (b: string) => string> = {
    assessment: facts.studyModeQuiz,
    review: facts.studyModeReview,
    card: facts.studyModeCard,
    restatement: facts.studyModeRestatement,
    capability: facts.studyModeCapability,
  };
  return {
    key: "pref-study-mode",
    category: "preference",
    text: template[leader](breakdown),
  };
}

/**
 * 输出习惯（`cog-output-habit`）：复述覆盖率中位数 + 划线密度 + 有笔记占比。
 *
 * 门槛 = 复述 ≥ 3 次；**划线密度需要 `chapterCount > 0`**（分母为 0 不做除零，
 * 该部分整段不产出，而不是产出 `Infinity`）。
 */
export function deriveOutputHabit(
  signals: MemorySignals,
  facts: MemoryFactTexts,
): DerivedFact | undefined {
  const { restatements, annotations, chapterCount } = signals;
  if (restatements.length < MEMORY_FACT_MIN_SAMPLES["cog-output-habit"].restatements) {
    return undefined;
  }

  const parts: string[] = [];
  const coverages = restatements
    .map((r) => r.feedback?.coverage)
    .filter((c): c is number => typeof c === "number");
  const coverage = median(coverages);
  if (coverage !== undefined) parts.push(facts.outputCoverage(Math.round(coverage * 100)));

  if (chapterCount > 0) {
    parts.push(facts.outputDensity(round1(annotations.length / chapterCount)));
    if (annotations.length > 0) {
      const withNote = annotations.filter((a) => a.note.trim().length > 0).length;
      parts.push(facts.outputNoteRatio(Math.round((withNote / annotations.length) * 100)));
    }
  }
  if (parts.length === 0) return undefined;

  return { key: "cog-output-habit", category: "cognition", text: parts.join("") };
}

/**
 * 全部派生（顺序固定：`cadence-window` → `cadence-review` → `pref-study-mode` → `cog-output-habit`）。
 *
 * **每条独立判门槛，互不牵连**：复述样本不够不影响活跃时段产出。
 */
export function deriveAllFacts(
  signals: MemorySignals,
  now: number,
  facts: MemoryFactTexts,
): DerivedFact[] {
  return [
    deriveCadence(signals, now, facts),
    deriveReviewRhythm(signals, facts),
    deriveStudyMode(signals, facts),
    deriveOutputHabit(signals, facts),
  ].filter((f): f is DerivedFact => f !== undefined);
}

/**
 * 「记录显示的学习方式」与 F1 **声明**的 `preferences.style` 是否冲突（§5.4 / D7）。
 *
 * 冲突时**以声明为准**（不自动改写声明），只在页面上给一条中性提示。
 * 无声明 / 无足够记录 → `undefined`（不制造冲突）。
 */
export function studyStyleMismatch(
  signals: MemorySignals,
  profile: LearnerProfile | undefined,
): { observed: StudyStyle; declared: StudyStyle } | undefined {
  const declared = profile?.preferences?.style;
  if (!declared) return undefined;
  if (signals.evidence.length < MEMORY_FACT_MIN_SAMPLES["pref-study-mode"].evidence) {
    return undefined;
  }
  const leader = leaderKind(countByKind(signals.evidence));
  if (!leader) return undefined;
  const observed: StudyStyle =
    leader === "assessment" ? "quiz" : leader === "capability" ? "quiz" : "practice";
  // 声明为「阅读为主」时，任何行为主导都算冲突（阅读没有对应的行为证据）
  if (observed === declared) return undefined;
  if (declared === "reading") return { observed, declared };
  if (declared === "quiz" && observed === "quiz") return undefined;
  if (declared === "practice" && observed === "practice") return undefined;
  return { observed, declared };
}

/**
 * 证据跨度（**整日**）：`floor((max − min) / 1 天)` —— 门槛是「至少覆盖 7 个整日」。
 *
 * ⚠️ 导出给 `/memory` 页头的「覆盖 N 天」用：**同一条规则不能在页面里重写一遍**
 * （两把尺子 —— 页头显示 8 天而门槛按 7 天判，用户会完全无法理解为什么还不达标）。
 */
export function spanDays(evidence: readonly { at: number }[]): number {
  if (evidence.length === 0) return 0;
  let min = evidence[0].at;
  let max = evidence[0].at;
  for (const e of evidence) {
    if (e.at < min) min = e.at;
    if (e.at > max) max = e.at;
  }
  return Math.floor((max - min) / MS_PER_DAY);
}

/** 会话段时长中位数（分钟）；没有任何多事件会话 → `undefined`（不报「约 0 分钟」）。 */
function medianSessionMinutes(
  evidence: readonly { at: number }[],
  _now: number,
): number | undefined {
  const times = [...new Set(evidence.map((e) => e.at))].sort((a, b) => a - b);
  const durations: number[] = [];
  let segmentStart = times[0];
  let prev = times[0];
  for (let i = 1; i < times.length; i++) {
    const t = times[i];
    if (t - prev > SESSION_GAP_MS) {
      if (prev > segmentStart) durations.push(prev - segmentStart);
      segmentStart = t;
    }
    prev = t;
  }
  if (prev > segmentStart) durations.push(prev - segmentStart);
  const ms = median(durations);
  return ms === undefined ? undefined : Math.max(1, Math.round(ms / MS_PER_MINUTE));
}

function countByKind(evidence: readonly { kind: EvidenceKind }[]): Record<EvidenceKind, number> {
  const counts = {
    assessment: 0,
    review: 0,
    card: 0,
    restatement: 0,
    capability: 0,
  } as Record<EvidenceKind, number>;
  for (const e of evidence) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return counts;
}

/** 占比最高者（并列按 `KIND_ORDER` 取靠前者 —— 同数据同结论）。 */
function leaderKind(counts: Record<EvidenceKind, number>): EvidenceKind | undefined {
  let leader: EvidenceKind | undefined;
  let best = 0;
  for (const kind of KIND_ORDER) {
    const c = counts[kind] ?? 0;
    if (c > best) {
      best = c;
      leader = kind;
    }
  }
  return leader;
}

/** 中位数（偶数取中间两个的平均值）；空数组 → `undefined`。 */
function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 保留一位小数（划线密度这类「每章 3.2 处」的展示口径）。 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 门槛表的键（供 UI 渲染「还差什么」时对齐文案）。 */
export type { MemoryFactKey };
