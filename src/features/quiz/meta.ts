/**
 * /quiz 系列页面共享的展示辅助 —— 卷型元信息、范围可读标签、相对时间。
 *
 * 出卷 UI 三步弹层（范围 → 模式 → 生成）在 NewQuiz 里用这些信息做
 * 模式卡片（题量与时长预览），答题页与试卷中心用于卷卡与范围标签。
 */
import type { Chapter, PaperMode, PaperScope, QuizType } from "../../domain";
import {
  isSubjectiveType,
  PAPER_MODE_DURATION_MIN,
  PAPER_MODE_LABEL,
} from "../../domain";
import type { PaperQuestion } from "../../domain";

/** 模式 → 支持的最小章数（向导中决定哪些模式可选）。 */
export const MODE_MIN_CHAPTERS: Record<Exclude<PaperMode, "retake">, number> = {
  "unit-test": 1,
  "stage-test": 2,
  "final-test": 3,
};

/** 模式 → 一行可读说明（配比 + 时长），供模式卡片副标题。 */
export function modeHint(mode: PaperMode, chapterCount: number): string {
  const duration = PAPER_MODE_DURATION_MIN[mode];
  switch (mode) {
    case "unit-test":
      return `单章 · 约 ${duration} 分钟`;
    case "stage-test":
      return `${chapterCount} 章联测 · 约 ${duration} 分钟`;
    case "final-test":
      return `综合卷（${chapterCount} 章）· 约 ${duration} 分钟`;
    case "retake":
      return `仅错题章 · 约 ${duration} 分钟`;
  }
}

/** 模式全称（含补考）。 */
export function modeLabel(mode: PaperMode): string {
  return PAPER_MODE_LABEL[mode];
}

/** 范围可读标签：如「第 1–3 章 · 3 章」或「全本 5 章」。 */
export function scopeLabel(scope: PaperScope, allChapters: Chapter[]): string {
  const count = scope.chapterIds.length;
  const first = allChapters.find((c) => c.id === scope.chapterIds[0]);
  const last = allChapters.find(
    (c) => c.id === scope.chapterIds[scope.chapterIds.length - 1],
  );
  const range =
    first && last
      ? first.order === last.order
        ? `第 ${first.order} 章`
        : `第 ${first.order}–${last.order} 章`
      : `${count} 章`;
  return `${range} · ${count} 章`;
}

/** 题型 → 短徽标文案（选项/对错/文本）。 */
export function typeBadgeText(type: QuizType): string {
  switch (type) {
    case "choice":
      return "选择";
    case "judge":
      return "判断";
    case "qa":
      return "问答";
    case "application":
      return "应用";
  }
}

/** 判断一道题是否「主观需 AI 批改」（前端用于 pending 标识）。 */
export function needsAI(q: PaperQuestion): boolean {
  return isSubjectiveType(q.type);
}

/** 「3 分钟前」样式的相对时间。 */
export function ago(at: number): string {
  const diff = Math.max(0, Date.now() - at);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  return `${day} 天前`;
}
