/**
 * 纯文本行布局（plain-text layout）—— `PlainTextRenderer` 的渲染规则，
 * 以**纯函数**形式唯一实现。
 *
 * 为什么单独成文件（docs/learn-highlight-note-design-2026-09.md §11.2）：
 * 「渲染后 DOM 文本长什么样」这件事有两个消费方 —— ① 渲染器本身；
 * ② 高亮定位层（它必须知道哪些字符**不在** DOM 里，才能正确匹配）。
 * 若两边各写一遍规则，就会出现本仓库已踩过的根因：同一规则散在多处，
 * 改一处不改另一处 → 静默错位（DOM 文本与源串不等长，实测 44/44 章全偏）。
 *
 * 本文件是**纯 TS、零 DOM、零 React、零 import** —— 可直跑 node 单测。
 * ⚠️ 不得 import `renderer-registry.ts`（它会连带 `MarkdownRenderer.tsx`，
 * 而 `--experimental-strip-types` 不支持 JSX → 单测直接失败）。
 */

/** 一行的渲染形态（与 `PlainTextRenderer` 的 JSX 分支一一对应）。 */
export interface PlainTextLine {
  /** 该行在**源串**中的起始偏移（含被丢弃的空白与标记）。 */
  srcStart: number;
  kind: "heading" | "blank" | "text";
  /** 标题层级（1–6）；非标题为 `undefined`。 */
  level?: number;
  /**
   * **进入文本节点**的字面（已按渲染规则剥装饰）。
   *
   * - `heading`：已剥 `### ` 前缀与行尾闭合 `###`；
   * - `blank`：`""`（渲染为占位 `<div>`，**零文本节点**）；
   * - `text`：`trimEnd` 后的行内容（`\n` 与行尾空白不进入任何文本节点）。
   */
  text: string;
}

/**
 * 按渲染规则切行。
 *
 * 规则（与 `PlainTextRenderer` 逐条对应，改这里就是改观感）：
 * 1. `\n` 本身不进任何文本节点 → 每行只贡献自己的内容；
 * 2. 行尾空白 `trimEnd` 丢弃；
 * 3. 标题行剥掉 `#{1,6} ` 前缀**与**行尾闭合 `###`；
 * 4. 空行输出占位元素（零文本节点）。
 */
export function plainTextLayout(source: string): PlainTextLine[] {
  const out: PlainTextLine[] = [];
  let srcStart = 0;
  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push({
        srcStart,
        kind: "heading",
        level: heading[1].length,
        text: heading[2].replace(/\s+#+\s*$/, ""),
      });
    } else if (line.trim() === "") {
      out.push({ srcStart, kind: "blank", text: "" });
    } else {
      out.push({ srcStart, kind: "text", text: line });
    }
    // +1 = 被 `split` 吞掉的 `\n`；末行多加 1 只影响哨兵，不参与计算。
    srcStart += raw.length + 1;
  }
  return out;
}

/**
 * 「渲染后 DOM 文本」的拼接口径（= 所有文本节点的 `data` 顺序相接）。
 *
 * 高亮定位层与单测都以此为准 —— 不依赖真实 DOM 即可算出「应该匹配到第几个字符」。
 * 注意：真实 DOM 里可能**多出**文本节点（如 Mermaid 图的 SVG 文字、错误降级残留），
 * 那只会让 DOM 文本更长，不会让本函数失效（定位层用的是「quote 字面匹配」）。
 */
export function plainTextToDomText(source: string): string {
  return plainTextLayout(source)
    .map((l) => l.text)
    .join("");
}
