/**
 * 「问这一章」（章内提问）面板 —— 阅读页右栏第 5 区。
 *
 * 设计（docs/learn-chapter-qa-design-2026-09.md §7 线框 / §8.6）：
 * - 状态机六态：`answered` / `unanchored` / `not-found` / `empty` / `no-ai` / `error`；
 *   **除 answered / unanchored 外不渲染任何模型文本**（不做隐式兜底）。
 * - 问答记录是**会话级内存**（决策 D2）：组件卸载即弃，不落库。
 * - 所有反馈内联在面板内，无弹层、无 Toast（保持阅读页无模态打断）。
 * - `data-testid` 一次到位（`rules/playwright-test-ids`：写 testid 但不启浏览器）。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../../i18n";
import type { Chapter, ChapterAnswer, ChapterQaErrorKind, QaCitation, SourceDocument } from "../../../domain";
import { Section } from "../../../components/primitives";
import { Button } from "../../../components/ui/button";
import { Spinner } from "../../../components/ui/spinner";
import { Textarea } from "../../../components/ui/textarea";
import { useAiReady } from "../../../hooks/useAiReady";
import { MAX_QUESTION_CHARS, askChapter } from "../chapter-qa-service";
import { splitCitationMarkers } from "./qa-citations";

interface ChapterQaPanelProps {
  doc: SourceDocument;
  chapter: Chapter;
  /** 本章引用：章内相对偏移 → 页面高亮正文。 */
  onHighlight: (start: number, end: number) => void;
  /** 跨章引用：文档绝对偏移 → 跳转到目标章。 */
  onJumpChapter: (chapterId: string, atAbs: number) => void;
}

export default function ChapterQaPanel({
  doc,
  chapter,
  onHighlight,
  onJumpChapter,
}: ChapterQaPanelProps) {
  const { m } = useI18n();
  const t = m.learn.reader.qa;
  const aiReady = useAiReady();
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<ChapterAnswer | undefined>();
  /** 卸载后丢弃迟到的 setState（切章 / 切页时不写已卸组件）。 */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const tooLong = question.length > MAX_QUESTION_CHARS;
  const canAsk = aiReady && question.trim().length > 0 && !tooLong && !asking;

  const ask = async (q: string) => {
    setAsking(true);
    try {
      const res = await askChapter({
        documentId: doc.id,
        chapterId: chapter.id,
        question: q,
      });
      if (aliveRef.current) setAnswer(res);
    } finally {
      if (aliveRef.current) setAsking(false);
    }
  };

  return (
    <section className="space-y-2" data-testid="chapter-qa-root">
      <Section title={t.eyebrow} />
      <div className="rounded-xl border border-line bg-surface p-4">
        <Textarea
          data-testid="chapter-qa-input"
          rows={2}
          className="resize-none text-sm"
          value={question}
          placeholder={aiReady ? t.placeholder : t.notReady}
          disabled={!aiReady || asking}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canAsk) void ask(question);
            }
          }}
        />
        {tooLong ? (
          <p className="mt-1 text-xs text-state-failed">{t.tooLong(MAX_QUESTION_CHARS)}</p>
        ) : null}

        {/* 示例问题：直接取自本章要点，点一下即提问（零编造） */}
        {!answer && aiReady && chapter.keyPoints.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chapter.keyPoints.slice(0, 3).map((kp, i) => (
              <button
                key={i}
                type="button"
                data-testid={`chapter-qa-suggestion-${i}`}
                disabled={asking}
                onClick={() => void ask(t.explainOf(kp))}
                className="rounded-lg border border-line bg-surface px-2.5 py-1 text-left text-xs leading-5 text-ink-2 transition-colors hover:border-ink-3/40 disabled:opacity-50"
              >
                {t.explainOf(kp)}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
            {asking ? (
              <>
                <Spinner />
                <span className="truncate">{t.searching}</span>
              </>
            ) : null}
          </span>
          <Button
            data-testid="chapter-qa-submit"
            size="sm"
            disabled={!canAsk}
            onClick={() => void ask(question)}
          >
            {asking ? t.asking : t.ask}
          </Button>
        </div>

        {!aiReady ? (
          <QaNotice
            kind="info"
            text={t.notReady}
            action={{ label: t.goConfigure, to: "/settings" }}
          />
        ) : null}
        {answer ? (
          <QaAnswerBody
            answer={answer}
            doc={doc}
            onHighlight={onHighlight}
            onJumpChapter={onJumpChapter}
            onRetry={() => void ask(answer.question)}
          />
        ) : null}
      </div>
      <p className="text-xs leading-5 text-ink-3">{t.footnote}</p>
    </section>
  );
}

/** 内联提示条（无弹层；warn 走 warning 语义色，与徽标色族同源）。 */
function QaNotice({
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

/** 答案体：按状态分支；除 answered / unanchored 外不渲染任何模型文本。 */
function QaAnswerBody({
  answer,
  doc,
  onHighlight,
  onJumpChapter,
  onRetry,
}: {
  answer: ChapterAnswer;
  doc: SourceDocument;
  onHighlight: (start: number, end: number) => void;
  onJumpChapter: (chapterId: string, atAbs: number) => void;
  onRetry: () => void;
}) {
  const { m } = useI18n();
  const t = m.learn.reader.qa;

  /** 错误分类 → 文案（唯一映射点；service 层只产出分类，不硬编码文案）。 */
  const errorText = (kind: ChapterQaErrorKind | undefined): string => {
    switch (kind) {
      case "invalid-question":
        return t.tooLong(MAX_QUESTION_CHARS);
      case "not-configured":
        return t.errNotConfigured;
      case "parse":
        return t.errParse;
      case "fetch":
        return t.errFetch;
      default:
        return t.errGeneric;
    }
  };

  switch (answer.status) {
    case "answered":
      return (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <p className="text-xs text-ink-3">「{answer.question}」</p>
          {answer.scopeUsed === "document" ? (
            <QaNotice kind="muted" text={t.expanded} />
          ) : null}
          <p className="text-sm leading-6 text-ink-1" data-testid="chapter-qa-answer">
            {renderWithCitations(answer.answer ?? "", answer.citations, onHighlight, onJumpChapter)}
          </p>
          <div>
            <p className="mb-1 text-xs font-semibold tracking-wide text-ink-2">
              {t.citationsTitle}
            </p>
            <CitationList
              citations={answer.citations}
              chapterOrdinal={m.chapter.ordinal}
              onHighlight={onHighlight}
              onJumpChapter={onJumpChapter}
            />
          </div>
          <div className="text-right text-xs text-ink-3">{t.footnote}</div>
        </div>
      );
    case "unanchored": // 展示 + 显式警示（零引用）
      return (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <p className="text-xs text-ink-3">「{answer.question}」</p>
          <QaNotice kind="warn" testId="chapter-qa-warning" text={t.unanchored} />
          <p className="text-sm leading-6 text-ink-1">{answer.answer}</p>
          <div className="text-right">
            <Button size="sm" variant="outline" onClick={onRetry}>
              {t.retry}
            </Button>
          </div>
        </div>
      );
    case "not-found":
      return (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-sm leading-6 text-ink-2">{t.notFound}</p>
        </div>
      );
    case "empty":
      return (
        <div className="mt-3 border-t border-line pt-3">
          {/* 无正文快照 vs 未建索引：据 doc 判定，措辞分别对应（不新增重复键） */}
          <p className="text-sm leading-6 text-ink-2">
            {doc.textPreview ? t.emptyIndex : m.learn.reader.noSnapshot}
          </p>
        </div>
      );
    case "no-ai":
      return null; // 已由上方禁用态承担
    case "error":
      return (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <p className="text-sm leading-6 text-state-failed">
            {errorText(answer.errorKind)}
          </p>
          <div className="text-right">
            <Button size="sm" variant="outline" onClick={onRetry}>
              {t.retry}
            </Button>
          </div>
        </div>
      );
    default:
      return null;
  }
}

/** 把答案里的 `[n]` 标记渲染为可点按钮（越界下标原样当普通文本）。 */
function renderWithCitations(
  text: string,
  citations: readonly QaCitation[],
  onHighlight: (start: number, end: number) => void,
  onJumpChapter: (chapterId: string, atAbs: number) => void,
): ReactNode {
  const segments = splitCitationMarkers(text, citations.length);
  return segments.map((seg, i) => {
    if (seg.citation === undefined) return <span key={i}>{seg.text}</span>;
    const citation = citations[seg.citation - 1];
    return (
      <button
        key={i}
        type="button"
        data-testid={`chapter-qa-inline-citation-${seg.citation}`}
        onClick={() => jumpTo(citation, onHighlight, onJumpChapter)}
        className="mx-0.5 align-baseline text-xs font-semibold text-primary hover:underline"
      >
        [{seg.citation}]
      </button>
    );
  });
}

/** 引用列表：一行一条，点击回原文。 */
function CitationList({
  citations,
  chapterOrdinal,
  onHighlight,
  onJumpChapter,
}: {
  citations: readonly QaCitation[];
  chapterOrdinal: (order: number) => string;
  onHighlight: (start: number, end: number) => void;
  onJumpChapter: (chapterId: string, atAbs: number) => void;
}) {
  return (
    <ul className="space-y-1">
      {citations.map((c, i) => (
        <li key={c.start}>
          <button
            type="button"
            data-testid={`chapter-qa-citation-${i + 1}`}
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
function jumpTo(
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
function previewOf(quote: string): string {
  return quote.length > 60 ? `${quote.slice(0, 60)}…` : quote;
}
