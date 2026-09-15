/**
 * F2 · 计划的时间维度 `planQuota()` 单测（docs/plan-time-dimension-design-2026-09.md §12）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:quota
 *
 * 覆盖：配额公式（UC-01/02）· 时间分组装填（UC-01/03）· 无 deadline 零回归（UC-03）·
 * 节奏判定（UC-04）· 边界 9 条（EDGE-01~09）· 回归 3 条（REG-01/02/04）。
 * TC-REG-03（`estimatePlanEta` 行为不变）由 `npm run test:eta` 覆盖。
 *
 * 所有断言**显式注入 `now`**（默认 0 = epoch），杜绝 `Date.now()` 带来的不确定性。
 */
import assert from "node:assert/strict";
import { planQuota } from "../src/features/plan/plan-quota.ts";
import type { Chapter } from "../src/domain/chapter.ts";
import type { LearnerProfile } from "../src/domain/learner.ts";
import type { NextAction } from "../src/domain/plan.ts";

const DAY = 86_400_000;
/** 所有用例共用的固定「现在」（epoch，便于按整天构造 deadline）。 */
const NOW = 0;

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

/** 章：`contentRef` 跨度 = chars（决定 learn-chapter 的耗时）。 */
function chapter(id: string, chars: number): Chapter {
  return {
    id,
    documentId: "d1",
    order: 1,
    title: `${id} 标题`,
    contentRef: { start: 0, end: chars },
    keyPoints: [],
    unitIds: [],
    status: "not-started",
    createdAt: 1,
  };
}

/**
 * 队列工厂：按给定分钟数构造动作。
 *
 * `learn-chapter` 的耗时为 `clamp(round(chars / pace), 5, 40)`，取 `chars = 350 × min`
 * 且 `min ∈ [5, 40]` → 结果恰为 `min`（默认 pace = DEFAULT_PACE = 350）。
 */
function queue(mins: number[]): {
  actions: NextAction[];
  chapterOf: (id: string) => Chapter | undefined;
} {
  const map = new Map<string, Chapter>();
  const actions = mins.map((min, i) => {
    const unitId = `c${i}`;
    map.set(unitId, chapter(unitId, 350 * min));
    return {
      id: `a${i}`,
      kind: "learn-chapter" as const,
      unitId,
      priority: i,
      reasons: [],
      createdAt: 1,
    };
  });
  return { actions, chapterOf: (id) => map.get(id) };
}

/** retake-quiz 队列（5 分钟/项的常量，不读章信息）。 */
function retakeQueue(n: number): {
  actions: NextAction[];
  chapterOf: (id: string) => Chapter | undefined;
} {
  const actions = Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    kind: "retake-quiz" as const,
    unitId: `c${i}`,
    priority: i,
    reasons: [],
    createdAt: 1,
  }));
  return { actions, chapterOf: () => undefined };
}

/** 画像：`weeklyMinutes` 省略即「未声明」。 */
function profile(patch: Partial<LearnerProfile> = {}): LearnerProfile {
  return {
    level: "basic",
    preferences: { depth: "depth", style: "reading" },
    updatedAt: 1,
    ...patch,
  };
}

const idsOf = (list: readonly NextAction[]): string[] => list.map((a) => a.id);

async function main() {
  /* ---------------- UC-01 · 有 deadline + 有预算 ---------------- */

  await check("TC-UC01-01 队列 300 分钟 ÷ 6 天 → dueTodayMin 50", () => {
    const { actions, chapterOf } = queue([30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
    const q = planQuota({ actions, chapterOf, deadlineAt: 5 * DAY, now: NOW });
    assert.equal(q.totalMinutes, 300);
    assert.equal(q.daysLeft, 6);
    assert.equal(q.dueTodayMin, 50);
  });

  await check("TC-UC01-02 weeklyMinutes 350 → capacityMin 50（round(350/7)）", () => {
    const { actions, chapterOf } = queue([30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
    const q = planQuota({
      actions,
      chapterOf,
      profile: profile({ weeklyMinutes: 350 }),
      deadlineAt: 5 * DAY,
      now: NOW,
    });
    assert.equal(q.capacityMin, 50);
  });

  await check("TC-UC01-03 队列 [12,8,40,30] ÷ 3 天 → today 装前 2 项（40 装不下）", () => {
    const { actions, chapterOf } = queue([12, 8, 40, 30]);
    const q = planQuota({ actions, chapterOf, deadlineAt: 2 * DAY, now: NOW });
    assert.equal(q.totalMinutes, 90);
    assert.equal(q.dueTodayMin, 30);
    assert.deepEqual(idsOf(q.groups?.today ?? []), ["a0", "a1"]);
    assert.deepEqual(idsOf(q.groups?.week ?? []), ["a2", "a3"]);
    assert.deepEqual(idsOf(q.groups?.later ?? []), []);
  });

  await check("TC-UC01-04 todayMinutes === 20（12 + 8）", () => {
    const { actions, chapterOf } = queue([12, 8, 40, 30]);
    const q = planQuota({ actions, chapterOf, deadlineAt: 2 * DAY, now: NOW });
    assert.equal(q.todayMinutes, 20);
  });

  await check("TC-UC01-05 三段并集 = 原队列顺序（不丢项、不乱序）", () => {
    const { actions, chapterOf } = queue([12, 8, 40, 30]);
    const q = planQuota({ actions, chapterOf, deadlineAt: 2 * DAY, now: NOW });
    const all = [
      ...(q.groups?.today ?? []),
      ...(q.groups?.week ?? []),
      ...(q.groups?.later ?? []),
    ];
    assert.deepEqual(idsOf(all), idsOf(actions));
  });

  await check("TC-UC01-06 deadline 6 天后 00:00、now 今天 14:00 → daysLeft 7", () => {
    const { actions, chapterOf } = queue([10]);
    const q = planQuota({
      actions,
      chapterOf,
      deadlineAt: 6 * DAY,
      now: 14 * 3_600_000,
    });
    assert.equal(q.daysLeft, 7);
    assert.equal(q.overdue, false);
  });

  /* ---------------- UC-02 · 有 deadline 无预算（D2） ---------------- */

  await check("TC-UC02-01 无 weeklyMinutes：dueTodayMin 有值、capacityMin/pace 无值", () => {
    const { actions, chapterOf } = queue([30, 30]);
    const q = planQuota({
      actions,
      chapterOf,
      profile: profile(),
      deadlineAt: 2 * DAY,
      now: NOW,
    });
    assert.equal(q.dueTodayMin, 20);
    assert.equal(q.capacityMin, undefined);
    assert.equal(q.pace, undefined);
  });

  await check("TC-UC02-02 weeklyMinutes 20（< 下限 30）视为未声明", () => {
    const { actions, chapterOf } = queue([30, 30]);
    const q = planQuota({
      actions,
      chapterOf,
      profile: profile({ weeklyMinutes: 20 }),
      deadlineAt: 2 * DAY,
      now: NOW,
    });
    assert.equal(q.capacityMin, undefined);
    assert.equal(q.pace, undefined);
  });

  await check("TC-UC02-03 无预算仍产生三段分组（不回退两段）", () => {
    const { actions, chapterOf } = queue([30, 30]);
    const q = planQuota({ actions, chapterOf, deadlineAt: 2 * DAY, now: NOW });
    assert.notEqual(q.groups, undefined);
    assert.equal(idsOf(q.groups?.today ?? []).length, 1);
    assert.equal(idsOf(q.groups?.week ?? []).length, 1);
  });

  /* ---------------- UC-03 · 无 deadline（D3 零回归） ---------------- */

  await check("TC-UC03-01 无 deadline → groups/dueTodayMin 缺失、overdue false", () => {
    const { actions, chapterOf } = queue([30, 30]);
    const q = planQuota({ actions, chapterOf, now: NOW });
    assert.equal(q.groups, undefined);
    assert.equal(q.dueTodayMin, undefined);
    assert.equal(q.overdue, false);
    assert.equal(q.totalMinutes, 60);
  });

  await check("TC-UC03-02 无 deadline + 有预算 → capacityMin 有值但不分组", () => {
    const { actions, chapterOf } = queue([30, 30]);
    const q = planQuota({
      actions,
      chapterOf,
      profile: profile({ weeklyMinutes: 350 }),
      now: NOW,
    });
    assert.equal(q.capacityMin, 50);
    assert.equal(q.groups, undefined);
  });

  /* ---------------- UC-04 · 节奏判定（首页警示的依据） ---------------- */

  await check("TC-UC04-01 学不完（6.4 天 vs 2 天）→ pace.behind true、days 4", () => {
    const { actions, chapterOf } = queue([40, 40, 40, 40, 40, 40, 40, 40]);
    const q = planQuota({
      actions,
      chapterOf,
      profile: profile({ weeklyMinutes: 350 }),
      deadlineAt: 2 * DAY,
      now: NOW,
    });
    assert.equal(q.totalMinutes, 320);
    assert.equal(q.pace?.behind, true);
    assert.equal(q.pace?.days, 4);
  });

  await check("TC-UC04-02 来得及 → pace.behind false（首页不渲染警示）", () => {
    const { actions, chapterOf } = queue([10]);
    const q = planQuota({
      actions,
      chapterOf,
      profile: profile({ weeklyMinutes: 350 }),
      deadlineAt: 2 * DAY,
      now: NOW,
    });
    assert.equal(q.pace?.behind, false);
  });

  /* ---------------- 边界 ---------------- */

  await check("TC-EDGE-01 deadline 已过 3 天 → overdue true、daysLeft 1、一天摊完", () => {
    const { actions, chapterOf } = queue([30, 30]);
    const q = planQuota({ actions, chapterOf, deadlineAt: -3 * DAY, now: NOW });
    assert.equal(q.overdue, true);
    assert.equal(q.overdueDays, 3);
    assert.equal(q.daysLeft, 1);
    assert.equal(q.dueTodayMin, q.totalMinutes);
  });

  await check("TC-EDGE-02 deadline === now（临界）→ daysLeft 1、overdue false", () => {
    const { actions, chapterOf } = queue([30, 30]);
    const q = planQuota({ actions, chapterOf, deadlineAt: NOW, now: NOW });
    assert.equal(q.daysLeft, 1);
    assert.equal(q.overdue, false);
    assert.equal(q.overdueDays, undefined);
  });

  await check("TC-EDGE-03 队列为空 → totalMinutes/dueTodayMin 0、无分组", () => {
    const q = planQuota({
      actions: [],
      chapterOf: () => undefined,
      deadlineAt: 2 * DAY,
      now: NOW,
    });
    assert.equal(q.totalMinutes, 0);
    assert.equal(q.dueTodayMin, 0);
    assert.equal(q.groups, undefined);
  });

  await check("TC-EDGE-04 单项 40 分钟 > dueTodayMin 20 → 仍进 today", () => {
    const { actions, chapterOf } = queue([40]);
    const q = planQuota({ actions, chapterOf, deadlineAt: DAY, now: NOW });
    assert.equal(q.dueTodayMin, 20);
    assert.deepEqual(idsOf(q.groups?.today ?? []), ["a0"]);
    assert.equal(q.todayMinutes, 40);
  });

  await check("TC-EDGE-05 dueTodayMin = 1 且队列多项 → today 只有 1 项", () => {
    const { actions, chapterOf } = queue([8, 8]);
    const q = planQuota({ actions, chapterOf, deadlineAt: 15 * DAY, now: NOW });
    assert.equal(q.dueTodayMin, 1);
    assert.equal(idsOf(q.groups?.today ?? []).length, 1);
  });

  await check("TC-EDGE-06 deadline 恰为整 6 天后 → daysLeft 7（无 off-by-one）", () => {
    const { actions, chapterOf } = queue([10]);
    const q = planQuota({ actions, chapterOf, deadlineAt: 6 * DAY, now: NOW });
    assert.equal(q.daysLeft, 7);
  });

  await check("TC-EDGE-07 profile 缺省 → 不抛错、capacityMin 缺失、其余照常", () => {
    const { actions, chapterOf } = queue([30, 30]);
    const q = planQuota({ actions, chapterOf, deadlineAt: 2 * DAY, now: NOW });
    assert.equal(q.capacityMin, undefined);
    assert.equal(q.dueTodayMin, 20);
    assert.equal(q.daysLeft, 3);
  });

  await check("TC-EDGE-08 全 retake-quiz（5 分钟常量）→ 不读章信息仍正确分组", () => {
    const { actions, chapterOf } = retakeQueue(2);
    const q = planQuota({ actions, chapterOf, deadlineAt: DAY, now: NOW });
    assert.equal(q.totalMinutes, 10);
    assert.equal(q.dueTodayMin, 5);
    assert.deepEqual(idsOf(q.groups?.today ?? []), ["r0"]);
    assert.deepEqual(idsOf(q.groups?.week ?? []), ["r1"]);
    assert.equal(q.todayMinutes, 5);
  });

  await check("TC-EDGE-09 阅读速度口径统一：advanced(450) 不用 DEFAULT_PACE(350)", () => {
    // chars 4500：按画像 450 字/分 = 10 分钟；若误用默认 350 会算成 13 分钟
    // → 会让 totalMinutes 与 todayMinutes 变成两把尺子。
    const map = new Map([["c0", chapter("c0", 4500)]]);
    const { actions } = queue([10]);
    const q = planQuota({
      actions,
      chapterOf: (id) => map.get(id),
      profile: profile({ level: "advanced" }),
      deadlineAt: 2 * DAY,
      now: NOW,
    });
    assert.equal(q.totalMinutes, 10);
    assert.equal(q.todayMinutes, 10);
  });

  /* ---------------- 回归：无 deadline 的 UI 判据 ---------------- */

  await check("TC-REG-01 无 deadline → groups 缺失（UI hasQuota === false）", () => {
    const { actions, chapterOf } = queue([12, 8, 40, 30]);
    const q = planQuota({ actions, chapterOf, now: NOW });
    assert.equal(q.groups === undefined, true);
  });

  await check("TC-REG-02 无 deadline → 无配额行（dueTodayMin 缺失）", () => {
    const { actions, chapterOf } = queue([12, 8, 40, 30]);
    const q = planQuota({ actions, chapterOf, profile: profile({ weeklyMinutes: 350 }), now: NOW });
    assert.equal(q.dueTodayMin, undefined);
  });

  await check("TC-REG-04 首页无 deadline → 标题仍走 todayTitle（quota 缺失）", () => {
    const { actions, chapterOf } = queue([12, 8]);
    const q = planQuota({ actions, chapterOf, now: NOW });
    assert.equal(q.dueTodayMin === undefined, true);
    assert.equal(q.pace === undefined, true);
  });
}

await main();

for (const line of results) console.log(line);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
