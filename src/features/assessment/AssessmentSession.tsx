import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BandBadge, Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { DeltaBadge } from "../../components/DeltaBadge";
import { bandOf } from "../../engine";
import type { CognitiveLevel, KnowledgeUnit } from "../../domain";
import { useLoopStore } from "../../stores/useLoopStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { unitTitle } from "../units";

/** Bloom 认知层级的中文标签与题目模板。 */
const LEVELS: { level: CognitiveLevel; label: string; hint: string }[] = [
  {
    level: "remember",
    label: "记忆",
    hint: "回忆基本定义",
  },
  {
    level: "understand",
    label: "理解",
    hint: "用自己的话解释",
  },
  {
    level: "apply",
    label: "应用",
    hint: "给一个实际例子",
  },
];

type Stage = "answer" | "grade" | "feedback";

const LEVEL_ORDER: CognitiveLevel[] = ["remember", "understand", "apply"];

function levelIndexOf(l: CognitiveLevel): number {
  const i = LEVEL_ORDER.indexOf(l);
  return i === -1 ? 0 : i;
}

function promptFor(unit: KnowledgeUnit, level: CognitiveLevel): string {
  const title = unit.title;
  switch (level) {
    case "remember":
      return `「${title}」是什么？用一两句话给出定义。`;
    case "understand":
      return `用自己的话解释「${title}」，并说明它解决什么问题。`;
    case "apply":
      return `举一个实际场景：在什么情况下会用上「${title}」？具体怎么做？`;
    default:
      return `关于「${title}」，请给出你的理解。`;
  }
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
  const question = promptFor(unit, currentLevel);
  const masteryNow = snapshot?.masteryByUnit[unit.id] ?? 0;

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

  const levelLabel = (i: number) => LEVELS[Math.min(i, LEVELS.length - 1)].label;

  return (
    <PageContainer>
      <SectionTitle
        title="测评"
        subtitle="从缺口单元出题，难度随作答调整——本地模式为自评对错。"
        action={
          <button
            onClick={onExit}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
          >
            退出
          </button>
        }
      />

      <Card>
        {/* 单元 + 层级状态 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-slate-900">{unitTitle(unit.id)}</span>
            <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
              认知层级：{levelLabel(levelIdx)}
              <span className="ml-1 text-[10px] text-indigo-400">
                {LEVELS[Math.min(levelIdx, LEVELS.length - 1)].hint}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">掌握度 {Math.round(masteryNow * 100)}%</span>
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
                placeholder="写下你的回答…（本地模式：写完后对照参考答案自评）"
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
                  对照参考答案
                </button>
              ) : null}
              {revealed ? (
                <div className="mt-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    <span className="font-medium text-slate-700">参考答案要点：</span>
                    {unit.summary ?? unit.title}
                  </div>
                  <div className="mt-3 flex gap-3">
                    <button
                      onClick={() => void submitGrade(true)}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      我答对了 <kbd className="ml-1 rounded bg-emerald-500/40 px-1 text-[10px]">1</kbd>
                    </button>
                    <button
                      onClick={() => void submitGrade(false)}
                      className="rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 hover:bg-red-100"
                    >
                      我没答对 <kbd className="ml-1 rounded bg-red-100 px-1 text-[10px]">2</kbd>
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">
                    本地无 AI 判分，采用诚实自评；接入 Provider 后自动判分。
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="mt-3 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {delta !== undefined && delta >= 0 ? "✅ 判定：答对" : "❌ 判定：没答对"}
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
                        ? "连续答对，难度已上调。"
                        : "答对了，下一题难度上调。"
                    : "没关系，这道题已进入你的复习队列。"}
                </span>
              </div>
              {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}
              <button
                onClick={nextRound}
                className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                {!wrongAtLevel && levelIdx < LEVEL_ORDER.length - 1 ? "下一题 ▶" : "完成本单元测评 ✅"}
              </button>
            </div>
          )}
        </div>
      </Card>

      <p className="mt-4 text-xs text-slate-400">
        已掌握度 {Math.round(startMastery * 100)}% → 现在 {Math.round(masteryNow * 100)}%。
        连续答对升认知层级（记忆→理解→应用），答错则回到复习队列。
      </p>
      <div className="mt-2">
        <button
          onClick={() => navigate("/study")}
          className="text-sm text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
        >
          查看复习队列 →
        </button>
      </div>
    </PageContainer>
  );
}
