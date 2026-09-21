/**
 * 能力评测作答页（/goals/:goalId/capability/run/:runId）—— F6 两阶段评测现场。
 *
 * 两阶段（docs/goal-capability-assessment-design-2026-09.md §7.3 / 决策 D9-A）：
 * - **第 1 步 · 客观摸底卷（可选）**：`run.paperId` 指向一张综合测卷，作答与判卷
 *   完全复用既有 `/quiz/:paperId` 链路；结果只作「知识底座参考分」。
 *   ⚠️ **第 2 步不依赖第 1 步** —— 未完成（`pending`）/ 无卷（`skipped`）都照常作答
 *   提交，判定口径不变（客观卷缺考不阻断）。
 * - **第 2 步 · 场景任务**：逐任务开放式作答 → 提交后 AI 按 rubric 逐项评分。
 *
 * 作答草稿：改动 800ms 防抖落库（`status` 保持 run 原状态），刷新后作答不丢；
 * 提交时先落 `collected` 再评分（用户产出优先），评分失败仍可「重新评分」。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Card, Section } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import type {
  CapabilityErrorKind,
  CapabilityItemSnapshot,
  CapabilityRun,
  CapabilityStatus,
  Paper,
} from "../../domain";
import { CAPABILITY_LIMITS } from "../../engine";
import { useI18n } from "../../i18n";
import { storage } from "../../stores/useLoopStore";
import {
  getCapabilityRunById,
  objectiveStageOf,
  submitCapabilityRun,
  type ObjectiveStage,
} from "./capability-service";
import { capabilityStatusText, wantsAiSettings } from "./capability/status-text";

type BadStatus = Exclude<CapabilityStatus, "ok"> | CapabilityErrorKind;

interface Loaded {
  run: CapabilityRun;
  stage: ObjectiveStage;
  /** 阶段 1 卷（取题量用）；未建卷 → undefined。 */
  paper?: Paper;
}

export default function CapabilityRunPage() {
  const { goalId = "", runId = "" } = useParams();
  const navigate = useNavigate();
  const { m } = useI18n();
  const c = m.capability;

  const [loaded, setLoaded] = useState<Loaded>();
  const [missing, setMissing] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState<BadStatus>();
  /** 已提交但评分失败（run 已落 collected）→ 展示「重新评分」引导。 */
  const [kept, setKept] = useState(false);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    try {
      const run = await getCapabilityRunById(runId, storage);
      if (!run || run.goalId !== goalId) {
        setMissing(true);
        return;
      }
      const stage = await objectiveStageOf(run, storage);
      const paper = run.paperId
        ? (await storage.listPapers()).find((p) => p.id === run.paperId)
        : undefined;
      setLoaded({ run, stage, ...(paper ? { paper } : {}) });
      setAnswers(run.answers);
      dirty.current = false;
    } catch {
      setBad("fetch");
    }
  }, [goalId, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 作答草稿防抖落库（800ms）：只在本页确实改过时才写，避免 mount 时空写一次。
  useEffect(() => {
    if (!loaded || !dirty.current) return;
    const timer = setTimeout(() => {
      void storage.saveCapabilityRun({ ...loaded.run, answers });
    }, 800);
    return () => clearTimeout(timer);
  }, [answers, loaded]);

  const setAnswer = (taskId: string, text: string) => {
    dirty.current = true;
    setAnswers((prev) => ({ ...prev, [taskId]: text }));
  };

  const doSubmit = async (): Promise<void> => {
    if (busy || !loaded) return;
    setBusy(true);
    setBad(undefined);
    try {
      const out = await submitCapabilityRun({ runId, answers, storage });
      if (out.status === "ok") {
        navigate(`/goals/${goalId}/capability`);
        return;
      }
      setBad(out.status === "error" ? out.errorKind : out.status);
      // 失败后重新读盘：run 可能已落 collected（作答保住），状态以落库为准。
      await load();
      const persisted = await getCapabilityRunById(runId, storage);
      setKept(persisted?.status === "collected");
    } finally {
      setBusy(false);
    }
  };

  if (missing) {
    return (
      <PageContainer>
        <Card>
          <p className="text-sm text-ink-2">{c.runMissing}</p>
          <Link
            to={`/goals/${goalId}/capability`}
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            {c.backToGoal}
          </Link>
        </Card>
      </PageContainer>
    );
  }

  if (!loaded) {
    return (
      <PageContainer>
        <Card>
          <p className="text-sm text-ink-3">{c.loading}</p>
        </Card>
      </PageContainer>
    );
  }

  const { run, stage, paper } = loaded;
  /** 项标签：快照里找不到 → 兜底文案（**绝不显示裸 itemId**）。 */
  const labelOf = (itemId: string) =>
    run.items.find((i: CapabilityItemSnapshot) => i.id === itemId)?.label ?? c.itemGone;
  const shortTaskIds = run.tasks.filter(
    (t) => (answers[t.id] ?? "").trim().length < CAPABILITY_LIMITS.answerMinChars,
  );
  const answeredCount = run.tasks.filter((t) => (answers[t.id] ?? "").trim().length > 0).length;

  return (
    <PageContainer>
      <div data-testid="cap-run-root">
        <Link
          to={`/goals/${goalId}/capability`}
          className="text-xs font-medium text-ink-3 hover:text-primary"
        >
          {c.backToGoal}
        </Link>
        <h2 className="mt-2 text-xl font-semibold text-ink-1">{c.title}</h2>
        <p className="mt-1 text-sm text-ink-2">
          {c.answeredOf(answeredCount, run.tasks.length)}
        </p>

        {bad ? (
          <div
            data-testid="cap-run-status"
            className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-2"
          >
            <span className="text-xs text-state-weak">
              {capabilityStatusText(bad, c)}
              {kept ? ` ${c.submittedKept}` : ""}
            </span>
            {wantsAiSettings(bad) ? (
              <Link to="/settings" className="text-xs font-medium text-primary hover:underline">
                {c.err.goSettings}
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* 第 1 步 · 客观摸底卷 */}
        <div className="mt-6">
          <Section title={c.step1} />
          {stage.status === "skipped" ? (
            <p data-testid="cap-objective-skipped" className="mt-2 text-xs text-ink-3">
              {c.objectiveSkipped}
            </p>
          ) : (
            <div
              data-testid={stage.status === "done" ? "cap-objective-done" : "cap-objective-pending"}
              className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
            >
              <span className="text-sm text-ink-1">
                {c.objectiveQuestions(paper?.questions.length ?? 0)}
              </span>
              {stage.status === "done" ? (
                <span className="text-xs font-medium text-state-mastered">
                  {c.objectiveDone(stage.totalScore)}
                </span>
              ) : (
                <Link
                  to={`/quiz/${stage.paperId}`}
                  className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-subtle"
                >
                  {c.objectiveGo}
                </Link>
              )}
              <span className="text-[11px] text-ink-3">{c.objectiveHint}</span>
            </div>
          )}
        </div>

        {/* 第 2 步 · 场景任务（不依赖第 1 步） */}
        <div className="mt-6">
          <Section title={c.step2} />
          <ul className="mt-2 space-y-3">
            {run.tasks.map((task, i) => {
              const text = answers[task.id] ?? "";
              const tooShort = text.trim().length < CAPABILITY_LIMITS.answerMinChars;
              return (
                <li
                  key={task.id}
                  data-testid={`cap-task-${i}`}
                  className="rounded-xl border border-line bg-surface px-4 py-3"
                >
                  <p className="text-sm font-medium text-ink-1">
                    {i + 1}. {task.prompt}
                  </p>
                  {task.deliverableHint ? (
                    <p className="mt-0.5 text-xs text-ink-2">{task.deliverableHint}</p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {task.rubric.map((r) => (
                      <span
                        key={r.itemId}
                        className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] text-ink-3"
                      >
                        {labelOf(r.itemId)}
                      </span>
                    ))}
                  </div>
                  <Textarea
                    data-testid={`cap-task-answer-${i}`}
                    value={text}
                    placeholder={c.answerPlaceholder}
                    maxLength={CAPABILITY_LIMITS.answerMaxChars}
                    onChange={(e) => setAnswer(task.id, e.target.value)}
                    className="mt-2 min-h-28"
                  />
                  <p className={`mt-1 text-[11px] ${tooShort ? "text-state-weak" : "text-ink-3"}`}>
                    {c.charCount(text.trim().length, CAPABILITY_LIMITS.answerMinChars)}
                  </p>
                </li>
              );
            })}
          </ul>

          {shortTaskIds.length > 0 ? (
            <p data-testid="cap-short-warn" className="mt-2 text-[11px] text-state-weak">
              {c.shortWarn(shortTaskIds.length)}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              data-testid="cap-submit"
              loading={busy}
              disabled={busy || run.tasks.length === 0}
              onClick={() => void doSubmit()}
            >
              {kept ? c.reScore : c.submit}
            </Button>
            <Link
              to={`/goals/${goalId}/capability`}
              className="text-xs font-medium text-ink-3 hover:text-primary"
            >
              {c.cancel}
            </Link>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
