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
 * 处理序（先整行类规则、后行内替换，顺序不可换——链接正则会吃掉图片语法的
 * `[alt](url)` 部分，badge 行判断也必须在替换前做）：
 * 1. HTML 注释 `<!-- … -->` 整段删除（README 里的构建/协作注释）；
 * 2. 纯 badge 行整行删除——仅限行内全部为**空 alt**的图片/徽章（装饰物）；
 *    带 alt 的图片行不删（alt 是可读内容，走第 4 步保留文字）；
 * 3. HTML `<img …>` 标签整体删除；
 * 4. 行内图片 `![alt](url)` → `alt`（有替代文字保文字，纯装饰图清空）；
 * 5. 引用式图片 `![alt][id]` → `alt`，引用定义行 `[id]: url` 整行删除；
 * 6. 行内链接 `[text](url)` → `text`（保可读文字，去 URL 噪音）；
 * 7. 清洗后残留的空 bullet 行（如 `- ![x](url)` 变成 `- `）整行删除。
 *
 * 不做的事：不处理脚注 `[^1]` 与多行嵌套结构（误伤面大，遇到再议）；
 * 不改写任何普通文本。
 */
export function stripMarkdownNoise(text: string): string {
  let out = text;
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  // badge 行：行内全部由 [![](img)](link) 或 ![](img) 构成（允许空白分隔）。
  // 只匹配空 alt —— 带 alt 的图片是可读内容，不属于装饰 badge。
  const badge = "(?:\\[!\\[\\]\\([^)]*\\)\\]\\([^)]*\\)|!\\[\\]\\([^)]*\\))";
  out = out.replace(new RegExp(`^[ \\t]*${badge}(?:[ \\t]+${badge})*[ \\t]*(?:\\r?\\n|$)`, "gm"), "");
  out = out.replace(/<img\b[^>]*>/gi, "");
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => alt.trim());
  out = out.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, (_m, alt: string) => alt.trim());
  out = out.replace(/^[ \t]*\[[^\]\s]+\]:[ \t]*\S+[^\n]*(?:\r?\n|$)/gm, "");
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  out = out.replace(/^[ \t]*[-*+][ \t]*(?:\r?\n|$)/gm, "");
  return out;
}
