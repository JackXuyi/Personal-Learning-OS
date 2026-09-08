/**
 * P5 判卷流（/quiz/:paperId/grading）—— V2 三步闭环「判卷」过渡页（T7 + T12）。
 *
 * 职责：交卷后在此统一执行判分闭环（幂等，可重入）：
 *   1. 载入作答快照（草稿保底）→ gradeAndApply：客观题本地判分 + 章掌握度
 *      平滑回写（0.65×卷面 + 0.35×历史）+ nextReviewAt；
 *   2. N3 主观题 AI 批改（双证据）：Provider 就绪且卷含主观题时，已作答的逐题调
 *      AI 批改（0-1 得分 + 批语 + 定位要点），结果 merge 回 PaperResult——低于 0.6
 *      的作答并入错题回顾（aiFeedback / point），全部已作答题拿到 AI 分后卷面
 *      totalScore 并入主观分（未作答主观题按确定性 0 分并入）；失败/未配置 →
 *      保留 pending，不伪造判分（P0-3），报告页可「重试 AI 批改」（N3b）。
 *      掌握度回写仍只吃客观确定性证据（双证据：卷面展示口径 ≠ 掌握度回写口径）；
 *   3. 写 learnerState / PaperResult / paper.status=done，并按 statusAfterExam
 *      回写章状态机（mastered / retake 流转，T7 编排收口）；
 *   4. 展示逐题对错 + 总分 → 5 秒撤销窗口（回滚 learner + result + paper），
 *      到期自动清草稿并进入 /report/:paperId。
 *
 * 幂等约定：已存在判卷结果（中断后重入 / 已完成回访）→ 直接跳报告，不重复回写；
 * paper 已完成但结果缺失（异常修复）→ 允许基于现存草稿重新判分一次。
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Card } from "../../components/primitives";
import type {
  Chapter,
  LearnerState,
  Paper,
  PaperAnswers,
  PaperQuestion,
  PaperResult,
} from "../../domain";
import { isSubjectiveType, MASTERY_FLOOR, MASTERY_THRESHOLD } from "../../domain";
import { statusAfterExam } from "../../domain";
import type { GradedPaper } from "../../engine";
import { gradeAndApply, mergeSubjectiveGrades, SUBJECTIVE_PASS } from "../../engine";
import { gradeSubjectiveWithAi } from "../../ai";
import type { SubjectiveGradeItem } from "../../ai";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { storage } from "../../stores/useLoopStore";

/** 撤销窗口（毫秒；与 useLoopStore.UNDO_WINDOW_MS 语义一致）。 */
const UNDO_MS = 5_000;

type Phase = "loading" | "summary" | "error";

/** 主观题 AI 批改阶段（T12）。 */
type AiPhase = "idle" | "grading" | "done" | "failed";

export default function QuizGradingPage() {
  const { paperId = "" } = useParams();
  const navigate = useNavigate();

  const [paper, setPaper] = useState<Paper | undefined>();
  const [result, setResult] = useState<PaperResult | undefined>();
  const [graded, setGraded] = useState<GradedPaper | undefined>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  const [missing, setMissing] = useState(false);
  const [left, setLeft] = useState(5); // 撤销倒计时（秒）
  /** 主观题 AI 批改阶段（T12；only meaningful when paper has subjective）。 */
  const [aiPhase, setAiPhase] = useState<AiPhase>("idle");

  // 判分只执行一次（React StrictMode 双调 effect 防护 + 换卷重置）。
  const gradedFor = useRef<string | undefined>(undefined);
  /** 判分前快照（撤销回滚用）。 */
  const snapshotRef = useRef<{ learner: LearnerState } | undefined>(undefined);
  /** 判分前的 open 态试卷原样（撤销时恢复）。 */
  const originalRef = useRef<Paper | undefined>(undefined);
  const leftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const finishingRef = useRef(false);

  // 撤销窗口倒计时：归零 → 清草稿并自动进入报告。
  useEffect(() => {
    if (phase !== "summary") return;
    if (left <= 0) {
      void finish();
      return;
    }
    leftTimer.current = setTimeout(() => setLeft((v) => v - 1), 1_000);
    return () => clearTimeout(leftTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, left]);

  useEffect(() => {
    if (gradedFor.current === paperId) return;
    gradedFor.current = paperId;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  async function run() {
    const papers = await storage.listPapers();
    const found = papers.find((p) => p.id === paperId);
    if (!found) {
      setMissing(true);
      return;
    }
    setPaper(found);

    const results = await storage.listPaperResults();
    if (results.some((r) => r.paperId === found.id)) {
      // 已完成（中断后重入 / 结果已落库）→ 直接进报告，绝不重复回写。
      navigate(`/report/${found.id}`, { replace: true });
      return;
    }
    if (found.status === "open" && !(await storage.getPaperDraft(found.id))) {
      setMessage("这张卷还没有作答记录，无法判分。");
      setPhase("error");
      return;
    }

    const answers = (await storage.getPaperDraft(found.id)) ?? {};
    const learner = await storage.getLearnerState();
    const { result: r, learnerState: nextState, graded: g } = gradeAndApply({
      paper: found,
      answers,
      learnerState: learner,
    });

    // 快照（撤销窗口内可完整回滚；AI 批改并入的 result 一并回滚）。
    snapshotRef.current = { learner };
    originalRef.current = { ...found, status: "open" };

    // N3 主观题 AI 批改 → 批语回填 + 卷面并入（双证据：掌握度仍只吃客观确定性证据）。
    // Provider 就绪且卷含主观题时：已作答的走 AI 批改（失败保留 pending，报告页
    // 可重试）；未作答的按确定性 0 分并入（无需 AI）。未配置 → 全卷保持 pending，
    // 不伪造判分（P0-3）。
    let finalResult = r;
    const provider = buildActiveProvider();
    const subjectiveQs = found.questions.filter((q) => isSubjectiveType(q.type));
    if (subjectiveQs.length > 0 && provider.isConfigured()) {
      const attempts = subjectiveQs.filter((q) => (answers[q.id] ?? "").trim().length > 0);
      if (attempts.length > 0) {
        setAiPhase("grading");
        try {
          const items = await buildGradeItems(attempts, answers);
          const grades = await gradeSubjectiveWithAi(provider, items);
          finalResult = mergeSubjectiveGrades({ result: r, paper: found, answers, aiGrades: grades });
          setAiPhase(grades.length > 0 ? "done" : "failed");
        } catch (err) {
          console.warn("主观题 AI 批改失败，暂按客观计分（报告页可重试）：", err);
          // 失败也落主观作答快照 + 未作答 0 分，供报告页「重试 AI 批改」补齐。
          finalResult = mergeSubjectiveGrades({ result: r, paper: found, answers, aiGrades: [] });
          setAiPhase("failed");
        }
      } else {
        // 卷含主观但全部未作答：确定性 0 分并入（无需 AI，进分母惩罚）。
        finalResult = mergeSubjectiveGrades({ result: r, paper: found, answers, aiGrades: [] });
        setAiPhase("done");
      }
    }

    // 持久化：结果 → 试卷状态 → 章状态机（顺序无关紧要，但都须成功）。
    await storage.savePaperResult(finalResult);
    await storage.savePaper({ ...found, status: "done", submittedAt: finalResult.createdAt });
    await storage.saveLearnerState(nextState);
    await syncChapterStatus(finalResult);

    setResult(finalResult);
    setGraded(g);
    setLeft(Math.ceil(UNDO_MS / 1_000));
    setPhase("summary");
  }

  /** 判卷完成后清空草稿并进入报告（撤销窗口结束后调用）。 */
  async function finish() {
    if (!paper || finishingRef.current) return;
    finishingRef.current = true;
    await storage.savePaperDraft(paper.id, {});
    navigate(`/report/${paper.id}`, { replace: true });
  }

  /** 5s 窗口内撤销：回滚掌握度与结果，试卷回到 open，保留草稿以便续改。 */
  async function undo() {
    if (!paper) return;
    const snap = snapshotRef.current;
    const original = originalRef.current;
    if (!snap || !original) return;
    await storage.saveLearnerState(snap.learner);
    await storage.deletePaperResult(paper.id);
    await storage.savePaper(original);
    navigate(`/quiz/${paper.id}`, { replace: true });
  }

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-base font-semibold text-slate-900">试卷不存在</p>
        <Link to="/quiz" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          ← 返回试卷中心
        </Link>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-base font-semibold text-slate-900">无法判分</p>
        <p className="mt-1 text-sm text-slate-500">{message}</p>
        <Link to="/quiz" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          ← 返回试卷中心
        </Link>
      </div>
    );
  }

  if (phase === "loading" || !paper || !graded || !result) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-sm text-slate-500">
          {aiPhase === "grading" ? "正在 AI 批改主观题…" : "正在判分…"}
        </p>
        <p className="mt-2 text-xs text-slate-400">
          {aiPhase === "grading"
            ? "客观题即时判定 · 主观题逐题 AI 批改（首次约需数秒）"
            : "客观题即时判定 · 掌握度平滑回写中"}
        </p>
      </div>
    );
  }

  const score = Math.round(result.totalScore * 100);
  const passed = result.totalScore >= MASTERY_THRESHOLD;
  const near = result.totalScore >= MASTERY_FLOOR;
  const wrongCount = result.wrongQuestions.length;
  const subjectiveQs = paper.questions.filter((q) => isSubjectiveType(q.type));
  const subjectiveCount = subjectiveQs.length;
  // 已得分主观题（AI 批改分 + 未作答确定性 0 分）；pending = 已作答但缺 AI 分。
  const subScores = result.subjectiveScores ?? {};
  const scoredCount = subjectiveQs.filter((q) => q.id in subScores).length;
  const pendingSubjective = Math.max(0, subjectiveCount - scoredCount);

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <Link to="/quiz" className="text-xs text-slate-400 hover:text-indigo-600">
        ← 试卷中心
      </Link>

      {/* 逐题对错（客观 ✓ / 客观 ✗ / 主观待 AI） */}
      <Card className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-800">判卷结果</p>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> 正确
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400" /> 错误
            </span>
            {pendingSubjective > 0 ? (
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" /> 待 AI 批改
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {paper.questions.map((q, i) => {
            const g = graded.questions.find((x) => x.questionId === q.id);
            if (g?.correct !== undefined) {
              // 客观题：本地即时判定。
              return (
                <div
                  key={q.id}
                  title={`${i + 1}. ${q.prompt}`}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold ${
                    g.correct ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-500"
                  }`}
                >
                  {g.correct ? "✓" : "✗"}
                </div>
              );
            }
            // 主观题：有确定得分（AI 批改 / 未作答 0 分）→ 按 0.6 通过线显示对错；
            // 否则待 AI（灰 = pending，报告页可重试）。
            const sc = subScores[q.id];
            const scPass = sc !== undefined && sc >= SUBJECTIVE_PASS;
            const unanswered = sc === 0 && !(result.subjectiveAnswers?.[q.id] ?? "").trim();
            const detail =
              sc === undefined
                ? "待 AI 批改"
                : `得分 ${Math.round(sc * 100)}${unanswered ? "（未作答）" : "（AI 批改）"}`;
            return (
              <div
                key={q.id}
                title={`${i + 1}. ${q.prompt} · ${detail}`}
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold ${
                  sc === undefined
                    ? "bg-slate-100 text-slate-400"
                    : scPass
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-500"
                }`}
              >
                {sc === undefined ? "AI" : scPass ? "✓" : "✗"}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          选择/判断题本地即时判定
          {subjectiveCount > 0
            ? pendingSubjective > 0
              ? aiPhase === "failed"
                ? `；${pendingSubjective} 道主观题批改失败——暂按客观计分，可在报告页重试`
                : `；${pendingSubjective} 道主观题待 AI 批改（未计入卷面）`
              : scoredCount > 0
                ? `；${scoredCount} 道主观题 AI 批改已并入卷面`
                : ""
            : ""}
          {wrongCount > 0 ? `；错 ${wrongCount} 题` : ""}
        </p>
      </Card>

      {/* 结果卡 + 撤销窗口 */}
      <Card className="mt-4 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">卷面得分</p>
        <p
          className={`mt-2 text-5xl font-bold tabular-nums ${
            passed ? "text-emerald-600" : near ? "text-amber-600" : "text-red-500"
          }`}
        >
          {score}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          满分 100 · 达标 {Math.round(MASTERY_THRESHOLD * 100)} · 掌握度按客观题证据回写
          {scoredCount > 0 && pendingSubjective === 0 ? " · 主观分已并入卷面" : ""}
        </p>

        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            onClick={() => void undo()}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            撤销判分（{left}s）
          </button>
          <button
            onClick={() => void finish()}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            查看报告 →
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          {left > 0
            ? "撤销可回滚掌握度与成绩（回到答题页续改）"
            : "即将自动进入报告…（撤销窗口已结束）"}
        </p>
      </Card>
    </div>
  );
}

/**
 * 组装主观题批改输入（附章上下文要点，供 AI 定位批语；T12）。
 * 调用方已保证只传「有作答文本」的主观题。
 */
async function buildGradeItems(
  questions: PaperQuestion[],
  answers: PaperAnswers,
): Promise<SubjectiveGradeItem[]> {
  const docs = await storage.listDocuments();
  const chapterById = new Map<string, Chapter>();
  for (const doc of docs) {
    for (const ch of await storage.listChapters(doc.id)) {
      chapterById.set(ch.id, ch);
    }
  }
  return questions.map((q, i) => {
    const c = chapterById.get(q.chapterId);
    return {
      questionId: q.id,
      label: `q${i + 1}`,
      chapterTitle: c?.title ?? "",
      keyPoints: c?.keyPoints ?? [],
      prompt: q.prompt,
      referenceAnswer: q.referenceAnswer,
      answerText: (answers[q.id] ?? "").trim(),
    };
  });
}

/**
 * 卷面判分后回写章状态机（T7 编排收口；chapter-badge 注释预期的写回点）。
 * 只处理有客观证据（result.perChapter 有键）的章；规则见 domain/chapter.ts statusAfterExam。
 */
async function syncChapterStatus(result: PaperResult): Promise<void> {
  const docs = await storage.listDocuments();
  for (const doc of docs) {
    const chapters = await storage.listChapters(doc.id);
    let changed = false;
    const next = chapters.map((c) => {
      const per = result.perChapter[c.id];
      if (!per) return c;
      const s = statusAfterExam(c.status, per.mastery);
      if (s !== c.status) {
        changed = true;
        return { ...c, status: s };
      }
      return c;
    });
    if (changed) await storage.saveChapters(doc.id, next);
  }
}
