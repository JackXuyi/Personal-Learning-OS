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

  units: {
    kind: {
      concept: "Concept",
      skill: "Skill",
      fact: "Fact",
      procedure: "Procedure",
      principle: "Principle",
    },
    action: {
      learn: "Learn",
      review: "Review",
      practice: "Practice",
      remediation: "Remediate",
      assessment: "Assess",
      explore: "Explore",
      "learn-chapter": "Learn chapter",
      "chapter-quiz": "Quiz chapter",
      "retake-quiz": "Retake",
      "review-points": "Review points",
    },
    goalType: {
      career: "Career",
      study: "Study",
      exam: "Exam",
      personal: "Personal",
      research: "Research",
      project: "Project",
    },
    importance: { high: "High", medium: "Medium", low: "Low" },
  },

  cmd: {
    placeholder: "Jump or run…",
    searchAria: "Command palette search",
    section: { action: "Actions", jump: "Go to", recent: "Recent" },
    startNext: "Start today's next step",
    startNextHint: "Launch today's loop",
    quizAll: "Make a full quiz · all chapters mastered",
    quizAllHint: "Reinforce chapter readiness",
    import: "Import material",
    importHint: "Paste → split chapters → learn each",
    emptyNoMatch: (q: string) => `No command matching “${q}”`,
    searchWords: {
      start: "start next learn review quiz today run",
      quiz: "quiz paper test master reinforce",
      import: "import paste material chapter split",
      nav: "page open go",
      recent: "recent continue",
    },
    time: {
      now: "just now",
      minAgo: (n: number) => `${n} min ago`,
      hourAgo: (n: number) => `${n} h ago`,
    },
  },

  settings: {
    lang: {
      title: "Language",
      auto: "Follow system",
      zh: "中文",
      en: "English",
      autoHint: "Auto-select from system language; picking one keeps it always.",
      current: (lang: "zh" | "en") =>
        `Currently active: ${lang === "zh" ? "中文" : "English"}`,
    },
  },
};
