/**
 * Mermaid 主题映射与**安全配置基线** —— 纯 TS，零 DOM（读取器由外部注入）。
 *
 * 两条硬约束：
 * 1. **本文件不出现任何 hex 色值**（`rules/react.mdc`：颜色只允许出现在 `main.css`）。
 *    需要什么颜色就从 `main.css` 的语义变量里读，读不到就**不写该键**，
 *    交给 mermaid 自己的中性默认值。
 * 2. **安全键全部显式声明**，不依赖 mermaid 的默认值 —— 默认值会随版本变动，
 *    而这几项直接决定注入面（见 `MERMAID_BASE_CONFIG` 逐项注释）。
 */
import type { MermaidConfig } from "mermaid";

/** 读取一个 CSS 变量的**计算值**；缺变量时返回空串。 */
export interface StyleVarReader {
  (name: string): string;
}

/**
 * 从 CSS 变量构造 mermaid `themeVariables`。
 *
 * 读 `--plos-*` 而非 Tailwind 桥接出来的 `--color-*`：前者是 `main.css` 里的
 * **原始值**，更贴近单一事实源（`@theme inline` 只是 Tailwind 侧的桥接层）。
 *
 * 空值一律跳过 → 返回值里**不会出现 `undefined` 值或空串键**，
 * 从而不会把 mermaid 的主题覆盖成空白。
 */
export function readThemeVariables(read: StyleVarReader): Record<string, string> {
  const get = (cssVar: string) => read(cssVar).trim();
  const pairs: Array<[string, string]> = [
    ["background", get("--plos-surface")],
    ["mainBkg", get("--plos-surface")],
    ["primaryColor", get("--plos-subtle")],
    ["secondaryColor", get("--plos-subtle")],
    ["tertiaryColor", get("--plos-surface")],
    ["primaryBorderColor", get("--plos-line")],
    ["nodeBorder", get("--plos-line")],
    ["clusterBkg", get("--plos-subtle")],
    ["clusterBorder", get("--plos-line")],
    ["lineColor", get("--plos-ink-3")],
    ["textColor", get("--plos-ink-1")],
    ["nodeTextColor", get("--plos-ink-1")],
    ["primaryTextColor", get("--plos-ink-1")],
    ["titleColor", get("--plos-ink-1")],
    ["edgeLabelBackground", get("--plos-surface")],
    ["fontFamily", get("--font-sans")],
  ];
  const out: Record<string, string> = {};
  for (const [key, value] of pairs) if (value) out[key] = value;
  return out;
}

/**
 * 安全与稳定性基线。逐项都**必须显式**（默认值不可信）：
 *
 * - `securityLevel: "strict"` —— HTML 标签被编码、图内 click 功能禁用；
 * - `startOnLoad: false` —— 禁止 mermaid 自己去扫 DOM（我们只用 `render()`）；
 * - `suppressErrorRendering: true` —— **默认 `false` 会把一张 "Syntax error" 图插进
 *   `document.body`**，必须关掉，否则单块语法错误会污染整个页面；
 * - `htmlLabels: false` —— v12 起该键已上提到根级（图级的 `flowchart.htmlLabels`
 *   已废弃）。关掉后标签退化为纯 SVG `<text>`，消除 `foreignObject` HTML 注入面；
 * - `maxTextSize` / `maxEdges` —— 引擎侧的硬护栏（我们自己的 30 000 字符上限更严）；
 * - `logLevel: "fatal"` —— 本地优先：不往用户控制台刷 mermaid 内部日志；
 * - `theme: "base"` —— 只有 base 会完整吃 `themeVariables`，配合上面的 token 映射。
 */
export const MERMAID_BASE_CONFIG = {
  securityLevel: "strict",
  startOnLoad: false,
  suppressErrorRendering: true,
  htmlLabels: false,
  maxTextSize: 50_000,
  maxEdges: 500,
  logLevel: "fatal",
  fontSize: 14,
  theme: "base",
} as const satisfies Partial<MermaidConfig>;
