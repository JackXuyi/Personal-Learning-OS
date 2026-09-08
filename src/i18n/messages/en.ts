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
    import: "Import material",
    targetLine: (p: number) => `Target ${p}%`,
    delta: {
      nextReview: (d: number) => `Next review: ~${d} days`,
      heuristic: "Heuristic estimate",
    },
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
    band: {
      "not-started": "Not started",
      learning: "Learning",
      proficient: "Proficient",
      mastered: "Mastered",
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
    actionVerb: {
      learn: "Learn",
      review: "Review",
      practice: "Practice",
      remediation: "Remediate",
      assessment: "Assess",
      explore: "Explore",
      "learn-chapter": "Learn chapter",
      "chapter-quiz": "Take quiz",
      "retake-quiz": "Make retake paper",
      "review-points": "Review points",
    },
    actionCta: {
      learn: "Learn",
      review: "Review",
      practice: "Practice",
      remediation: "Remediate",
      assessment: "Assess",
      explore: "Explore",
      "learn-chapter": "Learn this chapter",
      "chapter-quiz": "Quiz this chapter",
      "retake-quiz": "Retake this chapter",
      "review-points": "Review key points",
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
  chapter: {
    ordinal: (n: number) => `Chapter ${n}`,
  },

  home: {
    title: "Learning loop",
    subtitle: "Do one thing today — the system has already figured out what.",
    running: "Running the learning loop…",
    todayActionEyebrow: "Today's action",
    masteryAt: (p: number) => `Mastery ${p}%`,
    generating: "Generating…",
    why: "Why this? (explainable)",
    goalOf: (title: string) => `Current goal · ${title}`,
    goalFallback: "Chapter readiness",
    chaptersMastered: (m: number, t: number) => `${m} / ${t} chapters ready`,
    readyLine: (thresholdPct: number, gap: number) =>
      `Ready line ${thresholdPct}% · ${gap} gaps to fill`,
    statReady: "Ready",
    statPending: "Gaps",
    statPendingHint: "By recommendation",
    priorityFill: "Fill first",
    planTitle: "Learning plan",
    planSubtitle: "The planner sorts by priority — fix weak chapters first.",
    viewAll: "View all",
    allDoneTitle: "🎉 All chapters mastered",
    allDoneDesc:
      "Chapter readiness is maxed — take a full quiz to reinforce, or import new material.",
    goQuizReinforce: "Take a quiz",
    viewCatalog: "Browse chapters",
    emptyTitle: "📥 No learning material yet",
    emptyDesc:
      "Import your first material (Markdown / notes) and the system will split chapters and plan a learn → quiz → review loop.",
    viewPlan: "View plan",
    noChapterTitle: "Material has no chapters",
    noChapterDesc:
      "Saved material isn't split yet — split it in the chapter catalog, or re-import.",
    goCatalog: "Go to chapters",
  },

  career: {
    title: "Career · Goal readiness",
    subtitle: "Break a role into practiceable units — one fewer gap each time one is ready.",
    loading: "Computing goal readiness…",
    currentGoal: "Current goal",
    importanceLine: (importance: string, count: number) =>
      `Importance ${importance} · ${count} units total`,
    readyOf: (done: number, total: number) => `${done}/${total} units ready`,
    masteryAt: (p: number) => `Mastery ${p}%`,
    remainingGap: (g: number) => `${g}% to go`,
    allDoneTitle: "🎉 All units of the current goal are ready",
    allDoneDesc: (p: number) => `Readiness ${p}% · no gaps to fill.`,
    gapList: (n: number) => `Gaps to fill (${n} · dependency order)`,
  },

  scaffold: {
    scopeTitle: "Scope",
    nextTitle: "Next up (MVP milestones)",
  },

  spaces: {
    title: "Spaces",
    subtitle: "Keep a separate knowledge base for each area of your life.",
    scope: [
      "Storage ready: in-memory + localStorage adapters behind one interface",
      "Domain model supports multiple goals across career / study / personal",
      "SQLite / filesystem backends reserved in src/storage",
    ],
    nextSteps: [
      "Create a Learning Space (name, description, icon)",
      "Import PDF / Markdown / TXT / EPUB into a space",
      "Document parsing + chunking pipeline",
      "List documents with source references",
    ],
  },
};
