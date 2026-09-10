/**
 * 图片型资料的空态渲染器。
 *
 * 图片资料导入时抽取的是元信息，没有可渲染的正文 —— 与其显示一片空白，
 * 不如明确说明「这是图片，无可渲染正文」。
 */
import { useI18n } from "../../../i18n";
import type { DocumentRendererProps } from "./renderer-registry";

export default function ImageNoticeRenderer(_props: DocumentRendererProps) {
  const { m: t } = useI18n();
  return (
    <div
      data-testid="image-notice"
      className="rounded-lg border border-dashed border-line bg-surface p-6 text-center"
    >
      <p className="text-sm font-medium text-ink-1">
        {t.learn.detail.content.imageNoText}
      </p>
    </div>
  );
}
