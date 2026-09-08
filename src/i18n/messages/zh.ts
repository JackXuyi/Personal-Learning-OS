/**
 * 源语言（中文）字典 —— 唯一事实源（docs/i18n-design-2026-09.md §3.2）。
 *
 * 约定：
 * - 不要加 `as const`：叶子需保持 string 宽类型，en.ts 才能以 `Messages` 同构通过；
 * - 叶子 = 纯字符串，或 `(params) => string`（插值 / 复数用函数，参数显式受检）；
 * - 命名空间按 feature / 领域分块（nav/common/home/study/…/units/engine/app）。
 *
 * en.ts 以 `Messages`（= typeof zh）约束，缺任一叶子在编译期报错。
 */

export const zh = {
  app: {
    title: "Personal Learning OS",
    metaDescription:
      "Personal Learning OS —— 开源、本地优先的自适应学习系统：由它决定你下一步该学什么。",
  },

  common: {
    save: "保存",
    cancel: "取消",
    back: "返回",
    confirm: "确认",
    close: "关闭",
    delete: "删除",
    done: "已完成",
    loading: "加载中…",
    all: "全部",
    import: "导入资料",
    targetLine: (p: number) => `达标 ${p}%`,
    delta: {
      nextReview: (d: number) => `下次复习：约 ${d} 天后`,
      heuristic: "启发式估计",
    },
  },

  nav: {
    brand: "个人学习 OS",
    brandSub: "本地优先 · 学习闭环",
    groupLearnLoop: "学习闭环",
    groupStart: "开始学习",
    groupContent: "内容",
    groupPlan: "规划",
    groupSystem: "系统",
    home: { label: "首页", hint: "今天做哪件事" },
    learn: { label: "学习", hint: "章节目录与阅读" },
    plan: { label: "计划", hint: "章级学习队列" },
    quiz: { label: "测评", hint: "试卷 · 出卷 · 答题" },
    spaces: { label: "学习空间", hint: "资料与空间" },
    career: { label: "职业", hint: "目标就绪度" },
    settings: { label: "设置", hint: "AI 服务" },
    footerHint: "⌘K 快速操作",
    footerBadge: "Pre-MVP",
    readyTooltip: "AI Provider 已就绪",
  },

  units: {
    kind: {
      concept: "概念",
      skill: "技能",
      fact: "事实",
      procedure: "流程",
      principle: "原理",
    },
    band: {
      "not-started": "未开始",
      learning: "学习中",
      proficient: "较熟练",
      mastered: "已掌握",
    },
    action: {
      learn: "学习",
      review: "复习",
      practice: "练习",
      remediation: "补救",
      assessment: "测评",
      explore: "探索",
      "learn-chapter": "学本章",
      "chapter-quiz": "测本章",
      "retake-quiz": "补考",
      "review-points": "复习要点",
    },
    /** 计划项按钮动词（去学习 / 去测验 / 生成补考卷 / 去复习）。 */
    actionVerb: {
      learn: "去学习",
      review: "去复习",
      practice: "去练习",
      remediation: "去补救",
      assessment: "去测评",
      explore: "去探索",
      "learn-chapter": "去学习",
      "chapter-quiz": "去测验",
      "retake-quiz": "生成补考卷",
      "review-points": "去复习",
    },
    /** 首页主 CTA 大按钮动词（去学本章 / 去测本章 / 补考本章 / 去复习要点）。 */
    actionCta: {
      learn: "去学习",
      review: "去复习",
      practice: "去练习",
      remediation: "去补救",
      assessment: "去测评",
      explore: "去探索",
      "learn-chapter": "去学本章",
      "chapter-quiz": "去测本章",
      "retake-quiz": "补考本章",
      "review-points": "去复习要点",
    },
    goalType: {
      career: "职业",
      study: "学习",
      exam: "考试",
      personal: "个人",
      research: "研究",
      project: "项目",
    },
    importance: { high: "高", medium: "中", low: "低" },
  },

  cmd: {
    placeholder: "跳转或执行…",
    searchAria: "命令面板搜索",
    section: { action: "行动", jump: "跳转", recent: "最近" },
    startNext: "开始今天的下一步",
    startNextHint: "启动今日闭环",
    quizAll: "出综合测 · 全部章节已达标",
    quizAllHint: "巩固章就绪度",
    import: "导入资料",
    importHint: "粘贴 → 切分章节 → 逐章学习",
    emptyNoMatch: (q: string) => `没有匹配「${q}」的命令`,
    searchWords: {
      start: "开始 下一步 学习 复习 测评 今天 启动",
      quiz: "测评 综合 试卷 达标 巩固",
      import: "导入 资料 粘贴 章节 学习",
      nav: "页面 打开",
      recent: "最近 继续",
    },
    time: {
      now: "刚刚",
      minAgo: (n: number) => `${n} 分钟前`,
      hourAgo: (n: number) => `${n} 小时前`,
    },
  },

  settings: {
    lang: {
      title: "界面语言",
      auto: "跟随系统",
      zh: "中文",
      en: "English",
      autoHint: "自动按系统语言选择；手动选择后始终使用该语言。",
      current: (lang: "zh" | "en") => `当前生效：${lang === "zh" ? "中文" : "English"}`,
    },
  },
  chapter: {
    ordinal: (n: number) => `第 ${n} 章`,
  },

  home: {
    title: "学习闭环",
    subtitle: "今天只做一件事——系统已经替你算好。",
    running: "正在运行学习闭环…",
    todayActionEyebrow: "今日主行动",
    masteryAt: (p: number) => `当前掌握度 ${p}%`,
    generating: "生成中…",
    why: "为什么是它？（可解释）",
    goalOf: (title: string) => `当前目标 · ${title}`,
    goalFallback: "章就绪度",
    chaptersMastered: (m: number, t: number) => `${m} / ${t} 章达标`,
    readyLine: (thresholdPct: number, gap: number) =>
      `达标线 ${thresholdPct}% · 待补缺口 ${gap} 项`,
    statReady: "章就绪",
    statPending: "待补",
    statPendingHint: "按推荐序",
    priorityFill: "优先补",
    planTitle: "学习计划",
    planSubtitle: "规划器按优先级排序，先补弱章。",
    viewAll: "查看全部",
    allDoneTitle: "🎉 所有章节已达标",
    allDoneDesc: "章就绪度到顶——可出综合测巩固，或继续导入新资料。",
    goQuizReinforce: "去测评巩固",
    viewCatalog: "查看章节目录",
    emptyTitle: "📥 还没有学习资料",
    emptyDesc: "导入第一份资料（Markdown / 笔记），系统会自动切分章节，排出「学 → 测 → 补」计划。",
    viewPlan: "查看计划",
    noChapterTitle: "资料还没有章节",
    noChapterDesc: "已保存正文的资料还未切分——去章节目录补切分，或重新导入。",
    goCatalog: "去章节目录",
  },

  career: {
    title: "职业 · 目标就绪度",
    subtitle: "把岗位拆成可练习的单元，达标一个少一个缺口。",
    loading: "正在计算目标就绪度…",
    currentGoal: "当前目标",
    importanceLine: (importance: string, count: number) =>
      `重要性 ${importance} · 共 ${count} 个单元`,
    readyOf: (done: number, total: number) => `已达标 ${done}/${total} 个单元`,
    masteryAt: (p: number) => `掌握度 ${p}%`,
    remainingGap: (g: number) => `还差 ${g}%`,
    allDoneTitle: "🎉 当前目标所有单元已达标",
    allDoneDesc: (p: number) => `就绪度 ${p}% · 没有待补缺口。`,
    gapList: (n: number) => `待补缺口（${n} · 依赖序）`,
  },

  scaffold: {
    scopeTitle: "范围",
    nextTitle: "下一步（MVP 里程碑）",
  },

  spaces: {
    title: "学习空间",
    subtitle: "为生活不同领域分别建立独立的知识库。",
    scope: [
      "存储层就绪：内存 + localStorage 适配器统一在单一接口之后",
      "领域模型支持跨职业 / 学习 / 个人的多个目标",
      "SQLite / 文件系统后端接口已在 src/storage 预留",
    ],
    nextSteps: [
      "创建一个 Learning Space（名称、描述、图标）",
      "将 PDF / Markdown / TXT / EPUB 导入到空间",
      "文档解析 + 分块（chunking）流水线",
      "列出文档并附带来源引用",
    ],
  },
};

/** 文案结构类型 = typeof zh（en.ts 以它同构约束）。 */
export type Messages = typeof zh;
