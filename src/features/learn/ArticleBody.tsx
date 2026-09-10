/**
 * ArticleBody —— 极简 Markdown 行渲染（从 ChapterReaderPage 抽取为共享组件，
 * docs/library-module-design-2026-09.md §8.7）。
 *
 * 消费方：章节阅读页（左栏章正文）与资料详情页「资料内容」Tab（全文渲染）。
 * 约束：标题加粗放大、空行留白、其余原文 pre-wrap；不做转义 / 代码高亮。
 */
import type { ReactNode } from "react";

export default function ArticleBody({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(
        <p
          key={i}
          className={
            level <= 2
              ? "mt-5 mb-2 text-lg font-semibold text-ink-1"
              : "mt-4 mb-1.5 text-base font-semibold text-ink-1"
          }
        >
          {heading[2].replace(/\s+#+\s*$/, "")}
        </p>,
      );
    } else if (line.trim() === "") {
      out.push(<div key={i} className="h-3" />);
    } else {
      out.push(
        <p key={i} className="text-[15px] leading-7 text-ink-2">
          <span className="whitespace-pre-wrap">{line}</span>
        </p>,
      );
    }
  });
  return <article>{out}</article>;
}
