import { useMemo, useState } from 'react';
import { useI18n } from '../../../i18n';
import { Button } from '../../../components/ui/button';
import ArticleBody from '../ArticleBody';
import type { SourceDocument } from '../../../domain';

const PREVIEW_CHARS = 200000;

export default function ContentTab({ doc }: { doc: SourceDocument }) {
  const { m: t } = useI18n();
  const [showAll, setShowAll] = useState(false);

  const text = doc.textPreview || '';
  const truncated = text.length > PREVIEW_CHARS;
  const displayed = showAll ? text : text.slice(0, PREVIEW_CHARS);

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

      {/* 正文 */}
      <div className="rounded-lg border border-line bg-surface p-6">
        <ArticleBody text={displayed} />
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
