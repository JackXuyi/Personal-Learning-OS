/**
 * 资料正文渲染器注册表 —— 按 `SourceDocument.format` 分派渲染实现。
 *
 * 为什么需要它（docs/library-detail-page-design-2026-09.md §4.2）：
 * 原来「资料内容」Tab 无条件用 `ArticleBody`（只识别 `#` 标题），Markdown 的
 * 列表 / 表格 / 代码块 / 引用全部退化成纯文本。按格式分派后，markdown 走真正的
 * GFM 渲染，代码走等宽行号，其余保留朴素行渲染。
 *
 * 降级预案：若 `react-markdown` 不可用，只需把 `markdown` 分支改指向
 * `PlainTextRenderer`，对外契约（`pickRenderer(format)`）零变化。
 */
import type { ReactElement } from "react";
import type { DocumentFormat, SourceDocument } from "../../../domain";
import MarkdownRenderer from "./MarkdownRenderer";
import PlainTextRenderer from "./PlainTextRenderer";
import CodeRenderer from "./CodeRenderer";
import ImageNoticeRenderer from "./ImageNoticeRenderer";

export interface DocumentRendererProps {
  /** 待渲染正文（调用方已完成截断）。 */
  text: string;
  doc: SourceDocument;
}

export type DocumentRenderer = (props: DocumentRendererProps) => ReactElement;

/**
 * 格式 → 渲染器。未显式覆盖的格式一律回落 `PlainTextRenderer`
 * （pdf / docx / epub / web / note / txt / custom 抽出的都是纯文本）。
 */
export function pickRenderer(format: DocumentFormat): DocumentRenderer {
  switch (format) {
    case "markdown":
      return MarkdownRenderer;
    case "code":
      return CodeRenderer;
    case "image":
      return ImageNoticeRenderer;
    default:
      return PlainTextRenderer;
  }
}
