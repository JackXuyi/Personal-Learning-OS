/**
 * P4 答题页（/quiz/:paperId）—— V2 三步闭环「考一卷」的作答页（T6）。
 *
 * 交互（docs §4.2 P4）：
 * - 逐题流：进度 x/y + 范围标签；← 上一题 / → 下一题；
 * - 控件按题型：选择 → 选项卡（键盘 1–4）；判断 → 对/错；问答与应用 → textarea
 *   （T6 卷内无主观题，AI 判分 T7 接入后恢复）；
 * - 草稿：每答一题自动暂存（storage.savePaperDraft），中途离开可续答；
 * - 交卷：未答二次确认 → gradeAndApply 客观判分 + 章掌握度平滑回写 →
 *   落 PaperResult + paper.status=done → 内嵌结果摘要（总分/错题/逐章前后掌握度）。
 *
 * done 态再次打开（从试卷中心「查看结果」）→ 展示同一份结果摘要；
 * 独立 /report 报告页（P6）属 T7，届时结果摘要升级为完整报告入口。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Bar, Card } from "../../components/primitives";
import { MASTERY_THRESHOLD } from "../../domain";
import type { Paper, PaperAnswers, PaperQuestion, PaperResult } from "../../domain";
import { PAPER_MODE_LABEL } from "../../domain";
import { gradeAndApply } from "../../engine";
import { storage } from "../../stores/useLoopStore";
import { scopeLabel } from "./meta";

type Phase = "answering" | "confirm-submit" | "done";

export default function QuizAnswerPage() {
  const { paperId = "" } = useParams();
  const [paper, setPaper] = useState<Paper | undefined>();
  const [context, setContext] = useState<string>("");
  const [chapterTitles, setChapterTitles] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<PaperAnswers>({});
  const [result, setResult] = useState<PaperResult | undefined>();
  const [phase, setPhase] = useState<Phase>("answering");
  const [index, setIndex] = useState(0);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  // 载入试卷 + 章标题表 + 草稿 + 既有结果（done 卷直接展示）。
  useEffect(() => {
    void (async () => {
      const papers = await storage.listPapers();
      const found = papers.find((p) => p.id === paperId);
      if (!found) {
        setMissing(true);
        return;
      }
      setPaper(found);
      const { context: ctx, titles } = await contextOf(found);
      setContext(ctx);
      setChapterTitles(titles);

      const [draft, results] = await Promise.all([
        storage.getPaperDraft(found.id),
        storage.listPaperResults(),
      ]);
      const prevResult = results.find((r) => r.paperId === found.id);
      if (found.status === "done" && prevResult) {
        setResult(prevResult);
        setPhase("done");
      } else if (draft) {
        setAnswers(draft);
      }
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

  /** 交卷：客观判分 + 掌握度回写 + 结果落库。 */
  const submit = async () => {
    if (!paper || busy) return;
    setBusy(true);
    try {
      const learnerState = await storage.getLearnerState();
      const { result: r, learnerState: nextState } = gradeAndApply({
        paper,
        answers,
        learnerState,
      });
      await storage.saveLearnerState(nextState);
      await storage.savePaper({ ...paper, status: "done", submittedAt: r.createdAt });
      await storage.savePaperResult(r);
      await storage.savePaperDraft(paper.id, {}); // 清草稿
      setResult(r);
      setPhase("done");
    } finally {
      setBusy(false);
    }
  };

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

  if (phase === "done") {
    return result ? (
      <ResultView result={result} chapterTitles={chapterTitles} />
    ) : (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-sm text-slate-500">正在加载结果…</p>
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
              <p className="mt-2 text-sm text-slate-500">
                全部题目已作答，交卷后立即判分并更新章节掌握度。
              </p>
            )}
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
                {busy ? "判分中…" : "确认交卷"}
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

/** 判卷结果摘要（done 态；T7 升级为独立 /report 报告页）。 */
function ResultView({
  result,
  chapterTitles,
}: {
  result: PaperResult;
  chapterTitles: Record<string, string>;
}) {
  const score = Math.round(result.totalScore * 100);
  const passed = score >= 80;
  const wrongCount = result.wrongQuestions.length;
  const chapterIds = Object.keys(result.perChapter);
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <Link to="/quiz" className="text-xs text-slate-400 hover:text-indigo-600">
        ← 试卷中心
      </Link>

      {/* 总分 */}
      <Card className="mt-4 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">卷面得分</p>
        <p
          className={`mt-2 text-5xl font-bold tabular-nums ${
            passed ? "text-emerald-600" : score >= 60 ? "text-amber-600" : "text-red-500"
          }`}
        >
          {score}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          满分 100 · 达标 {Math.round(MASTERY_THRESHOLD * 100)}
        </p>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          {passed
            ? "已达标——掌握度按「0.65×卷面 + 0.35×历史」平滑更新。"
            : score >= 60
              ? "接近达标——建议复习错题要点后补考（报告页将提供补考入口）。"
              : "未达标——建议重读薄弱章节后再测。"}
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-50 px-4 py-1.5 text-xs text-slate-500">
          客观题错 {wrongCount} 题 · 掌握度已回写（0.65 卷面 + 0.35 历史）
        </div>
      </Card>

      {/* 逐章前后掌握度 */}
      {chapterIds.length > 0 ? (
        <Card className="mt-4">
          <p className="text-sm font-semibold text-slate-800">章节掌握度变化</p>
          <div className="mt-3 space-y-3">
            {chapterIds.map((chapterId) => {
              const ch = result.perChapter[chapterId];
              const delta = Math.round((ch.mastery - ch.previousMastery) * 100);
              return (
                <div key={chapterId}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      {chapterTitles[chapterId] ?? chapterId}
                    </span>
                    <span className="tabular-nums text-slate-600">
                      {Math.round(ch.previousMastery * 100)}% → {Math.round(ch.mastery * 100)}%
                      <span
                        className={`ml-1.5 font-medium ${delta >= 0 ? "text-emerald-600" : "text-red-500"}`}
                      >
                        {delta >= 0 ? `+${delta}` : delta}
                      </span>
                    </span>
                  </div>
                  <Bar value={ch.mastery} target={MASTERY_THRESHOLD} targetLabel="达标线" />
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <div className="mt-6 flex justify-center">
        <Link
          to="/quiz"
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          返回试卷中心
        </Link>
      </div>
    </div>
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

/** 试卷范围 → 上下文文案 + 章标题表（跨文档查，一次遍历完成）。 */
async function contextOf(paper: Paper): Promise<{
  context: string;
  titles: Record<string, string>;
}> {
  const docs = await storage.listDocuments();
  const titles: Record<string, string> = {};
  for (const d of docs) {
    const chapters = await storage.listChapters(d.id);
    const hit = chapters.filter((c) => paper.scope.chapterIds.includes(c.id));
    for (const c of hit) titles[c.id] = c.title || `第 ${c.order} 章`;
    if (hit.length > 0) {
      return { context: `${d.title} · ${scopeLabel(paper.scope, hit)}`, titles };
    }
  }
  return { context: "资料已移除", titles };
}
