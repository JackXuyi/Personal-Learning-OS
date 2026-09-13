/**
 * Markdown 噪音清洗（导入侧根治，2026-09-13）。
 *
 * 动机（线上案例）：GitHub README 里 `- ![banner](url)` 这类图片 bullet，
 * 渲染层不显示图片（markdown-core.tsx 的安全约束），用户看到「空 bullet」；
 * 但入库正文保留 `!` 与 URL，AI 管道与 FTS 检索都会吃到这些符号噪音 ——
 * 最坏情况：小模型把残留的 `!` 硬凑成一条「要点」。
 *
 * 在共享导入管道（pipeline.ts）入口对 markdown 来源统一清洗一次，
 * 粘贴 / 本地 md / GitHub 三类来源一并生效；清洗后的文本全程一致
 * （saveDocument / splitDocument / 章偏移 / RAG chunk 均基于同一份）。
 *
 * 本模块为纯函数：不触碰 React / DOM / fetch，node 单测可直跑。
 */

/**
 * 纯函数：剥离 markdown 图片语法与链接 URL 噪音。
 *
 * 处理序（先图后链，顺序不可换——链接正则会吃掉图片语法的 `[alt](url)` 部分）：
 * 1. HTML `<img …>` 标签整体删除；
 * 2. 行内图片 `![alt](url)` → `alt`（有替代文字保文字，纯装饰图清空）；
 * 3. 行内链接 `[text](url)` → `text`（保可读文字，去 URL 噪音）；
 * 4. 清洗后残留的空 bullet 行（如 `- ![x](url)` 变成 `- `）整行删除。
 *
 * 不做的不做的事：不处理引用式图片 `![alt][id]` 与 `[id]: url` 定义
 * （README 中占比低、误伤面大，遇到再议）；不改写任何普通文本。
 */
export function stripMarkdownNoise(text: string): string {
  let out = text;
  out = out.replace(/<img\b[^>]*>/gi, "");
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => alt.trim());
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  out = out.replace(/^[ \t]*[-*+][ \t]*(?:\r?\n|$)/gm, "");
  return out;
}
