/**
 * 代码型资料渲染器 —— 等宽 + 行号 + subtle 底。
 *
 * 用一列 `grid-cols-[auto_1fr]`，每行贡献「行号 + 代码」两个 grid item，
 * 避免给每行再套一层容器（万行文件下 DOM 体量差一倍）。行号列
 * `select-none`，复制正文时不会把行号一起带走。
 */
import { Fragment, useMemo } from "react";
import type { DocumentRendererProps } from "./renderer-registry";

export default function CodeRenderer({ text }: DocumentRendererProps) {
  const lines = useMemo(() => text.split("\n"), [text]);
  const gutter = String(lines.length).length;

  return (
    <div
      data-testid="code-body"
      className="overflow-x-auto rounded-lg border border-line bg-subtle p-3 font-mono text-[13px] leading-6 text-ink-1"
    >
      <div className="grid w-max grid-cols-[auto_1fr] gap-x-3">
        {lines.map((line, i) => (
          // 行号与代码是同一行的两个 grid item；用 Fragment 保证 key 正确。
          <Fragment key={i}>
            <span className="select-none text-right text-ink-3">
              {String(i + 1).padStart(gutter, " ")}
            </span>
            <span className="whitespace-pre">{line || " "}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
