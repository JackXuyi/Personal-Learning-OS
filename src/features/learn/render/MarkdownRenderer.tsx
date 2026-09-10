/**
 * Markdown 正文渲染器（react-markdown + remark-gfm）。
 *
 * 安全约束（docs/library-detail-page-design-2026-09.md §3.3）：
 * - **不引入 rehype-raw** —— 原始 HTML 一律不渲染，`<script>` 只会被当文本；
 * - `urlTransform` 白名单：仅放行 http / https / mailto，挡掉 `javascript:` 等；
 * - 图片不渲染（`img: () => null`）—— 正文里的外链图片属追踪器，且本地优先。
 *
 * 类名一律语义 token：`text-ink-1/2/3`、`border-line`、`bg-subtle`。
 */
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { DocumentRendererProps } from "./renderer-registry";

/** 只放行安全协议；其余（javascript: / data: / vbscript:）一律置空。 */
function safeUrl(url: string): string {
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : "";
}

const components: Components = {
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
  // 行内代码 vs 代码块：react-markdown 用 `code` 的 inline class 区分，
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

export default function MarkdownRenderer({ text }: DocumentRendererProps) {
  return (
    <div data-testid="md-body" className="text-[15px] leading-7 text-ink-2">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeUrl}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
}
