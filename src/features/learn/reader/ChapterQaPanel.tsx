/**
 * 「问这一章」（章内提问）面板 —— 阅读页右栏第 5 区。
 *
 * 设计（docs/learn-chapter-qa-design-2026-09.md §7 线框 / §8.6）：
 * - 状态机六态：`answered` / `unanchored` / `not-found` / `empty` / `no-ai` / `error`；
 *   **除 answered / unanchored 外不渲染任何模型文本**（不做隐式兜底）。
 * - 问答记录是**会话级内存**（决策 D2）：组件卸载即弃，不落库。
 * - 所有反馈内联在面板内，无弹层、无 Toast（保持阅读页无模态打断）。
 * - `data-testid` 一次到位（`rules/playwright-test-ids`：写 testid 但不启浏览器）。
 *
 * 追加（docs/ai-immediate-explain-design-2026-10.md，Feature B）：
 * - **掌握度驱动的讲解档位**（决策 D5）：弱章先给脚手架、强章直达结论 ——
 *   档位由 `tutorTierOf(mastery)` 决定，用户可手动改档（改了就一直生效到切章）。
 * - **追问线程**（决策 D6）：最多注入最近 3 轮，**会话级内存**，切章即弃。
 *   只有真的拿到回答（answered / unanchored）才追加进线程 —— no-ai / error
 *   不污染上下文，否则模型会看到「自己说了一半又被问」的假历史。
 */
import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n";
import type {
  Chapter,
  ChapterAnswer,
  ChapterQaErrorKind,
  ChapterQaTurn,
  SourceDocument,
  TutorTier,
} from "../../../domain";
import { Section } from "../../../components/primitives";
import { Button } from "../../../components/ui/button";
import { Spinner } from "../../../components/ui/spinner";
import { Textarea } from "../../../components/ui/textarea";
import { useAiReady } from "../../../hooks/useAiReady";
import { useAliveRef } from "../../../hooks/useAliveRef";
import { isUsefulKeyPoint } from "../../../lib/text-quality";
import { storage } from "../../../stores/useLoopStore";
import { MAX_QUESTION_CHARS, askChapter, trimThread, tutorTierOf } from "../chapter-qa-service";
import { CitationList, QaNotice, renderWithCitations } from "./qa-shared";

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
  /**
   * 示例问题取本章要点前 3 条 **且过质量门**（2026-09-16 缺陷修复）：
   * 脏碎片（PDF 抽取的编号 `"4."`）会生成「解释 4.」这种无意义建议。
   */
  const examplePoints = chapter.keyPoints.filter(isUsefulKeyPoint).slice(0, 3);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<ChapterAnswer | undefined>();
  /** 卸载后丢弃迟到的 setState（切章 / 切页时不写已卸组件）。 */
  const aliveRef = useAliveRef();
  /** 追问线程（会话级；不落库，见文件头 D6）。 */
  const [turns, setTurns] = useState<ChapterQaTurn[]>([]);
  /** 用户手动改档（undefined = 用掌握度推荐的档位）。 */
  const [tierOverride, setTierOverride] = useState<TutorTier | undefined>();
  /** 本章掌握度：mount 时读一次，**不轮询**（避免多余 IO）。 */
  const [mastery, setMastery] = useState<number | undefined>();
  /** 追问框（与首轮输入分开，避免互相清空）。 */
  const [followUp, setFollowUp] = useState("");

  useEffect(() => {
    // 切章：线程、手动档、上一轮答案全部作废（会话级语义）。
    if (!aliveRef.current) return;
    void (async () => {
      const learner = await storage.getLearnerState();
      if (aliveRef.current) setMastery(learner.byUnit[chapter.id]?.mastery);
    })();
  }, [chapter.id, aliveRef]);

  const tier = tierOverride ?? tutorTierOf(mastery);
  const TIER_TEXT: Record<TutorTier, string> = {
    scaffold: t.tierScaffold,
    standard: t.tierStandard,
    direct: t.tierDirect,
  };
  const tierText = t.tierLabel(Math.round((mastery ?? 0) * 100));

  const tooLong = question.length > MAX_QUESTION_CHARS;
  const canAsk = aiReady && question.trim().length > 0 && !tooLong && !asking;
  const followTooLong = followUp.length > MAX_QUESTION_CHARS;
  const canFollow =
    aiReady && followUp.trim().length > 0 && !followTooLong && !asking && answer !== undefined;

  const ask = async (q: string, nextTier: TutorTier = tier) => {
    setAsking(true);
    try {
      const res = await askChapter({
        documentId: doc.id,
        chapterId: chapter.id,
        question: q,
        history: trimThread(turns),
        tier: nextTier,
      });
      if (!aliveRef.current) return;
      setAnswer(res);
      // 只有真的拿到回答才进线程：no-ai / error 不污染上下文
      if (res.status === "answered" || res.status === "unanchored") {
        setTurns((prev) => [
          ...prev,
          { role: "user", text: q },
          { role: "tutor", text: res.answer ?? "" },
        ]);
      }
      // 只清追问框：首轮输入框的既有行为（提交后保留内容）不改，避免顺手改坏。
      setFollowUp("");
    } finally {
      if (aliveRef.current) setAsking(false);
    }
  };

  return (
    <section className="space-y-2" data-testid="chapter-qa-root">
      <Section title={t.eyebrow} />
      <div className="rounded-xl border border-line bg-surface p-4">
        {/* 档位标签：常态只在「非标准档 / 用户改过档」时才给出改回入口，避免常态噪音 */}
        <div
          className="mb-2 flex items-center justify-between gap-2"
          data-testid="chapter-qa-tier"
        >
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
            <span
              className="rounded bg-subtle px-1.5 py-0.5 font-medium text-ink-2"
              data-testid="chapter-qa-tier-badge"
            >
              {TIER_TEXT[tier]}
            </span>
            <span className="truncate">{tierText}</span>
          </span>
          {tierOverride ? (
            <button
              type="button"
              data-testid="chapter-qa-tier-reset"
              onClick={() => setTierOverride(undefined)}
              className="shrink-0 text-xs text-primary hover:underline"
            >
              {t.tierReset}
            </button>
          ) : null}
        </div>
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
        {!answer && aiReady && examplePoints.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {examplePoints.map((kp, i) => (
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

        {/* 追问线程：只在真拿到回答后出现（no-ai / error 时追问没有意义） */}
        {answer && (answer.status === "answered" || answer.status === "unanchored") ? (
          <div className="mt-3 space-y-2 border-t border-line pt-3" data-testid="chapter-qa-thread">
            <div className="flex items-end gap-2">
              <Textarea
                data-testid="chapter-qa-followup"
                rows={2}
                className="resize-none text-sm"
                value={followUp}
                placeholder={t.followUpPlaceholder}
                disabled={!aiReady || asking}
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (canFollow) void ask(followUp);
                  }
                }}
              />
              <Button
                data-testid="chapter-qa-followup-send"
                size="sm"
                disabled={!canFollow}
                onClick={() => void ask(followUp)}
              >
                {asking ? t.asking : t.followUpSend}
              </Button>
            </div>
            {followTooLong ? (
              <p className="text-xs text-state-failed">{t.tooLong(MAX_QUESTION_CHARS)}</p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-testid="chapter-qa-rephrase"
                disabled={asking}
                onClick={() => void ask(t.rephrase)}
                className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs leading-5 text-ink-2 transition-colors hover:border-ink-3/40 disabled:opacity-50"
              >
                {t.rephrase}
              </button>
              <button
                type="button"
                data-testid="chapter-qa-direct"
                disabled={asking}
                onClick={() => {
                  // 不只这一次用直达档：改档后**持续生效**，直到用户点「改回推荐档」——
                  // 否则用户每次追问都要再点一次，档位就成了摆设。
                  setTierOverride("direct");
                  void ask(answer.question, "direct");
                }}
                className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs leading-5 text-ink-2 transition-colors hover:border-ink-3/40 disabled:opacity-50"
              >
                {t.directAnswer}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <p className="text-xs leading-5 text-ink-3">{t.footnote}</p>
    </section>
  );
}

/**
 * ⚠️ `QaNotice` / `renderWithCitations` / `CitationList` / `jumpTo` / `previewOf`
 * 已搬到 `./qa-shared`（供作答页「要点提示」共用，见 §T0）。
 * **此处不再保留任何一份副本** —— 两份实现必然漂移。
 */

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
              testIdPrefix="chapter-qa-citation"
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
