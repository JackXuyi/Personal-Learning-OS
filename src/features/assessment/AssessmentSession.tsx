import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BandBadge, Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { DeltaBadge } from "../../components/DeltaBadge";
import { bandOf } from "../../engine";
import type { CognitiveLevel, KnowledgeUnit } from "../../domain";
import { useLoopStore } from "../../stores/useLoopStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useI18n } from "../../i18n";
import { unitTitle } from "../units";

type Stage = "answer" | "grade" | "feedback";

/** 测评实际使用的三档（analyze+ 为将来扩展，不在自适应循环内）。 */
type QuizLevel = "remember" | "understand" | "apply";

const LEVEL_ORDER: QuizLevel[] = ["remember", "understand", "apply"];

function levelIndexOf(l: CognitiveLevel): number {
  const i = LEVEL_ORDER.indexOf(l as QuizLevel);
  return i === -1 ? 0 : i;
}

/**
 * 测评会话 —— 一次作答循环（本地模式）。
 *
 * 流程：从选定单元的当前认知层级出题 → 作答 → 对照参考答案自评对错 →
 * 对错写回 Learner Model（submitAnswer）→ 答对升认知层级 / 答错降级。
 *
 * 本地无 AI 判分，因此采用「参考答案对照 + 自评对错」的诚实模式；
 * AI 判分接入后替换为自动判分。
 */
export default function AssessmentSession({
  unit,
  onExit,
}: {
  unit: KnowledgeUnit;
  onExit: () => void;
}) {
  const { m } = useI18n();
  const a = m.assessment;
  const navigate = useNavigate();
  const snapshot = useLoopStore((s) => s.snapshot);
  const submitAnswer = useLoopStore((s) => s.submitAnswer);
  const sessionRecord = useSessionStore((s) => s.record);

  const startMastery = snapshot?.masteryByUnit[unit.id] ?? 0;
  const [levelIdx, setLevelIdx] = useState(() => {
    const from = snapshot?.masteryByUnit[unit.id] ?? 0;
    // 已掌握（≥80%）从应用层测，其余从当前状态推断：未开始→记忆、学习中→理解。
    if (from >= 0.8) return 2;
    if (from > 0) return Math.min(1, Math.max(0, levelIndexOf("understand")));
    return 0;
  });
  const [stage, setStage] = useState<Stage>("answer");
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [delta, setDelta] = useState<number | undefined>();
  const [intervalDays, setIntervalDays] = useState<number | undefined>();
  const [correctStreak, setCorrectStreak] = useState(0);
  const [wrongAtLevel, setWrongAtLevel] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const activeRef = useRef(true);
  useEffect(() => {
    return () => {
      activeRef.current = false;
    };
  }, []);

  const currentLevel = LEVEL_ORDER[Math.min(levelIdx, LEVEL_ORDER.length - 1)];
  const question = promptText(unit.title, currentLevel);
  const masteryNow = snapshot?.masteryByUnit[unit.id] ?? 0;

  function promptText(title: string, level: CognitiveLevel): string {
    const p = a.prompt;
    switch (level) {
      case "remember":
        return p.remember(title);
      case "understand":
        return p.understand(title);
      case "apply":
        return p.apply(title);
      default:
        return p.fallback(title);
    }
  }

  const submitGrade = useCallback(
    async (correct: boolean) => {
      if (stage !== "grade") return;
      setSubmitError(undefined);
      try {
        const result = await submitAnswer(unit.id, { correct });
        if (!activeRef.current) return;
        sessionRecord({
          unitId: unit.id,
          mode: "assessment",
          correct,
          masteryDelta: result.masteryDelta,
          nextReviewInDays: result.nextReviewInDays,
          at: Date.now(),
        });
        setDelta(result.masteryDelta);
        setIntervalDays(result.nextReviewInDays);
        if (correct) {
          setCorrectStreak((c) => c + 1);
          setLevelIdx((i) => Math.min(i + 1, LEVEL_ORDER.length - 1));
        } else {
          setWrongAtLevel(true);
          setLevelIdx((i) => Math.max(0, i - 1));
        }
        setStage("feedback");
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : String(err));
      }
    },
    [stage, unit.id, submitAnswer, sessionRecord],
  );

  // 键盘：答完显示参考答案后 Enter 提交自评？1=答对 2=答错。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (stage === "grade") {
        if (e.key === "1") void submitGrade(true);
        if (e.key === "2") void submitGrade(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, submitGrade]);

  const nextRound = () => {
    if (!wrongAtLevel && levelIdx < LEVEL_ORDER.length - 1) {
      // 答对且未到顶：升层后继续下一题。
      setStage("answer");
      setAnswer("");
      setRevealed(false);
      setDelta(undefined);
      setIntervalDays(undefined);
    } else {
      // 已到顶（或中途答错过）→ 完成该单元测评。
      onExit();
    }
  };

  const level = (i: number): QuizLevel => LEVEL_ORDER[Math.min(i, LEVEL_ORDER.length - 1)];

  return (
    <PageContainer>
      <SectionTitle
        title={a.title}
        subtitle={a.subtitle}
        action={
          <button
            onClick={onExit}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
          >
            {m.common.exit}
          </button>
        }
      />

      <Card>
        {/* 单元 + 层级状态 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-slate-900">{unitTitle(unit.id)}</span>
            <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
              {a.cognitiveOf(a.levelLabel[level(levelIdx)])}
              <span className="ml-1 text-[10px] text-indigo-400">
                {a.levelHint[level(levelIdx)]}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{a.masteryAt(Math.round(masteryNow * 100))}</span>
            <BandBadge band={bandOf(masteryNow)} />
          </div>
        </div>

        {/* 题目 */}
        <div className="mt-5">
          <p className="text-sm font-medium text-slate-700">{question}</p>

          {stage === "answer" || stage === "grade" ? (
            <>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onFocus={() => setStage((s) => (s === "grade" ? "grade" : s))}
                placeholder={a.answerPlaceholder}
                rows={3}
                className="mt-3 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:bg-white"
              />
              {!revealed ? (
                <button
                  onClick={() => {
                    setStage("grade");
                    setRevealed(true);
                  }}
                  className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  {a.compareRef}
                </button>
              ) : null}
              {revealed ? (
                <div className="mt-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    <span className="font-medium text-slate-700">{a.refLead}</span>
                    {unit.summary ?? unit.title}
                  </div>
                  <div className="mt-3 flex gap-3">
                    <button
                      onClick={() => void submitGrade(true)}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      {a.gotIt} <kbd className="ml-1 rounded bg-emerald-500/40 px-1 text-[10px]">1</kbd>
                    </button>
                    <button
                      onClick={() => void submitGrade(false)}
                      className="rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 hover:bg-red-100"
                    >
                      {a.missedIt} <kbd className="ml-1 rounded bg-red-100 px-1 text-[10px]">2</kbd>
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">{a.honestNote}</p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="mt-3 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {delta !== undefined && delta >= 0 ? a.verdictRight : a.verdictWrong}
                {delta !== undefined ? (
                  <span className="mt-1 block">
                    <DeltaBadge delta={delta} nextReviewInDays={intervalDays} />
                  </span>
                ) : null}
                <span className="mt-1 block text-xs text-slate-400">
                  {delta !== undefined && delta >= 0
                    ? wrongAtLevel
                      ? ""
                      : correctStreak >= 2
                        ? a.streakUp
                        : a.upNext
                    : a.queued}
                </span>
              </div>
              {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}
              <button
                onClick={nextRound}
                className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                {!wrongAtLevel && levelIdx < LEVEL_ORDER.length - 1 ? a.nextQuestion : a.finishUnit}
              </button>
            </div>
          )}
        </div>
      </Card>

      <p className="mt-4 text-xs text-slate-400">
        {a.progress(Math.round(startMastery * 100), Math.round(masteryNow * 100))}{" "}
        {a.climbRule}
      </p>
      <div className="mt-2">
        <button
          onClick={() => navigate("/study")}
          className="text-sm text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
        >
          {a.viewQueue}
        </button>
      </div>
    </PageContainer>
  );
}
