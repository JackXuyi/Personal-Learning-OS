/**
 * 章卡片状态徽标（/learn 目录与阅读页共用）—— 由「章状态机 + 卷面掌握度」派生。
 *
 * 语义（docs/learning-system-v2-design-2026-09.md §3 步骤 1）：
 *   not-started → learning（打开阅读）→ ready（标记学完）→ mastered（卷面 ≥ 0.8）
 *   ready 后卷面 < 0.6 → retake（待补考）
 *
 * 派生优先级：卷面掌握度 ≥ 0.8 视为「已掌握」（即使状态机尚未回写 mastered，
 * T7 编排会把 grade 后状态写回 Chapter.status）；其后再看状态机显式标记。
 * 注意：卷面流程（T6/T7）上线前 mastery 恒为空，展示以状态机为主。
 *
 * label 走 i18n 字典（m.learn.chapterBadge[status]），cls 为语言无关样式。
 */
import { MASTERY_THRESHOLD } from "../../domain";
import type { ChapterStatus } from "../../domain";
import { zh, type Messages } from "../../i18n";

export interface ChapterBadge {
  label: string;
  /** tailwind 徽章样式（浅底深字 + 描边，与 BandBadge 同风格）。 */
  cls: string;
}

const BADGE_CLS: Record<ChapterStatus, string> = {
  "not-started": "border-slate-200 bg-slate-100 text-slate-500",
  learning: "border-sky-200 bg-sky-50 text-sky-700",
  ready: "border-indigo-200 bg-indigo-50 text-indigo-700",
  mastered: "border-emerald-200 bg-emerald-50 text-emerald-700",
  retake: "border-amber-200 bg-amber-50 text-amber-700",
};

/** 由状态机 + 卷面掌握度派生目录/阅读页徽标。mastery 可缺省（未考）。 */
export function chapterBadge(
  status: ChapterStatus,
  mastery?: number,
  m: Messages = zh,
): ChapterBadge {
  if ((mastery ?? 0) >= MASTERY_THRESHOLD && status !== "retake") {
    return { label: m.learn.chapterBadge.mastered, cls: BADGE_CLS.mastered };
  }
  return { label: m.learn.chapterBadge[status], cls: BADGE_CLS[status] };
}

/** 目录过滤：仅未达标 = 未达 0.8（未学 / 未考 / 低分章都算）。 */
export function isChapterUnmet(mastery?: number): boolean {
  return (mastery ?? 0) < MASTERY_THRESHOLD;
}
