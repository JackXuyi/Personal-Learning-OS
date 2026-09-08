/**
 * 英文（English）字典 —— 与 zh.ts 同构（Messages = typeof zh）。
 * 缺任一叶子 / 参数签名不匹配 → tsc 编译错误。
 */

import type { Messages } from "./zh";

export const en: Messages = {
  app: {
    title: "Personal Learning OS",
    metaDescription:
      "Personal Learning OS — an open-source, local-first adaptive learning system that decides what you should learn next.",
  },

  common: {
    save: "Save",
    cancel: "Cancel",
    back: "Back",
    confirm: "Confirm",
    close: "Close",
    delete: "Delete",
    done: "Done",
    loading: "Loading…",
    all: "All",
  },

  nav: {
    brand: "Personal Learning OS",
    brandSub: "Local-first · Learning loop",
    groupLearnLoop: "Learning loop",
    groupStart: "Start learning",
    groupContent: "Content",
    groupPlan: "Plan",
    groupSystem: "System",
    home: { label: "Home", hint: "What to do today" },
    learn: { label: "Learn", hint: "Chapters & reading" },
    plan: { label: "Plan", hint: "Chapter-level queue" },
    quiz: { label: "Quiz", hint: "Papers · grading · answers" },
    spaces: { label: "Spaces", hint: "Materials & spaces" },
    career: { label: "Career", hint: "Goal readiness" },
    settings: { label: "Settings", hint: "AI services" },
    footerHint: "⌘K quick actions",
    footerBadge: "Pre-MVP",
    readyTooltip: "AI Provider ready",
  },
};
