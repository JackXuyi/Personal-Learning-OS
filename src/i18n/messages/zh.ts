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
};

/** 文案结构类型 = typeof zh（en.ts 以它同构约束）。 */
export type Messages = typeof zh;
