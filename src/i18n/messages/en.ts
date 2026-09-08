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
    exit: "Exit",
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
    groupToday: "Today",
    groupLearn: "Learn",
    groupKnowledge: "Knowledge",
    groupGoals: "Goals",
    groupSystem: "System",
    home: { label: "Home", hint: "What to do today" },
    plan: { label: "Plan", hint: "Your learning queue" },
    learn: { label: "Learn", hint: "Chapters & reading" },
    quiz: { label: "Assess", hint: "Papers · grading · reports" },
    career: { label: "Goals", hint: "Readiness & gaps" },
    settings: { label: "Settings", hint: "Local-first & AI" },
    /* Enabled later: library (U5 · /learn upgrade); graph (N5 · global graph); learner (U6 · profile) */
    library: { label: "Library", hint: "Documents · import" },
    graph: { label: "Graph", hint: "Concept relations · soon" },
    learner: { label: "My Learner", hint: "How the system sees you" },
    footerHint: "⌘K quick actions",
    footerBadge: "Pre-MVP",
    readyTooltip: "AI Provider ready",
    aiReady: "AI ready",
    aiOffline: "No AI configured",
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
    placeholder: "Search docs, chapters, goals — or run a command…",
    searchAria: "Command palette search",
    section: { action: "Suggested", search: "Search", commands: "Commands", recent: "Recent" },
    startNext: "Start today's next step",
    startNextHint: "Launch today's loop",
    quizAll: "Make a full quiz · all chapters mastered",
    quizAllHint: "Reinforce chapter readiness",
    import: "Import material",
    importHint: "Paste → split chapters → learn each",
    typeDoc: "Document",
    typeChapter: "Chapter",
    typeGoal: "Goal",
    emptyNoMatch: (q: string) => `No content matching “${q}”`,
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
      dayAgo: (n: number) => `${n} day(s) ago`,
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
    /** Settings · AI Model Center (local model downloads + API model config). */
    models: {
      pageTitle: "Settings · AI Model Center",
      pageSubtitle:
        "Pick your “current model”: knowledge extraction / quiz generation & grading / Q&A and progress summaries all run through it.",
      timeToday: "Today",
      savedOk: "Saved ✓",
      currentUse: "Currently in use",
      banner: {
        activePrefix: "In use:",
        untitledModel: "(no model)",
        localReady:
          "Local model · Ready · data stays on this machine and works offline; AI tasks like knowledge extraction and quiz grading run through it",
        localNotReady:
          "Local model · Not ready (download one under “Local models” and set it current first)",
        apiReady:
          "API model · Connected, cloud inference; AI tasks like knowledge extraction and quiz grading run through it",
        apiNotReady:
          "API model · Not tested yet (try “Test connection” before using)",
        noneTitle: "No model selected",
        noneDesc:
          "Learning features will run on offline heuristics. Download a local model or configure an API model to unlock full AI capability.",
      },
      tabLocal: "Local models (download & run)",
      tabApi: "API models (requests)",
      localHint:
        "Download and activate a local model — default tier Qwen3.5-4B (~2.5 GB); clicking “Set current” takes effect right away, no save needed.",
      aiStatus: "AI status",
      savedPassed: "Passed test when saved",
      savedFailed: "Did not pass when saved",
      noModel: "No model selected",
      heuristicAlways: "Offline heuristic engine always available",
      runtime: "Runtime",
      runtimeHeuristic: "Engine runs on offline heuristics",
      runtimeCallable: "Current model is callable",
      runtimeMissingCfg: "Missing key config (model file / Key / URL)",
      retesting: "Testing…",
      retestConnection: "Retest connection",
      retestOk: (ms: number) => `Retest passed · ${ms}ms latency`,
      keychainNote:
        "API Key is stored in the system Keychain, never kept in plaintext on this machine; read/written by the app, settings only shows a mask.",
      statusLegend:
        "“Passed test when saved” records the last save result; “Runtime” decides in real time whether the current model can be called. When not ready, the engine degrades to local heuristics (never crashes).",
      currentConfig: "Current config",
      kv: {
        source: "Source",
        model: "Model",
        provider: "Provider",
        status: "Status",
        sourceLocal: "Local model",
        sourceApi: "API model",
        none: "(none)",
        empty: "(empty)",
        testedPass: (t: string, latMs: number | null) =>
          latMs ? `Test passed · ${t} · ${latMs}ms` : `Test passed · ${t}`,
        notTested: "Not passed / not ready",
      },
      api: {
        presetProvider: "Preset provider",
        presetHint:
          "Picking one auto-fills the default Base URL and suggested model; both can be edited below.",
        configTitle: (name: string) => `Config: ${name}`,
        configPlain: "Config",
        configNote: "(Base URL / model name both editable)",
        modelLabel: "Model",
        testing: "Testing…",
        testConnection: "Test connection",
        useModel: "Use this model",
        validHintCloud:
          "Cloud models need an API Key; Base URL and model name are required.",
        validHint: "Base URL and model name are required.",
        keychainNote:
          "On “Use this model”, the API Key is written to the system Keychain — never kept in plaintext on this machine.",
        localStorageNote:
          "Pure browser preview: API Key is stored as plaintext in local localStorage, used only by this app to call the endpoint.",
        testNote:
          "“Test connection” sends one minimal request against the current form values (tests even when unsaved).",
        testRunning: "Testing connection…",
        testOk: (ms: number) => `✅ Connected · ${ms}ms latency · model online`,
      },
      builtin: {
        previewNoticeHead: "Built-in local models require the desktop app. Run ",
        previewNoticeTail:
          " or open the installed app; this is a pure browser preview.",
        aboutGb: (n: string) => `~${n} GB`,
        aboutMb: (n: string) => `~${n} MB`,
        unsupportedPlatform: (os: string, arch: string) =>
          `Local models need the macOS Apple Silicon desktop app (current ${os}/${arch})`,
        ramBelowMin: (ram: string, name: string, min: string) =>
          `This machine has ${ram}GB RAM; running ${name} needs ≥${min}GB`,
        unsupportedGeneric: "This device cannot run this model",
        status: {
          not_found: "Not downloaded",
          downloading: "Downloading",
          ready: "Ready",
          corrupted: "Corrupted",
        },
        devicePrefix: "This machine: ",
        downloadNoteHead:
          "Models are downloaded by the app into a local data folder (",
        downloadNoteTail: "); sources: ModelScope first, HuggingFace fallback.",
        refresh: "Refresh",
        deviceMatchNote:
          "Matched against this machine: models needing too much RAM / unsupported platforms are disabled (cannot download or enable).",
        deviceUnsupported: "Unsupported",
        tapToActivate: "Click a card to switch to it",
        download: "Download",
        retryDownload: "Retry download",
        cancel: "Cancel",
        setActive: "Set current",
        confirmDelete: (name: string) => `Delete model ${name}?`,
        deleteWarnActive:
          "In use right now; deleting it falls back to offline heuristics.",
        deleteWarnNormal: "You can re-download it later.",
        downloadTip:
          "First download of the recommended tier is ~2.5 GB (Qwen3.5-4B) and takes a few minutes depending on speed; downloads run in the background and can be cancelled anytime.",
      },
    },
  },
  chapter: {
    ordinal: (n: number) => `Chapter ${n}`,
    range: (a: number, b: number) => `Chapters ${a}–${b}`,
  },

  home: {
    title: "Today",
    running: "Syncing learning state…",
    goalSelectAria: "Switch current learning goal",
    manageGoals: "Manage goals",
    targetOf: (p: number) => `${p}% target`,
    masteredOf: (m: number, t: number) => `${m} / ${t} chapters mastered`,
    pendingOf: (n: number) => `${n} to go`,
    nextBestAction: "Next best action",
    todayTitle: (n: number) => `${n} items today`,
    viewPlan: "View full plan",
    recentEvidence: "Recent evidence",
    evidenceEmpty:
      "No assessments yet — finish a quiz or review and it will show up here.",
    generating: "Working…",
    time: {
      today: "Today",
      yesterday: "Yesterday",
      daysAgo: (n: number) => `${n} day(s) ago`,
    },
    allDoneTitle: "🎉 All chapters in scope mastered",
    allDoneDesc:
      "Chapter readiness for this goal is maxed — take a full quiz to reinforce, or import new material.",
    goQuizReinforce: "Take a quiz",
    viewCatalog: "Browse chapters",
    emptyTitle: "📥 No learning material yet",
    emptyDesc:
      "Import your first material (Markdown / notes) and the system will split chapters and plan a learn → quiz → review loop.",
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

  learn: {
    chapterBadge: {
      "not-started": "Not started",
      learning: "Learning",
      ready: "Quiz ready",
      mastered: "Mastered",
      retake: "Retake needed",
    },
    catalog: {
      title: "Chapter catalog",
      subtitleEmpty: "Import a document and the system will split it into chapters to learn one by one.",
      subtitleStats: (total: number, mastered: number, p: number) =>
        `${total} chapters · ${mastered} mastered (target ${p}%)`,
      filterAll: "All",
      filterUnmet: "Not ready",
      hint: "Click a chapter to start reading · mark it learned when done",
      emptyTitle: "No material yet",
      emptyDesc:
        "Import your first document (Markdown / notes) and the system will split it into chapters by heading — then learn and quiz chapter by chapter.",
      emptyImport: "Import your first document",
      doclessTitle: "Material has no chapters",
      doclessDesc: (n: number) =>
        `${n} document(s) not split yet (legacy or saved only). Split their text now, or re-import.`,
      chapterRange: (done: number, total: number) =>
        `Chapters 1–${total} · ${done}/${total} ready`,
      targetLine: "Target line",
      unmetEmpty: "No unmet chapters 🎉",
      unsplitCount: (n: number) => `${n} document(s) not split yet`,
      unsplitHint: "These documents have saved text but no chapters — split by heading in one click.",
      splitting: "Splitting…",
      splitNow: "Split now",
    },
    import: {
      title: "Import document",
      subtitle:
        "Paste Markdown / notes — it will be split into chapters by heading, then learn chapter by chapter.",
      formatNote: "Notes",
      formatWeb: "Web",
      formatTxt: "Plain text",
      stepSource: (n: number) => `${n} · Source`,
      stepPreview: (n: number) => `${n} · Split preview`,
      titlePlaceholder: "Name this document, e.g. “RAG System Design”",
      bodyPlaceholder:
        "Paste your notes / Markdown here…\nUse # / ## for chapters (e.g. “# Chapter 1: Embedding”); plain text is auto-clustered by blank lines.",
      format: "Format",
      saveOnly: "Save document only",
      unnamedDoc: "Untitled document",
      previewHead: (title: string, n: number) =>
        `“${title}” split into ${n} chapter(s)`,
      refinedBadge: "AI refined",
      noSplitWarn:
        "No chapters detected — content may lack headings or paragraphs. Add some and retry.",
      tooShort:
        "Too short or no headings/paragraphs, so no chapters were split. The document is saved — paste fuller content and retry.",
      splitFail: (msg: string) => `Split failed: ${msg}`,
      savedDoc: (title: string) => `Document “${title}” saved to local library.`,
      startLearning: (n: number) => `Start learning → (${n} chapters)`,
      doneSaved: "Done (document saved)",
      busy: "Splitting chapters…",
      saveSplit: "Save & split chapters",
    },
    reader: {
      missingTitle: "Chapter not found",
      missingDesc: "It may have been removed, or belongs to another document.",
      backToCatalog: "← Back to catalog",
      backCatalogShort: "← Catalog",
      opening: "Opening chapter…",
      masteryEyebrow: "Chapter mastery",
      masteryFormula:
        "Updated by quizzes as 0.65 × paper score + 0.35 × history; self-rating only reschedules review, it never moves mastery.",
      pointsEyebrow: "Key points",
      noPoints: "No key points yet.",
      graphEyebrow: "Concept graph",
      graphDesc:
        "AI splits this chapter into concepts you can memorize and review individually — mastery at a glance.",
      openGraph: "Open chapter concept graph →",
      dueHint:
        "Review is due — re-read the key points, tap “Reviewed” and the next review is rescheduled automatically.",
      readyHint: "Marked as learned — next step is “Quiz chapter” to check mastery.",
      readingHint: "Mark the chapter as learned after reading to unlock its quiz.",
      directQuiz: (p: number) => `✓ At ${p}%, take a comprehensive quiz`,
      markReviewed: "✓ Reviewed · reschedule",
      goQuiz: "Quiz chapter →",
      markDone: "Mark learned ✓",
      doneLabel: "Marked learned",
      noSnapshot:
        "This document has no saved body snapshot (empty textPreview), so the original text can't be shown.",
    },
  },

  knowledge: {
    rel: {
      prerequisite: "Prerequisite",
      related: "Related",
      parent: "Parent",
      child: "Child",
      example: "Example",
      contrast: "Contrast",
      application: "Application",
      source: "Source",
    },
    hintPill: "Drag to pan · scroll to zoom · click to focus · double-click for source",
    masteryOf: (p: number, degree: number) =>
      `Mastery ${p}% · ${degree} relation(s)`,
    review: "Review ▶",
    viewSource: "View source",
    noSummary: "No summary for this unit yet.",
    gapNote: "This unit is a gap of the current goal.",
    relationsTitle: "Relations",
    noRelations: "No modeled relations for this unit yet.",
    focusEyebrow: "Focus",
    focusPlaceholder:
      "Click a node to inspect its detail and relations; double-click a sourced unit to view the original text.",
    chapterGraph: {
      missingTitle: "Chapter not found",
      missingDesc: "It may have been removed, or belongs to another document.",
      backToCatalog: "← Back to catalog",
      opening: "Opening concept graph…",
      backToReader: "← Back to chapter",
      crumbSuffix: "Concept graph",
      extractBusy: "Extracting…",
      reExtract: "Re-extract concepts",
      extract: "Extract chapter concepts",
      notReady:
        "AI not ready — configure a model in Settings → AI Model Center before extracting concepts.",
      noBody:
        "This document has no saved body snapshot, so chapter concepts can't be extracted.",
      doneMsg: (units: number, rels: number) =>
        `Extracted ${units} concept(s) · ${rels} relation(s)`,
      hint: "Concepts are extracted by AI from the chapter body; self-rated reviews are the mastery evidence (no papers at concept level). Click a node to focus · double-click for the chapter source · gap concepts (<80%) pulse indigo.",
      emptyTitle: "No concept graph for this chapter yet",
      emptyDesc:
        "Once AI is ready, tap “Extract chapter concepts” in the top-right to split this chapter into individually memorable and reviewable concepts (with prerequisite/related links). Without AI configured the concept layer stays empty — nothing is fabricated.",
      goConfigure: "Configure AI →",
    },
  },

  plan: {
    title: "Learning plan",
    loadingSubtitle: "Computing learning plan…",
    running: "Running the learning planner…",
    subtitle: (goal: string, mastered: number, total: number, todo: number) =>
      `${goal} · ${mastered}/${total} chapters ready · ${todo} to-do(s)`,
    newPaper: "＋ New paper",
    emptyTitle: "No chapters to plan yet",
    emptyDesc:
      "Import a document and finish splitting first — the planner will schedule “learn → quiz → fix” for every chapter.",
    goCatalog: "Go to catalog",
    readinessEyebrow: "Chapter readiness",
    masteredOf: (m: number, t: number) => `${m} / ${t} chapters ready`,
    remaining: (n: number) => `${n} to-do(s) left (already in recommended order)`,
    allReadyDesc: "Every chapter is ready — take a comprehensive quiz or import new material.",
    allDoneTitle: "🎉 All chapters ready",
    allDoneDesc:
      "Chapter readiness is maxed out. Take a comprehensive quiz to consolidate, or keep importing new material.",
    quizAll: "Comprehensive quiz",
    importMore: "Import new material",
    masteryAt: (p: number) => `Mastery ${p}%`,
    generating: "Generating…",
  },

  review: {
    rating: { forget: "Forgot", hard: "Hard", good: "Knew it", easy: "Easy" },
    goBackGraph: "Back to concept graph",
    goBackStudy: "Back to study",
    singleReason: "Review this chapter concept — self-rate to reschedule the next review.",
    missingChapter: "Chapter not found or has been removed.",
    opening: "Entering review session…",
    noConceptGaps:
      "No gap concepts to review in this chapter — all are ready, or concepts haven't been extracted yet.",
    noGaps: "No gap units to review right now.",
    confirmExit: "Answers aren't submitted yet or can be undone — leave anyway?",
    titleOf: (i: number, total: number) => `Review · ${i}/${total}`,
    goalOf: (title: string) => `Goal: ${title}`,
    exit: "Exit",
    masteryAt: (p: number) => `Mastery ${p}%`,
    explainPrompt: "Explain this concept in your own words",
    explainPlaceholder:
      "Write your understanding (optional) — it doesn't affect the self-rating.",
    hideRef: "Hide reference points",
    showRef: "Show reference points",
    askSelf: "How did that step feel? (self-rating)",
    meetAgain: (d: number) => `See you in ${d} day(s)`,
    intervalPreview:
      "Interval preview: forgot → 1d · hard → 2d · knew it → 4d · easy → 7d (heuristic)",
    recorded: (label: string) => `Recorded: ${label}`,
    undo: (s: number) => `Undo (${s}s)`,
    nextItem: "Next item ▶",
    finishReview: "Finish review ✅",
    conceptDoneTitle: "Chapter concept review complete 🎉",
    doneTitle: "Review complete 🎉",
    conceptDoneSubtitle:
      "No papers at concept level — self-rating is the mastery evidence; review scheduling follows the rating.",
    doneSubtitle: "Mastery changes are heuristic estimates.",
    noneDone: "No units were completed this session.",
    readinessHead: "Readiness",
    readinessTail: (target: number) => ` · target ${target}%`,
    gapsLeft: (n: number) => `${n} gap(s) left — keep assessing to consolidate.`,
    allReadyShort: "All gaps ready 🎉",
    goHome: "Back to home",
    keepAssess: "Keep assessing →",
    backCatalog: "Back to catalog",
  },

  assessment: {
    title: "Assess",
    subtitle:
      "Questions drawn from your gap units, difficulty adapts — local mode is honest self-grading.",
    levelLabel: { remember: "Recall", understand: "Understand", apply: "Apply" },
    levelHint: {
      remember: "Recall the basic definition",
      understand: "Explain in your own words",
      apply: "Give a real example",
    },
    prompt: {
      remember: (title: string) =>
        `What is “${title}”? Define it in one or two sentences.`,
      understand: (title: string) =>
        `Explain “${title}” in your own words and what problem it solves.`,
      apply: (title: string) =>
        `Give a real scenario: when would you use “${title}”? How exactly?`,
      fallback: (title: string) => `Share your understanding of “${title}”.`,
    },
    cognitiveOf: (label: string) => `Cognitive level: ${label}`,
    masteryAt: (p: number) => `Mastery ${p}%`,
    answerPlaceholder:
      "Write your answer… (local mode: compare with the reference, then self-grade)",
    compareRef: "Compare with reference",
    refLead: "Reference points: ",
    gotIt: "I got it right",
    missedIt: "I missed it",
    honestNote:
      "No AI grading locally — honest self-grading is used; auto-grading arrives once a Provider is connected.",
    verdictRight: "✅ Verdict: correct",
    verdictWrong: "❌ Verdict: not correct",
    streakUp: "Correct streak — difficulty raised.",
    upNext: "Correct — next question is harder.",
    queued: "No worries — this unit entered your review queue.",
    nextQuestion: "Next question ▶",
    finishUnit: "Finish this unit ✅",
    progress: (from: number, now: number) =>
      `Mastery was ${from}% → now ${now}%.`,
    climbRule:
      "Correct answers climb cognitive levels (Recall → Understand → Apply); a miss sends it back to the review queue.",
    viewQueue: "View review queue →",
    recommendEyebrow: "Recommended first",
    start: "Start assessment →",
    pickAny: "or pick any unit",
    emptyLead: "No units to assess yet. ",
    goStudy: "Go to study",
    emptyTail: "Learn a bit first, then assess.",
    todayTitle: "Assessed today",
    todayCount: (n: number) => `${n} answer(s)`,
    correct: "Correct",
    wrong: "Wrong",
  },

  quiz: {
    mode: {
      "unit-test": "Unit test",
      "stage-test": "Stage test",
      "final-test": "Final test",
      retake: "Retake",
    },
    type: {
      choice: "Multiple choice",
      judge: "True / False",
      qa: "Q&A",
      application: "Application",
    },
    typeBadge: {
      choice: "Choice",
      judge: "Judge",
      qa: "Q&A",
      application: "Apply",
    },
    status: { open: "In progress", grading: "Grading", done: "Done" },
    hintUnit: (dur: number) => `Single chapter · ~${dur} min`,
    hintStage: (n: number, dur: number) => `${n} chapters together · ~${dur} min`,
    hintFinal: (n: number, dur: number) => `Final paper (${n} chapters) · ~${dur} min`,
    hintRetake: (dur: number) => `Wrong chapters only · ~${dur} min`,
    quotaPreview: {
      "unit-test": "5 items: 2 choice · 1 judge · 1 qa · 1 app (low mastery → objective only ×3)",
      "stage-test": "Per chapter objective ×3 + subjective ×1 (rotated; low mastery → objective ×4)",
      "final-test": "Total clamp(3n,15,20) · objective ~60% / subjective ~40%",
      retake: "Per chapter objective ×3 · no subjective · one notch easier",
    },
    rangeWithCount: (range: string, n: number) => `${range} · ${n} chapter(s)`,
    itemUnit: (n: number) => `${n} item(s)`,
    center: {
      title: "Quiz center",
      subtitleCount: (n: number) => `${n} paper(s) · quiz chapter by chapter`,
      subtitleEmpty: "Finish a chapter, then take a paper to check mastery.",
      newPaper: "＋ New paper",
      loading: "Loading…",
      noPaperTitle: "No papers yet",
      noPaperDesc:
        "Pick one or several chapters for a paper: unit tests check one chapter, stage tests cover several, final tests span the whole book.",
      firstPaper: "Create your first paper",
      needImportTitle: "Import material first to create papers",
      needImportDesc:
        "Papers are generated per chapter. Go to the catalog and import a document (Markdown / notes); once chapters are split you can quiz.",
      goImport: "Go import",
      continueAnswer: "Continue answering →",
      startAnswer: "Start answering →",
      sectionGrading: "Grading",
      finishGrading: "Finish grading →",
      sectionHistory: "Past results",
      viewReport: "View report",
      viewPaper: "View paper",
      noHistory: "(No past papers — start with “New paper” above)",
      removedDoc: "Document removed",
      unknownDoc: "Unknown document",
      scoreOf: (n: number) => `${n} pts`,
    },
    answer: {
      backToCenter: "← Quiz center",
      answered: "answered",
      submit: "Submit",
      qOf: (i: number, total: number) => `Question ${i} / ${total}`,
      prev: "← Previous",
      next: "Next →",
      unansweredTip: (n: number) => `${n} unanswered (you can go back and check)`,
      keyboardTip: "Use keys 1–4 to answer choice/judge quickly",
      keyboardFast: (n: number) => `Press keys 1–${n} to choose`,
      difficulty: (n: number) => `Difficulty ${n}`,
      trueLabel: "True ✓",
      falseLabel: "False ✗",
      qaPlaceholder: "Answer in your own words…",
      appPlaceholder: "Describe how you would apply it…",
      missingTitle: "Paper not found",
      missingDesc: "It may have been removed.",
      opening: "Opening paper…",
      confirmTitle: "Submit paper?",
      confirmUnanswered: (n: number) =>
        `${n} question(s) unanswered — unanswered objective items count as wrong.`,
      confirmAllDone: "Every question answered — grading starts right after submit.",
      confirmNote:
        "Objective items are graded instantly; Q&A/application items await AI grading (not scored when AI isn't configured).",
      recheck: "Review again",
      submitting: "Submitting…",
      confirmSubmit: "Confirm submit",
      removedDoc: "Document removed",
    },
    newPaper: {
      title: "New paper",
      subtitle: "Pick chapters and a paper type — questions are generated from key points.",
      noDocTitle: "No documents to quiz yet",
      noDocDesc: "Import a document and split it into chapters before creating papers.",
      generating: "Generating paper…",
      stepRange: "1 · Choose scope",
      selectedInfo: (n: number) => `${n} selected · tap cards to toggle`,
      selectAll: (n: number) => `All ${n} chapters`,
      noChapterOfDoc:
        "This document has no chapters yet — run “Split now” on it in /learn.",
      stepMode: "2 · Choose paper type",
      pickChapterFirst: "Select at least one chapter above first.",
      aiReadyHint: "AI ready: prompts generated live · Q&A/application graded by AI",
      noAiHint: "No AI configured: objective questions only (local deterministic bank)",
      footerDefault: "Pick scope and type, then create the paper.",
      footerSummary: (label: string, n: number, dur: number) =>
        `${label} · ${n} chapter(s) · ~${dur} min · item count auto from key points`,
      start: "Create & start →",
      drNone: "Select chapters first",
      drUnitNotOne: "Unit tests cover a single chapter",
      drStageFew: "Stage tests need ≥2 chapters",
      drFinalAll: "Final tests need the whole book (≥3 chapters)",
    },
    grading: {
      missingTitle: "Paper not found",
      backToCenter: "← Quiz center",
      cannotTitle: "Cannot grade",
      noAnswer: "This paper has no answers on record, so it can't be graded.",
      aiLoading: "Grading subjective items with AI…",
      loading: "Grading…",
      aiLoadingSub:
        "Objective items graded instantly · subjective items graded one by one by AI (a few seconds the first time)",
      loadingSub: "Objective items graded instantly · smoothly updating mastery…",
      resultTitle: "Grading result",
      legendCorrect: "Correct",
      legendWrong: "Wrong",
      legendPending: "Awaiting AI",
      pendingAI: "Awaiting AI",
      scored: (n: number) => `Score ${n}`,
      unansweredTag: "(unanswered)",
      aiTag: "(AI graded)",
      objInstant: "Choice/judge graded instantly locally",
      aiFailedTail: (n: number) =>
        `; ${n} subjective item(s) failed AI grading — scored by objective only, retry on the report page`,
      aiPendingTail: (n: number) =>
        `; ${n} subjective item(s) awaiting AI grading (not counted yet)`,
      aiMergedTail: (n: number) =>
        `; ${n} subjective item(s) merged into the paper score`,
      wrongTail: (n: number) => `; ${n} wrong`,
      scoreEyebrow: "Paper score",
      scoreBase: (pass: number) =>
        `Out of 100 · target ${pass} · mastery written back from objective evidence`,
      subMerged: " · subjective score merged in",
      undo: (s: number) => `Undo grading (${s}s)`,
      viewReport: "View report →",
      undoHint: "Undo rolls back mastery and score (back to the answer page to edit)",
      autoEnter: "Entering the report automatically… (undo window over)",
    },
    report: {
      backToCenter: "← Quiz center",
      missingTitle: "Paper not found",
      noResultTitle: "No grading record",
      noResultDesc: "This paper has no grading result yet — finish answering it first.",
      opening: "Opening report…",
      submitted: (agoText: string) => `Submitted ${agoText}`,
      scoreEyebrow: "Paper score",
      passedDesc: "Ready — this chapter can move on to the final test or the next chapter.",
      nearDesc: "Almost there — review the wrong items' points to cross the line.",
      failDesc: "Not there yet — consider a retake or reread the weak chapter.",
      meta: (questions: number, wrong: number, target: number, floor: number) =>
        `${questions} items · ${wrong} objective wrong · target ${target} / pass ${floor} · mastery written back from objective evidence`,
      pendingSubjective: (n: number) =>
        `${n} subjective item(s) awaiting AI grading · score is objective-only for now`,
      retryAI: "Retry AI grading",
      aiRetrying: "Grading…",
      goConfigAI: "Configure AI →",
      noAnswerCopy: "(No answer copy kept at grading time — cannot re-grade)",
      mergedIn: (n: number) => `${n} subjective item(s) merged (AI graded)`,
      aiUnavailable: "AI was unavailable when grading this paper — subjective items not counted",
      aiNotConfig:
        "No AI grading configured — configure a grading model in Settings → AI Model Center first.",
      aiNoResult: "AI returned no grades — please retry shortly.",
      aiGraded: (n: number) =>
        `Graded ${n} subjective item(s) and merged them — the score is updated.`,
      aiFailed: "Grading failed: model unavailable — please retry shortly.",
      planClose: "Collapse plan",
      planGenerate: "Generate learning plan",
      retakeWeak: (n: number) => `Retake ${n} weak chapter(s) →`,
      planHeader: "Learning plan · do these first",
      planDrivenBy: "Driven by this paper's report (only chapters in scope)",
      planEmpty:
        "🎉 Every chapter in scope is ready — advance to new chapters or take a final test.",
      goQuiz: "Take quiz →",
      goRetake: "Create retake →",
      goRelearn: "Reread →",
      goReview: "Review →",
      perChapterTitle: "Mastery per chapter",
      perChapterSub: "Written back after the paper · vs. before the paper",
      noObjective: "No objective evidence in this paper — mastery wasn't updated.",
      weakRetake: "Retake chapter",
      wrongTitle: "Wrong-item review",
      wrongSub: (n: number) => `${n} item(s) · with reference answers & weak points`,
      difficulty: (n: number) => `Difficulty ${n}`,
      chapterOf: (n: number) => `Chapter ${n}`,
      yourAnswerLead: "Your answer: ",
      refAnswerLead: "Reference: ",
      unanswered: "(unanswered)",
      aiCommentLead: "AI feedback: ",
      aiPointLead: (p: string) => `Weak point: ${p}`,
      unansweredHint:
        "Unanswered — study the reference points first, then take the chapter quiz again.",
      aiPendingHint:
        "AI feedback: generated automatically once AI grading is configured (subjective feedback + pinpointed key points).",
      goCatalog: "Back to catalog",
      backCenter: "Back to quiz center",
      removedDoc: "Document removed",
      targetLine: "Target line",
      trueLabel: "True ✓",
      falseLabel: "False ✗",
    },
  },

  /** Engine runtime copy (learning-planner / assessment-engine / loop; defaults to zh). */
  engine: {
    // —— learning-planner concept layer (buildPlan reasons) ——
    goalRequired: (g: { title: string; importance: string }) =>
      `Required for goal “${g.title}” (importance: ${g.importance}).`,
    currentMastery: (cur: number, target: number) =>
      `Current mastery is ${cur}%, target ${target}%.`,
    bottleneckPrereq: (names: string) =>
      `Key bottleneck — prerequisite for: ${names}.`,
    knownMisconception: "Known misconception found in recent assessments.",
    // —— learning-planner chapter layer (specForChapter reasons; title is the raw chapter title) ——
    chapterDue: (title: string, days: number) =>
      `“${title}” is above target, but ${days} day(s) have passed since the last review — entering the forgetting window.`,
    reviewResetsSchedule:
      "Reviewing the key points resets your next review schedule.",
    retakePending: (title: string) => `“${title}” is flagged for a retake.`,
    retakePlanNote: (target: number) =>
      `The retake drops one difficulty tier; hitting ${target}% returns the chapter to mastered.`,
    lowScoreReread: (title: string, score: number, low: number) =>
      `“${title}” scored only ${score}% (below ${low}%) — reread the chapter before retaking.`,
    thresholds: (target: number, floor: number) =>
      `Target ${target}%, pass line ${floor}%.`,
    belowFloorRetake: (title: string, score: number, floor: number) =>
      `“${title}” scored ${score}%, under the pass line (${floor}%) — consider a retake.`,
    retakeEasier: "The retake drops one difficulty tier.",
    nearTargetReview: (title: string, score: number, target: number) =>
      `“${title}” is at ${score}% mastery, one step from the target (${target}%).`,
    reviewThenQuiz:
      "Review the chapter's key points, then go straight to the comprehensive test.",
    chapterDoneVerify: (title: string) =>
      `“${title}” is marked as studied — take the unit test to verify mastery.`,
    chapterNotStarted: (title: string) =>
      `“${title}” hasn't been studied yet — proceed through chapters in order.`,
    // —— assessment-engine feedback ——
    notAnswered: "No answer.",
    pendingSubjective:
      "Subjective answers need AI grading — no Provider configured, so this answer isn't counted as right or wrong for now.",
    // —— loop / store runtime errors ——
    goalNotFound: "No learning goal found.",
    duplicateSubmit:
      "This unit was just submitted — undo and retry within the window.",
  },
};
