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
    more: "More actions",
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
    /* U6 nav item (GOALS group main entry /goals). */
    goals: { label: "Goals", hint: "Manage goals & readiness" },
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
    /** Settings section tabs (top horizontal navigation). */
    sections: {
      ai: "AI models",
      storage: "Local storage",
      learning: "Learning behavior",
      appearance: "Appearance & language",
      shortcuts: "Shortcuts",
      logs: "Logs",
      about: "About",
    },
    /** Logs section (desktop only, docs/tauri-log-config-design-2026-09.md). */
    logs: {
      title: "Logs",
      desc: "File logs (desktop only): written to daily files under the log directory, kept for 7 days, for offline troubleshooting.",
      enabledLabel: "Write to file",
      enabledHint: "Turn off to stop writing; existing files are kept. The setting is remembered.",
      levelLabel: "Level",
      dirLabel: "Log directory",
      openDir: "Open directory",
      resetDir: "Reset to default",
      refresh: "Refresh",
      previewTitle: "Recent logs",
      previewEmpty: "No logs today.",
      writeError: "Write error",
    },
    /** Storage section. */
    storage: {
      title: "Local storage",
      desc: "Everything is written on this device. Preview uses localStorage; the desktop build will switch to a SQLite / file-system backend with the same interface.",
      backend: "Current backend",
      /** "Current backend" value label (adapter name → local / memory). */
      storageMemory: "In-memory (preview)",
      storageLocal: "This machine's localStorage",
      counts: "Data volume",
      docCount: (n: number) => `${n} document(s)`,
      chapterCount: (n: number) => `${n} chapter(s)`,
      paperCount: (n: number) => `${n} paper(s)`,
      goalCount: (n: number) => `${n} goal(s)`,
      evidenceCount: (n: number) => `${n} evidence entrie(s)`,
      note: "Reset / migration will ship together with the SQLite backend (no clear button this milestone, to avoid wiping local data by accident).",
    },
    /** U6b · Learning section (informational; no tunables this milestone). */
    learning: {
      title: "Learning behavior",
      desc: "The adaptive engine decides from your current data; the thresholds below are fixed semantics of this version and not user-configurable yet.",
      items: [
        "Ready line 80%: paper mastery ≥ 0.8 marks a chapter as mastered",
        "Pass line 60%: a paper below 0.6 enters re-take",
        "Forgetting model: due reviews follow interval scheduling; reads decay without writing back",
        "Re-take papers drop one difficulty tier and use objective questions only (local deterministic bank)",
      ],
    },
    /** U6b · Shortcuts section. */
    shortcuts: {
      title: "Shortcuts",
      desc: "Global shortcuts in the current version:",
      items: [
        { keys: "⌘K / Ctrl+K", action: "Open the command palette (search & run)" },
        { keys: "↑ / ↓", action: "Move selection inside the palette" },
        { keys: "Enter", action: "Run the selected command" },
        { keys: "Esc", action: "Close palette / overlay" },
      ],
      more: "More shortcuts land with the desktop (Tauri) build.",
    },
    /** U6b · About section. */
    about: {
      title: "About",
      name: "Personal Learning OS",
      tagline: "Open-source · local-first adaptive learning",
      badge: "Pre-MVP",
      desc: "Made by the 阅界 brand. Learning loop: material → chapters → assessment → mastery → what to learn next.",
      repoNote: "Source is in the project repository; this build is the Pre-MVP milestone (U6 · UI Workbench wrap-up).",
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
    /** Settings · vector index (needed by semantic retrieval). */
    embedding: {
      title: "Vector index",
      desc:
        "Build a vector index over document bodies so search can hit passages that mean the same thing in different words. Vectors stay in your local SQLite and are never uploaded.",
      model: "Embedding model",
      modelPlaceholder: "e.g. text-embedding-v3",
      modelHint:
        "Model name only; base URL and API key are inherited from the current model above.",
      suggestion: (name: string) => `Try ${name}`,
      endpoint: "Endpoint",
      endpointInherit: "Inherited from current model",
      endpointMissing: "No current model selected yet",
      coverage: "Index coverage",
      coverageValue: (indexed: number, total: number) => `${indexed} / ${total} blocks`,
      coverageEmpty: "Nothing to index yet (import and split a document first)",
      rebuild: "Rebuild index",
      onlyMissing: "Fill missing only",
      desktopOnly: "Desktop app required",
      notSupported:
        "The current model cannot embed (the built-in local model has no embedding support; configure an API model)",
      noModel: "Enter an embedding model name first",
      running: (done: number, total: number) => `Indexing ${done}/${total}…`,
      failedPartial: (n: number) => `${n} blocks failed; use “Fill missing only” to retry`,
      doneAll: "Index complete",
      previewHint:
        "In browser preview vectors are not persisted (storage quota), so retrieval falls back to full-text matching.",
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

  /** U6 · Goals (multi-goal CRUD, docs/ui-workbench-plan-2026-09.md §U6/§20-22). */
  goals: {
    title: "Goals",
    subtitle: "Answer “why learn” — each goal binds a chapter scope, clear them one by one.",
    listLoading: "Loading goals…",
    noGoalsTitle: "No goals yet",
    noGoalsDesc:
      "Create your first goal: pick a type, write what you want to achieve, then select the chapters it covers.",
    newGoal: "＋ New goal",
    sectionActive: "In progress",
    sectionCompleted: "Completed",
    activeTag: "Active",
    setActive: "Set active",
    open: "Open →",
    edit: "Edit",
    delete: "Delete",
    notFound: "Goal not found",
    notFoundDesc: "It may have been deleted, or belongs to another space.",
    backToList: "← Back to goals",
    deadline: (d: string) => `Due ${d}`,
    noDeadline: "No deadline",
    createdOn: (d: string) => `Created ${d}`,
    readyOf: (done: number, total: number) => `${done}/${total} chapters ready`,
    gapOf: (n: number) => `${n} gap(s)`,
    scopeEmptyHint:
      "This goal has no chapters selected yet — after editing, readiness follows its scope.",
    doneAll: "🎉 All chapters in scope are ready",
    doneAllSub: "Create another goal, or import more material to extend the scope.",
    confirmDeleteTitle: "Delete this goal?",
    confirmDeleteDesc:
      "Deletion cannot be undone. If it is the active goal, the learning context switches to the first remaining goal automatically.",
    cancelDelete: "Cancel",
    confirmDelete: "Delete",
    deleted: "Deleted",
    detail: {
      readinessEyebrow: "Readiness",
      targetLine: (p: number) => `Target ${p}%`,
      readyOf: (done: number, total: number) => `${done} / ${total} chapters ready`,
      importance: (v: string) => `Importance ${v}`,
      type: (v: string) => `Type ${v}`,
      scope: "Chapter scope",
      scopeHint: "Chapters selected here all count toward this goal's readiness.",
      editScope: "Edit scope →",
      noScope: "No chapters selected — edit the goal to add a scope.",
      knowledge: "Chapter progress",
      gapSection: "Gaps (below floor)",
      gapEmpty: "🎉 No chapters in scope below the floor.",
      gapHint: "Gap chapters rise to the top of your learning plan.",
      goLearn: "Go learn →",
      toPlan: "View this goal's learning plan →",
      path: "Learning path",
      pathHint: "✓ mastered · ● learning · ○ not started",
    },
    /** New / edit form. */
    form: {
      newTitle: "New goal",
      editTitle: "Edit goal",
      back: "← Back to goal",
      stepBasics: "1 · Basics",
      stepScope: "2 · Pick chapter scope",
      titleLabel: "Goal title",
      titlePlaceholder: "e.g. AI Application Engineer · Foundations",
      typeLabel: "Type",
      descLabel: "Description",
      descPlaceholder: "What do you want to achieve? Why now? (optional)",
      importanceLabel: "Importance",
      deadlineLabel: "Deadline (optional)",
      scopeHint:
        "Select chapters from your Library; leave empty to fall back to all chapters.",
      scopeEmpty: "Library has no chapters yet — import and split a document first.",
      goImport: "Go import",
      docGroup: (title: string, n: number) => `${title} · ${n} chapters`,
      selectAll: "Select all in this document",
      selectedOf: (n: number) => `${n} selected`,
      clearScope: "Clear",
      save: "Save goal",
      saving: "Saving…",
      saved: "Saved ✓",
      invalidTitle: "Please enter a goal title",
      invalidScope: "Select at least one chapter (or leave empty = whole library)",
      cancel: "Cancel",
    },
  },

  /** U6 · My Learner (pure view, §23/§7.6). */
  learner: {
    title: "My Learner",
    subtitle:
      "How the system sees you — derived from learning records, every figure maps to the domain model.",
    loading: "Aggregating learning records…",
    noRecordTitle: "No learning records yet",
    noRecordDesc:
      "Start a chapter or a quiz and this profile will be generated from your mastery records.",
    goPlan: "Go to plan to start →",
    // KNOWLEDGE counts
    knowledgeSection: "Knowledge overview",
    labelTotal: "Units",
    labelMastered: "Mastered",
    labelProficient: "Proficient",
    labelAccuracy: "Accuracy",
    labelLearning: "Below target",
    countTotal: (n: number) => `${n} learned units`,
    countMastered: (n: number) => `${n} mastered`,
    countProficient: (n: number) => `${n} proficient`,
    countLearning: (n: number) => `${n} learning`,
    countNotStarted: (n: number) => `${n} not started`,
    avgMastery: (p: number) => `Average mastery ${p}%`,
    accuracy: (p: number) => `Answer accuracy ${p}%`,
    accuracyNone: "No answers yet",
    dueReview: (n: number) => `${n} due for review`,
    // strengths / gaps
    strengthsSection: "Strengths",
    gapsSection: "Gaps",
    none: "—",
    // misconceptions
    misconceptionsSection: "Known misconceptions",
    misconceptionsEmpty:
      "No misconceptions captured yet — missed answers are recorded and reused for future questions.",
    misconception: (n: number) => `Misconception ×${n}`,
    // patterns
    patternsSection: "Learning patterns",
    patternsHeuristic: "Heuristic · from this session's records",
    patternSubmissions: (n: number) => `${n} actions completed`,
    patternAssess: (n: number) => `${n} assessments`,
    patternReview: (n: number) => `${n} reviews`,
    patternAccuracy: (p: number) => `Assessment accuracy ${p}%`,
    patternAccuracyNone: "No assessment verdicts yet",
    patternDeltaUp: (d: number) => `Avg +${d}% mastery per action`,
    patternDeltaDown: (d: number) => `Avg ${d}% mastery per action (declining)`,
    patternDeltaNone: "No mastery delta recorded yet",
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
      /** U5: /learn upgraded to a "document library" feel (Option A, docs/ui-workbench-plan §11/U5). */
      title: "Library",
      subtitleEmpty: "Import a document and the system will split it into chapters to learn one by one.",
      subtitleStats: (docs: number, chapters: number, mastered: number, p: number) =>
        `${docs} document(s) · ${chapters} chapters · ${mastered} mastered (target ${p}%)`,
      filterAll: "All",
      filterUnmet: "Not ready",
      hint: "Click a chapter row to read · collapse cards by header",
      searchPlaceholder: "Search documents / chapters / points…",
      searchEmpty: (q: string) => `No material matching “${q}”`,
      emptyTitle: "No material yet",
      emptyDesc:
        "Import your first document (Markdown / notes) and the system will split it into chapters by heading — then learn and quiz chapter by chapter.",
      emptyImport: "Import your first document",
      doclessTitle: "Material has no chapters",
      doclessDesc: (n: number) =>
        `${n} document(s) not split yet (legacy or saved only). Split their text now, or re-import.`,
      /** Document-card meta line (when = "last learned" relative text; omitted if never studied). */
      docMeta: (chapters: number, points: number, when?: string) =>
        when
          ? `${chapters} chapter(s) · ${points} point(s) · ${when}`
          : `${chapters} chapter(s) · ${points} point(s)`,
      docReady: (done: number, total: number) => `${done}/${total} ready`,
      learnedToday: "studied today",
      learnedYesterday: "studied yesterday",
      learnedAgo: (n: number) => `studied ${n} day(s) ago`,
      notLearned: "not studied yet",
      /** U3 doc header overall exploration (touched chapters ratio, not ready-line). */
      exploredOf: (pct: number) => `Explored ${pct}%`,
      targetLine: "Target line",
      unmetEmpty: "No unmet chapters 🎉",
      unsplitCount: (n: number) => `${n} document(s) not split yet`,
      unsplitHint: "These documents have saved text but no chapters — split by heading in one click.",
      splitting: "Splitting…",
      splitNow: "Split now",
    },
    /** Library list page (/learn revamp: card grid, docs/library-module-design-2026-09.md §8.18). */
    library: {
      title: "Library",
      subtitleEmpty: "Import a document and it will be split into chapters for learning.",
      subtitleStats: (docs: number, chapters: number, mastered: number, p: number) =>
        `${docs} documents · ${chapters} chapters · ${mastered} mastered (target ${p}%)`,
      searchPlaceholder: "Search documents / sources…",
      searchEmpty: (q: string) => `No documents matching “${q}”`,
      filterAll: "All",
      filterUnsplit: "Unsplit",
      filterActive: "In progress",
      sortNewest: "Newest",
      sortOldest: "Oldest",
      sortTitle: "By name",
      noSource: "Unknown source",
      importedAt: (when: string) => `Imported ${when}`,
      cardMeta: (chapters: number, points: number, mastered: number) =>
        `${chapters} chapters · ${points} points · ${mastered}/${chapters} mastered`,
      targetLine: "Target",
      unsplitBadge: "Unsplit",
      splitNow: "Split now",
      resplit: "Re-split",
      emptyTitle: "No documents yet",
      emptyDesc:
        "Import your first document (Markdown / notes / PDF) and it will be split into chapters automatically.",
      emptyImport: "Import first document",
      actions: {
        rename: "Rename",
        meta: "Edit info",
        replace: "Replace body",
        append: "Append content",
        split: "Split now",
        resplit: "Re-split",
        delete: "Delete",
      },
      rename: { title: "Rename document", label: "Document name", empty: "Name cannot be empty" },
      meta: {
        title: "Edit document info",
        name: "Document name",
        source: "Source",
        sourcePlaceholder: "e.g. github.com/owner/repo or local file · x.md",
        format: "Original format",
      },
      replace: {
        title: "Replace body",
        desc: "Pick a new body source; chapters will be re-split after replacement.",
        submit: "Replace & re-split",
        phase: { save: "Save body", split: "Re-split", migrate: "Migrate mastery" },
        done: (chapters: number, carried: number, dropped: number) =>
          dropped > 0
            ? `Replaced · ${chapters} chapters (${carried} carried, ${dropped} dropped)`
            : `Replaced · ${chapters} chapters (${carried} carried)`,
      },
      append: {
        title: "Append content",
        desc: "Append new content to the end; the whole document will be re-split.",
        label: "Append content",
        placeholder: "Paste new notes / chapters here…",
        count: (n: number, total: number) => `${n} chars now · ~${total} after append`,
        submit: "Append & re-split",
        tooLarge: "Body would exceed the size limit — split the document first.",
      },
      del: {
        title: (t: string) => `Delete “${t}”?`,
        desc: (c: number, p: number, k: number, chunks: number) =>
          `This will also remove ${c} chapters, ${p} papers, ${k} concepts${
            chunks > 0 ? ` and ${chunks} content index blocks` : ""
          }. This cannot be undone.`,
        confirm: "Delete",
      },
    },
    /** Library search · content hits section (chunk-level hits after RAG wiring). */
    search: {
      contentHits: (n: number) => `${n} content hits`,
      contentEmpty: "No content match",
      fulltextOnly: "Full-text only",
      fulltextOnlyHint:
        "Vector index unavailable (no embedding model configured, or index not built yet)",
      indexing: (done: number, total: number) => `Indexing ${done}/${total}`,
      semanticTag: "Semantic",
      loading: "Searching…",
    },
    /** Document detail page (/learn/doc/:docId, 4 tabs). */
    detail: {
      back: "← Library",
      missingTitle: "Document not found",
      missingDesc: "It may have been deleted.",
      loading: "Loading…",
      tabs: { overview: "Overview", content: "Content", split: "Chapters", knowledge: "Key points", papers: "Papers" },
      /** Overview tab (AI whole-document summary + local stats). */
      overview: {
        head: "AI overview",
        generate: "Generate overview",
        regenerate: "Regenerate",
        generating: "Generating…",
        progressMap: (i: number, n: number, label: string) =>
          label ? `Summarizing ${i}/${n} · ${label}` : `Summarizing ${i}/${n}`,
        progressSingle: "Writing overview…",
        progressMerge: "Merging into the final overview…",
        at: (d: string, mode: string) => `Generated ${d} · ${mode}`,
        modeSingle: "single pass",
        modeMapReduce: (n: number) => `map-reduce, ${n} blocks`,
        emptyTitle: "No overview yet",
        emptyDesc:
          "AI reads the whole document and returns its structure, keywords and prerequisites.",
        noAi: "Configure an AI model to generate an overview.",
        noBody: "This document has no body — cannot generate an overview.",
        goConfigure: "Configure AI model →",
        failed: (reason: string) => `Generation failed: ${reason} (click again to retry)`,
        stale: "The body has changed — this overview may be outdated.",
        skippedChunks: (n: number) =>
          `${n} block(s) could not be summarized — the overview does not cover them.`,
        gistLabel: "In one line",
        sectionsLabel: "Structure",
        keywordsLabel: "Keywords",
        prereqLabel: "Before you read",
        statsLabel: "This document",
        statChapters: "Chapters",
        statChars: "Characters",
        statUnits: "Concepts",
        statPapers: "Papers",
        statMastery: "Mastered",
        masteryEmpty: "No chapter to assess yet.",
        goRead: "Open reader →",
        goSplit: "Chapters →",
        goKnowledge: "Key points →",
        goPapers: "Papers →",
      },
      /** Chapter list (former “Split” tab): in-row copy. */
      chapters: {
        emptyTitle: "No chapters yet",
        emptyDesc: "Click “Split now” to cut this document into chapters by headings or paragraphs.",
        split: "Split now",
        chars: (n: number) => `${n} chars`,
        keyPoints: (n: number) => `${n} points`,
        totalChars: (n: number) => `${n} chars total`,
        expand: "Show text",
        collapse: "Hide text",
        openFull: "Open reader →",
        previewEmpty: "No text snapshot for this chapter.",
      },
      metaLine: (source: string, imported: string, chars: number) =>
        `${source} · imported ${imported} · ${chars} chars`,
      content: {
        emptyTitle: "This document has no body",
        emptyDesc: "Only metadata was saved — use “Replace body” to import content.",
        showAll: (n: number) => `Showing first ${n} chars — show all`,
        metaType: (t: string) => `Format ${t}`,
        metaChars: (n: number) => `${n} chars`,
        metaImported: (d: string) => `Imported ${d}`,
        metaSource: (s: string) => `Source ${s}`,
        imageNoText: "This document is an image — there is no body to render.",
      },
      /** Split (code): deterministic, no retry. */
      split: {
        strategyHeadings: "By headings",
        strategyParagraphs: "By paragraphs",
        refinedYes: "AI refined",
        refinedNo: "Local heuristic",
        keyPoints: "points",
        chapters: "chapters",
        stats: (c: number, p: number) => `${c} chapters · ${p} points`,
        at: (d: string) => `Split ${d}`,
        split: "Split now",
        resplit: "Re-split",
        analyzeOnly: "Analyze only",
        splitting: "Splitting…",
        goConfigure: "Configure AI model →",
        emptyTitle: "No chapters yet",
        emptyDesc: "Click \"Split now\" to split by headings / paragraphs automatically.",
        confirmTitle: "Re-split?",
        confirmDesc: (n: number) =>
          `This overwrites the current ${n}-chapter structure; mastery is carried over by content overlap, chapters that change too much will lose mastery.`,
        confirmOk: "Re-split",
        result: (c: number, carried: number, dropped: number, refined: boolean) =>
          refined
            ? `Re-split · ${c} chapters (AI refined) · ${carried} carried${dropped ? `, ${dropped} dropped` : ""}`
            : `Split · ${c} chapters (local heuristic) · ${carried} carried${dropped ? `, ${dropped} dropped` : ""}`,
        noBody: "This document has no body — use \"Replace body\" first.",
        noChapters: "No chapters were produced — the content may lack headings or paragraphs.",
      },
      /** Analyze (AI): repeatable, re-runnable. */
      analyze: {
        analyze: "AI analyze chapters",
        reAnalyze: "Re-analyze",
        analyzing: "Analyzing…",
        notAnalyzed: "Not analyzed · titles & points are the plain code-split results",
        at: (d: string) => `Analyzed ${d}`,
        result: (changed: number, merged: number) =>
          `Analyzed · ${changed} titles rewritten${merged ? ` · ${merged} merged` : ""}`,
        aiOff: "AI is not configured — analysis unavailable.",
        goConfigure: "Configure AI model →",
        failed: (reason: string) => `Analysis failed: ${reason} (click to retry)`,
        tooManyChapters: "Too many chapters (>24); whole-document analysis unsupported.",
      },
      knowledge: {
        pointsHead: "Chapter points",
        graphHead: "Concept graph",
        pointsEmpty: "No points yet — split first.",
        goRead: "Open reader →",
        extractPoints: "AI analyze points",
        reExtractPoints: "Re-analyze points",
        pointsNoAi: "Configure an AI model to extract points and locate them in the source.",
        pointsDone: (done: number, total: number) => `${done}/${total} chapters have source quotes`,
        pointsUnanchored: (n: number) =>
          `${n} quote(s) could not be located in the source and were dropped — better no quote than a fake one.`,
        refLabel: "Source",
        goSource: "Source →",
        extractAll: "AI analyze concepts",
        reExtract: "Re-analyze concepts",
        extracting: (i: number, n: number, t: string) => `Analyzing ${i}/${n} · ${t}`,
        extractDone: (ok: number, failed: number) =>
          failed > 0 ? `Concept analysis done: ${ok} ok · ${failed} failed` : `Concept analysis done: ${ok} chapters`,
        graphStats: (done: number, total: number, units: number, rels: number) =>
          `${done}/${total} chapters analyzed · ${units} concepts · ${rels} relations`,
        graphEmptyTitle: "No concepts yet",
        graphEmptyDesc:
          "Click “AI analyze concepts” — AI distills each chapter into reviewable concepts.",
        graphNoAi: "Configure an AI model to analyze concepts per chapter.",
        failedItem: (title: string, reason: string) => `${title}: ${reason}`,
        failedUnknown: "Analysis failed (no reason returned)",
      },
      papers: {
        head: (n: number, done: number) => `${n} papers · ${done} completed`,
        newPaper: "New paper for this document →",
        emptyTitle: "No papers yet",
        emptyDesc: "Create a paper for any chapter to test mastery.",
        noPapers: "No papers yet",
        staleScope: "Scope outdated",
        docAdvice: "Whole-document advice",
        goNew: "New paper →",
        itemCount: (n: number) => `${n} items`,
        score: (n: number) => `${n} pts`,
        duration: (min: number) => `~${min} min`,
        difficulty: (band: number) => `Level ${band}`,
        viewReport: "View report →",
        goAnswer: "Answer →",
        reason: {
          never: "Not tested yet",
          failed: "Below pass line — retake suggested",
          weak: "Passed but not yet on target",
          near: "Close to target — stage test suggested",
          mastered: "On target",
          allMastered: "Whole document on target",
        },
      },
    },
    /** Document-format labels (type badge on document cards; covers DocumentFormat). */
    format: {
      pdf: "PDF",
      markdown: "Markdown",
      txt: "Plain text",
      docx: "Word",
      epub: "EPUB",
      web: "Web",
      note: "Notes",
      code: "Code",
      image: "Image",
      custom: "Other",
      fallback: "Document",
    },
    import: {
      title: "Import document",
      subtitle:
        "Paste Markdown, or import from local files / public GitHub repos — it will be split into chapters, then learn chapter by chapter.",
      sourceTab: { paste: "Paste", local: "Local files", github: "GitHub" },
      local: {
        dropTitle: "Drop .md / .pdf here, or click to select files",
        dropHint: "Multiple files supported; scanned PDFs are not supported (text PDFs work)",
        selected: (n: number) => `${n} file(s) selected`,
        importable: (n: number) => `${n} importable`,
        removeAll: "Remove all",
        remove: "Remove",
        kindMd: "Markdown",
        kindPdf: "PDF",
        import: (n: number) => `Save & split ${n} document(s)`,
        /** Conversion failure copy; keys mirror `LocalFileErrorKind`. */
        errors: {
          unsupported: "Unsupported type (only .md / .pdf)",
          "too-large": "Exceeds the size limit",
          "pdf-no-text": "No extractable text (likely a scanned PDF)",
          "pdf-too-large": "PDF exceeds the page limit",
          "read-failed": "Failed to read the file",
        },
      },
      github: {
        label: "GitHub link (public repo)",
        placeholder: "https://github.com/owner/repo or /tree/…, /blob/…",
        resolve: "Resolve",
        resolving: "Resolving repo…",
        hint: "Repo / subdirectory (tree) / single file (blob) links; public repos only, imported as a one-time snapshot",
        importN: (n: number) => `Will import ${n} Markdown file(s) · merged into one document`,
        skipped: (n: number) => `${n} skipped (over limit)`,
        filesHead: "Markdown file list",
        emptyPreview: "Paste a public repo link and hit “Resolve” to preview the files",
        /** Resolve / import failure copy; keys mirror `GhErrorKind`. */
        errors: {
          invalid:
            "Cannot parse this link — paste a public github.com repo / subdirectory / single-file link.",
          unavailable: "Repository not found, or it is private.",
          network: "Request failed — check your network and retry.",
          "rate-limit": "GitHub API rate limit reached (60/h unauthenticated) — retry later.",
          "too-many-files": "Too many Markdown files — use a subdirectory or single-file link.",
          "merged-too-large": "Merged text exceeds the size limit — use a subdirectory or single-file link.",
          "fetch-failed": "Failed to fetch all Markdown files — check your network and retry.",
          empty: "No importable Markdown found in this scope.",
        },
      },
      batch: {
        importing: (i: number, n: number, title: string) => `Importing ${i}/${n} · ${title}`,
        doneToLibrary: "Done, go to library →",
        failedN: (n: number) => `${n} document(s) failed`,
        allFailed: "All imports failed — check the files and retry",
        summaryTitle: (ok: number, failed: number) =>
          failed > 0 ? `Import done: ${ok} ok · ${failed} failed` : `Import done: ${ok} imported`,
      },
      formatNote: "Notes",
      formatWeb: "Web",
      formatTxt: "Plain text",
      stepSource: (n: number) => `${n} · Source`,
      titlePlaceholder: "Name this document, e.g. “RAG System Design”",
      bodyPlaceholder:
        "Paste your notes / Markdown here…\nUse # / ## for chapters (e.g. “# Chapter 1: Embedding”); plain text is auto-clustered by blank lines.",
      format: "Format",
      saveOnly: "Save document only",
      unnamedDoc: "Untitled document",
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
      /** U5: stage progress (read → detect → refine → create → link) and result card. */
      progressTitle: "Importing…",
      phaseLabel: {
        read: "Reading document",
        detect: "Detecting structure",
        refine: "Refining key points",
        create: "Creating chapters",
        link: "Linking to goals",
      },
      phaseHint: {
        read: "Saving the source text to your local library",
        detect: "Splitting chapters by headings / paragraphs",
        refine: "AI refines titles & key points (first-sentence summary offline)",
        create: "Writing chapters and key points",
        link: "Material is in your library — scope it under Goals later",
      },
      statChapter: (n: number) => `${n} chapter(s)`,
      statPoints: (n: number) => `${n} point(s)`,
      /** Result card observability (G6): extraction volume / pages / decoding / scan suspicion. */
      statChars: (n: number) => `${n} characters extracted`,
      statPages: (done: number, total: number) => `${done}/${total} pages with text`,
      encodingHint: (name: string) => `Decoded as ${name}`,
      scannedHint: "Some pages had no extractable text — may contain scanned pages",
      /** Result card index status (G7). */
      indexQueued: "Vector indexing queued",
      indexOff: "No embedding model · full-text search only",
      mergedN: (n: number) => `${n} over-fragmented section(s) auto-merged`,
      structureRefined: "AI refined titles & key points",
      structureLocal: "Local heuristic split · no AI configured",
      resultTitle: (title: string) => `“${title}” is ready to learn`,
      inspect: "Inspect structure →",
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
      /** U3 right rail, four zones: status / why it matters / knowledge / evidence. */
      whyEyebrow: "Why it matters",
      knowledgeEyebrow: "Knowledge",
      knowledgeSelect: "Select knowledge block",
      evidenceEyebrow: "Evidence",
      evidenceSource: (doc: string, ord: string) => `From “${doc}” · ${ord}`,
      evidenceNone:
        "No quiz recorded for this chapter yet — your mastery delta will appear here.",
      toPlan: "Back to plan for the full next step",
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
    /** U2 sections: high priority (do today) vs the rest (queued). */
    next: "NEXT · Do today",
    upNext: "UP NEXT · In queue",
    /** Per-item time estimate (heuristic, marked as estimate). */
    etaOf: (n: number) => `about ${n} min`,
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
      // UI Workbench U4：Recommended 直推（activeGoal 范围 plan 的测评类高优动作）。
      recommended: "Recommended",
      recommendedSub:
        "The weakest chapter worth quizzing now, based on your goal and recent reports.",
      recommendedNone:
        "No weak chapter is due for a quiz — one will appear here after you learn a new chapter or a review comes due.",
      recommendedGoPlan: "View plan →",
      recent: "Recent",
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
      planViewAll: "View full plan (incl. other chapters) →",
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
