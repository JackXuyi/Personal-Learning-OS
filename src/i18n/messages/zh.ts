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
};

/** 文案结构类型 = typeof zh（en.ts 以它同构约束）。 */
export type Messages = typeof zh;
