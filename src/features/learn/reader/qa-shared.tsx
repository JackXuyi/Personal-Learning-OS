/**
 * 章内问答 / 客观题提示**共用**的渲染件。
 *
 * 为什么抽出来：作答页「要点提示」（Feature A）与阅读页「问这一章」（Feature B）
 * 形态完全同构 —— 正文 + 可锚定引用 + 六态。两处各写一份 `QaNotice` /
 * `CitationList` 等于同一套分支维护两遍，改一处漏一处。
 *
 * 这是**搬家不是重写**：JSX 与 className 从 `ChapterQaPanel.tsx` 逐字搬来，
 * 只改 import 路径与可见性。任何样式「顺手优化」都属于越界 —— 要改就两处一起改。
 *
 * ⚠️ 引用区间口径：`QaCitation.start/end` 是 `doc.textPreview` 的**绝对**偏移。
 * 阅读页自行减去章起点得页内相对偏移；答题页没有页内高亮，直接用绝对值跳转。
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ChapterAnswer, QaCitation } from "../../../domain";
import { splitCitationMarkers } from "./qa-citations";

/** 内联提示条（无弹层；warn 走 warning 语义色，与徽标色族同源）。 */
export function QaNotice({
  kind,
  text,
  testId,
  action,
}: {
  kind: "info" | "muted" | "warn";
  text: string;
  testId?: string;
  action?: { label: string; to: string };
}) {
  const cls =
    kind === "warn"
      ? "mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700"
      : kind === "muted"
        ? "mt-3 text-xs leading-5 text-ink-3"
        : "mt-3 rounded-lg border border-line bg-subtle px-3 py-2 text-xs leading-5 text-ink-2";
  return (
    <div className={cls} data-testid={testId}>
      <span>{text}</span>
      {action ? (
        <Link to={action.to} className="ml-1 font-medium text-primary hover:underline">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/** 把答案里的 `[n]` 标记渲染为可点按钮（越界下标原样当普通文本）。 */
export function renderWithCitations(
  text: string,
  citations: readonly QaCitation[],
  onHighlight: (start: number, end: number) => void,
  onJumpChapter: (chapterId: string, atAbs: number) => void,
  /** 行内引用标记 `[n]` 的 testid 前缀（阅读页 / 答题页各一套）。 */
  testIdPrefix = "qa-inline-citation",
): ReactNode {
  const segments = splitCitationMarkers(text, citations.length);
  return segments.map((seg, i) => {
    if (seg.citation === undefined) return <span key={i}>{seg.text}</span>;
    const citation = citations[seg.citation - 1];
    return (
      <button
        key={i}
        type="button"
        data-testid={`${testIdPrefix}-${seg.citation}`}
        onClick={() => jumpTo(citation, onHighlight, onJumpChapter)}
        className="mx-0.5 align-baseline text-xs font-semibold text-primary hover:underline"
      >
        [{seg.citation}]
      </button>
    );
  });
}

/** 引用列表：一行一条，点击回原文。 */
export function CitationList({
  citations,
  chapterOrdinal,
  onHighlight,
  onJumpChapter,
  testIdPrefix = "qa-citation",
}: {
  citations: readonly QaCitation[];
  chapterOrdinal: (order: number) => string;
  onHighlight: (start: number, end: number) => void;
  onJumpChapter: (chapterId: string, atAbs: number) => void;
  /** 答题页与阅读页各自的 testid 前缀（`rules/playwright-test-ids`）。 */
  testIdPrefix?: string;
}) {
  return (
    <ul className="space-y-1">
      {citations.map((c, i) => (
        <li key={c.start}>
          <button
            type="button"
            data-testid={`${testIdPrefix}-${i + 1}`}
            onClick={() => jumpTo(c, onHighlight, onJumpChapter)}
            className="w-full rounded-md px-2 py-1.5 text-left text-xs leading-5 text-ink-2 transition-colors hover:bg-subtle hover:text-primary"
          >
            <span className="font-semibold text-primary">[{i + 1}]</span>{" "}
            <span className="text-ink-3">
              {chapterOrdinal(c.chapterOrder)} · {c.chapterTitle}
            </span>
            <br />
            <span className="line-clamp-2">{previewOf(c.quote)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 引用跳转：本章 → 页内高亮（章内相对偏移）；跨章 → 路由跳转（文档绝对偏移）。 */
export function jumpTo(
  citation: QaCitation | undefined,
  onHighlight: (start: number, end: number) => void,
  onJumpChapter: (chapterId: string, atAbs: number) => void,
): void {
  if (!citation) return;
  if (citation.inThisChapter) {
    onHighlight(citation.start, citation.end);
  } else {
    onJumpChapter(citation.chapterId, citation.start);
  }
}

/** 引文预览（单行省略，与线框「引文前 60 字…」同口径）。 */
export function previewOf(quote: string): string {
  return quote.length > 60 ? `${quote.slice(0, 60)}…` : quote;
}

/**
 * 问答/解释的**非正文态**统一判定。
 *
 * 只有 `answered` / `unanchored` 允许渲染模型文本 —— 其余四态一律只给提示，
 * 零兜底（既不伪造解释，也不显示「生成失败」之外的模型输出）。
 */
export function hasBody(answer: ChapterAnswer): boolean {
  return answer.status === "answered" || answer.status === "unanchored";
}
