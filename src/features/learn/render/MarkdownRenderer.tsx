/**
 * Markdown 正文渲染器 —— `markdown-core` 的**薄包装**
 * （docs/library-detail-page-v2-design-2026-09.md §8.5）。
 *
 * 保留本文件的意义只有一个：不动 `renderer-registry` 的对外契约
 * （`pickRenderer("markdown")` 仍返回本组件）。
 * 安全约束（无 rehype-raw / URL 白名单 / 图片不渲染）与类名映射全部下沉到
 * `markdown-core`，改渲染规则请改那里，勿在此复制第二份。
 */
import { MarkdownBlock } from "./markdown-core";
import type { DocumentRendererProps } from "./renderer-registry";

export default function MarkdownRenderer({ text }: DocumentRendererProps) {
  return <MarkdownBlock text={text} />;
}
