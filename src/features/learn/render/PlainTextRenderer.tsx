/**
 * 纯文本渲染器 —— pdf / docx / epub / web / note / txt / custom 的默认渲染。
 *
 * 行渲染规则（`#` 标题放大、空行留白、其余 pre-wrap）原先定义在 `ArticleBody`；
 * 该组件已在 v2 优化中删除（阅读页改用 `pickRenderer`），**本文件即该规则的
 * 唯一实现** —— 需要调整纯文本观感请改这里。
 */
import type { DocumentRendererProps } from "./renderer-registry";

export default function PlainTextRenderer({ text }: DocumentRendererProps) {
  const lines = text.split("\n");
  return (
    <div data-testid="plain-body" className="text-[15px] leading-7 text-ink-2">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
          const level = heading[1].length;
          return (
            <p
              key={i}
              className={
                level <= 2
                  ? "mt-5 mb-2 text-lg font-semibold text-ink-1"
                  : "mt-4 mb-1.5 text-base font-semibold text-ink-1"
              }
            >
              {heading[2].replace(/\s+#+\s*$/, "")}
            </p>
          );
        }
        if (line.trim() === "") {
          return <div key={i} className="h-3" />;
        }
        return (
          <p key={i} className="text-[15px] leading-7 text-ink-2">
            <span className="whitespace-pre-wrap">{line}</span>
          </p>
        );
      })}
    </div>
  );
}
