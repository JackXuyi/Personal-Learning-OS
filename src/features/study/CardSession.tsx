/**
 * 卡片复习会话（F5 第 4 条「自测卡」）—— `/study/session?mode=cards&…`。
 *
 * 与同目录 `ReviewSession`（概念层 / 全局闭环快照）的关系：**独立组件**，由
 * `ReviewSession` 按 URL 模式**委托**渲染（见 `session-mode.ts`）。这样既有会话体
 * 零改动 —— 卡片模式不经过 `snapshot` / `submitAnswer`，评分只写卡级 `CardState`，
 * 因此**不会移动掌握度**（决策 D1-A / D6-A）。
 *
 * 交互骨架（`Space` 揭晓 / `1-4` 评分 / `Enter` 下一项 / `Esc` 退出 / 5s 撤销 /
 * 四档按钮文案）**逐项复用既有 `review` 文案块**，不新写一套。
 *
 * 硬约束：卡面 100% 来自 `Chapter`（零 AI）；正反面语义 = quote / point。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, SectionTitle } from "../../components/primitives";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { PageContainer } from "../../components/layout/AppShell";
import { Spinner } from "../../components/ui/spinner";
import type { CardState, CardStateMap, DerivedCard, SelfRating } from "../../domain";
import { nextReviewInDays } from "../../engine";
import { collectCards, rateCard, revertCard } from "../learn/flashcard-service";
import { fmtDate } from "../goals/GoalsPage";
import { useI18n } from "../../i18n";

/** 四档顺序（间隔天数从引擎取，避免与 1/2/4/7 的两处口径漂移）。 */
const RATINGS: SelfRating[] = ["forget", "hard", "good", "easy"];

const UNDO_SECONDS = 5;

type Stage = "show" | "rated";

export default function CardSession({
  documentId,
  chapterId,
}: {
  documentId: string;
  chapterId?: string;
}) {
  const { m, lang } = useI18n();
  const t = m.learn.reader.cards;
  const r = m.review;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState(false);
  const [scopeMissing, setScopeMissing] = useState(false);
  const [queue, setQueue] = useState<DerivedCard[]>([]);
  const [states, setStates] = useState<CardStateMap>({});
  const [uncarded, setUncarded] = useState(0);
  const [nextDueAt, setNextDueAt] = useState<number | undefined>(undefined);
  const [dueIdsAtStart, setDueIdsAtStart] = useState<Set<string>>(new Set());

  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("show");
  const [revealed, setRevealed] = useState(false);
  const [prevState, setPrevState] = useState<CardState | undefined>(undefined);
  const [lastRating, setLastRating] = useState<SelfRating | undefined>(undefined);
  const [ratedById, setRatedById] = useState<Map<string, SelfRating>>(new Map());
  const [undoLeft, setUndoLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** 加载卡片组：`collectCards` 内部只做派生 + 孤儿清理（唯一写点）。 */
  const load = useCallback(async () => {
    setLoading(true);
    setStorageError(false);
    try {
      const now = Date.now();
      const col = await collectCards({ documentId, chapterId }, now);
      if (!aliveRef.current) return;
      setScopeMissing(col.scopeMissing);
      // 会话队列**一次固定**，中途不重排（与既有复习会话同一口径）
      setQueue(col.queue);
      setStates(col.state);
      setUncarded(col.uncarded);
      setNextDueAt(col.nextDueAt);
      setDueIdsAtStart(
        new Set(
          col.cards
            .filter((c) => {
              const st = col.state[c.id];
              return st?.nextReviewAt !== undefined && st.nextReviewAt <= now;
            })
            .map((c) => c.id),
        ),
      );
      setIndex(0);
      setStage("show");
      setRevealed(false);
      setRatedById(new Map());
      setFinished(false);
    } catch {
      if (aliveRef.current) setStorageError(true);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [documentId, chapterId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 撤销倒计时（与既有会话一致的 5 秒窗口）
  useEffect(() => {
    if (undoLeft <= 0) return;
    const timer = setInterval(() => setUndoLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(timer);
  }, [undoLeft]);

  const current = queue[index];
  const goBack = chapterId ? `/learn/chapter/${chapterId}` : `/learn/doc/${documentId}?tab=knowledge`;
  const goBackLabel = chapterId ? t.backToChapter : t.backToDoc;

  const onRate = useCallback(
    async (rating: SelfRating) => {
      const card = queue[index];
      if (!card || stage !== "show" || undoLeft > 0 || busy) return;
      setBusy(true);
      setStorageError(false);
      try {
        // 评分前状态（撤销用）：首次评分 → undefined（撤销 = 删除该条）
        const before = states[card.id];
        const res = await rateCard(card, rating, Date.now());
        if (!aliveRef.current) return;
        setPrevState(before);
        setLastRating(rating);
        setRatedById((s) => new Map(s).set(card.id, rating));
        setStates((s) => ({
          ...s,
          [card.id]: {
            cardId: card.id,
            chapterId: card.chapterId,
            documentId: card.documentId,
            nextReviewAt: res.nextReviewAt,
            lastReviewedAt: Date.now(),
            reps: (before?.reps ?? 0) + 1,
            lastRating: rating,
            lapses: (before?.lapses ?? 0) + (rating === "forget" ? 1 : 0),
          },
        }));
        setStage("rated");
        setUndoLeft(UNDO_SECONDS);
      } catch {
        if (aliveRef.current) setStorageError(true);
      } finally {
        if (aliveRef.current) setBusy(false);
      }
    },
    [queue, index, stage, undoLeft, busy, states],
  );

  const next = useCallback(() => {
    if (index + 1 < queue.length) {
      setIndex((i) => i + 1);
      setStage("show");
      setRevealed(false);
      setPrevState(undefined);
      setLastRating(undefined);
      setUndoLeft(0);
    } else {
      setFinished(true);
    }
  }, [index, queue.length]);

  const undo = useCallback(async () => {
    const card = queue[index];
    if (!card) return;
    try {
      await revertCard(card.id, prevState);
      if (!aliveRef.current) return;
      setRatedById((s) => {
        const nextMap = new Map(s);
        nextMap.delete(card.id);
        return nextMap;
      });
      setStage("show");
      setRevealed(false);
      setLastRating(undefined);
      setUndoLeft(0);
    } catch {
      if (aliveRef.current) setStorageError(true);
    }
  }, [queue, index, prevState]);

  const exit = useCallback(() => {
    if (ratedById.size > 0 && undoLeft > 0) {
      setConfirmExitOpen(true);
      return;
    }
    navigate(goBack);
  }, [goBack, navigate, ratedById.size, undoLeft]);

  // 键盘：与既有复习会话同款（Space 揭晓 / 1-4 评分 / Enter 下一项 / Esc 退出）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished) return;
      if (e.key === "Escape") {
        exit();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (stage === "show") {
        if (e.key === " ") {
          e.preventDefault();
          setRevealed((v) => !v);
          return;
        }
        const n = Number(e.key);
        if (n >= 1 && n <= 4) void onRate(RATINGS[n - 1]);
      } else if (stage === "rated" && e.key === "Enter") {
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, onRate, next, finished, exit]);

  const stillDue = useMemo(
    () => [...dueIdsAtStart].filter((id) => !ratedById.has(id)).length,
    [dueIdsAtStart, ratedById],
  );

  if (loading) {
    return (
      <PageContainer>
        <Card>
          <p className="flex items-center gap-2 text-sm text-ink-3" data-testid="card-loading">
            <Spinner className="size-3.5" />
            {t.loading}
          </p>
        </Card>
      </PageContainer>
    );
  }

  if (scopeMissing) {
    return (
      <PageContainer>
        <Card>
          <p className="text-sm text-ink-3">{r.missingChapter}</p>
          <Link to="/learn" className="mt-2 inline-block text-sm text-primary hover:underline">
            ← {m.learn.reader.backToCatalog}
          </Link>
        </Card>
      </PageContainer>
    );
  }

  if (storageError && queue.length === 0) {
    return (
      <PageContainer>
        <Card>
          <p className="text-sm text-warn" data-testid="card-error-storage">
            {t.errStorage}
          </p>
          <button
            onClick={() => void load()}
            data-testid="card-retry"
            className="mt-3 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-subtle"
          >
            {t.retry}
          </button>
        </Card>
      </PageContainer>
    );
  }

  if (queue.length === 0) {
    return (
      <PageContainer>
        <Card>
          {uncarded > 0 ? (
            <div data-testid="card-empty-noref">
              <p className="text-sm text-ink-2">{t.uncardedAll}</p>
              <Link
                to={`/learn/doc/${documentId}?tab=knowledge`}
                className="mt-2 inline-block text-sm text-primary hover:underline"
              >
                {t.goAnalyze}
              </Link>
              <p className="mt-1 text-xs text-ink-3">{t.needAi}</p>
            </div>
          ) : nextDueAt !== undefined ? (
            <p className="text-sm text-ink-2" data-testid="card-empty-notdue">
              {t.emptyNotDue(fmtDate(nextDueAt, lang))}
            </p>
          ) : (
            <p className="text-sm text-ink-2" data-testid="card-empty-nocards">
              {t.emptyNoCards}
            </p>
          )}
          <Link to={goBack} className="mt-3 inline-block text-sm text-primary hover:underline">
            ← {goBackLabel}
          </Link>
        </Card>
      </PageContainer>
    );
  }

  if (finished) {
    const counts = RATINGS.map(
      (rating) => [rating, [...ratedById.values()].filter((v) => v === rating).length] as const,
    );
    return (
      <PageContainer>
        <SectionTitle title={t.summaryDone(ratedById.size)} />
        <Card>
          <div data-testid="card-summary">
            {ratedById.size === 0 ? (
              <p className="text-sm text-ink-3">{t.summaryEmpty}</p>
            ) : (
              <ul className="space-y-1.5">
                {counts
                  .filter(([, n]) => n > 0)
                  .map(([rating, n]) => (
                    <li key={rating} className="flex items-center justify-between text-sm">
                      <span className="text-ink-2">{r.rating[rating]}</span>
                      <span className="font-medium text-ink-1">{n}</span>
                    </li>
                  ))}
              </ul>
            )}
            {stillDue > 0 ? (
              <p className="mt-3 text-xs text-ink-3">{t.stillDue(stillDue)}</p>
            ) : null}
          </div>
          <Link
            to={goBack}
            className="mt-4 inline-block text-sm text-primary hover:underline"
            data-testid="card-summary-back"
          >
            ← {goBackLabel}
          </Link>
        </Card>
      </PageContainer>
    );
  }

  const isLast = index + 1 >= queue.length;

  return (
    <>
      <PageContainer>
        <SectionTitle
          title={t.title(index + 1, queue.length)}
          action={
            <button
              onClick={exit}
              data-testid="card-exit"
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-subtle"
            >
              {r.exit}
            </button>
          }
        />

        {/* 卡面：正面 = 原文摘录（提示「这句话在讲什么？」） */}
        <Card>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-ink-2">
              {m.units.action.card}
            </span>
          </div>
          <div className="mt-4 rounded-xl border border-line bg-subtle/60 px-4 py-5">
            <p className="text-xs font-medium text-ink-3">{t.frontLabel}</p>
            <p className="mt-2 text-base leading-relaxed text-ink-1" data-testid="card-front">
              “{current.quote}”
            </p>
          </div>
          {revealed ? (
            <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-4">
              <p className="text-xs font-medium text-ink-3">{t.backLabel}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-1" data-testid="card-back">
                {current.point}
              </p>
              <Link
                to={
                  chapterId
                    ? `/learn/chapter/${chapterId}?at=${current.start}`
                    : `/learn/doc/${documentId}?tab=content&at=${current.start}`
                }
                data-testid="card-source-jump"
                className="mt-2 inline-block text-sm text-primary hover:underline"
              >
                {t.sourceJump}
              </Link>
            </div>
          ) : (
            <button
              onClick={() => setRevealed(true)}
              data-testid="card-reveal"
              className="mt-4 text-sm font-medium text-primary hover:underline"
            >
              {r.showRef}{" "}
              <kbd className="ml-1 rounded border border-line px-1 text-[10px] text-ink-3">
                Space
              </kbd>
            </button>
          )}
        </Card>

        {/* 评分区（复用既有 review 文案与四档语义） */}
        <Card className="mt-4">
          {stage === "show" ? (
            <>
              <p className="mb-3 text-sm font-semibold text-ink-1">{r.askSelf}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {RATINGS.map((rating, i) => (
                  <button
                    key={rating}
                    onClick={() => void onRate(rating)}
                    disabled={busy}
                    data-testid={`card-rate-${rating}`}
                    className="group rounded-xl border border-line px-3 py-3 text-center transition hover:border-primary/40 hover:bg-primary/5 active:scale-[0.98] disabled:opacity-60"
                  >
                    <span className="block text-sm font-semibold text-ink-1">
                      {r.rating[rating]}
                    </span>
                    <span className="mt-1 block text-[11px] text-ink-3 group-hover:text-primary">
                      {r.meetAgain(nextReviewInDays(rating))}
                      <kbd className="ml-1 rounded border border-line px-1 text-[10px]">
                        {i + 1}
                      </kbd>
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-ink-3">{r.intervalPreview}</p>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium text-ink-2">
                  {r.recorded(lastRating ? r.rating[lastRating] : "")}
                  {lastRating ? (
                    <span className="ml-2 text-xs text-ink-3">
                      {r.meetAgain(nextReviewInDays(lastRating))}
                    </span>
                  ) : null}
                </p>
                {undoLeft > 0 ? (
                  <button
                    onClick={() => void undo()}
                    data-testid="card-undo"
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-subtle"
                  >
                    {r.undo(undoLeft)}
                  </button>
                ) : null}
              </div>
              {storageError ? (
                <p className="text-sm text-warn" data-testid="card-error-storage">
                  {t.errStorage}
                </p>
              ) : null}
              <button
                onClick={next}
                data-testid="card-next"
                className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"
              >
                {isLast ? r.finishReview : r.nextItem}{" "}
                <kbd className="ml-1 rounded bg-white/20 px-1 text-[10px] text-white">Enter</kbd>
              </button>
            </div>
          )}
        </Card>
      </PageContainer>
      <ConfirmDialog
        open={confirmExitOpen}
        onOpenChange={setConfirmExitOpen}
        title={r.confirmExit}
        confirmLabel={r.exit}
        cancelLabel={m.common.cancel}
        onConfirm={() => navigate(goBack)}
      />
    </>
  );
}

