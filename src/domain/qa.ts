/**
 * 章内提问（Chapter Q&A）的领域类型。
 *
 * 定位：**只读消费型**类型 —— 不落库（会话级内存，决策 D2）、不参与掌握度与
 * 证据流。问答是纯只读动作，因此不需要 schema 迁移，也不会产生「重切分后旧
 * 记录章 id 失效」的脏数据（docs/learn-chapter-qa-design-2026-09.md §4.3.1）。
 *
 * 不变式（由 `features/learn/chapter-qa-service.ts::anchorQuotes` 保证，单测断言）：
 *   - `QaCitation.start/end` 为 `doc.textPreview` 绝对偏移，左闭右开；
 *   - 且必然落在某个 `Chapter.contentRef` 区间内（`chapterId` 即该章）；
 *   - 锚不上的 quote **不会**出现在引用里（零伪造引用）。
 */

/**
 * 一条「答案 → 原文」的引用。
 */
export interface QaCitation {
  /** 模型给出的 verbatim 原文摘录（已通过 `locateQuote` 校验）。 */
  quote: string;
  /** 文档绝对区间起点（含）。 */
  start: number;
  /** 文档绝对区间终点（不含）。 */
  end: number;
  /** 归属章（由 `contentRef` 区间判定）。 */
  chapterId: string;
  chapterTitle: string;
  /** 归属章序号（1..n），供 UI 渲染「第 n 章」标签。 */
  chapterOrder: number;
  /** 是否属于提问时所在的这一章（false = 同资料其他章）。 */
  inThisChapter: boolean;
}

/**
 * 问答结果状态（UI 据此分支渲染，不做隐式兜底）。
 */
export type ChapterAnswerStatus =
  | "answered"    // 有 ≥1 条锚定成功的引用 → 正常展示
  | "unanchored"  // 模型给了回答，但一条引用都没能定位回原文 → 展示 + 显式警示
  | "not-found"   // 检索到原文/或资料确实没写 → 「资料中未提及」
  | "empty"       // 无正文快照 / 范围内没有任何 chunk（未切分 / 未建索引）
  | "no-ai"       // 未配置模型 → 不检索、不伪造
  | "error";      // 问题非法 / 检索失败 / 调用失败 / 解析失败

/**
 * 失败原因分类。
 *
 * **为什么是 kind 而不是文案**：`rules/engineering-code-style` 要求 UI 文案
 * 一律走 i18n 且成对维护；`features` 服务层取不到 `src/i18n` 的消息表，
 * 因此这里只产出稳定的分类，由 `ChapterQaPanel` 映射到 `learn.reader.qa.err*`。
 */
export type ChapterQaErrorKind =
  /** 问题为空 / 超长（UI 已在提交前拦截，service 侧同样拒绝）。 */
  | "invalid-question"
  /** 模型未配置或密钥失效。 */
  | "not-configured"
  /** 输出无法解析（截断抢救也失败）。 */
  | "parse"
  /** 检索链路异常。 */
  | "fetch"
  /** 其它（资料 / 章不存在等）。 */
  | "generic";

export interface ChapterAnswer {
  status: ChapterAnswerStatus;
  /** 提问文本（原样回显，UI 用它做「问题」标题）。 */
  question: string;
  /** status="answered"|"unanchored" 时的回答正文（可含 [1][2] 标记）。 */
  answer?: string;
  /** 已锚定引用（status="answered" 时非空）。 */
  citations: QaCitation[];
  /** 实际使用的检索范围（UI 据此提示「已扩展到本资料其他章节」）。 */
  scopeUsed: "chapter" | "document";
  /** status="error" 时的原因分类（UI 映射为可读文案）。 */
  errorKind?: ChapterQaErrorKind;
  /** 生成时刻（面板按需展示 / 用作 React key）。 */
  at: number;
}
