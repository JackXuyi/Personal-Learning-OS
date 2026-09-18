/**
 * 划线批注（F5 第 2 条 —— 高亮与笔记；docs/learn-highlight-note-design-2026-09.md）。
 *
 * 定位与三条边界（方案 §0.1 决策 D1–D4 / D9）：
 *
 * 1. **用户产出的学习资产**：与「章内提问」（纯只读、不落库）性质不同 —— 划线是
 *    「我标的」，因此落库；但**不参与掌握度**（`mastery` 唯一写方仍是卷面
 *    `applyPaperResult`），也**不写证据流**（D4：划线是高频轻动作，逐条进
 *    `evidenceLog` 会挤掉真实测评证据、稀释 /progress 热力图）。
 * 2. **单一实体，单色**（D2）：一条记录 = 原文区间 + 可选笔记文本。`note` 为空串
 *    = 纯高亮。一对一，无关联表、无多色分类。
 * 3. **零 AI / 零网络**（D9）：本能力与自测卡同类，未配置任何模型时 100% 可用。
 *
 * 不变量（由 `features/learn/annotation-service.ts` 保证，单测断言）：
 * - `quote` 是 **verbatim 原文摘录**，`[start, end)` 为 `doc.textPreview` 的
 *   **绝对偏移**（与 `KeyPointRef` 同口径，见 `domain/chapter.ts`），左闭右开；
 * - `doc.textPreview.slice(start, end) === quote` —— **必须逐字相等**，否则整条
 *   拒绝落库（零伪造区间，对齐 `locateQuote` 的「诚实降级」原则）。
 */
import { hashId } from "../lib/hash";

/** 尺寸护栏（UI 与服务层共用同一常量，防两处口径漂移）。 */
export const ANNOTATION_LIMITS = {
  /**
   * 选区过短没有信息量（1 个字的划线无意义，且极易多命中）。
   */
  minQuoteChars: 2,
  /**
   * 单条 `quote` 上限（**用户选区**口径）。
   *
   * ⚠️ 与 `features/learn/evidence-anchor.ts::MAX_QUOTE_CHARS`（同为 2000）
   * **刻意不合并**：那个常量管的是「**AI 摘录**灌水防护」，这个管的是
   * 「**用户选区**不可用长度」。数值相同是巧合，语义不同 ——
   * 调整其中一个**不需要**跟着改另一个，故各自留在属主模块。
   */
  maxQuoteChars: 2_000,
  /** 笔记上限（防灌水；UI 与 service 共用）。 */
  maxNoteChars: 1_000,
  /** 单章批注上限（超限时 UI 停用「划线」并如实提示，不静默丢弃）。 */
  maxPerChapter: 200,
} as const;

/**
 * 一条划线批注。
 *
 * `note` 用**空串**而不是 `undefined`：让「有没有写过笔记」与「笔记被清空」
 * 在数据上同形，避免两种空值语义各自演化。
 */
export interface Annotation {
  /**
   * `ann_` + djb2(`documentId` + NUL + `start` + NUL + `end`)。
   *
   * **区间派生**，不是随机 id：同一区间重复划线得到同一条（天然幂等，
   * 见 `annotationId`）。与 `DerivedCard.id` 同思路 —— 内容派生 id 才能在
   * 数据被重算后保持稳定。
   */
  id: string;
  documentId: string;
  /** 创建时归属章（复习回看的组织维度）；章被重切分/合并时按新区间回填。 */
  chapterId: string;
  /** verbatim 原文摘录（**不含**用户选区首尾空白）。 */
  quote: string;
  /** 文档绝对偏移（`doc.textPreview`），与 `keyPointRefs` 同口径。 */
  start: number;
  end: number;
  /** 用户笔记（**空串 = 纯高亮**）。 */
  note: string;
  createdAt: number;
  /** 最近一次改笔记的时间（纯高亮时为 `createdAt`）。 */
  updatedAt: number;
}

/**
 * djb2 32bit → base36。
 *
 * ⚠️ 此处原有的一份私有实现已抽到 `src/lib/hash.ts`：本文件原先的注释写着
 * 「**若出现第四处，才值得抽**（届时三处一起换）」—— F9 学习者记忆的 AI 条目键
 * 正是第四处（`docs/learner-memory-design-2026-09.md` §4.2），约定如期兑现。
 *
 * **输入拼接格式未变**（`documentId` + `"\u0000"` + `start` + `"\u0000"` + `end`）
 * → 既有 `ann_*` id 逐字节不变，已落库的批注不会成孤儿（方案 R7）。
 */

/**
 * 区间派生的稳定 id（同区间 → 同 id）。
 *
 * 为什么不用随机 id：用户对同一段原文重复划线是常见误操作，id 相同即天然
 * 幂等 —— 服务层据此返回 `duplicate` 并滚到已有条目，而不是留下两条重叠记录。
 */
export function annotationId(documentId: string, start: number, end: number): string {
  return `ann_${hashId(`${documentId}\u0000${start}\u0000${end}`)}`;
}

/** 有笔记 = 列表显示笔记行；空串 = 纯高亮（UI 分支依据，单一真源）。 */
export function hasNote(a: Annotation): boolean {
  return a.note.trim().length > 0;
}

/**
 * 摘录摘要（右栏列表展示用）：折叠全部空白为单空格 + 超长截断加省略号。
 *
 * 注意：纯函数**只做归一化与截断**。「是否展示省略号」的判断也在这里，
 * UI 不再二次裁剪（避免两处各写一套阈值）。
 */
export function quoteExcerpt(quote: string, maxChars = 80): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}
