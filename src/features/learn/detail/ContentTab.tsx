/**
 * 「资料内容」Tab —— 按资料格式分派渲染器，并支持 `?at=<offset>` 原文跳转高亮。
 *
 * 两处关键改动（docs/library-detail-page-design-2026-09.md §8.12）：
 * - 渲染：`ArticleBody`（只认 `#`）→ `pickRenderer(doc.format)`，markdown 走
 *   真正的 GFM 渲染；渲染器抛错由 ErrorBoundary 降级为纯文本（E7）。
 * - 锚点：知识点 Tab 点「原文 →」会带 `?at=<start>` 过来，这里在渲染完成后
 *   按**源串区间**切出 quote、再在渲染后的 DOM 文本上匹配定位并滚动（T12）。
 *   ⚠️ 未展开时只渲染前 `PREVIEW_CHARS` 个字符 → `at` 越界时先展开全文再跳。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../i18n';
import { Button } from '../../../components/ui/button';
import { pickRenderer } from '../render/renderer-registry';
import PlainTextRenderer from '../render/PlainTextRenderer';
import RenderErrorBoundary from '../render/RenderErrorBoundary';
import { highlightSourceRange, HIGHLIGHT_WINDOW } from '../highlight';
import type { SourceDocument } from '../../../domain';

const PREVIEW_CHARS = 200000;

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
    // ⚠️ T12 步骤 0（截断边界，最易漏）：未展开时 DOM 只渲染前 PREVIEW_CHARS 个字符，
    // 若 at ≥ 200000 则 DOM 里**根本没有这段文本** —— 必须先把全文渲染出来再跳，
    // 否则换口径后体验会从「错位跳转」退化成「不跳转」（见方案 §8.16）。
    if (at >= PREVIEW_CHARS && truncated && !showAll) {
      setShowAll(true);
      return; // 展开后 displayed 变化 → 本 effect 会再跑一次，那时才高亮
    }
    const root = bodyRef.current;
    if (!root) return;
    // 两帧后执行，等 Markdown 子树挂载完成。
    const id = requestAnimationFrame(() => {
      // ⚠️ 第 2 个参数必须传**本 root 实际渲染的源串**（`displayed`），不是全文：
      // 高亮区间由「源串切片 → DOM 字面匹配」得出，源串必须与 DOM 同源。
      highlightSourceRange(root, displayed, at, at + HIGHLIGHT_WINDOW);
    });
    return () => cancelAnimationFrame(id);
  }, [at, doc.id, displayed, truncated, showAll]);

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
