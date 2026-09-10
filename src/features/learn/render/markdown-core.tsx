/**
 * markdown 渲染核心 —— 本仓库**唯一**的 markdown → React 映射表
 * （docs/library-detail-page-v2-design-2026-09.md §8.4）。
 *
 * 为什么单独抽一个文件：markdown 的类名映射需要被三类场景复用 ——
 * ① 整篇正文（`MarkdownRenderer`，块级排版）；
 * ② 要点 / 原文引用等短文本（`MarkdownInline`，行内不撑行高）；
 * ③ 图谱聚焦侧栏摘要（`MarkdownBlock`，无 `SourceDocument` 也要能渲染）。
 * 收敛到一处才不会有第 2、3 份各写各的 components 表
 * （rules/code-structure-and-dependencies：同逻辑 ≥10 行 × ≥3 处必须抽取）。
 *
 * 安全约束（沿用原 MarkdownRenderer，不得放宽）：
 * - **不引入 rehype-raw** —— 原始 HTML 一律不渲染，`<script>` 只会被当文本；
 * - `urlTransform` 白名单：仅放行 http / https / mailto，挡掉 `javascript:` 等；
 * - 图片不渲染（`img: () => null`）—— 正文里的外链图片属追踪器，且本系统本地优先。
 *
 * 类名一律语义 token：`text-ink-1/2/3`、`border-line`、`bg-subtle`、`bg-primary`。
 */
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";
import type { Components } from "react-markdown";

/** 只放行安全协议；其余（javascript: / data: / vbscript:）一律置空。 */
export function safeUrl(url: string): string {
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : "";
}

/** GFM 插件清单（导出以便两条渲染路径共用同一份配置）。 */
export const remarkPlugins = [remarkGfm];

/** 块级组件表：段落 / 列表 / 表格 / 代码块按 GFM 正常排版。 */
export const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 mb-3 text-xl font-semibold text-ink-1">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-5 mb-2 text-lg font-semibold text-ink-1">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 mb-2 text-base font-semibold text-ink-1">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-4 mb-1.5 text-base font-semibold text-ink-2">{children}</h4>
  ),
  p: ({ children }) => <p className="my-2 text-[15px] leading-7 text-ink-2">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-6 text-[15px] leading-7 text-ink-2">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-6 text-[15px] leading-7 text-ink-2">
      {children}
    </ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  a: ({ children, href }) => (
    <a
      href={safeUrl(href ?? "")}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-line pl-3 text-[15px] leading-7 text-ink-3">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-line" />,
  // 行内代码 vs 代码块：react-markdown 用 `code` 的 className 区分，
  // 这里统一给等宽 + subtle 底，代码块由 pre 再套一层。
  code: ({ className, children }) => (
    <code
      className={`rounded bg-subtle px-1 py-0.5 font-mono text-[13px] text-ink-1 ${
        className ?? ""
      }`}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg border border-line bg-subtle p-3 font-mono text-[13px] leading-6 text-ink-1">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-[14px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-subtle">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-line px-3 py-2 text-left font-semibold text-ink-1">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-line px-3 py-2 align-top text-ink-2">{children}</td>
  ),
  // 外链图片不渲染（见文件头安全约束）。
  img: () => null,
  strong: ({ children }) => <strong className="font-semibold text-ink-1">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
};

/** 标题在行内场景降级为加粗 —— 短要点里出现大标题会撑破行高。 */
function InlineStrong({ children }: { children?: ReactNode }) {
  return <strong className="font-semibold text-ink-1">{children}</strong>;
}

/**
 * 行内组件表：不产生块级元素。
 * 严格用于「本来就在一段话里」的文本（要点、引用、摘要），因此：
 * - `p` 不再包 `<p>`（否则 12px 引用块里塞进 15px 段落 + 额外外边距）；
 * - 列表退化为块级 span + 圆点，避免在行内出现缩进层级；
 * - 标题降级为加粗。
 */
export const inlineMarkdownComponents: Components = {
  ...markdownComponents,
  p: ({ children }) => <>{children}</>,
  ul: ({ children }) => <span className="block">{children}</span>,
  ol: ({ children }) => <span className="block">{children}</span>,
  li: ({ children }) => <span className="block">· {children}</span>,
  h1: InlineStrong,
  h2: InlineStrong,
  h3: InlineStrong,
  h4: InlineStrong,
  h5: InlineStrong,
  h6: InlineStrong,
  blockquote: ({ children }) => (
    <span className="block border-l-2 border-line pl-2 text-ink-3">{children}</span>
  ),
  hr: () => <span className="block" />,
};

export interface MarkdownBlockProps {
  text: string;
  /** 追加类名（默认 `text-[15px] leading-7 text-ink-2`）。 */
  className?: string;
}

/** 块级 markdown 渲染（整篇正文 / 图谱摘要）。 */
export function MarkdownBlock({ text, className }: MarkdownBlockProps) {
  return (
    <div data-testid="md-block" className={className ?? "text-[15px] leading-7 text-ink-2"}>
      <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrl} components={markdownComponents}>
        {text}
      </Markdown>
    </div>
  );
}

export interface MarkdownInlineProps {
  text: string;
  /** 追加类名（默认 `leading-5`，字号继承父级）。 */
  className?: string;
}

/** 行内 markdown 渲染（要点 / 原文引用）；字号与行高继承父级。 */
export function MarkdownInline({ text, className }: MarkdownInlineProps) {
  return (
    <span data-testid="md-inline" className={className ?? "leading-5"}>
      <Markdown
        remarkPlugins={remarkPlugins}
        urlTransform={safeUrl}
        components={inlineMarkdownComponents}
      >
        {text}
      </Markdown>
    </span>
  );
}
