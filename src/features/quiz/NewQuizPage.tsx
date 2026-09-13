/**
 * P3 新建试卷向导（/quiz/new）—— 三步弹层（T6）。
 *
 * Step 1 范围：选文档（多文档时）→ 选章（卡片多选）或「全本」快捷。
 * Step 2 模式：按章数启用 单元测（1 章）/ 阶段测（多章）/ 综合测（全本），
 *              模式卡展示配比与时长（实时）。
 * Step 3 生成并开始：createPaper → savePaper → /quiz/:id。
 *
 * 支持 URL 预填直达（阅读页「去测本章」/ 目录页「对本章出卷」）：
 *   /quiz/new?doc=DOC_ID&chapters=c1,c2&mode=unit-test
 *   满足单文档+单章+unit-test 时自动生成并跳答题页，跳过向导。
 *
 * T6 诚实降级：无 AI 时一律客观题（本地确定性题库）；N3/T12 起 allowSubjective
 * 门按 buildActiveProvider().isConfigured() 动态开——AI 就绪才出问答/应用
 * （交了卷有 AI 批改），且题面由 generateQuizQuestionsWithAi 即时生成、
 * 失败静默回退本地卷（P0-3 不伪造）。
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, SectionTitle } from "../../components/primitives";
import { PageContainer, openImportModal } from "../../components/layout/AppShell";
import type { Chapter, LearnerState, PaperMode, SourceDocument } from "../../domain";
import { PAPER_MODE_DURATION_MIN } from "../../domain";
import { availablePaperModes, NEW_PAPER_MODES } from "../../engine";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { storage } from "../../stores/useLoopStore";
import { useAiTask } from "../../stores/useAiTaskStore";
import { Button } from "../../components/ui/button";
import { AiTaskStatusLine } from "../../components/ai-task-status-line";
import { sortChaptersByOrder } from "../../domain";
import { useI18n } from "../../i18n";
import { modeHint } from "./meta";
import { createPaperAndSave } from "./paper-flow";


export default function NewQuizPage() {
  const { m } = useI18n();
  const np = m.quiz.newPaper;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [docs, setDocs] = useState<SourceDocument[]>([]);
  const [chaptersByDoc, setChaptersByDoc] = useState<Record<string, Chapter[]>>({});
  const [learner, setLearner] = useState<LearnerState | undefined>();

  const [docId, setDocId] = useState<string | undefined>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 向导只新建 单元/阶段/综合 三种卷（补考卷由报告页触发）。 */
  const [mode, setMode] = useState<Exclude<PaperMode, "retake"> | undefined>();
  const [autoDone, setAutoDone] = useState(false);
  /** URL 是否带 mode（= 来自「去测本章」等直达入口，允许自动创建）。 */
  const autoRequested = searchParams.get("mode") !== null;
  /** T12：AI 判分/出题就绪门（allowSubjective 与题面 AI 生成共用）。 */
  const aiReady = buildActiveProvider().isConfigured();

  // 出卷任务走全局注册表（paper:{docId}；文档未定时退 paper:all）。
  // 原实现没有任何 busy state：按钮可重复点击并发建卷、失败仅 console.error（UC-04）。
  const task = useAiTask(`paper:${docId ?? "all"}`);

  /** 模式不可选原因（与 selectableModes 规则同源，供 UI 提示）。 */
  function disabledReason(mm: PaperMode, n: number, total: number): string {
    if (n === 0) return np.drNone;
    switch (mm) {
      case "unit-test":
        return n === 1 ? "" : np.drUnitNotOne;
      case "stage-test":
        return n >= 2 ? "" : np.drStageFew;
      case "final-test":
        return n === total && total >= 3 ? "" : np.drFinalAll;
      default:
        return "";
    }
  }

  // 载入全部资料 + 章节 + 学习者状态（难度自适应用）。
  useEffect(() => {
    void (async () => {
      const [ds, ls] = await Promise.all([
        storage.listDocuments(),
        storage.getLearnerState(),
      ]);
      setLearner(ls);
      const withChapters = await Promise.all(
        ds.map(async (d) => [d.id, sortChaptersByOrder(await storage.listChapters(d.id))] as const),
      );
      setDocs(ds);
      setChaptersByDoc(Object.fromEntries(withChapters));

      // URL 预填：仅一个文档时自动选中；doc= 显式指定。
      const wantDoc = searchParams.get("doc");
      const doc =
        (wantDoc && ds.find((d) => d.id === wantDoc)) ||
        (ds.length === 1 ? ds[0] : undefined);
      if (doc) {
        setDocId(doc.id);
        const chapters = withChapters.find(([id]) => id === doc.id)?.[1] ?? [];
        const wantIds = (searchParams.get("chapters") ?? "")
          .split(",")
          .filter(Boolean);
        const ids = wantIds.length > 0 ? wantIds : chapters.map((c) => c.id);
        setSelected(new Set(ids));
        const wantMode = searchParams.get("mode");
        // 只接受向导支持的卷型（补考卷 / 未知值一律忽略，避免非法 mode 流入 createPaper）。
        if (wantMode && (NEW_PAPER_MODES as readonly string[]).includes(wantMode)) {
          setMode(wantMode as Exclude<PaperMode, "retake">);
        }
      }
    })();
  }, [searchParams]);

  const chapters = useMemo(
    () => (docId ? (chaptersByDoc[docId] ?? []) : []),
    [docId, chaptersByDoc],
  );
  const sortedSelected = useMemo(
    () =>
      chapters
        .filter((c) => selected.has(c.id))
        .sort((a, b) => a.order - b.order),
    [chapters, selected],
  );

  // 可选卷型：规则下沉到引擎（详情页「一键出卷」同源校验），此处只取结果。
  const selectableModes = useMemo(
    () => availablePaperModes({ selected: selected.size, total: chapters.length }),
    [selected, chapters],
  );

  // 自动路径：仅 URL 预填的 unit-test（「去测本章」等入口）→ 直接生成进入答题。
  // 手动在向导里选单章+单元测不触发（autoRequested=false）。
  // 幂等：只挡 running——done 终态保留至下次 start，若在此处也拦截，PapersTab
  // 出过卷后（共享 paper:{docId} 的 done 记录）会静默吞掉自动建卷（R1 回归）。
  // 「只建一次」由 autoDone flag 保证。
  useEffect(() => {
    if (autoDone || !autoRequested || !docId || sortedSelected.length === 0) return;
    if (task.running) return;
    if (mode === "unit-test" && sortedSelected.length === 1) {
      setAutoDone(true);
      createAndStart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, sortedSelected, mode, autoDone, autoRequested]);

  /**
   * 建卷 → 落库 → 进答题页（经全局任务注册表：loading 期间按钮 disabled，
   * 失败终态与本地回退说明落页面，不再只 console.error）。
   *
   * 出卷细节（本地确定性卷 / AI 就绪门 / 题面 AI 生成与静默回退 / 卷型校验）
   * 全部收敛到 `paper-flow`，本页只负责「取去哪」。
   */
  const createAndStart = () => {
    if (!docId || sortedSelected.length === 0 || !mode || task.running) return;
    void task.run(async (_report, done) => {
      const { paper, ai } = await createPaperAndSave({
        chapters: sortedSelected,
        allChapters: chapters,
        mode,
        learnerState: learner,
        text: docs.find((d) => d.id === docId)?.textPreview,
      });
      // 静默回退（AI 未就绪/失败 → 本地卷）不再是黑洞：说明文案进任务终态
      if (!ai) done(np.localFallback);
      navigate(`/quiz/${paper.id}`, { replace: autoRequested });
    }).catch(() => {
      // 失败终态经 task.message 渲染到下方错误位（PaperFlowError kind → 页面文案）
    });
  };

  /** PaperFlowError.message 是错误 kind（invalid-mode / no-chapters）→ 页面可读文案。 */
  const taskErrorText = (raw: string): string => {
    if (raw.includes("invalid-mode")) return np.errInvalidMode;
    if (raw.includes("no-chapters")) return np.errNoChapters;
    return raw;
  };

  // —— 渲染 ——
  if (docs.length === 0) {
    return (
      <PageContainer>
        <Card className="border-dashed">
          <p className="text-base font-semibold text-slate-900">{np.noDocTitle}</p>
          <p className="mt-1 text-sm text-slate-500">{np.noDocDesc}</p>
          <button
            onClick={openImportModal}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {m.quiz.center.goImport}
          </button>
        </Card>
      </PageContainer>
    );
  }

  // 自动路径进行中（createAndStart 异步，先给短暂 loading）。
  if (
    autoRequested &&
    mode === "unit-test" &&
    sortedSelected.length === 1 &&
    (!autoDone || task.running)
  ) {
    return (
      <PageContainer>
        <p className="text-sm text-slate-400">{np.generating}</p>
      </PageContainer>
    );
  }

  const canNext = sortedSelected.length > 0;

  return (
    <PageContainer>
      <SectionTitle
        title={np.title}
        subtitle={mode ? undefined : np.subtitle}
      />

      {/* Step 1 · 范围 */}
      <Card className="mb-4">
        <p className="text-sm font-semibold text-slate-800">{np.stepRange}</p>
        {docs.length > 1 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {docs.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  setDocId(d.id);
                  setSelected(new Set());
                  setMode(undefined);
                }}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  docId === d.id
                    ? "border-indigo-300 bg-indigo-50 font-medium text-indigo-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {d.title}
              </button>
            ))}
          </div>
        ) : null}

        {chapters.length > 0 ? (
          <div className="mt-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-slate-400">
                {np.selectedInfo(selected.size)}
              </p>
              <button
                onClick={() =>
                  setSelected(new Set(chapters.map((c) => c.id)))
                }
                disabled={selected.size === chapters.length}
                className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-40"
              >
                {np.selectAll(chapters.length)}
              </button>
            </div>
            <div className="grid max-h-72 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
              {chapters.map((c) => {
                const on = selected.has(c.id);
                const mastery = learner?.byUnit[c.id]?.mastery ?? 0;
                return (
                  <button
                    key={c.id}
                    onClick={() => {
                      setMode(undefined);
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      });
                    }}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                      on
                        ? "border-indigo-300 bg-indigo-50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-medium ${
                        on
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-slate-300 text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-slate-800">
                        {c.order}. {c.title || m.chapter.ordinal(c.order)}
                      </span>
                      {mastery > 0 ? (
                        <span className="ml-1.5 text-[11px] text-slate-400">
                          {Math.round(mastery * 100)}%
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">{np.noChapterOfDoc}</p>
        )}
      </Card>

      {/* Step 2 · 模式 */}
      <Card className="mb-4">
        <p className="text-sm font-semibold text-slate-800">{np.stepMode}</p>
        {!canNext ? (
          <p className="mt-2 text-xs text-slate-400">{np.pickChapterFirst}</p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {NEW_PAPER_MODES.map((mm) => {
              const enabled = selectableModes.includes(mm);
              const on = mode === mm;
              const label = m.quiz.mode[mm];
              const reason = disabledReason(mm, selected.size, chapters.length);
              return (
                <button
                  key={mm}
                  disabled={!enabled}
                  onClick={() => setMode(on ? undefined : mm)}
                  className={`rounded-xl border p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                    on
                      ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-800">{label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">
                    {enabled ? modeHint(mm, sortedSelected.length, m) : reason}
                  </p>
                  <p className="mt-1.5 text-[11px] leading-4 text-slate-400">
                    {m.quiz.quotaPreview[mm]}
                  </p>
                  {enabled ? (
                    <p className="mt-1 text-[10px] leading-3 text-slate-300">
                      {aiReady ? np.aiReadyHint : np.noAiHint}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* Step 3 · 生成并开始 */}
      <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white/90 px-5 py-3.5 shadow-lg backdrop-blur">
        <p className="text-xs text-slate-500">
          {mode
            ? np.footerSummary(m.quiz.mode[mode], sortedSelected.length, PAPER_MODE_DURATION_MIN[mode])
            : np.footerDefault}
        </p>
        <Button
          loading={task.running}
          disabled={!canNext || !mode || !selectableModes.includes(mode)}
          onClick={createAndStart}
        >
          {np.start}
        </Button>
      </div>

      {/* 失败 / 本地回退终态 + running 进度（统一状态行：新鲜度门防跨页面串台；可 dismiss） */}
      <AiTaskStatusLine
        task={task}
        runningFallback={np.generating}
        formatError={taskErrorText}
        onDismiss={task.clear}
        className="mt-3"
      />
    </PageContainer>
  );
}
