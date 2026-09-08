/**
 * P4 答题页（/quiz/:paperId）—— V2 三步闭环「考一卷」的作答页（T6，T7 接入判卷流）。
 *
 * 交互（docs §4.2 P4）：
 * - 逐题流：进度 x/y + 范围标签；← 上一题 / → 下一题；
 * - 控件按题型：选择 → 选项卡（键盘 1–4）；判断 → 对/错；问答与应用 → textarea；
 * - 草稿：每答一题自动暂存（storage.savePaperDraft），中途离开可续答；
 * - 交卷（T7 判卷流）：存最终草稿 → paper.status=grading → 跳 /quiz/:paperId/grading，
 *   判分/掌握度回写/章状态流转在该判卷页完成（5s 内可撤销）。
 *
 * 态迁移兼容：
 * - done（已有判卷结果）→ 重定向 /report/:paperId；
 * - grading（交卷后未完成判卷 / 中断恢复）→ 重定向判卷页继续；
 *   （报告页 / 判卷页见 QuizReportPage / QuizGradingPage）
 */
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Bar, Card } from "../../components/primitives";
import type { Paper, PaperAnswers, PaperQuestion } from "../../domain";
import { PAPER_MODE_LABEL } from "../../domain";
import { storage } from "../../stores/useLoopStore";

type Phase = "answering" | "confirm-submit";

export default function QuizAnswerPage() {
  const { paperId = "" } = useParams();
  const navigate = useNavigate();
  const [paper, setPaper] = useState<Paper | undefined>();
  const [context, setContext] = useState("");
  const [answers, setAnswers] = useState<PaperAnswers>({});
  const [phase, setPhase] = useState<Phase>("answering");
  const [index, setIndex] = useState(0);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 重定向目标：done → 报告；grading → 判卷页（载入后跳转）。 */
  const [redirectTo, setRedirectTo] = useState<string | undefined>();

  // 载入试卷 + 范围标签 + 草稿；按态迁移决定视图。
  useEffect(() => {
    void (async () => {
      const papers = await storage.listPapers();
      const found = papers.find((p) => p.id === paperId);
      if (!found) {
        setMissing(true);
        return;
      }
      if (found.status === "grading") {
        setRedirectTo(`/quiz/${found.id}/grading`);
        return;
      }
      if (found.status === "done") {
        const results = await storage.listPaperResults();
        const hasResult = results.some((r) => r.paperId === found.id);
        setRedirectTo(hasResult ? `/report/${found.id}` : `/quiz/${found.id}/grading`);
        return;
      }
      setPaper(found);
      setContext(await contextLabel(found));
      const draft = await storage.getPaperDraft(found.id);
      if (draft) setAnswers(draft);
    })();
  }, [paperId]);

  const q = paper?.questions[index];
  const answeredCount = paper
    ? paper.questions.filter((qq) => (answers[qq.id] ?? "").trim().length > 0).length
    : 0;
  const unansweredCount = paper ? paper.questions.length - answeredCount : 0;

  /** 写入单题答案并自动暂存草稿。 */
  const answer = useCallback(
    async (questionId: string, value: string) => {
      setAnswers((prev) => {
        const next = { ...prev, [questionId]: value };
        void storage.savePaperDraft(paperId, next);
        return next;
      });
    },
    [paperId],
  );

  // 键盘 1–4 快速选择（选择/判断题；textarea 输入时忽略）。
  useEffect(() => {
    if (!paper || !q || phase !== "answering") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      const num = parseInt(e.key, 10);
      if (!Number.isFinite(num) || num < 1 || num > 4) return;
      if (q.type === "choice" && q.options && num <= q.options.length) {
        e.preventDefault();
        void answer(q.id, String(num - 1)); // answer 存选项索引字符串
      } else if (q.type === "judge") {
        const map: Record<number, string> = { 1: "true", 2: "false" };
        if (map[num]) {
          e.preventDefault();
          void answer(q.id, map[num]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paper, q, phase, answer]);

  /**
   * 交卷：只做「提交」动作——保底草稿 + 置 grading，真正的判分/掌握度回写
   * 在判卷页统一执行（T7 判卷流，5s 撤销窗口内可回滚）。
   */
  const submit = async () => {
    if (!paper || busy) return;
    setBusy(true);
    try {
      await storage.savePaperDraft(paper.id, answers); // 保底作答快照（判卷页据此判分）
      await storage.savePaper({ ...paper, status: "grading" });
      navigate(`/quiz/${paper.id}/grading`, { replace: true });
    } finally {
      setBusy(false);
    }
  };

  if (redirectTo) return <Navigate to={redirectTo} replace />;

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-base font-semibold text-slate-900">试卷不存在</p>
        <p className="mt-1 text-sm text-slate-500">它可能已被移除。</p>
        <Link to="/quiz" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          ← 返回试卷中心
        </Link>
      </div>
    );
  }

  if (!paper || !context) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-sm text-slate-500">正在打开试卷…</p>
      </div>
    );
  }

  // —— 作答视图 ——
  const modeLabel = PAPER_MODE_LABEL[paper.scope.mode];
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      {/* 顶栏：范围标签 + 进度 */}
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link to="/quiz" className="text-xs text-slate-400 hover:text-indigo-600">
            ← 试卷中心
          </Link>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {modeLabel} · {context}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-right">
            <span className="text-sm font-semibold tabular-nums text-slate-800">
              {answeredCount}/{paper.questions.length}
            </span>
            <span className="text-xs text-slate-400"> 已答</span>
          </span>
          <button
            onClick={() => setPhase("confirm-submit")}
            disabled={answeredCount === 0}
            className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-40"
          >
            交卷
          </button>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="flex-1">
          <Bar value={answeredCount / paper.questions.length} className="bg-indigo-500" />
        </div>
        <span className="text-xs tabular-nums text-slate-400">
          第 {index + 1} / {paper.questions.length} 题
        </span>
      </div>

      {/* 题目卡 */}
      {q ? (
        <QuestionCard
          q={q}
          index={index}
          value={answers[q.id] ?? ""}
          onChange={(v) => void answer(q.id, v)}
        />
      ) : null}

      {/* 底部：上一题 / 下一题 / 交卷 */}
      <div className="sticky bottom-4 z-10 mt-6 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white/90 px-5 py-3.5 shadow-lg backdrop-blur">
        <button
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          ← 上一题
        </button>
        <p className="hidden text-xs text-slate-400 sm:block">
          {index === paper.questions.length - 1
            ? `还有 ${unansweredCount} 题未答（可返回检查）`
            : "选择/判断题可用键盘 1–4 快速作答"}
        </p>
        {index < paper.questions.length - 1 ? (
          <button
            onClick={() => setIndex((i) => i + 1)}
            disabled={!q || (answers[q.id] ?? "").trim().length === 0}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
          >
            下一题 →
          </button>
        ) : (
          <button
            onClick={() => setPhase("confirm-submit")}
            disabled={paper.questions.length === 0}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
          >
            交卷
          </button>
        )}
      </div>

      {/* 交卷二次确认（未答提示） */}
      {phase === "confirm-submit" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPhase("answering");
          }}
        >
          <Card className="w-full max-w-sm">
            <p className="text-base font-semibold text-slate-900">确认交卷？</p>
            {unansweredCount > 0 ? (
              <p className="mt-2 text-sm leading-6 text-amber-700">
                还有 {unansweredCount} 题未作答——未答的客观题将判为错误。
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">全部题目已作答，交卷后立即判分。</p>
            )}
            <p className="mt-2 text-xs leading-5 text-slate-400">
              客观题即时判定；问答/应用题待 AI 判分接入（未配置 AI 时不计入得分）。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPhase("answering")}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                再检查一下
              </button>
              <button
                onClick={() => void submit()}
                disabled={busy}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? "提交中…" : "确认交卷"}
              </button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/** 单题卡：按题型渲染控件。 */
function QuestionCard({
  q,
  index,
  value,
  onChange,
}: {
  q: PaperQuestion;
  index: number;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-[11px]">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500">
              {typeLabel(q.type)}
            </span>
            <span className="text-slate-300">难度 {q.difficulty}</span>
          </div>
          <p className="text-[15px] font-medium leading-7 text-slate-900">{q.prompt}</p>
        </div>
      </div>

      <div className="mt-4 pl-9">
        {q.type === "choice" ? (
          <div className="space-y-2">
            {(q.options ?? []).map((opt, i) => {
              const selected = value === String(i);
              return (
                <button
                  key={i}
                  onClick={() => onChange(String(i))}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition ${
                    selected
                      ? "border-indigo-400 bg-indigo-50 text-slate-900"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                      selected
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-slate-300 text-slate-400"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">{opt}</span>
                </button>
              );
            })}
            <p className="pt-1 text-[11px] text-slate-300">按键盘 1–{q.options?.length} 快速选择</p>
          </div>
        ) : q.type === "judge" ? (
          <div className="flex gap-2">
            {(
              [
                ["true", "对 ✓"],
                ["false", "错 ✗"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                onClick={() => onChange(val)}
                className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition ${
                  value === val
                    ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={5}
            placeholder={q.type === "application" ? "写出你的应用思路…" : "用你自己的话回答…"}
            className="w-full resize-y rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        )}
      </div>
    </Card>
  );
}

function typeLabel(type: PaperQuestion["type"]): string {
  switch (type) {
    case "choice":
      return "选择题";
    case "judge":
      return "判断题";
    case "qa":
      return "问答题";
    case "application":
      return "应用题";
  }
}

/** 试卷范围 → 上下文文案（如「《RAG 指南》 · 第 1–3 章」；跨文档查，命中即返回）。 */
async function contextLabel(paper: Paper): Promise<string> {
  const docs = await storage.listDocuments();
  for (const d of docs) {
    const chapters = await storage.listChapters(d.id);
    const hit = chapters
      .filter((c) => paper.scope.chapterIds.includes(c.id))
      .sort((a, b) => a.order - b.order);
    if (hit.length > 0) {
      const first = hit[0].order;
      const last = hit[hit.length - 1].order;
      const range = first === last ? `第 ${first} 章` : `第 ${first}–${last} 章`;
      return `${d.title} · ${range}`;
    }
  }
  return "资料已移除";
}
