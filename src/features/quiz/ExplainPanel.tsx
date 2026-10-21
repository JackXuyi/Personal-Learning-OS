/**
 * 作答页「就地要点提示」面板（Feature A 的 UI）。
 *
 * 设计（docs/ai-immediate-explain-design-2026-10.md §7.1/§7.2）：
 * - 六态渲染：`answered` / `unanchored` / `not-found` / `empty` / `no-ai` / `error`；
 *   **除 answered / unanchored 外不渲染任何模型文本**（零兜底，与阅读页同口径）。
 * - 面板自身**不含任何取数逻辑**，全部由 `QuizAnswerPage` 受控传入 —— 这样缓存
 *   按题 id 存、切题不丢的行为只在一处决定。
 *
 * 两条揭示通道（决策 D2/D3）：
 *   ① AI 讲解（有源，但**不给答案**）→ 本面板上半部；
 *   ② 参考答案（本地 `q.answer`，零 AI）→ 需用户主动点开。
 * 刻意分开：AI 不知道答案，就不会顺着答案编理由；用户想知道答案时不必等模型。
 *
 * token：全部走语义 token，**不出现 `slate-*` / `indigo-*`**（决策 D7 —— 整改
 * 基线 436 处不得上涨）。
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ChapterAnswer, PaperQuestion } from "../../domain";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { useI18n } from "../../i18n";
import { referenceOptionText } from "./meta";
import { canExplain } from "./explain-service";
import { CitationList, QaNotice, renderWithCitations } from "../learn/reader/qa-shared";

export interface ExplainPanelProps {
  q: PaperQuestion;
  /** 页级缓存（按 questionId）：一次取得，切题不丢。 */
  state: { answer?: ChapterAnswer; loading: boolean } | undefined;
  onAsk: () => void;
  onRetry: () => void;
}

export default function ExplainPanel({ q, state, onAsk, onRetry }: ExplainPanelProps) {
  const { m } = useI18n();
  const t = m.quiz.explain;
  const navigate = useNavigate();
  /** 参考答案是否展开（D2：默认不展开 —— 想看答案得主动点一下）。 */
  const [revealed, setRevealed] = useState(false);

  // 主观题不提供入口（双保险：service 侧同样守卫，见 explain-service ⓪）
  if (!canExplain(q)) return null;

  /** 答题页没有页内正文可高亮 ⇒ 所有引用一律跳阅读页（沿用既有 ?at= 约定）。 */
  const onHighlight = (start: number) => navigate(`/learn/chapter/${q.chapterId}?at=${start}`);
  const onJumpChapter = (chapterId: string, atAbs: number) =>
    navigate(`/learn/chapter/${chapterId}?at=${atAbs}`);

  if (!state?.answer && !state?.loading) {
    return (
      <div className="mt-4 border-t border-line pt-3">
        <button
          type="button"
          data-testid="quiz-explain-open"
          onClick={onAsk}
          className="text-xs font-medium text-primary hover:underline"
        >
          {t.openEntry}
        </button>
      </div>
    );
  }

  if (state.loading) {
    return (
      <div className="mt-4 border-t border-line pt-3">
        <p
          className="flex items-center gap-1.5 text-xs text-ink-3"
          data-testid="quiz-explain-loading"
        >
          <Spinner />
          <span>{t.loading}</span>
        </p>
      </div>
    );
  }

  const ans = state.answer;
  if (!ans) return null;

  const reference = referenceOptionText(q, m);

  /** 非正文态：只给提示，不渲染任何模型文本。 */
  const notice = () => {
    switch (ans.status) {
      case "no-ai":
        return (
          <QaNotice
            kind="info"
            testId="quiz-explain-no-ai"
            text={t.noAiTitle}
            action={{ label: t.goConfigure, to: "/settings" }}
          />
        );
      case "empty":
        return <QaNotice kind="muted" testId="quiz-explain-empty" text={t.emptyIndex} />;
      case "not-found":
        return <QaNotice kind="muted" testId="quiz-explain-not-found" text={t.notFound} />;
      case "error":
        return (
          <div className="mt-3 space-y-2">
            <p className="text-xs leading-5 text-state-failed" data-testid="quiz-explain-error">
              {t.errGeneric}
            </p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              {t.retry}
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="mt-4 border-t border-line pt-3" data-testid="quiz-explain-panel">
      {ans.status === "answered" || ans.status === "unanchored" ? (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-semibold tracking-wide text-ink-2">{t.hintTitle}</p>
            <span className="text-xs text-ink-3">{t.aiBadge}</span>
          </div>
          {ans.status === "unanchored" ? (
            <QaNotice kind="warn" testId="quiz-explain-warning" text={t.unanchored} />
          ) : null}
          <p className="text-sm leading-6 text-ink-1" data-testid="quiz-explain-body">
            {renderWithCitations(
              ans.answer ?? "",
              ans.citations,
              onHighlight,
              onJumpChapter,
              "quiz-explain-inline-citation",
            )}
          </p>
          {ans.citations.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-ink-2">
                {t.citationsTitle}
              </p>
              <CitationList
                citations={ans.citations}
                chapterOrdinal={m.chapter.ordinal}
                onHighlight={onHighlight}
                onJumpChapter={onJumpChapter}
                testIdPrefix="quiz-explain-citation"
              />
            </div>
          ) : null}
        </div>
      ) : (
        notice()
      )}

      {/* 参考答案：本地数据，零 AI。只有客观题才有「标准选项」可言。 */}
      {reference !== undefined ? (
        <div className="mt-3 border-t border-line pt-3">
          {revealed ? (
            <div className="space-y-1" data-testid="quiz-explain-answer">
              <p className="text-xs font-semibold tracking-wide text-ink-2">{t.answerTitle}</p>
              <p className="text-sm leading-6 text-ink-1">{reference}</p>
            </div>
          ) : (
            <p className="text-xs text-ink-3">
              {t.revealCta}{" "}
              <button
                type="button"
                data-testid="quiz-explain-reveal"
                onClick={() => setRevealed(true)}
                className="font-medium text-primary hover:underline"
              >
                {t.revealAnswer}
              </button>
            </p>
          )}
        </div>
      ) : null}

      <p className="mt-3 text-xs leading-5 text-ink-3">{t.footnote}</p>
    </div>
  );
}
