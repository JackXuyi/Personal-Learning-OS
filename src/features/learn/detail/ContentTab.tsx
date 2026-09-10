/**
 * 「资料内容」Tab —— 按资料格式分派渲染器，并支持 `?at=<offset>` 原文跳转高亮。
 *
 * 两处关键改动（docs/library-detail-page-design-2026-09.md §8.12）：
 * - 渲染：`ArticleBody`（只认 `#`）→ `pickRenderer(doc.format)`，markdown 走
 *   真正的 GFM 渲染；渲染器抛错由 ErrorBoundary 降级为纯文本（E7）。
 * - 锚点：知识点 Tab 点「原文 →」会带 `?at=<start>` 过来，这里在渲染完成后
 *   按字符区间高亮并滚动到视野中央。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../i18n';
import { Button } from '../../../components/ui/button';
import { pickRenderer } from '../render/renderer-registry';
import PlainTextRenderer from '../render/PlainTextRenderer';
import RenderErrorBoundary from '../render/RenderErrorBoundary';
import { highlightRange } from '../highlight';
import type { SourceDocument } from '../../../domain';

const PREVIEW_CHARS = 200000;
/** 锚点高亮窗口：从 at 起高亮这么多个字符（够看清上下文，又不至于糊满屏）。 */
const HIGHLIGHT_WINDOW = 120;

interface ContentTabProps {
  doc: SourceDocument;
  /** 原文绝对字符偏移（来自 ?at=）；未提供或越界则不高亮。 */
  at?: number;
}

export default function ContentTab({ doc, at }: ContentTabProps) {
  const { m: t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const text = doc.textPreview || '';
  const truncated = text.length > PREVIEW_CHARS;
  const displayed = showAll ? text : text.slice(0, PREVIEW_CHARS);

  const Renderer = useMemo(() => pickRenderer(doc.format), [doc.format]);

  // 渲染完成后再高亮：Markdown 渲染是异步提交 DOM 的，effect 时机刚好。
  useEffect(() => {
    if (at === undefined || !Number.isFinite(at)) return;
    const root = bodyRef.current;
    if (!root) return;
    // 两帧后执行，等 Markdown 子树挂载完成。
    const id = requestAnimationFrame(() => {
      highlightRange(root, at, at + HIGHLIGHT_WINDOW);
    });
    return () => cancelAnimationFrame(id);
  }, [at, doc.id, displayed]);

  const metaLines = useMemo(() => {
    const lines = [];
    if (doc.format) lines.push(t.learn.detail.content.metaType(doc.format));
    if (text) lines.push(t.learn.detail.content.metaChars(text.length));
    lines.push(
      t.learn.detail.content.metaImported(
        new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
          new Date(doc.importedAt)
        )
      )
    );
    if (doc.source) lines.push(t.learn.detail.content.metaSource(doc.source));
    return lines;
  }, [doc, text, t]);

  if (!text) {
    return (
      <div className="rounded-lg border border-line bg-surface p-6 text-center">
        <p className="text-sm font-medium text-ink-1">{t.learn.detail.content.emptyTitle}</p>
        <p className="mt-1 text-xs text-ink-3">{t.learn.detail.content.emptyDesc}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 元信息行 */}
      <div className="flex flex-wrap gap-2">
        {metaLines.map((line, i) => (
          <span key={i} className="text-xs text-ink-3">
            {line}
          </span>
        ))}
      </div>

      {/* 正文（按格式分派；渲染异常降级纯文本） */}
      <div className="rounded-lg border border-line bg-surface p-6">
        <div ref={bodyRef}>
          <RenderErrorBoundary
            resetKey={`${doc.id}:${doc.format}:${displayed.length}`}
            fallback={<PlainTextRenderer text={displayed} doc={doc} />}
          >
            <Renderer text={displayed} doc={doc} />
          </RenderErrorBoundary>
        </div>
      </div>

      {/* 展开按钮（仅截断时显示） */}
      {truncated && !showAll && (
        <div className="text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAll(true)}
            className="text-xs"
          >
            {t.learn.detail.content.showAll(PREVIEW_CHARS)}
          </Button>
        </div>
      )}
    </div>
  );
}
