/**
 * 通用文本质量原语（2026-09-13 自 ai/chapter-map-reduce.ts 下沉）。
 *
 * 依赖约束：engine/ 与 ai/ 都不得互相 import 对方才能用——本模块放 lib/
 * 让两侧各自单向引入（ai → lib，engine → lib，方向不破）。
 */

/**
 * 「是不是人话」质量门：剔除符号后有效字符（Unicode 字母/数字，含 CJK）
 * 少于 2 个即判为无意义内容。
 *
 * 动机（2026-09-13 线上案例）：GitHub README 图片语法残留的 `!` 被本地小模型
 * 硬凑成要点 `{point:"!", quote:"!"}` —— 非空 / ≤60 字 / quote 可锚定，
 * 格式校验全绿放行。格式门之外必须补质量门，对所有模型来源生效。
 * 消费方：要点解析（ai/chapter-map-reduce.ts）与本模块的 `cleanKeyPoints`
 * （engine/ 生成侧三条路径）与 `isUsefulKeyPoint`（features/ 渲染侧过滤）。
 */
export function hasMeaningfulText(s: string): boolean {
  const m = s.match(/[\p{L}\p{N}]/gu);
  return m !== null && m.length >= 2;
}

/**
 * 纯编号 / 纯标点形态：整串只由数字、分隔符与空白组成，没有任何实义词。
 *
 * 动机（2026-09-16 线上案例）：PDF 抽取把编号标题糊进正文，断句正则
 * `(?<=[。！？.!?])\s*` 把 `4.2.2` 里的小数点当句尾，切出碎片 `"4."`。
 * 这类碎片**过得了 `hasMeaningfulText`**（`"4.2.2"` 有 3 个数字），
 * 却会被 markdown 渲染成「一个孤立圆点」的空行 → 界面上看起来就是
 * 「要点是空的」。两道门必须都过，格式门之外才有质量门。
 */
const NUMBERING_OR_PUNCT_ONLY =
  /^[\d\s.．。、，,;；:：!！?？()（）\[\]【】{}<>《》\-—–_~*/\\|+=&%$#@'"`^×÷]+$/;

/** 整串是否为纯编号 / 纯标点（空串返回 false —— 空白另由长度门处理）。 */
export function isNumberingOrPunctOnly(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && NUMBERING_OR_PUNCT_ONLY.test(t);
}

/** 要点文本规范化：折叠所有空白为单空格并去首尾 —— 清洗 / 去重 / refs 对齐共用同一口径。 */
export function normalizeKeyPointText(point: string): string {
  return point.replace(/\s+/g, " ").trim();
}

/**
 * 单条要点是否可用：规范化后非空 + 是人话 + 不是纯编号/标点。
 *
 * 渲染层（features/learn/detail/KnowledgeTab.tsx）与生成侧（本模块的
 * `cleanKeyPoints`）共用这一个判据 —— 否则「界面过滤掉的」与「入库过滤掉的」
 * 会随时间漂移成两套标准（本次修复前正是 3 套）。
 */
export function isUsefulKeyPoint(s: string): boolean {
  const t = normalizeKeyPointText(s);
  return t.length > 0 && hasMeaningfulText(t) && !isNumberingOrPunctOnly(t);
}

/** `cleanKeyPoints` 选项（缺省一律不做该维度处理，调用方按各自历史口径显式声明）。 */
export interface CleanKeyPointsOptions {
  /** 单条最大字符数；超出则截断并追加省略号。缺省不截断。 */
  maxCharsPerItem?: number;
  /** 最多保留条数。缺省不限。 */
  maxItems?: number;
  /** 按规范化后的文本去重（保序）。缺省 false。 */
  dedupe?: boolean;
}

/**
 * 要点清洗**单一真源**：规范化 → 质量门（空 / 非人话 / 纯编号标点）→ 截字 → 去重 → 截条数。
 *
 * 三个消费点曾各写一套（`cleanRefinedKeyPoints` 80 字 5 条需截字、
 * `mergeChapterRange` 6 条去重不截字、`mergeShortChapters` 6 条**完全不过滤**），
 * 后者正是脏碎片进入正常章的通道。统一到此函数后，口径差异只由 options 表达。
 */
export function cleanKeyPoints(
  list: readonly string[],
  options: CleanKeyPointsOptions = {},
): string[] {
  const { maxCharsPerItem, maxItems, dedupe = false } = options;
  let out = list.map(normalizeKeyPointText).filter(isUsefulKeyPoint);
  if (maxCharsPerItem !== undefined) {
    out = out.map((k) => (k.length <= maxCharsPerItem ? k : `${k.slice(0, maxCharsPerItem)}…`));
  }
  if (dedupe) out = [...new Set(out)];
  if (maxItems !== undefined) out = out.slice(0, maxItems);
  return out;
}
