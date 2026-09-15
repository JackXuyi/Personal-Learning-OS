/**
 * 计划的时间维度（F2）—— 每日配额与时间分组。
 *
 * 输入全部来自 ChapterLoopSnapshot（无需新读取），输出全部为派生值（不落库）。
 * 设计决策见 docs/plan-time-dimension-design-2026-09.md：
 *  - D1 每日额度 = weeklyMinutes ÷ 7（自然日摊派）
 *  - D2 无预算仍给「今日应做」（deadline 摊派独立于预算）
 *  - D3 无 deadline → groups 为 undefined（UI 逐字节退回现状）
 *
 * 与 F1 的关系：`estimatePlanEta` 回答「来不来得及」（节奏外推结论），本模块回答
 * 「今天该做多少」（可执行处方）—— 前者复用而非重写，两者共用同一 pace 口径。
 */
import type { Chapter, LearnerProfile, NextAction } from "../../domain";
import { paceOf } from "../../engine";
import { estimateEtaMin, estimatePlanEta, weeklyMinutesOf, type PlanEta } from "./chapter-action";

const DAY_MS = 86_400_000;

/** 今日配额的输入（全部来自已有快照，无需新读取）。 */
export interface PlanQuotaInput {
  actions: readonly NextAction[];
  chapterOf: (id: string) => Chapter | undefined;
  profile?: LearnerProfile;
  deadlineAt?: number;
  now?: number;
}

/** 今日配额与时间分组（F2）。全部为派生值，不落库。 */
export interface PlanQuota {
  /** 队列总时长（分钟）—— 与 `estimatePlanEta.totalMinutes` 同源。 */
  totalMinutes: number;
  /** deadline 摊派的「今日应做」分钟；无 deadline → undefined。 */
  dueTodayMin?: number;
  /** 预算摊派的「今日额度」分钟（`weeklyMinutes ÷ 7`，D1）；无预算 → undefined。 */
  capacityMin?: number;
  /** 距截止天数（含今天与截止日当天，下限 1）；无 deadline → undefined。 */
  daysLeft?: number;
  /** 截止日已过（`deadlineAt < now`）。 */
  overdue: boolean;
  /**
   * 已超截止天数（仅 `overdue` 时有值；ceil 口径、下限 1）。
   * 由本模块给出而非 UI 重算 —— UI 若再用一次 `Date.now()` 会与这里的 `now`
   * 差一个时刻，跨零点时两个数字会互相矛盾。
   */
  overdueDays?: number;
  /** 节奏判定（沿用 `estimatePlanEta.deadline`；需声明预算才有）。 */
  pace?: PlanEta["deadline"];
  /** 时间分组；无 deadline 或队列为空 → undefined（UI 退回现状两段 / 空态）。 */
  groups?: { today: NextAction[]; week: NextAction[]; later: NextAction[] };
  /** 今日组实际总时长（分钟）。 */
  todayMinutes?: number;
}

/**
 * 今日配额与时间分组（纯函数）。
 *
 * 两个口径**分开算**，这是「落后」判定的根据：
 *  - `dueTodayMin`（应该做多少）= 队列总时长 ÷ 剩余天数 —— 只需 deadline（D2）；
 *  - `capacityMin`（你能做多少）= weeklyMinutes ÷ 7 —— 只需预算（D1）。
 * 两者都有时才由 `estimatePlanEta` 给出节奏判定（`pace`），本模块不重复公式。
 */
export function planQuota(input: PlanQuotaInput): PlanQuota {
  const { actions, chapterOf, profile, deadlineAt, now = Date.now() } = input;

  // 复用 F1 的汇总与节奏判定（唯一真源，勿重写公式）。
  const eta = estimatePlanEta({
    actions,
    chapterOf,
    ...(profile ? { profile } : {}),
    ...(deadlineAt !== undefined ? { deadlineAt } : {}),
    now,
  });

  // 阅读速度口径必须与 estimatePlanEta 内部一致：否则 totalMinutes 按画像水平算、
  // 而分组装填按 DEFAULT_PACE 算，两个「分钟」不是同一把尺子 → 装填偏差。
  const pace = paceOf(profile);

  // 每日额度（D1）：预算有效才有值；越界 / 缺省 = 未声明 → undefined。
  const weekly = weeklyMinutesOf(profile);
  const capacityMin = weekly === undefined ? undefined : Math.round(weekly / 7);

  // 无 deadline（D3）：只回可空字段，UI 据此退回现状两段。
  if (deadlineAt === undefined) {
    return {
      totalMinutes: eta.totalMinutes,
      overdue: false,
      ...(capacityMin !== undefined ? { capacityMin } : {}),
    };
  }

  // 剩余天数：把截止日按「当天结束」计（§3.4：deadlineAt 存的是当天 00:00），下限 1
  // —— 过期目标按 1 天摊完，不阻断（§5.2）。
  const daysLeft = Math.max(1, Math.ceil((deadlineAt + DAY_MS - now) / DAY_MS));
  const overdue = deadlineAt < now;
  const overdueDays = overdue ? Math.max(1, Math.ceil((now - deadlineAt) / DAY_MS)) : undefined;
  // 今日应做（D2）：deadline 摊派，不需要预算。
  const dueTodayMin = Math.ceil(eta.totalMinutes / daysLeft);
  // 本周额度：有预算用预算（一周），无预算退化为「按今日节奏再做 7 天」。
  const weekBudget = capacityMin !== undefined ? capacityMin * 7 : dueTodayMin * 7;

  const groups =
    actions.length > 0
      ? packByTime({ actions, chapterOf, pace, todayBudget: dueTodayMin, weekBudget })
      : undefined;

  return {
    totalMinutes: eta.totalMinutes,
    dueTodayMin,
    ...(capacityMin !== undefined ? { capacityMin } : {}),
    daysLeft,
    overdue,
    ...(overdueDays !== undefined ? { overdueDays } : {}),
    ...(eta.deadline !== undefined ? { pace: eta.deadline } : {}),
    ...(groups !== undefined
      ? { groups, todayMinutes: sumMin(groups.today, chapterOf, pace) }
      : {}),
  };
}

/**
 * 按时间装填（贪心，不超装）。
 *
 * 规则：today 为空时**必然放 1 项**（否则「今天必做」会空 —— 即使单项就超配额）；
 * 其余按 `acc + t <= todayBudget` 装进 today，再按 weekBudget 装进 week，余下 later。
 * `acc` 是**全局**累计（三段共用），保证「今天 + 本周」不重复计入同一分钟。
 */
function packByTime(args: {
  actions: readonly NextAction[];
  chapterOf: (id: string) => Chapter | undefined;
  pace: number;
  todayBudget: number;
  weekBudget: number;
}): { today: NextAction[]; week: NextAction[]; later: NextAction[] } {
  const { actions, chapterOf, pace, todayBudget, weekBudget } = args;
  const today: NextAction[] = [];
  const week: NextAction[] = [];
  const later: NextAction[] = [];
  let acc = 0;
  for (const a of actions) {
    const t = estimateEtaMin(a, chapterOf(a.unitId), pace);
    if (today.length === 0 || acc + t <= todayBudget) {
      today.push(a);
    } else if (acc < todayBudget + weekBudget) {
      week.push(a);
    } else {
      later.push(a);
    }
    acc += t;
  }
  return { today, week, later };
}

/** 组内总时长（分钟）—— 与装填同口径。 */
function sumMin(
  actions: readonly NextAction[],
  chapterOf: (id: string) => Chapter | undefined,
  pace: number,
): number {
  return actions.reduce((n, a) => n + estimateEtaMin(a, chapterOf(a.unitId), pace), 0);
}
