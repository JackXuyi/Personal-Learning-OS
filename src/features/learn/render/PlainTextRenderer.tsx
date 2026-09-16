/**
 * 纯文本渲染器 —— pdf / docx / epub / web / note / txt / custom 的默认渲染。
 *
 * ⚠️ **行渲染规则的唯一实现已搬到 `plain-text-layout.ts::plainTextLayout`**
 * （2026-09-16，F5 第 2 条「划线高亮与笔记」§11.2）：
 * 高亮定位层必须知道「哪些字符不在 DOM 里」（`\n` / 行尾空白 / `### ` 前缀都是
 * 被丢弃的），才能把用户划线准确匹配回原文。若渲染器与定位层各写一遍这套规则，
 * 就是本仓库反复踩过的根因（同一规则散在多处）→ 现在两处共用同一个纯函数，
 * 本文件只负责把行映射成 JSX。
 *
 * 历史：该规则原先定义在 `ArticleBody`；组件已在 v2 优化中删除（阅读页改用
 * `pickRenderer`）。**需要调整纯文本观感请改 `plain-text-layout.ts`。**
 */
import type { DocumentRendererProps } from "./renderer-registry";
import { plainTextLayout } from "./plain-text-layout";

export default function PlainTextRenderer({ text }: DocumentRendererProps) {
  return (
    <div data-testid="plain-body" className="text-[15px] leading-7 text-ink-2">
      {plainTextLayout(text).map((line, i) => {
        if (line.kind === "heading") {
          const level = line.level ?? 1;
          return (
            <p
              key={i}
              className={
                level <= 2
                  ? "mt-5 mb-2 text-lg font-semibold text-ink-1"
                  : "mt-4 mb-1.5 text-base font-semibold text-ink-1"
              }
            >
              {line.text}
            </p>
          );
        }
        if (line.kind === "blank") {
          return <div key={i} className="h-3" />;
        }
        return (
          <p key={i} className="text-[15px] leading-7 text-ink-2">
            <span className="whitespace-pre-wrap">{line.text}</span>
          </p>
        );
      })}
    </div>
  );
}
