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
 * 消费方：要点解析（ai/chapter-map-reduce.ts）与导入精修清洗
 * （engine/splitter-engine.ts 的 cleanRefinedKeyPoints / 合并拼接）。
 */
export function hasMeaningfulText(s: string): boolean {
  const m = s.match(/[\p{L}\p{N}]/gu);
  return m !== null && m.length >= 2;
}
