/**
 * 「讲给我听」（费曼式复述）面板 —— 阅读页右栏第 6 区。
 *
 * 设计（docs/learn-feynman-restatement-design-2026-09.md §7 线框 / §8.10）：
 * - **阻断态（D6-B）**：`useAiReady() === false` 时输入框与提交按钮**整体禁用**
 *   + 引导条（跳 `/settings`）；就绪判定**响应式**（配好即亮，无需刷新）。
 *   与第 4 区 `ChapterQaPanel` 同款写法（`useAiReady` + 内联提示条）。
 * - 四态面板：输入 / 检查中 / 反馈 / 历史；反馈**内联**（无弹层），唯一例外是
 *   删除复述的二次确认（`ConfirmDialog`）。
 * - `no-body`（无正文快照）是**提交前**禁用态，与 `no-ai` 同一时刻只渲染一条提示。
 * - 点引文 → `onHighlight(章内相对偏移)` → 复用页面既有 `highlightSourceRange` 通道。
 * - `data-testid` 一次到位（`rules/no-headless-browser-validation`：写 testid 但不启浏览器）。
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../../i18n";
import type {
  Chapter,
  Restatement,
  RestatementFeedback,
  RestatementMisread,
  RestatementPoint,
  RestatementResult,
  SourceDocument,
} from "../../../domain";
import { PIPELINE_LIMITS } from "../../../ai/pipeline-core";
import { Section } from "../../../components/primitives";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Spinner } from "../../../components/ui/spinner";
import { Textarea } from "../../../components/ui/textarea";
import { useAiReady } from "../../../hooks/useAiReady";
import { useLoopStore } from "../../../stores/useLoopStore";
import {
  MAX_RESTATEMENT_CHARS,
  MIN_RESTATEMENT_CHARS,
  checkRestatement,
  listChapterRestatements,
  removeRestatement,
  scheduleRestatementReview,
} from "../restatement-service";

interface ChapterRestatementPanelProps {
  doc: SourceDocument;
  chapter: Chapter;
  /** 章内相对偏移 → 页面高亮正文（复用 ChapterReaderPage 既有 highlight 通道）。 */
  onHighlight: (start: number, end: number) => void;
}

export default function ChapterRestatementPanel({
  doc,
  chapter,
  onHighlight,
}: ChapterRestatementPanelProps) {
  const { m, lang } = useI18n();
  const t = m.learn.reader.restatement;
  const aiReady = useAiReady();
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<RestatementResult | undefined>();
  const [history, setHistory] = useState<Restatement[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Restatement | undefined>();
  const [scheduled, setScheduled] = useState(false);
  /** 卸载后丢弃迟到的 setState（切章 / 切页时不写已卸组件，照抄 ChapterQaPanel）。 */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /**
   * 章切换 → 丢弃未提交文本与上次结果（UC-11，与章内提问的会话级语义一致），
   * 并重拉本章历史（历史只读，**不受 D6-B 阻断影响**，UC-05）。
   */
  useEffect(() => {
    setText("");
    setResult(undefined);
    setScheduled(false);
    let alive = true;
    void (async () => {
      const list = await listChapterRestatements(chapter.id);
      if (alive) setHistory(list);
    })();
    return () => {
      alive = false;
    };
  }, [chapter.id]);

  const noBody = !doc.textPreview;
  const tooShort = text.trim().length > 0 && text.trim().length < MIN_RESTATEMENT_CHARS;
  const tooLong = text.length > MAX_RESTATEMENT_CHARS;
  /** D6-B 阻断门：`useAiReady` 响应式，配好即亮。 */
  const noAi = !aiReady;
  /** 两项都是「提交前」禁用态（拦截发生在用户白写一通之前）。 */
  const blocked = noAi || noBody;
  const canCheck =
    !blocked && text.trim().length >= MIN_RESTATEMENT_CHARS && !tooLong && !checking;

  const check = async () => {
    setChecking(true);
    try {
      const res = await checkRestatement({
        documentId: doc.id,
        chapterId: chapter.id,
        text,
      });
      if (!aliveRef.current) return;
      setResult(res);
      setScheduled(false);
      // 已落库的记录就地并入历史（同 id 去重，避免重复渲染）。
      const record = res.record;
      if (record) setHistory((h) => [record, ...h.filter((r) => r.id !== record.id)]);
    } finally {
      if (aliveRef.current) setChecking(false);
    }
  };

  /** D3-A 显式调度：写调度 + 落证据（`kind="restatement"`，delta=0），随后刷新章级计划。 */
  const schedule = async () => {
    const rating = result?.rating;
    if (!rating) return;
    await scheduleRestatementReview({
      chapterId: chapter.id,
      rating,
      ...(result?.record ? { sourceId: result.record.id } : {}),
    });
    if (!aliveRef.current) return;
    setScheduled(true);
    await useLoopStore.getState().refresh(m);
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(undefined);
    if (!target) return;
    await removeRestatement(target.id);
    setHistory((h) => h.filter((r) => r.id !== target.id));
    if (result?.record?.id === target.id) setResult(undefined);
  };

  return (
    <section className="space-y-2" data-testid="chapter-restatement-root">
      <Section title={t.eyebrow} />
      <div className="rounded-xl border border-line bg-surface p-4">
        <Textarea
          data-testid="chapter-restatement-input"
          rows={4}
          className="text-sm"
          value={text}
          placeholder={aiReady ? t.placeholder : t.notReady}
          disabled={blocked || checking}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-ink-3">
          <span data-testid="chapter-restatement-count">
            {text.length}/{MAX_RESTATEMENT_CHARS}
          </span>
          {tooShort ? (
            <span className="text-state-failed">{t.tooShort(MIN_RESTATEMENT_CHARS)}</span>
          ) : null}
          {tooLong ? (
            <span className="text-state-failed">{t.tooLong(MAX_RESTATEMENT_CHARS)}</span>
          ) : null}
        </div>

        <div className="mt-3 flex items-center justify-end gap-2">
          {checking ? (
            <span className="flex items-center gap-1.5 text-xs text-ink-3">
              <Spinner />
              <span>{t.checking}</span>
            </span>
          ) : null}
          {result ? (
            <Button
              data-testid="chapter-restatement-resubmit"
              size="sm"
              variant="outline"
              disabled={!canCheck}
              onClick={() => void check()}
            >
              {checking ? t.checking : t.resubmit}
            </Button>
          ) : (
            <Button
              data-testid="chapter-restatement-submit"
              size="sm"
              disabled={!canCheck}
              onClick={() => void check()}
            >
              {checking ? t.checking : t.check}
            </Button>
          )}
        </div>

        {/* 提交前阻断提示（同一时刻只渲染一条；优先级 no-ai > no-body）—— 形状同 QaNotice */}
        {noAi ? (
          <RestatementNotice
            testId="chapter-restatement-notice-noai"
            kind="info"
            text={t.notReady}
            action={{ label: t.goConfigure, to: "/settings" }}
          />
        ) : noBody ? (
          <RestatementNotice
            testId="chapter-restatement-notice-nobody"
            kind="muted"
            text={t.noBody}
          />
        ) : null}

        {result ? (
          <FeedbackBody
            result={result}
            onHighlight={onHighlight}
            onRetry={() => void check()}
            onSchedule={() => void schedule()}
            onClear={() => {
              setText("");
              setResult(undefined);
              setScheduled(false);
            }}
            scheduled={scheduled}
          />
        ) : null}
      </div>

      {history.length > 0 ? (
        <HistoryList
          history={history}
          lang={lang}
          open={showHistory}
          onToggle={() => setShowHistory((v) => !v)}
          onHighlight={onHighlight}
          onDelete={setPendingDelete}
        />
      ) : null}

      <p className="text-xs leading-5 text-ink-3">{t.footnote}</p>

      <ConfirmDialog
        open={pendingDelete !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
        title={t.deleteConfirmTitle}
        description={t.deleteConfirmDesc}
        confirmLabel={t.historyDelete}
        cancelLabel={m.common.cancel}
        destructive
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 内联提示条（就地实现，不抽共享组件 —— 与项目 5 处面板各自内联的现状一致） */
/* ------------------------------------------------------------------ */

function RestatementNotice({
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

/* ------------------------------------------------------------------ */
/* 反馈体                                                              */
/* ------------------------------------------------------------------ */

function FeedbackBody({
  result,
  onHighlight,
  onRetry,
  onSchedule,
  onClear,
  scheduled,
}: {
  result: RestatementResult;
  onHighlight: (start: number, end: number) => void;
  onRetry: () => void;
  onSchedule: () => void;
  onClear: () => void;
  scheduled: boolean;
}) {
  const { m } = useI18n();
  const t = m.learn.reader.restatement;
  const record = result.record;
  const feedback: RestatementFeedback | undefined = record?.feedback;

  /** 错误分类 → 文案（唯一映射点；service 层只产出分类，不硬编码文案）。 */
  const errorText = (kind: RestatementResult["errorKind"]): string => {
    switch (kind) {
      case "too-short":
        return t.tooShort(MIN_RESTATEMENT_CHARS);
      case "too-long":
        return t.tooLong(MAX_RESTATEMENT_CHARS);
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

  switch (result.status) {
    case "ok":
    case "partial": {
      if (!feedback || !record) return null;
      const covered = feedback.covered.length;
      const missed = feedback.missed.length;
      const partial = result.status === "partial";
      return (
        <div className="mt-3 space-y-3 border-t border-line pt-3" data-testid="chapter-restatement-feedback">
          {partial ? (
            <RestatementNotice kind="warn" testId="chapter-restatement-warning" text={t.unanchored} />
          ) : null}
          {!partial ? (
            <p className="text-xs font-semibold text-state-mastered" data-testid="chapter-restatement-coverage">
              ✓ {t.coverage(covered, covered + missed)}
            </p>
          ) : null}
          {feedback.truncated ? (
            <p className="text-xs leading-5 text-ink-3">
              {t.truncated(PIPELINE_LIMITS.restatementBodyChars)}
            </p>
          ) : null}

          <PointGroup
            title={t.coveredTitle}
            tone="covered"
            points={feedback.covered}
            onHighlight={onHighlight}
          />
          <PointGroup
            title={t.missedTitle}
            tone="missed"
            points={feedback.missed}
            onHighlight={onHighlight}
          />
          <ErrorGroup errors={feedback.errors} onHighlight={onHighlight} />

          {feedback.advice ? (
            <p className="text-sm leading-6 text-ink-1" data-testid="chapter-restatement-advice">
              <span className="font-semibold text-ink-2">{t.adviceTitle}：</span>
              {feedback.advice}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
            {result.rating && !partial ? (
              scheduled ? (
                <span className="text-xs text-ink-3" data-testid="chapter-restatement-scheduled">
                  {t.scheduled}
                </span>
              ) : (
                <Button data-testid="chapter-restatement-schedule" size="sm" onClick={onSchedule}>
                  {t.schedule}
                </Button>
              )
            ) : (
              <Button size="sm" variant="outline" onClick={onRetry}>
                {t.retry}
              </Button>
            )}
            <Button data-testid="chapter-restatement-clear" size="sm" variant="ghost" onClick={onClear}>
              {t.clear}
            </Button>
          </div>
        </div>
      );
    }
    case "no-body":
      return (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-sm leading-6 text-ink-2">{t.noBody}</p>
        </div>
      );
    case "error":
      return (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <p className="text-sm leading-6 text-state-failed" data-testid="chapter-restatement-error">
            {errorText(result.errorKind)}
          </p>
          <div className="text-right">
            <Button data-testid="chapter-restatement-retry" size="sm" variant="outline" onClick={onRetry}>
              {t.retry}
            </Button>
          </div>
        </div>
      );
    case "no-ai":
      return null; // 已由上方禁用态 + 引导条承担
    default:
      return null;
  }
}

/** 一组「要点」（你讲到的 / 你漏掉的）：每条可点回正文高亮。 */
function PointGroup({
  title,
  tone,
  points,
  onHighlight,
}: {
  title: string;
  tone: "covered" | "missed";
  points: readonly RestatementPoint[];
  onHighlight: (start: number, end: number) => void;
}) {
  if (points.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold tracking-wide text-ink-2">{title}</p>
      <ul className="space-y-1">
        {points.map((p, i) => (
          <li key={`${p.start}-${i}`}>
            <button
              type="button"
              data-testid={`chapter-restatement-${tone}-${i}`}
              onClick={() => onHighlight(p.start, p.end)}
              className="w-full rounded-md px-2 py-1.5 text-left text-xs leading-5 text-ink-2 transition-colors hover:bg-subtle hover:text-primary"
            >
              <span className={tone === "missed" ? "font-medium text-amber-700" : "font-medium text-ink-1"}>
                {p.point}
              </span>
              <br />
              <span className="text-ink-3">「{previewOf(p.quote)}」</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 「讲岔了的」：复述原话 + 原文正确说法 + 可点回的原文依据。 */
function ErrorGroup({
  errors,
  onHighlight,
}: {
  errors: readonly RestatementMisread[];
  onHighlight: (start: number, end: number) => void;
}) {
  const { m } = useI18n();
  const t = m.learn.reader.restatement;
  if (errors.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold tracking-wide text-ink-2">{t.errorsTitle}</p>
      <ul className="space-y-2">
        {errors.map((e, i) => (
          <li key={`${e.start}-${i}`} className="rounded-md border border-line px-2 py-1.5 text-xs leading-5">
            <p className="text-ink-1">“{e.quote}”</p>
            <p className="mt-0.5 text-ink-2">{e.correction}</p>
            {e.evidence ? (
              <button
                type="button"
                data-testid={`chapter-restatement-errors-${i}`}
                onClick={() => onHighlight(e.evidence!.start, e.evidence!.end)}
                className="mt-1 w-full rounded-md px-1 py-0.5 text-left text-ink-3 transition-colors hover:bg-subtle hover:text-primary"
              >
                「{previewOf(e.evidence.quote)}」↗
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 往次复述                                                            */
/* ------------------------------------------------------------------ */

function HistoryList({
  history,
  lang,
  open,
  onToggle,
  onHighlight,
  onDelete,
}: {
  history: readonly Restatement[];
  lang: "zh" | "en";
  open: boolean;
  onToggle: () => void;
  onHighlight: (start: number, end: number) => void;
  onDelete: (record: Restatement) => void;
}) {
  const { m } = useI18n();
  const t = m.learn.reader.restatement;
  return (
    <div className="rounded-xl border border-line bg-surface p-3" data-testid="chapter-restatement-history">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-xs font-medium text-ink-2 transition-colors hover:text-primary"
      >
        <span>
          {open ? "▾" : "▸"} {t.historyTitle}（{history.length}）
        </span>
      </button>
      {open ? (
        <ul className="mt-2 space-y-2">
          {history.map((r, i) => (
            <HistoryRow
              key={r.id}
              record={r}
              index={i}
              lang={lang}
              onHighlight={onHighlight}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function HistoryRow({
  record,
  index,
  lang,
  onHighlight,
  onDelete,
}: {
  record: Restatement;
  index: number;
  lang: "zh" | "en";
  onHighlight: (start: number, end: number) => void;
  onDelete: (record: Restatement) => void;
}) {
  const { m } = useI18n();
  const t = m.learn.reader.restatement;
  const [expanded, setExpanded] = useState(false);
  const f: RestatementFeedback | undefined = record.feedback;

  return (
    <li className="rounded-md border border-line px-2 py-1.5" data-testid={`chapter-restatement-history-${index}`}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left text-xs leading-5 text-ink-2 transition-colors hover:text-primary"
        >
          <span className="text-ink-3">{shortDate(record.createdAt, lang)}</span>
          {f ? (
            <span className="ml-1 text-state-mastered">
              · {t.coverage(f.covered.length, f.covered.length + f.missed.length)}
            </span>
          ) : null}
          <br />
          <span className="line-clamp-1">{record.text}</span>
        </button>
        <button
          type="button"
          data-testid={`chapter-restatement-history-delete-${index}`}
          onClick={() => onDelete(record)}
          className="shrink-0 text-xs text-ink-3 transition-colors hover:text-state-failed"
        >
          {t.historyDelete}
        </button>
      </div>
      {expanded ? (
        <div className="mt-2 space-y-1 border-t border-line pt-2">
          <p className="whitespace-pre-wrap text-xs leading-5 text-ink-1">{record.text}</p>
          {f ? (
            <>
              {f.covered.length > 0 ? (
                <ul className="space-y-0.5">
                  {f.covered.map((p, i) => (
                    <li key={`c-${p.start}-${i}`}>
                      <button
                        type="button"
                        onClick={() => onHighlight(p.start, p.end)}
                        className="w-full rounded px-1 py-0.5 text-left text-xs text-ink-3 transition-colors hover:bg-subtle hover:text-primary"
                      >
                        ✓ {p.point} 「{previewOf(p.quote)}」
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {f.missed.length > 0 ? (
                <ul className="space-y-0.5">
                  {f.missed.map((p, i) => (
                    <li key={`m-${p.start}-${i}`}>
                      <button
                        type="button"
                        onClick={() => onHighlight(p.start, p.end)}
                        className="w-full rounded px-1 py-0.5 text-left text-xs text-amber-700 transition-colors hover:bg-subtle"
                      >
                        ⚠ {p.point} 「{previewOf(p.quote)}」
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {f.advice ? <p className="text-xs leading-5 text-ink-2">{f.advice}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* 局部工具                                                            */
/* ------------------------------------------------------------------ */

/** 引文预览（单行省略，与线框「引文前 60 字…」同口径）。 */
function previewOf(quote: string): string {
  return quote.length > 60 ? `${quote.slice(0, 60)}…` : quote;
}

/** 短日期（随界面语言）：9/8 或 Sep 8。 */
function shortDate(at: number, lang: "zh" | "en"): string {
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    month: lang === "zh" ? "numeric" : "short",
    day: "numeric",
  }).format(new Date(at));
}
