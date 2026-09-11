/**
 * Mermaid 围栏的**纯逻辑层** —— 零 React、零 DOM、零依赖。
 *
 * 为什么单独抽出来（不是风格偏好，是**强制约束**）：
 * `tests/*` 用 node `--experimental-strip-types` 直跑，Node 的类型剥离**不支持 JSX**
 * → 测试无法 import 任何 `.tsx`。所以凡是需要被自动化断言的行为，都必须落在 `.ts`
 * 里；`MermaidBlock.tsx` 只保留「必须与 React 生命周期绑定」的部分。
 *
 * 覆盖范围（docs/library-mermaid-render-design-2026-09.md §8.1）：
 * 围栏识别 → hast 取文 → id 净化 → 图内指令剥离 → 源码规范化 → 超限判定。
 */

/** 围栏语言别名：`mermaid` 为规范写法，`mmd` 为 VitePress / Typora 常见别名。 */
export const MERMAID_LANGS: ReadonlySet<string> = new Set(["mermaid", "mmd"]);

/**
 * 应用层源码上限（30 000）。刻意低于 mermaid 自身的 `maxTextSize: 50000` ——
 * 为的是在自己这层就给出**可读的中文提示**，而不是等 mermaid 抛一堆内部错误。
 */
export const MAX_MERMAID_SOURCE_CHARS = 30_000;

/**
 * 最小 hast 节点结构。
 *
 * 刻意**不引 `@types/hast`**：那是 `react-markdown` 的传递依赖，直接依赖它的类型
 * 会让本模块与上游实现细节绑定。这里只要够用即可（调用方做一次显式窄化）。
 */
export interface HastNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: readonly HastNode[];
}

/**
 * 从 `<code>` 节点的 className 里取 `language-xxx` 的语言名（**统一转小写**）。
 *
 * 兼容三种 className 形态：`string[]`（hast 标准）、空格分隔的 `string`、
 * 以及完全缺失 → 返回 `undefined`（调用方视作「无语言」，走普通代码块）。
 */
export function fenceLang(node: HastNode | undefined): string | undefined {
  const raw = node?.properties?.className;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\s+/) : [];
  for (const item of list) {
    const matched = /^language-(.+)$/i.exec(String(item));
    if (matched) return matched[1].toLowerCase();
  }
  return undefined;
}

/**
 * 递归拼接 hast 子树里的全部文本。
 *
 * 必要性：`react-markdown` 可能把一段代码拆成多个 text 节点
 * （例如围栏内含 `{{...}}` 之类被解析器切开的片段），只看第一个 child 会丢内容。
 */
export function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  let out = "";
  for (const child of node.children ?? []) out += hastText(child);
  return out;
}

/**
 * `pre` 节点 → 第一个 `code` 子节点。
 * 取不到 `code` 时返回 `undefined`，调用方按普通 `pre` 渲染（保持既有视觉）。
 */
export function readCodeFence(
  node: HastNode | undefined,
): { lang: string; value: string } | undefined {
  const code = node?.children?.find((child) => child.tagName === "code");
  if (!code) return undefined;
  return { lang: fenceLang(code) ?? "", value: hastText(code) };
}

/**
 * 净化 SVG id。
 *
 * 必要性：这个值会被 mermaid 同时用作 ① `<svg id>` ② `<style>` 里的 CSS 选择器前缀
 * ③ 各节点 id 的命名空间。React 19.2.8 实测生成 `_r_0_`（合法），但 React 18 曾是
 * `:r0:`（`:` 在选择器里会直接抛错）。**不依赖 React 的实现细节**：统一加前缀，
 * 并把所有非 `[A-Za-z0-9_-]` 字符替换为 `-`。
 *
 * 边界（如实记录）：该映射**不是单射** —— `:r0:` 与 `«r0»` 都会落到 `plos-mm--r0-`。
 * 这可以接受，因为真实的唯一性来源是 React `useId()` 在**同一渲染树内**的唯一性，
 * 而同一版本 React 连续产出的 id（`_r_0_` / `_r_1_` 或 `:r0:` / `:r1:`）净化后仍两两不同。
 * 换成 mermaid 的 `deterministicIds` 也不会改善这一点，故不做额外编码。
 */
export function sanitizeSvgId(seed: string): string {
  const safe = seed.replace(/[^A-Za-z0-9_-]/g, "-");
  return `plos-mm-${safe}`; // 前缀保证首字符合法，且跨块天然唯一
}

/**
 * 剥离图内配置：YAML frontmatter（`title:` / `config:`）与 `%%{init:…}%%` 指令。
 *
 * **为什么必须剥（安全，不是洁癖）**：mermaid 的 `secure` 白名单只护住
 * `securityLevel / startOnLoad / maxTextSize / suppressErrorRendering / maxEdges`，
 * **不保护** `htmlLabels` / `theme` / `themeVariables` / `fontFamily`。
 * 不剥离 → 文档内容可以自己打开 `htmlLabels`（引入 `foreignObject` HTML 注入面）
 * 或换掉主题，使同一篇文档里的图表外观不一致。
 * 剥离后配置权完全归应用，代价只是图内 `title:` 失效（可用上方 markdown 标题替代）。
 */
export function stripMermaidDirectives(source: string): string {
  const lines = source.split("\n");

  // ① YAML frontmatter：**仅当首行是 `---` 且能找到闭合 `---`** 才剥离，
  //    否则会把文档里的水平分隔线误当成 frontmatter 起点。
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
    if (close > 0) start = close + 1;
  }

  // ② `%%{ … }%%` 指令：可能是单行，也可能跨多行（mermaid 允许）。
  //    普通 `%%` 注释必须保留 —— 正则刻意要求 `%%{` 而非 `%%`。
  const kept: string[] = [];
  let inDirective = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (inDirective) {
      if (line.includes("}%%")) inDirective = false;
      continue;
    }
    if (/^\s*%%\{/.test(line)) {
      if (!line.includes("}%%")) inDirective = true;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

/**
 * 规范化：剥指令 → 去每行行尾空白 → 去首尾空行。
 *
 * **不去行首空白**：mermaid 的缩进对部分语法（如 `subgraph` 内层级）有语义，
 * 动它会改变渲染结果。行尾空白则对解析无影响，去掉可让输出稳定、便于断言。
 */
export function normalizeMermaidSource(source: string): string {
  const lines = stripMermaidDirectives(source).split("\n").map((line) => line.replace(/\s+$/, ""));
  let head = 0;
  let tail = lines.length;
  while (head < tail && lines[head].trim() === "") head += 1;
  while (tail > head && lines[tail - 1].trim() === "") tail -= 1;
  return lines.slice(head, tail).join("\n");
}

/** 超限判定（边界含等号：恰好 30 000 字符视为可渲染）。 */
export function mermaidSourceTooLarge(source: string): boolean {
  return source.length > MAX_MERMAID_SOURCE_CHARS;
}
