/**
 * P6 报告页（/report/:paperId）—— V2 三步闭环「判卷 → 学习计划」的输出页（T7）。
 *
 * 内容（docs §4.2 P6）：
 * - 总分 + 档位（达标 / 接近 / 未达标）+ 卷面元信息（题量 / 客观错题 / 时间）；
 * - 逐章掌握度：前后对比 + DeltaBadge（Δ 与下次复习间隔）+ 未达及格线的章内嵌
 *   「补考本章」（单章 retake 卷，降一档难度）；
 * - 错题回顾：题目 / 你的作答 / 参考答案 / AI 批语槽（客观题本地判定，
 *   主观题批语待 AI 判分接入后回填，P0-3 不伪造）+ 薄弱要点；
 * - 主行动「生成学习计划」：buildChapterPlan（重学 > 补考 > 复习要点 > 推进）
 *   内联展开，每项带 reasons 与直达入口（重读 / 测验 / 生成补考卷）；
 * - 总分卡「补考 N 个弱章」（T10 · 仅错题章范围）：所有弱章合成一张补考卷
 *   （engine.createRetakePaper，跨文档分组出卷，每章客观 3 · 降一档）。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bar, Card } from "../../components/primitives";
import { DeltaBadge } from "../../components/DeltaBadge";
import {
  isSubjectiveType,
  MASTERY_FLOOR,
  MASTERY_THRESHOLD,
  PAPER_MODE_LABEL,
  sortChaptersByOrder,
} from "../../domain";
import type { Chapter, LearnerState, NextAction, Paper, PaperQuestion, PaperResult } from "../../domain";
import { buildChapterPlan, createRetakePaper, mergeSubjectiveGrades, reviewIntervalDaysForScore } from "../../engine";
import { gradeSubjectiveWithAi } from "../../ai";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { makeRetakePaper } from "../plan/chapter-action";
import { storage } from "../../stores/useLoopStore";
import { actionKindLabel } from "../units";
import { ago, typeBadgeText } from "./meta";

interface ChapterRef {
  chapter: Chapter;
  docTitle: string;
}

interface ReportData {
  paper: Paper;
  result: PaperResult;
  /** chapterId → {chapter, docTitle}（跨文档一次建索引）。 */
  index: Map<string, ChapterRef>;
  /** docId → 章列表（补考卷干扰项源）。 */
  docChapters: Map<string, Chapter[]>;
  /** 范围内章（order 排序，掌握度/计划都按此展示）。 */
  scopeChapters: Chapter[];
  learner: LearnerState;
}

interface ChapterRow {
  chapter: Chapter;
  entry: { score: number; previousMastery: number; mastery: number };
}

interface WrongRow {
  w: PaperResult["wrongQuestions"][number];
  q: PaperQuestion;
}

const KIND_CHIP: Record<string, string> = {
  "learn-chapter": "border-red-200 bg-red-50 text-red-600",
  "retake-quiz": "border-amber-200 bg-amber-50 text-amber-700",
  "review-points": "border-sky-200 bg-sky-50 text-sky-700",
  "chapter-quiz": "border-indigo-200 bg-indigo-50 text-indigo-700",
};

export default function QuizReportPage() {
  const { paperId = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ReportData | undefined>();
  const [missing, setMissing] = useState(false);
  const [noResult, setNoResult] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [plan, setPlan] = useState<NextAction[] | undefined>();
  const [retaking, setRetaking] = useState<string | undefined>();
  /** 主观题 AI 重试批改中（N3b）。 */
  const [aiRetrying, setAiRetrying] = useState(false);
  /** 主观题批改状态行文案（N3b）。 */
  const [aiMsg, setAiMsg] = useState("");

  useEffect(() => {
    void (async () => {
      const [papers, results, learner, docs] = await Promise.all([
        storage.listPapers(),
        storage.listPaperResults(),
        storage.getLearnerState(),
        storage.listDocuments(),
      ]);
      const paper = papers.find((p) => p.id === paperId);
      if (!paper) {
        setMissing(true);
        return;
      }
      const result = results.find((r) => r.paperId === paperId);
      if (!result) {
        setNoResult(true);
        return;
      }

      const index = new Map<string, ChapterRef>();
      const docChapters = new Map<string, Chapter[]>();
      for (const doc of docs) {
        const chapters = await storage.listChapters(doc.id);
        docChapters.set(doc.id, chapters);
        for (const chapter of chapters) {
          index.set(chapter.id, { chapter, docTitle: doc.title });
        }
      }
      const scopeChapters = sortChaptersByOrder(
        paper.scope.chapterIds
          .map((id) => index.get(id)?.chapter)
          .filter((c): c is Chapter => Boolean(c)),
      );
      setData({ paper, result, index, docChapters, scopeChapters, learner });
    })();
  }, [paperId]);

  /** 打开/切换「生成学习计划」；首次打开时由 buildChapterPlan 计算（数据已就绪，同步）。 */
  const togglePlan = () => {
    setPlanOpen((open) => !open);
    if (!planOpen && !plan && data) {
      setPlan(buildChapterPlan({ chapters: data.scopeChapters, learnerState: data.learner }));
    }
  };

  /** 对单章生成补考卷（retake：客观 3 · 降一档）并进入作答。 */
  const startRetake = async (chapter: Chapter) => {
    if (!data || retaking) return;
    setRetaking(chapter.id);
    try {
      const allChapters = data.docChapters.get(chapter.documentId) ?? [chapter];
      const paper = makeRetakePaper(chapter, allChapters, data.learner);
      await storage.savePaper(paper);
      navigate(`/quiz/${paper.id}`);
    } finally {
      setRetaking(undefined);
    }
  };

  /** 聚合补考（T10 · 仅错题章范围）：所有弱章合成一张补考卷（跨文档自动分组）。 */
  const startRetakeAll = async () => {
    if (!data || weakChapters.length === 0 || retaking) return;
    setRetaking("*");
    try {
      const paper = createRetakePaper({
        chapters: weakChapters.map((r) => r.chapter),
        docChapters: data.docChapters,
        learnerState: data.learner,
      });
      await storage.savePaper(paper);
      navigate(`/quiz/${paper.id}`);
    } finally {
      setRetaking(undefined);
    }
  };

  /**
   * N3b 重试批改：对 pending 主观题（已作答但缺 AI 分）重新调用 AI 批改并并入卷面。
   * 数据源 = PaperResult.subjectiveAnswers 快照（判卷后草稿已清，作答保存在结果里）。
   * 幂等：mergeSubjectiveGrades 重算 totalScore / 追加错题去重；掌握度不二次回写
   * （双证据——回写只发生在判卷时的客观证据路径）。
   */
  const retrySubjectiveGrading = async () => {
    if (!data || aiRetrying) return;
    const { result, paper, index } = data;
    const subAnswers = result.subjectiveAnswers ?? {};
    const subScores = result.subjectiveScores ?? {};
    const pending = paper.questions.filter(
      (q) =>
        isSubjectiveType(q.type) &&
        !(q.id in subScores) &&
        (subAnswers[q.id] ?? "").trim().length > 0,
    );
    if (pending.length === 0) return;
    const provider = buildActiveProvider();
    if (!provider.isConfigured()) {
      setAiMsg("未配置 AI 判分——请先到「设置 → AI 模型中心」配置判分模型。");
      return;
    }
    setAiRetrying(true);
    setAiMsg("");
    try {
      const items = pending.map((q, i) => {
        const c = index.get(q.chapterId)?.chapter;
        return {
          questionId: q.id,
          label: `q${i + 1}`,
          chapterTitle: c?.title ?? "",
          keyPoints: c?.keyPoints ?? [],
          prompt: q.prompt,
          referenceAnswer: q.referenceAnswer,
          answerText: subAnswers[q.id] ?? "",
        };
      });
      const grades = await gradeSubjectiveWithAi(provider, items);
      if (grades.length === 0) {
        setAiMsg("AI 未返回批改结果，请稍后重试。");
        return;
      }
      const merged = mergeSubjectiveGrades({ result, paper, answers: subAnswers, aiGrades: grades });
      await storage.savePaperResult(merged);
      setData({ ...data, result: merged });
      setAiMsg(`已批改 ${grades.length} 道主观题并并入卷面，总分已更新。`);
    } catch (err) {
      console.warn("主观题重试批改失败：", err);
      setAiMsg("批改失败：模型暂不可用，请稍后重试。");
    } finally {
      setAiRetrying(false);
    }
  };

  /** 计划动作 → 可执行入口（重读/复习 → 阅读页；测验 → 出卷直达；补考 → 生成卷）。 */
  const goAction = (action: NextAction) => {
    const chapter = data?.scopeChapters.find((c) => c.id === action.unitId);
    if (action.kind === "chapter-quiz") {
      navigate(
        `/quiz/new?doc=${chapter?.documentId ?? ""}&chapters=${action.unitId}&mode=unit-test`,
      );
      return;
    }
    if (action.kind === "retake-quiz") {
      if (chapter) void startRetake(chapter);
      return;
    }
    navigate(`/learn/${action.unitId}`);
  };

  // 逐章（按 order）：只列有卷面证据（result.perChapter 键）的章。
  const perChapterRows = useMemo<ChapterRow[]>(() => {
    if (!data) return [];
    return data.scopeChapters.flatMap((chapter) => {
      const entry = data.result.perChapter[chapter.id];
      return entry ? [{ chapter, entry }] : [];
    });
  }, [data]);

  // 弱章：掌握度 < 及格线（报告提示补考入口）。
  const weakChapters = useMemo(
    () =>
      perChapterRows
        .filter((r) => r.entry.mastery < MASTERY_FLOOR)
        .sort((a, b) => a.entry.mastery - b.entry.mastery),
    [perChapterRows],
  );

  // 错题回顾行（join paper.questions；找不到题目时跳过）。
  const wrongRows = useMemo<WrongRow[]>(() => {
    if (!data) return [];
    return data.result.wrongQuestions.flatMap((w) => {
      const q = data.paper.questions.find((qq) => qq.id === w.questionId);
      return q ? [{ w, q }] : [];
    });
  }, [data]);

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

  if (noResult) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-base font-semibold text-slate-900">暂无判卷记录</p>
        <p className="mt-1 text-sm text-slate-500">这份试卷还没有判分结果，请先完成作答。</p>
        <Link to="/quiz" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          ← 返回试卷中心
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-sm text-slate-500">正在打开报告…</p>
      </div>
    );
  }

  const { paper, result, index, scopeChapters } = data;
  const score = Math.round(result.totalScore * 100);
  const passed = score >= Math.round(MASTERY_THRESHOLD * 100);
  const near = score >= Math.round(MASTERY_FLOOR * 100);
  const wrongCount = result.wrongQuestions.length;

  // 主观题批改状态（N3 双证据：totalScore 已并入 AI 主观分；掌握度仍客观口径）。
  const subjectiveQs = paper.questions.filter((q) => isSubjectiveType(q.type));
  const subjectiveCount = subjectiveQs.length;
  const subScores = result.subjectiveScores ?? {};
  const scoredCount = subjectiveQs.filter((q) => q.id in subScores).length;
  const pendingSubjective = Math.max(0, subjectiveCount - scoredCount);
  // 可重试 = 存在「已作答（有快照）但缺 AI 分」的主观题。
  const retryable =
    pendingSubjective > 0 &&
    subjectiveQs.some(
      (q) => !(q.id in subScores) && (result.subjectiveAnswers?.[q.id] ?? "").trim().length > 0,
    );

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      {/* 顶栏 */}
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link to="/quiz" className="text-xs text-slate-400 hover:text-indigo-600">
            ← 试卷中心
          </Link>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {PAPER_MODE_LABEL[paper.scope.mode]} · {contextTitle(scopeChapters)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
          {ago(result.createdAt)}交卷
        </span>
      </div>

      {/* 总分卡 */}
      <Card className="text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">卷面得分</p>
        <p
          className={`mt-2 text-6xl font-bold tabular-nums ${
            passed ? "text-emerald-600" : near ? "text-amber-600" : "text-red-500"
          }`}
        >
          {score}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {passed
            ? "已达标 —— 本章节可直接进入综合测或下一章。"
            : near
              ? "接近达标 —— 复习错题要点后即可冲击达标线。"
              : "未达标 —— 建议补考或重读薄弱章节。"}
        </p>
        <p className="mt-3 text-xs text-slate-400">
          {paper.questions.length} 题 · 客观题错 {wrongCount} 题 · 达标{" "}
          {Math.round(MASTERY_THRESHOLD * 100)} / 及格 {Math.round(MASTERY_FLOOR * 100)} · 掌握度按
          客观题证据回写
        </p>

        {/* 主观题批改状态（N3）：全批 → 并入提示；有 pending → 状态行 + 重试入口 */}
        {subjectiveCount > 0 ? (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-xs">
            {pendingSubjective > 0 ? (
              <>
                <span className="font-medium text-amber-600">
                  还有 {pendingSubjective} 道主观题待 AI 批改 · 卷面暂按客观计分
                </span>
                {retryable ? (
                  buildActiveProvider().isConfigured() ? (
                    <button
                      onClick={() => void retrySubjectiveGrading()}
                      disabled={aiRetrying}
                      className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                    >
                      {aiRetrying ? "批改中…" : "重试 AI 批改"}
                    </button>
                  ) : (
                    <Link to="/settings" className="text-indigo-600 hover:underline">
                      去配置 AI →
                    </Link>
                  )
                ) : (
                  <span className="text-slate-400">（判卷时未保留作答副本，无法补批）</span>
                )}
              </>
            ) : scoredCount > 0 ? (
              <span className="font-medium text-emerald-600">
                卷面已并入 {scoredCount} 道主观题（AI 批改）
              </span>
            ) : (
              <span className="text-slate-400">本卷主观题判分时 AI 不可用，未计入卷面</span>
            )}
          </div>
        ) : null}
        {aiMsg ? <p className="mt-2 text-xs text-slate-500">{aiMsg}</p> : null}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={togglePlan}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            {planOpen ? "收起学习计划" : "生成学习计划"}
          </button>
          {weakChapters.length > 0 ? (
            <button
              onClick={() => void startRetakeAll()}
              disabled={Boolean(retaking)}
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              {retaking ? "生成中…" : `补考 ${weakChapters.length} 个弱章 →`}
            </button>
          ) : null}
        </div>
      </Card>

      {/* 学习计划（内联展开） */}
      {planOpen ? (
        <Card className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-800">学习计划 · 优先做这些</p>
            <span className="text-xs text-slate-400">由本卷报告驱动（仅覆盖本卷范围章）</span>
          </div>
          {plan === undefined ? (
            <p className="mt-3 text-sm text-slate-400">生成中…</p>
          ) : plan.length === 0 ? (
            <p className="mt-3 text-sm text-emerald-700">
              🎉 本卷范围内所有章节均已达标——可推进新章节或直接综合测。
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {plan.map((action, i) => {
                const chapter = scopeChapters.find((c) => c.id === action.unitId);
                const chip = KIND_CHIP[action.kind] ?? "border-slate-200 bg-slate-100 text-slate-600";
                return (
                  <div
                    key={action.id}
                    className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${chip}`}
                        >
                          {actionKindLabel(action.kind)}
                        </span>
                        <span className="text-sm font-medium text-slate-800">
                          {chapter ? `${chapter.order}. ${chapter.title}` : action.unitId}
                        </span>
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {action.reasons.map((r, ri) => (
                          <li key={ri} className="text-xs leading-5 text-slate-500">
                            · {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <button
                      onClick={() => goAction(action)}
                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      {action.kind === "chapter-quiz"
                        ? "去测验 →"
                        : action.kind === "retake-quiz"
                          ? "生成补考卷 →"
                          : action.kind === "learn-chapter"
                            ? "去重读 →"
                            : "去复习 →"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}

      {/* 逐章掌握度 */}
      <Card className="mt-4">
        <p className="text-sm font-semibold text-slate-800">逐章掌握度</p>
        <p className="mt-0.5 text-xs text-slate-400">卷面后回写 · 对比测验前</p>
        {perChapterRows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">本卷没有客观题证据，暂不更新掌握度。</p>
        ) : (
          <div className="mt-4 space-y-4">
            {perChapterRows.map(({ chapter, entry }) => {
              const chRef = index.get(chapter.id);
              const delta = entry.mastery - entry.previousMastery;
              const weak = entry.mastery < MASTERY_FLOOR;
              return (
                <div key={chapter.id}>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="text-xs text-slate-500">
                      {chRef ? `${chRef.docTitle} · ` : ""}
                      {chapter.order}. {chapter.title}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <DeltaBadge
                        delta={delta}
                        nextReviewInDays={reviewIntervalDaysForScore(entry.score)}
                      />
                      <span className="text-xs tabular-nums text-slate-500">
                        {Math.round(entry.previousMastery * 100)}% →{" "}
                        <b className="text-slate-800">{Math.round(entry.mastery * 100)}%</b>
                      </span>
                      {weak ? (
                        <button
                          onClick={() => void startRetake(chapter)}
                          disabled={Boolean(retaking)}
                          className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                        >
                          {retaking === chapter.id ? "生成中…" : "补考本章"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <Bar value={entry.mastery} target={MASTERY_THRESHOLD} targetLabel="达标线" />
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 错题回顾 */}
      {wrongRows.length > 0 ? (
        <Card className="mt-4">
          <p className="text-sm font-semibold text-slate-800">错题回顾</p>
          <p className="mt-0.5 text-xs text-slate-400">
            共 {wrongRows.length} 题 · 附参考答案与薄弱要点
          </p>
          <div className="mt-4 space-y-4">
            {wrongRows.map(({ w, q }, i) => {
              const chapter = q.chapterId ? index.get(q.chapterId)?.chapter : undefined;
              const correct = correctText(q);
              return (
                <div key={q.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500 text-xs font-semibold text-white">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2 text-[11px]">
                        <span className="rounded bg-slate-200/70 px-1.5 py-0.5 font-medium text-slate-500">
                          {typeBadgeText(q.type)}
                        </span>
                        {chapter ? (
                          <span className="text-slate-400">第 {chapter.order} 章</span>
                        ) : null}
                        <span className="text-slate-300">难度 {q.difficulty}</span>
                      </div>
                      <p className="text-sm font-medium leading-6 text-slate-900">{q.prompt}</p>

                      <div className="mt-2 space-y-1.5 text-xs leading-5">
                        <p className="text-slate-600">
                          <span className="text-slate-400">你的作答：</span>
                          {answerText(q, w.yourAnswer)}
                        </p>
                        <p className="text-emerald-700">
                          <span className="text-slate-400">参考答案：</span>
                          {correct}
                        </p>
                      </div>

                      {/* AI 批语槽（P0-3：未配置 AI 不伪造；T12 起回填批语与定位要点） */}
                      {w.aiFeedback ? (
                        <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs leading-5 text-slate-700">
                          <span className="font-medium text-indigo-700">AI 批语：</span>
                          {w.aiFeedback}
                          {w.point ? (
                            <span className="mt-1 block text-[11px] text-indigo-600/80">
                              定位要点：{w.point}
                            </span>
                          ) : null}
                        </div>
                      ) : isSubjectiveType(q.type) && w.yourAnswer === "（未作答）" ? (
                        <p className="mt-2 text-[11px] leading-4 text-amber-600/80">
                          未作答——先对照参考答案学一遍要点，再做一次本章测验。
                        </p>
                      ) : (
                        <p className="mt-2 text-[11px] leading-4 text-slate-400">
                          AI 批语：配置 AI 判分后自动生成（主观题批语 + 定位到章节要点）。
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <div className="mt-6 flex justify-center gap-2">
        <Link
          to="/learn"
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          回章节目录
        </Link>
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

/* ------------------------------------------------------------------ */
/* 展示辅助                                                           */
/* ------------------------------------------------------------------ */

/** 卷范围标题：单章 → 「第 x 章 · 1 章」；多章 → 「第 x–y 章 · n 章」。 */
function contextTitle(chapters: Chapter[]): string {
  if (chapters.length === 0) return "资料已移除";
  const first = chapters[0].order;
  const last = chapters[chapters.length - 1].order;
  const range = first === last ? `第 ${first} 章` : `第 ${first}–${last} 章`;
  return `${range} · ${chapters.length} 章`;
}

/** 将用户作答转为可读文本（choice → 选项内容；judge → 对/错；主观 → 原文）。 */
function answerText(q: PaperQuestion, raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "（未作答）";
  if (q.type === "choice") return q.options?.[Number(v)] ?? v;
  if (q.type === "judge") return v === "true" ? "对 ✓" : "错 ✗";
  return v;
}

/** 参考答案文本（客观 → 正确选项/对错；主观 → referenceAnswer）。 */
function correctText(q: PaperQuestion): string {
  if (q.type === "choice") return q.options?.[Number(q.answer)] ?? "—";
  if (q.type === "judge") return q.answer === "true" ? "对 ✓" : "错 ✗";
  return q.referenceAnswer ?? "—";
}
