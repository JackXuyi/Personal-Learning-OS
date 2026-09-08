/**
 * 章级计划动作的共享展示与执行工具（T8）——
 * 首页主 CTA / /plan 计划页 / 报告页共用，避免各页维护一份 kind → 徽标/动词/跳转映射。
 */
import type { Chapter, LearnerState, NextAction, Paper } from "../../domain";
import { createRetakePaper } from "../../engine";
import { zh, type Messages } from "../../i18n";

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
