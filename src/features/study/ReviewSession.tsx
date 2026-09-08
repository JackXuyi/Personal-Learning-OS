import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BandBadge, Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { DeltaBadge } from "../../components/DeltaBadge";
import { bandOf, createLearningPlanner } from "../../engine";
import { subgraphOf } from "../../engine/graph-engine";
import type { SelfRating, NextAction, Chapter } from "../../domain";
import { newId } from "../../domain";
import { storage, useLoopStore, type SubmitResult } from "../../stores/useLoopStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { actionKindLabel, unitTitle } from "../units";

type Stage = "show" | "rated";

const RATINGS: { value: SelfRating; label: string; days: number }[] = [
  { value: "forget", label: "忘记", days: 1 },
  { value: "hard", label: "困难", days: 2 },
  { value: "good", label: "记得", days: 4 },
  { value: "easy", label: "轻松", days: 7 },
];

/** 本次会话的完成条目（用于完成汇总）。 */
interface SessionItem {
  action: NextAction;
  rating: SelfRating;
  delta: number;
  intervalDays: number;
}

export default function ReviewSession() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const unitParam = params.get("unit");
  /** N5 概念层回归：带 chapterId = 章内概念复习（图谱「去复习」入口）。 */
  const chapterParam = params.get("chapterId");
  const conceptMode = chapterParam !== null;

  const snapshot = useLoopStore((s) => s.snapshot);
  const refresh = useLoopStore((s) => s.refresh);
  const submitAnswer = useLoopStore((s) => s.submitAnswer);
  const undoReview = useLoopStore((s) => s.undoReview);
  const sessionRecord = useSessionStore((s) => s.record);
  const sessionRemove = useSessionStore((s) => s.remove);

  const [ready, setReady] = useState(false);
  const [queue, setQueue] = useState<NextAction[]>([]);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  /** 概念模式：unitId → 概念标题（图谱概念不在静态 unitTitle 表内）。 */
  const [titles, setTitles] = useState<Record<string, string>>({});
  /** 概念模式：unitId → 掌握度（无全局 snapshot，直接从 learnerState 派生）。 */
  const [conceptMastery, setConceptMastery] = useState<Record<string, number>>({});
  const [missingChapter, setMissingChapter] = useState(false);
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("show");
  const [revealed, setRevealed] = useState(false);
  const [thinking, setThinking] = useState("");
  const [lastResult, setLastResult] = useState<SubmitResult | undefined>();
  const [undoLeft, setUndoLeft] = useState(0);
  const [sessionItems, setSessionItems] = useState<SessionItem[]>([]);
  const [startReadiness, setStartReadiness] = useState(0);
  const [finished, setFinished] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const activeRef = useRef(true);

  /** 退出目标：概念模式回章图谱，否则 /study（重定向 /plan）。 */
  const goBack = conceptMode && chapterParam ? `/learn/${chapterParam}/graph` : "/study";
  const goBackLabel = conceptMode ? "返回章图谱" : "返回学习页";
  const titleOf = (unitId: string): string => titles[unitId] ?? unitTitle(unitId);

  // 1) 数据就绪：概念模式 = 章概念缺口队列（先决 DFS 优先，复用概念 buildPlan）；
  //    非概念模式 = 全局闭环快照队列（V1 语义保留，直接访问会话 URL 时）。
  useEffect(() => {
    void (async () => {
      if (conceptMode && chapterParam) {
        const [docs, g, ls] = await Promise.all([
          storage.listDocuments(),
          storage.getGraph(),
          storage.getLearnerState(),
        ]);
        let found: Chapter | undefined;
        for (const d of docs) {
          const chapters = await storage.listChapters(d.id);
          const f = chapters.find((c) => c.id === chapterParam);
          if (f) {
            found = f;
            break;
          }
        }
        if (!activeRef.current) return;
        if (!found) {
          setMissingChapter(true);
          setReady(true);
          return;
        }
        const sub = subgraphOf(g, found.unitIds);
        const titleMap: Record<string, string> = {};
        for (const u of sub.units) titleMap[u.id] = u.title;
        setTitles(titleMap);
        const masteryMap: Record<string, number> = {};
        for (const [id, m] of Object.entries(ls.byUnit)) masteryMap[id] = m.mastery;
        setConceptMastery(masteryMap);
        const planActions = createLearningPlanner().buildPlan({
          goal: {
            id: `goal-ch-${found.id}`,
            type: "study",
            title: found.title || `第 ${found.order} 章`,
            importance: "high",
            requiredUnitIds: found.unitIds,
            createdAt: 0,
          },
          graph: sub,
          learnerState: ls,
        });
        let q = planActions;
        if (unitParam) {
          const idx = q.findIndex((a) => a.unitId === unitParam);
          if (idx >= 0) {
            q = q.slice(idx);
          } else if (q.length === 0 && sub.units.some((u) => u.id === unitParam)) {
            // 该概念已达标（不在缺口内）→ 单概念复习（自评顺延，不伪造缺口）。
            q = [
              {
                id: newId("action"),
                kind: "review",
                unitId: unitParam,
                priority: 0,
                reasons: ["复习本章概念，自评刷新下次复习安排。"],
                createdAt: Date.now(),
              },
            ];
          }
        }
        setQueue(q);
        setReady(true);
        return;
      }
      // 非概念模式：确保闭环快照就绪。
      if (!useLoopStore.getState().snapshot) await refresh();
      setReady(true);
    })();
    return () => {
      activeRef.current = false;
    };
  }, [conceptMode, chapterParam, unitParam, refresh]);

  // 2) 快照就绪后固定会话队列（非概念模式；从指定单元起，或整个队列），记录起始就绪度。
  useEffect(() => {
    if (conceptMode || !ready || !snapshot || queue.length > 0) return;
    let q = snapshot.actions;
    if (unitParam) {
      const startIdx = q.findIndex((a) => a.unitId === unitParam);
      if (startIdx >= 0) q = q.slice(startIdx);
    }
    setQueue(q);
    setStartReadiness(snapshot.readiness);
  }, [conceptMode, ready, snapshot, unitParam, queue.length]);

  // 3) 加载当前单元摘要作为「参考要点」。
  const current = queue[index];
  useEffect(() => {
    if (!current) return;
    void (async () => {
      const g = await storage.getGraph();
      const unit = g.units.find((u) => u.id === current.unitId);
      setSummaries((s) =>
        unit?.summary ? { ...s, [current.unitId]: unit.summary } : s,
      );
    })();
  }, [current]);

  // 4) 撤销倒计时。
  useEffect(() => {
    if (undoLeft <= 0) return;
    const t = setInterval(() => setUndoLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [undoLeft]);

  // 5) 键盘：空格显要点 / 1-4 评分 / Enter 下一项 / Esc 退出。
  const onRate = useCallback(
    async (rating: SelfRating) => {
      if (!current || stage !== "show" || undoLeft > 0) return;
      setSubmitError(undefined);
      try {
        const result = await submitAnswer(current.unitId, { rating });
        if (!activeRef.current) return;
        sessionRecord({
          unitId: current.unitId,
          mode: "review",
          rating,
          masteryDelta: result.masteryDelta,
          nextReviewInDays: result.nextReviewInDays,
          at: Date.now(),
        });
        setSessionItems((items) => [
          ...items.filter((it) => it.action.unitId !== current.unitId),
          {
            action: current,
            rating,
            delta: result.masteryDelta,
            intervalDays: result.nextReviewInDays,
          },
        ]);
        setLastResult(result);
        setStage("rated");
        setUndoLeft(5);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : String(err));
      }
    },
    [current, stage, undoLeft, submitAnswer, sessionRecord],
  );

  const next = useCallback(() => {
    if (index + 1 < queue.length) {
      setIndex((i) => i + 1);
      setStage("show");
      setRevealed(false);
      setThinking("");
      setLastResult(undefined);
      setUndoLeft(0);
    } else {
      setFinished(true);
    }
  }, [index, queue.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "TEXTAREA" || tag === "INPUT";
      if (finished) return;
      if (e.key === "Escape") {
        const changed = sessionItems.length > 0 && undoLeft > 0;
        if (!changed || window.confirm("本次作答尚未提交或可撤销，确定退出？")) {
          navigate(goBack);
        }
        return;
      }
      if (typing) return;
      if (stage === "show") {
        if (e.key === " ") {
          e.preventDefault();
          setRevealed((v) => !v);
        }
        const n = Number(e.key);
        if (n >= 1 && n <= 4) void onRate(RATINGS[n - 1].value);
      } else if (stage === "rated" && e.key === "Enter") {
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, onRate, next, finished, navigate, sessionItems, undoLeft, goBack]);

  // 6) 撤销：回滚状态并移除本次会话记录。
  const undo = useCallback(async () => {
    if (!current) return;
    const ok = await undoReview(current.unitId);
    if (!ok) return;
    sessionRemove(current.unitId);
    setSessionItems((items) => items.filter((it) => it.action.unitId !== current.unitId));
    setLastResult(undefined);
    setUndoLeft(0);
    setStage("show");
    setRevealed(false);
  }, [current, undoReview, sessionRemove]);

  const masteryNow = current
    ? conceptMode
      ? (conceptMastery[current.unitId] ?? 0)
      : (snapshot?.masteryByUnit[current.unitId] ?? 0)
    : 0;

  // 完成汇总态
  if (finished) {
    return (
      <SummaryView
        items={sessionItems}
        startReadiness={startReadiness}
        titles={titles}
        conceptMode={conceptMode}
        goBack={goBack}
        goBackLabel={goBackLabel}
      />
    );
  }

  if (missingChapter) {
    return (
      <PageContainer>
        <Card>
          <p className="text-sm text-slate-500">章节不存在或已被移除。</p>
          <Link to="/learn" className="mt-2 inline-block text-sm text-indigo-600 hover:underline">
            ← 返回章节目录
          </Link>
        </Card>
      </PageContainer>
    );
  }

  if (!ready || (!conceptMode && !snapshot)) {
    return (
      <PageContainer>
        <Card>
          <p className="text-sm text-slate-500">正在进入复习会话…</p>
        </Card>
      </PageContainer>
    );
  }

  if (!current) {
    return (
      <PageContainer>
        <Card>
          <p className="text-sm text-slate-500">
            {conceptMode
              ? "本章概念没有待复习的缺口——都已达标，或本章尚未提炼概念。"
              : "当前没有待复习的缺口单元。"}
          </p>
          <Link to={goBack} className="mt-2 inline-block text-sm text-indigo-600 hover:underline">
            ← {goBackLabel}
          </Link>
        </Card>
      </PageContainer>
    );
  }

  const isLast = index + 1 >= queue.length;

  const exit = () => {
    const changed = sessionItems.length > 0 && undoLeft > 0;
    if (changed) {
      const ok = window.confirm("本次作答尚未提交或可撤销，确定退出？");
      if (!ok) return;
    }
    navigate(goBack);
  };

  return (
    <PageContainer>
      <SectionTitle
        title={`复习 · ${index + 1}/${queue.length}`}
        subtitle={
          snapshot ? `目标：${snapshot.goal.title}` : undefined
        }
        action={
          <button
            onClick={exit}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
          >
            退出
          </button>
        }
      />

      {/* 当前单元卡片 */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {actionKindLabel(current.kind)}
            </span>
            <span className="text-base font-semibold text-slate-900">
              {titleOf(current.unitId)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">掌握度 {Math.round(masteryNow * 100)}%</span>
            <BandBadge band={bandOf(masteryNow)} />
          </div>
        </div>

        {/* 思考作答区（可选，默认自评模式） */}
        <div className="mt-5">
          <p className="text-sm font-medium text-slate-700">用自己的话解释一下这个概念</p>
          <textarea
            value={thinking}
            onChange={(e) => setThinking(e.target.value)}
            placeholder="写下你的理解（可选）——写不写都不影响自评。"
            rows={2}
            className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:bg-white"
          />
          <button
            onClick={() => setRevealed((v) => !v)}
            className="mt-2 text-sm font-medium text-indigo-600 hover:underline"
          >
            {revealed ? "收起参考要点" : "显示参考要点"} <kbd className="ml-1 rounded border border-slate-200 px-1 text-[10px] text-slate-400">Space</kbd>
          </button>
          {revealed && summaries[current.unitId] ? (
            <p className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-sm text-slate-600">
              {summaries[current.unitId]}
            </p>
          ) : null}
        </div>
      </Card>

      {/* 评分区 */}
      <Card className="mt-4 border-t-0">
        {stage === "show" ? (
          <>
            <p className="mb-3 text-sm font-semibold text-slate-700">这一步你感觉如何？（自评）</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {RATINGS.map((r, i) => (
                <button
                  key={r.value}
                  onClick={() => void onRate(r.value)}
                  className="group rounded-xl border border-slate-200 px-3 py-3 text-center transition hover:border-indigo-300 hover:bg-indigo-50/50 active:scale-[0.98]"
                >
                  <span className="block text-sm font-semibold text-slate-800">{r.label}</span>
                  <span className="mt-1 block text-[11px] text-slate-400 group-hover:text-indigo-500">
                    {r.days} 天后再见
                    <kbd className="ml-1 rounded border border-slate-200 px-1 text-[10px]">{i + 1}</kbd>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-slate-400">
              间隔预览：忘记→1 天 · 困难→2 天 · 记得→4 天 · 轻松→7 天（启发式估计）
            </p>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-600">
                  已记录：{ratingLabel(lastResultRating())}
                </p>
                {lastResult ? (
                  <div className="mt-1">
                    <DeltaBadge delta={lastResult.masteryDelta} nextReviewInDays={lastResult.nextReviewInDays} />
                  </div>
                ) : null}
              </div>
              {undoLeft > 0 ? (
                <button
                  onClick={() => void undo()}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
                >
                  撤销（{undoLeft}s）
                </button>
              ) : null}
            </div>
            {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}
            <button
              onClick={next}
              className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              {isLast ? "完成本次复习 ✅" : "下一项 ▶"}{" "}
              <kbd className="ml-1 rounded bg-indigo-400/30 px-1 text-[10px] text-white">Enter</kbd>
            </button>
          </div>
        )}
      </Card>
    </PageContainer>
  );

  function lastResultRating(): string {
    const item = sessionItems[sessionItems.length - 1];
    return item ? item.rating : "";
  }
}

/** 完成汇总态。 */
function SummaryView({
  items,
  startReadiness,
  titles,
  conceptMode = false,
  goBack,
  goBackLabel,
}: {
  items: SessionItem[];
  startReadiness: number;
  titles?: Record<string, string>;
  conceptMode?: boolean;
  goBack: string;
  goBackLabel: string;
}) {
  const navigate = useNavigate();
  const snapshot = useLoopStore((s) => s.snapshot);
  const nowReadiness = snapshot?.readiness ?? startReadiness;
  const delta = Math.round((nowReadiness - startReadiness) * 100);
  const titleOf = (unitId: string): string => titles?.[unitId] ?? unitTitle(unitId);
  return (
    <PageContainer>
      <SectionTitle
        title={conceptMode ? "本章概念复习完成 🎉" : "本次复习完成 🎉"}
        subtitle={
          conceptMode
            ? "概念层无卷面——自评即该概念的掌握度证据，复习调度随评分顺延。"
            : "掌握度变化为启发式估计。"
        }
      />
      <Card>
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">本次没有完成任何单元。</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li
                key={it.action.unitId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2"
              >
                <span className="text-sm font-medium text-slate-700">
                  {titleOf(it.action.unitId)}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {ratingLabel(it.rating)}
                  </span>
                </span>
                <DeltaBadge delta={it.delta} nextReviewInDays={it.intervalDays} />
              </li>
            ))}
          </ul>
        )}
        {!conceptMode && snapshot ? (
          <div className="mt-6 rounded-lg border border-indigo-100 bg-indigo-50/50 px-4 py-3">
            <p className="text-sm font-medium text-slate-800">
              就绪度{" "}
              <span className="tabular-nums text-slate-900">
                {Math.round(startReadiness * 100)}%
              </span>
              {delta !== 0 ? (
                <span className="tabular-nums text-emerald-600">
                  {" "}→ {Math.round(nowReadiness * 100)}%（{delta >= 0 ? "+" : ""}
                  {delta}%）
                </span>
              ) : (
                <span className="tabular-nums text-slate-900"> → {Math.round(nowReadiness * 100)}%</span>
              )}
              <span className="text-slate-500"> · 目标 80%</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {snapshot.next
                ? `还有 ${snapshot.actions.length} 个缺口待补，可继续测评巩固。`
                : "所有缺口已达标 🎉"}
            </p>
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={() => navigate("/")}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            回到首页
          </button>
          {conceptMode ? (
            <button
              onClick={() => navigate(goBack)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {goBackLabel} →
            </button>
          ) : (
            <button
              onClick={() => navigate("/assessment")}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              继续测评巩固 →
            </button>
          )}
          <button
            onClick={() => navigate(conceptMode ? "/learn" : "/study")}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {conceptMode ? "返回章节目录" : "返回学习页"}
          </button>
        </div>
      </Card>
    </PageContainer>
  );
}

function ratingLabel(rating: string): string {
  return { forget: "忘记", hard: "困难", good: "记得", easy: "轻松" }[rating] ?? rating;
}
