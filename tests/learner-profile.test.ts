/**
 * F1 · 学习者画像 —— 消费点 / 档位覆盖 / 容错 单测。
 * （docs/learner-profile-design-2026-09.md §12 TC-UC01~03 / TC-UC07~08 / TC-EDGE-01-02-06-07-08）
 *
 * 运行（Node 22 + 类型剥离直跑，见 package.json `test:profile`）：
 *   npm run test:profile
 *
 * 不 import 任何 `.tsx` 与 store：纯 `.ts` 链路（strip-types 不支持 JSX）。
 */
import assert from "node:assert/strict";
import type { Chapter } from "../src/domain/chapter.ts";
import type { NextAction } from "../src/domain/plan.ts";
import type { LearnerProfile } from "../src/domain/learner.ts";
import { PROFILE_LIMITS } from "../src/domain/learner.ts";
import {
  bandForChapter,
  bandForLevel,
  DEFAULT_PACE,
  paceOf,
} from "../src/engine/profile-band.ts";
import { createPaper } from "../src/engine/quiz-engine.ts";
import { buildChapterPlan, clsRankMap } from "../src/engine/learning-planner.ts";
import { estimateEtaMin, estimatePlanEta } from "../src/features/plan/chapter-action.ts";
import { mergeResumeDraft, normalizeProfile, ProfileError, toProfile } from "../src/features/profile/profile-service.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import { LocalStorageAdapter } from "../src/storage/local.ts";

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

/* ---------------- fixtures ---------------- */

const DAY = 86_400_000;

function chapter(id: string, order: number, status: Chapter["status"] = "not-started"): Chapter {
  return {
    id,
    documentId: "d1",
    order,
    title: `第${order}章`,
    contentRef: { start: 0, end: 12_000 },
    keyPoints: ["要点甲", "要点乙"],
    unitIds: [],
    status,
    createdAt: 1,
  };
}

function action(kind: NextAction["kind"], unitId = "c1"): NextAction {
  return { id: `a-${kind}-${unitId}`, kind, unitId, priority: 0, reasons: [], createdAt: 1 };
}

function profileOf(level: LearnerProfile["level"]): LearnerProfile {
  return {
    level,
    preferences: { depth: "depth", style: "reading" },
    updatedAt: 1,
  };
}

/** 卷面「形状」快照：去掉随机 id，只看可复算的确定性字段。 */
function shapeOfPaper(paper: ReturnType<typeof createPaper>): string[] {
  return paper.questions.map((q) => `${q.type}/${q.cognitiveLevel}/${q.difficulty}`);
}

async function main() {
  /* ============ 消费点 1：出卷难度先验 ============ */

  await check("TC-UC01-01 bandForLevel(undefined) → 1（现状）", () => {
    assert.equal(bandForLevel(undefined), 1);
  });

  await check("TC-UC01-01b 四档 → 三档映射（D4-A）", () => {
    assert.equal(bandForLevel("beginner"), 1);
    assert.equal(bandForLevel("basic"), 1);
    assert.equal(bandForLevel("intermediate"), 2);
    assert.equal(bandForLevel("advanced"), 3);
  });

  await check("TC-UC01-02 无掌握度记录 → 走自评先验", () => {
    const empty = { mastery: 0, attempts: 0 } as never;
    assert.equal(bandForChapter(empty, profileOf("advanced")), 3);
    assert.equal(bandForChapter(undefined, profileOf("beginner")), 1);
    assert.equal(bandForChapter(undefined, undefined), 1);
  });

  await check("TC-UC02-01 有卷面证据 → 实测压倒自评", () => {
    const unit = { mastery: 0.2, attempts: 3 } as never;
    assert.equal(bandForChapter(unit, profileOf("advanced")), 1);
  });

  await check("TC-UC02-02 mastery>0 而 attempts=0 仍算「有证据」", () => {
    // applyRating 会移动 mastery 但不增 attempts —— 只看 attempts 会误判为无证据。
    const unit = { mastery: 0.5, attempts: 0 } as never;
    assert.equal(bandForChapter(unit, profileOf("advanced")), 2);
  });

  await check("TC-UC02-03 createPaper 不传 profile → 与改动前同形状（零回归）", () => {
    const ch = chapter("c1", 1);
    const paper = createPaper({
      scope: { chapterIds: ["c1"], mode: "unit-test" },
      chapters: [ch],
    });
    assert.deepEqual(shapeOfPaper(paper), [
      "choice/remember/1",
      "judge/remember/1",
      "choice/remember/1",
    ]);
  });

  await check("profile 只在无证据时生效（同形状可复算）", () => {
    const ch = chapter("c1", 1);
    const base = {
      scope: { chapterIds: ["c1"], mode: "unit-test" as const },
      chapters: [ch],
      allowSubjective: true,
    };
    // 无证据 + advanced → band 3（含 2 道主观题）
    const advanced = createPaper({ ...base, profile: profileOf("advanced") });
    assert.deepEqual(shapeOfPaper(advanced), [
      "choice/analyze/3",
      "judge/understand/3",
      "choice/analyze/3",
      "qa/analyze/5",
      "application/evaluate/5",
    ]);
    // 有证据（mastery 0.2）→ 先验被实测接管，即使自评 advanced 也回 band 1
    const evidenced = createPaper({
      ...base,
      learnerState: { byUnit: { c1: { mastery: 0.2, attempts: 3 } as never } },
      profile: profileOf("advanced"),
    });
    assert.deepEqual(shapeOfPaper(evidenced), [
      "choice/remember/1",
      "judge/remember/1",
      "choice/remember/1",
    ]);
  });

  await check("TC-UC03-05/06 阅读速度因子：默认 350，档位改变学习耗时", () => {
    assert.equal(DEFAULT_PACE, 350);
    assert.equal(paceOf(undefined), 350);
    assert.equal(paceOf(profileOf("beginner")), 300);
    assert.equal(paceOf(profileOf("advanced")), 450);
    const ch = chapter("c1", 1);
    const a = action("learn-chapter");
    assert.equal(estimateEtaMin(a, ch), estimateEtaMin(a, ch, 350)); // 零回归
    assert.equal(estimateEtaMin(a, ch, 300), 40); // 12000/300 = 40
    assert.equal(estimateEtaMin(a, ch, 450), 27); // 12000/450 ≈ 26.7
  });

  /* ============ 消费点 2：计划预计完成日期 ============ */

  await check("TC-UC03-01 有计划预算 → 线性推算完成日", () => {
    const now = 1_700_000_000_000;
    const actions = Array.from({ length: 30 }, () => action("chapter-quiz")); // 30 × 8 = 240 min
    const eta = estimatePlanEta({
      actions,
      chapterOf: () => undefined,
      profile: { ...profileOf("basic"), weeklyMinutes: 300 },
      now,
    });
    assert.equal(eta.totalMinutes, 240);
    assert.equal(eta.finishAt, now + (240 / 300) * 7 * DAY);
    assert.equal(eta.deadline, undefined);
  });

  await check("TC-UC03-02/03 未声明或越界预算 → 不给完成日（零回归）", () => {
    const actions = [action("chapter-quiz")];
    for (const weeklyMinutes of [undefined, 0, 20, 168 * 60 + 1]) {
      const eta = estimatePlanEta({
        actions,
        chapterOf: () => undefined,
        profile: { ...profileOf("basic"), ...(weeklyMinutes !== undefined ? { weeklyMinutes } : {}) },
      });
      assert.equal(eta.finishAt, undefined, `weekly=${weeklyMinutes}`);
      assert.equal(eta.totalMinutes, 8);
    }
  });

  await check("TC-UC03-04 + D5 完成日早于截止日 → behind=false；晚于 → behind=true", () => {
    const now = 1_700_000_000_000;
    const actions = Array.from({ length: 30 }, () => action("chapter-quiz")); // 240 min
    const weekly = { ...profileOf("basic"), weeklyMinutes: 300 };
    const finish = now + (240 / 300) * 7 * DAY;

    const ahead = estimatePlanEta({
      actions, chapterOf: () => undefined, profile: weekly, deadlineAt: finish + 3 * DAY, now,
    });
    assert.deepEqual(ahead.deadline, { at: finish + 3 * DAY, behind: false, days: 3 });

    const behind = estimatePlanEta({
      actions, chapterOf: () => undefined, profile: weekly, deadlineAt: finish - 5 * DAY, now,
    });
    assert.deepEqual(behind.deadline, { at: finish - 5 * DAY, behind: true, days: 5 });
  });

  await check("TC-EDGE-02 空队列 → 0 分钟（UI 不渲染完成日期行）", () => {
    const eta = estimatePlanEta({
      actions: [],
      chapterOf: () => undefined,
      profile: { ...profileOf("basic"), weeklyMinutes: 300 },
      now: 0,
    });
    assert.equal(eta.totalMinutes, 0);
    assert.equal(eta.finishAt, 0);
  });

  await check("TC-EDGE-01 一周满预算（10080）→ 结果有限且非负", () => {
    const eta = estimatePlanEta({
      actions: [action("chapter-quiz")],
      chapterOf: () => undefined,
      profile: { ...profileOf("basic"), weeklyMinutes: 168 * 60 },
      now: 0,
    });
    assert.ok(Number.isFinite(eta.finishAt ?? NaN));
    assert.ok((eta.finishAt ?? -1) >= 0);
  });

  await check("TC-EDGE-08 概念层 action 无章信息 → 沿用 estimateEtaMin 兜底 8 分钟", () => {
    const eta = estimatePlanEta({
      actions: [action("remediation", "u1"), action("review", "u2")],
      chapterOf: () => undefined,
      profile: { ...profileOf("basic"), weeklyMinutes: 300 },
      now: 0,
    });
    assert.equal(eta.totalMinutes, 16);
  });

  /* ============ 消费点 3：档位覆盖（depth） ============ */

  await check("TC-UC08-01 不传 prefs / 传 depth → 输出与现状逐项相同", () => {
    const chapters = [chapter("c1", 1, "ready"), chapter("c2", 2, "not-started")];
    const learnerState = { byUnit: {} };
    const none = buildChapterPlan({ chapters, learnerState });
    const depth = buildChapterPlan({ chapters, learnerState, prefs: { depth: "depth" } });
    const key = (a: NextAction[]) => a.map((x) => `${x.kind}:${x.unitId}`);
    assert.deepEqual(key(depth), key(none));
    // 现状顺序：学完待测(3) 先于 推进未学(5)
    assert.deepEqual(key(none), ["chapter-quiz:c1", "learn-chapter:c2"]);
    assert.deepEqual(clsRankMap(undefined), clsRankMap("depth"));
  });

  await check("TC-UC08-02 depth=breadth → 未学章提到待测章之前（且不跨类）", () => {
    const chapters = [chapter("c1", 1, "ready"), chapter("c2", 2, "not-started")];
    const plan = buildChapterPlan({
      chapters,
      learnerState: { byUnit: {} },
      prefs: { depth: "breadth" },
    });
    assert.deepEqual(plan.map((x) => `${x.kind}:${x.unitId}`), [
      "learn-chapter:c2",
      "chapter-quiz:c1",
    ]);
    // 补考(cls1)/复习要点(cls2) 档位不变 —— 广度优先只换 3↔5
    assert.equal(clsRankMap("breadth")[1], 1);
    assert.equal(clsRankMap("breadth")[2], 2);
    assert.equal(clsRankMap("breadth")[4], 4);
  });

  /* ============ 画像读写与容错 ============ */

  await check("TC-UC07-01 saveProfile(undefined) → getProfile() 为 undefined", async () => {
    const store = new InMemoryStorage();
    await store.saveProfile(profileOf("intermediate"));
    assert.equal((await store.getProfile())?.level, "intermediate");
    await store.saveProfile(undefined);
    assert.equal(await store.getProfile(), undefined);
  });

  await check("TC-UC07-02 localStorage 后端：跨实例回读 + 清除不残留 'undefined'", async () => {
    const mem = new Map<string, string>();
    const stub = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: stub,
      configurable: true,
      writable: true,
    });
    const a = new LocalStorageAdapter();
    await a.saveProfile(profileOf("advanced"));
    const rehydrated = await new LocalStorageAdapter().getProfile();
    assert.equal(rehydrated?.level, "advanced");
    await a.saveProfile(undefined);
    assert.equal(mem.has("plos.learner-profile"), false, "未填写应移除 key");
    assert.equal(await new LocalStorageAdapter().getProfile(), undefined);
  });

  await check("TC-UC08-05 normalizeProfile 六种畸形输入按表回落", () => {
    // 1) level 非法 / 缺失 → 视为未填写
    assert.equal(normalizeProfile({ preferences: {} }), undefined);
    assert.equal(normalizeProfile({ level: "expert" }), undefined);
    assert.equal(normalizeProfile(null), undefined);
    // 2) preferences 缺失 → 补默认，不整条丢弃
    assert.deepEqual(normalizeProfile({ level: "basic" })?.preferences, {
      depth: "depth",
      style: "reading",
    });
    // 3) preferences 枚举非法 → 单项回落
    assert.deepEqual(
      normalizeProfile({ level: "basic", preferences: { depth: "wide", style: "video" } })?.preferences,
      { depth: "depth", style: "reading" },
    );
    // 4) weeklyMinutes 非数字 / 越界 → undefined
    assert.equal(normalizeProfile({ level: "basic", weeklyMinutes: Number.NaN })?.weeklyMinutes, undefined);
    assert.equal(normalizeProfile({ level: "basic", weeklyMinutes: 10 })?.weeklyMinutes, undefined);
    assert.equal(normalizeProfile({ level: "basic", weeklyMinutes: 999_999 })?.weeklyMinutes, undefined);
    assert.equal(normalizeProfile({ level: "basic", weeklyMinutes: 300 })?.weeklyMinutes, 300);
    // 5) background 超长 → 截断；backgroundSource 非法 → manual
    const long = "甲".repeat(PROFILE_LIMITS.backgroundChars + 5);
    const n5 = normalizeProfile({ level: "basic", background: long, backgroundSource: "weird" });
    assert.equal(n5?.background?.length, PROFILE_LIMITS.backgroundChars);
    assert.equal(n5?.backgroundSource, "manual");
    // 6) updatedAt 非法 → 用当前时间
    assert.ok((normalizeProfile({ level: "basic", updatedAt: "x" })?.updatedAt ?? 0) > 0);
  });

  await check("TC-EDGE-06/07 旧画像缺字段 / 档位非法", () => {
    const legacy = normalizeProfile({ level: "intermediate", updatedAt: 5 });
    assert.deepEqual(legacy?.preferences, { depth: "depth", style: "reading" });
    assert.equal(legacy?.level, "intermediate");
    assert.equal(normalizeProfile({ level: "PRO" }), undefined);
  });

  await check("toProfile 档位非法 → ProfileError('invalid-level')", () => {
    assert.equal(toProfile({ level: "advanced" }).level, "advanced");
    assert.throws(
      () => toProfile({ level: "" }),
      (err: unknown) => err instanceof ProfileError && err.kind === "invalid-level",
    );
  });

  await check("TC-UC04-05 mergeResumeDraft 只覆盖背景/来源/档位", () => {
    const base: LearnerProfile = {
      level: "basic",
      weeklyMinutes: 300,
      preferences: { depth: "breadth", style: "quiz" },
      background: "旧摘要",
      backgroundSource: "manual",
      updatedAt: 1,
    };
    const draft = { background: "新摘要", level: "advanced" as const, skills: [] };

    const kept = mergeResumeDraft(base, draft, false, 9);
    assert.equal(kept?.level, "basic", "未勾选 → 不覆盖档位");
    assert.equal(kept?.weeklyMinutes, 300, "每周预算原样保留");
    assert.deepEqual(kept?.preferences, { depth: "breadth", style: "quiz" });
    assert.equal(kept?.background, "新摘要");
    assert.equal(kept?.backgroundSource, "resume");
    assert.equal(kept?.updatedAt, 9);

    const applied = mergeResumeDraft(base, draft, true, 9);
    assert.equal(applied?.level, "advanced");
    assert.equal(applied?.weeklyMinutes, 300);

    // 无基线且未采用建议值 → 返回 undefined（绝不替用户猜档位）
    assert.equal(mergeResumeDraft(undefined, { skills: [] }, false), undefined);
    assert.equal(mergeResumeDraft(undefined, draft, true)?.level, "advanced");
  });
}

await main();

for (const line of results) console.log(line);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
