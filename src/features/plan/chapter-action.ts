/**
 * 章级计划动作的共享展示与执行工具（T8）——
 * 首页主 CTA / /plan 计划页 / 报告页共用，避免各页维护一份 kind → 徽标/动词/跳转映射。
 */
import type { Chapter, LearnerState, NextAction, Paper } from "../../domain";
import { createPaper } from "../../engine";

export interface ChapterActionMeta {
  /** kind 徽标（tailwind 浅底深字圆角，与报告页 KIND_CHIP 同一套配色）。 */
  chip: string;
  /** 计划列表项的主按钮动词（去学习 / 去测验 / 生成补考卷 / 去复习）。 */
  verb: string;
  /** 首页主 CTA 大按钮上的动词（去学本章 / 去测本章 / 补考本章 / 去复习要点）。 */
  cta: string;
}

const META: Record<string, ChapterActionMeta> = {
  "learn-chapter": {
    chip: "border-red-200 bg-red-50 text-red-600",
    verb: "去学习",
    cta: "去学本章",
  },
  "retake-quiz": {
    chip: "border-amber-200 bg-amber-50 text-amber-700",
    verb: "生成补考卷",
    cta: "补考本章",
  },
  "review-points": {
    chip: "border-sky-200 bg-sky-50 text-sky-700",
    verb: "去复习",
    cta: "去复习要点",
  },
  "chapter-quiz": {
    chip: "border-indigo-200 bg-indigo-50 text-indigo-700",
    verb: "去测验",
    cta: "去测本章",
  },
};

export function chapterActionMeta(kind: NextAction["kind"]): ChapterActionMeta {
  return (
    META[kind] ?? {
      chip: "border-slate-200 bg-slate-100 text-slate-600",
      verb: "去执行",
      cta: "去执行",
    }
  );
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
 */
export function makeRetakePaper(
  chapter: Chapter,
  docChapters: Chapter[],
  learnerState: LearnerState,
): Paper {
  return createPaper({
    scope: { chapterIds: [chapter.id], mode: "retake" },
    chapters: [chapter],
    allChapters: docChapters,
    learnerState,
    allowSubjective: false,
  });
}

/** 章展示标题：`第 x 章 · title`；有文档上下文时加 `docTitle · ` 前缀。 */
export function chapterDisplayTitle(
  chapter: Chapter,
  docTitle?: string,
): string {
  const head = chapter.title?.trim() ? chapter.title : `第 ${chapter.order} 章`;
  return docTitle ? `${docTitle} · ${head}` : head;
}
