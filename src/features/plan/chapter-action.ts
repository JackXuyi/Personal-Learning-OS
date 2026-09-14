/**
 * 章级计划动作的共享展示与执行工具（T8）——
 * 首页主 CTA / /plan 计划页 / 报告页共用，避免各页维护一份 kind → 徽标/动词/跳转映射。
 */
import type { Chapter, LearnerProfile, LearnerState, NextAction, Paper } from "../../domain";
import { PAPER_MODE_DURATION_MIN, PROFILE_LIMITS } from "../../domain";
import { createRetakePaper, DEFAULT_PACE, paceOf } from "../../engine";
// 子路径 import（不经 i18n barrel），避免 .tsx 参与单测直跑（与 engine/loop.ts 一致）。
import { zh, type Messages } from "../../i18n/messages/zh";

export interface ChapterActionMeta {
  /** kind 徽标（tailwind 浅底深字圆角，与报告页 KIND_CHIP 同一套配色）。 */
  chip: string;
  /** 计划列表项的主按钮动词（去学习 / 去测验 / 生成补考卷 / 去复习）。 */
  verb: string;
  /** 首页主 CTA 大按钮上的动词（去学本章 / 去测本章 / 补考本章 / 去复习要点）。 */
  cta: string;
}

const CHIP: Record<string, string> = {
  "learn-chapter": "border-red-200 bg-red-50 text-red-600",
  "retake-quiz": "border-amber-200 bg-amber-50 text-amber-700",
  "review-points": "border-sky-200 bg-sky-50 text-sky-700",
  "chapter-quiz": "border-indigo-200 bg-indigo-50 text-indigo-700",
};

const FALLBACK_CHIP = "border-slate-200 bg-slate-100 text-slate-600";

export function chapterActionMeta(
  kind: NextAction["kind"],
  m: Messages = zh,
): ChapterActionMeta {
  return {
    chip: CHIP[kind] ?? FALLBACK_CHIP,
    verb: m.units.actionVerb[kind],
    cta: m.units.actionCta[kind],
  };
}

/**
 * 章动作的可直达路径（阅读 / 出卷向导预填）。
 * 补考（retake-quiz）返回 undefined —— 需先 makeRetakePaper 生成卷再进答题页。
 */
export function actionPath(
  action: NextAction,
  chapter: Chapter | undefined,
): string | undefined {
  if (action.kind === "chapter-quiz") {
    return `/quiz/new?doc=${chapter?.documentId ?? ""}&chapters=${action.unitId}&mode=unit-test`;
  }
  if (action.kind === "learn-chapter" || action.kind === "review-points") {
    return `/learn/${action.unitId}`;
  }
  return undefined; // retake-quiz
}

/**
 * 生成一份补考卷（retake：客观 3 题 · 降一档难度；干扰项取同文档其他章）。
 * 不落库 —— 由调用方 savePaper 后 navigate(`/quiz/${paper.id}`)。
 *
 * 单章便捷入口（首页主 CTA / /plan / ⌘K 用）：委托 engine.createRetakePaper，
 * 与报告页「补考 N 个弱章」的聚合出卷共用同一实现（T10）。
 */
export function makeRetakePaper(
  chapter: Chapter,
  docChapters: Chapter[],
  learnerState: LearnerState,
): Paper {
  return createRetakePaper({
    chapters: [chapter],
    docChapters: new Map([[chapter.documentId, docChapters]]),
    learnerState,
  });
}

/** 章展示标题：`第 x 章 · title`；有文档上下文时加 `docTitle · ` 前缀。 */
export function chapterDisplayTitle(
  chapter: Chapter,
  docTitle?: string,
  m: Messages = zh,
): string {
  const head = chapter.title?.trim() ? chapter.title : m.chapter.ordinal(chapter.order);
  return docTitle ? `${docTitle} · ${head}` : head;
}

/** 章正文长度（字符）—— contentRef 切片区间；无 chapter 时 0。 */
export function chapterChars(chapter: Chapter | undefined): number {
  if (!chapter) return 0;
  return Math.max(0, chapter.contentRef.end - chapter.contentRef.start);
}

/**
 * 动作耗时估计（分钟）—— Plan 每项 / Reader ETA 用（docs/ui-workbench-plan-2026-09.md
 * §7.4：启发式即可，不进 domain/engine）。
 *
 * 策略（由动作模式决定，标注「估计」）：
 * - chapter-quiz / retake-quiz：卷模式时长常量（domain.PAPER_MODE_DURATION_MIN）；
 * - review-points：浏览要点为主，按章长 ~800 字/分，clamp [2, 12]；
 * - learn-chapter：精读 + 勾要点，按章长 ~350 字/分，clamp [5, 40]；
 * - 无章信息 / 其它 kind：走安全回退（quiz 8 / review 5 / learn 12 / 其它 8）。
 */
export function estimateEtaMin(
  action: NextAction,
  chapter: Chapter | undefined,
  pace: number = DEFAULT_PACE,
): number {
  if (action.kind === "chapter-quiz") return PAPER_MODE_DURATION_MIN["unit-test"];
  if (action.kind === "retake-quiz") return PAPER_MODE_DURATION_MIN.retake;
  const chars = chapterChars(chapter);
  if (action.kind === "review-points") {
    return chars === 0 ? 5 : clamp(Math.round(chars / 800), 2, 12);
  }
  if (action.kind === "learn-chapter") {
    return chars === 0 ? 12 : clamp(Math.round(chars / pace), 5, 40);
  }
  return 8;
}

/** 计划整体的时间估算（F1：把「要多久」升级为「按你的时间预算，来不来得及」）。 */
export interface PlanEta {
  /** 计划总时长（分钟）。 */
  totalMinutes: number;
  /**
   * 预计完成时间戳。仅当**声明了**每周预算时给出；未声明 → `undefined`
   * （UI 整行不渲染，退回现状文案）。
   */
  finishAt?: number;
  /** 完成日 vs 截止日（**两者都存在**时才给出，D5）。 */
  deadline?: { at: number; behind: boolean; days: number };
}

/** 每周预算是否有效（越界 / 缺省 = 未声明）。 */
function weeklyOf(profile?: LearnerProfile): number | undefined {
  const w = profile?.weeklyMinutes;
  if (w === undefined || w < PROFILE_LIMITS.weeklyMinutesMin || w > PROFILE_LIMITS.weeklyMinutesMax) {
    return undefined;
  }
  return w;
}

/**
 * 计划 ETA 聚合（纯函数）。
 *
 * `totalMinutes` 恒有值（所有队列项之和，按画像的阅读速度因子）；`finishAt`
 * 需要每周预算，`deadline` 还需要目标截止日 —— 缺哪个就不给哪个，UI 据此
 * 逐行收起，绝不展示猜测值。
 */
export function estimatePlanEta(args: {
  actions: readonly NextAction[];
  chapterOf: (id: string) => Chapter | undefined;
  profile?: LearnerProfile;
  deadlineAt?: number;
  now?: number;
}): PlanEta {
  const { actions, chapterOf, profile, deadlineAt, now = Date.now() } = args;
  const pace = paceOf(profile);
  const totalMinutes = actions.reduce(
    (n, a) => n + estimateEtaMin(a, chapterOf(a.unitId), pace),
    0,
  );
  const weekly = weeklyOf(profile);
  if (weekly === undefined) return { totalMinutes };

  const finishAt = now + (totalMinutes / weekly) * 7 * 86_400_000;
  if (deadlineAt === undefined) return { totalMinutes, finishAt };
  return {
    totalMinutes,
    finishAt,
    deadline: {
      at: deadlineAt,
      behind: finishAt > deadlineAt,
      days: Math.round(Math.abs(finishAt - deadlineAt) / 86_400_000),
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
