/**
 * Goal 详情（/goals/:goalId）—— 单个目标的「为什么 + 学得怎样」视图（UI Workbench U6，docs §21-22）。
 *
 * 布局：
 * - READINESS 头：类型徽标 / 标题 / 重要性 / 截止 + 就绪度 Bar（目标章范围，口径与 Today 一致）；
 * - KNOWLEDGE：范围章行（KnowledgeRow，点击进阅读）；
 * - GAPS：低于及格线（<0.6）的章，点击「去学习」；
 * - LEARNING PATH：范围章按 掌握/学习中/未开始 分组（✓ / ● / ○ 图例）；
 * - [设为当前]（非 active 时）/ [编辑] / [删除]（二次确认；activeGoal 被删回退首个剩余目标）。
 * - type=career 额外渲染 TARGET ROLE 卡（目标即岗位：title/desc/scope/近期证据）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bar, Card, EvidenceRow, KnowledgeRow, Section } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { MASTERY_FLOOR, MASTERY_THRESHOLD } from "../../domain";
import type { Chapter, EvidenceEntry, LearningGoal } from "../../domain";
import { runChapterLoop, type ChapterLoopSnapshot } from "../../engine";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { useI18n, type Messages } from "../../i18n";
import { chapterDisplayTitle } from "../plan/chapter-action";
import { fmtDate } from "./GoalsPage";

interface Loaded {
  goal: LearningGoal;
  plan: ChapterLoopSnapshot;
  evidence: EvidenceEntry[];
  isActive: boolean;
}

/** 掌握度 → 状态点语义（与 bandOf 同源简化：0 / <0.6 / <0.8 / ≥0.8）。 */
function toneOf(mastery: number): "idle" | "weak" | "learning" | "mastered" {
  if (mastery <= 0) return "idle";
  if (mastery < MASTERY_FLOOR) return "weak";
  if (mastery < MASTERY_THRESHOLD) return "learning";
  return "mastered";
}

export default function GoalDetailPage() {
  const { goalId = "" } = useParams();
  const navigate = useNavigate();
  const { m, lang } = useI18n();
  const g = m.goals;
  const removeGoal = useLoopStore((s) => s.removeGoal);
  const switchGoal = useLoopStore((s) => s.switchGoal);
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const [goals, activeGoal, evidence] = await Promise.all([
        storage.listGoals(),
        storage.getActiveGoal(),
        storage.listEvidence(),
      ]);
      const goal = goals.find((x) => x.id === goalId);
      if (!goal) {
        setMissing(true);
        return;
      }
      // 章级闭环快照按该目标 scope 重算（作用域与就绪度同源：runChapterLoop §7.3）。
      const plan = await runChapterLoop(storage, m, goal.id);
      setLoaded({ goal, plan, evidence, isActive: activeGoal?.id === goal.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [goalId, m]);

  useEffect(() => {
    void load();
  }, [load]);

  // 范围章（plan 内已按目标 scope 过滤；跨文档收集 + order 排序由引擎保证）。
  const scopeChapters = useMemo(() => {
    if (!loaded) return [];
    const out: Chapter[] = [];
    for (const list of Object.values(loaded.plan.chaptersByDoc)) out.push(...list);
    return out;
  }, [loaded]);

  const doSwitch = async () => {
    if (!loaded || switching) return;
    setSwitching(true);
    try {
      await switchGoal(loaded.goal.id, m);
      await load();
    } finally {
      setSwitching(false);
    }
  };

  const doDelete = async () => {
    if (!loaded || deleting) return;
    setDeleting(true);
    try {
      await removeGoal(loaded.goal.id, m);
      navigate("/goals", { replace: true });
    } finally {
      setDeleting(false);
    }
  };

  if (missing) {
    return (
      <PageContainer>
        <Card>
          <p className="text-lg font-semibold text-ink-1">{g.notFound}</p>
          <p className="mt-1 text-sm text-ink-2">{g.notFoundDesc}</p>
          <Link to="/goals" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
            {g.backToList}
          </Link>
        </Card>
      </PageContainer>
    );
  }

  if (!loaded) {
    return (
      <PageContainer>
        <Card>
          <p className="text-sm text-ink-3">{g.listLoading}</p>
        </Card>
      </PageContainer>
    );
  }

  const { goal, plan } = loaded;
  const masteredCount = scopeChapters.filter(
    (c) => (plan.learner.byUnit[c.id]?.mastery ?? 0) >= MASTERY_THRESHOLD,
  ).length;
  const readiness = scopeChapters.length === 0 ? 0 : masteredCount / scopeChapters.length;
  const gaps = scopeChapters.filter(
    (c) => (plan.learner.byUnit[c.id]?.mastery ?? 0) < MASTERY_FLOOR,
  );
  const masteredList = scopeChapters.filter(
    (c) => (plan.learner.byUnit[c.id]?.mastery ?? 0) >= MASTERY_THRESHOLD,
  );
  const learningList = scopeChapters.filter(
    (c) => {
      const mastery = plan.learner.byUnit[c.id]?.mastery ?? 0;
      return mastery >= MASTERY_FLOOR && mastery < MASTERY_THRESHOLD;
    },
  );
  const notStartedList = scopeChapters.filter(
    (c) => (plan.learner.byUnit[c.id]?.mastery ?? 0) < MASTERY_FLOOR,
  );

  return (
    <PageContainer>
      {/* READINESS 头 */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/goals" className="text-xs font-medium text-ink-3 hover:text-accent">
            {g.backToList}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
              {m.units.goalType[goal.type]}
            </span>
            <span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink-3">
              {g.detail.importance(m.units.importance[goal.importance])}
            </span>
            <span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink-3">
              {goal.deadlineAt
                ? g.deadline(fmtDate(goal.deadlineAt, lang))
                : g.noDeadline}
            </span>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-ink-1">{goal.title}</h2>
          {goal.description ? (
            <p className="mt-1 max-w-2xl text-sm text-ink-2">{goal.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {!loaded.isActive ? (
              <button
                type="button"
                disabled={switching}
                onClick={() => void doSwitch()}
                className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-subtle disabled:opacity-40"
              >
                {switching ? "…" : g.setActive}
              </button>
            ) : null}
            <Link
              to={`/goals/${goal.id}/edit`}
              className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-subtle"
            >
              {g.edit}
            </Link>
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-state-failed transition-colors hover:bg-subtle"
              >
                {g.delete}
              </button>
            ) : null}
          </div>
          {confirming ? (
            <div className="rounded-lg border border-line bg-surface p-3 shadow-sm">
              <p className="text-xs font-semibold text-ink-1">{g.confirmDeleteTitle}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-2">{g.confirmDeleteDesc}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void doDelete()}
                  className="rounded-md bg-state-failed px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {deleting ? "…" : g.confirmDelete}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-subtle"
                >
                  {g.cancelDelete}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <Card className="mt-4">
          <p className="text-sm text-state-failed">{error}</p>
        </Card>
      ) : null}

      {/* 就绪度 */}
      <div className="mt-5 rounded-xl border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            {g.detail.readinessEyebrow}
          </p>
          <p className="text-sm font-semibold tabular-nums text-ink-1">
            {Math.round(readiness * 100)}%{" "}
            <span className="font-normal text-ink-3">
              · {g.detail.readyOf(masteredCount, scopeChapters.length)}
            </span>
          </p>
        </div>
        {scopeChapters.length > 0 ? (
          <div className="mt-2">
            <Bar
              value={readiness}
              target={MASTERY_THRESHOLD}
              targetLabel={g.detail.targetLine(Math.round(MASTERY_THRESHOLD * 100))}
            />
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink-3">{g.scopeEmptyHint}</p>
        )}
      </div>

      {scopeChapters.length === 0 ? (
        <div className="mt-6">
          <Section title={g.detail.scope} className="mt-6" />
          <p className="mt-2 text-sm text-ink-2">{g.detail.noScope}</p>
          <Link
            to={`/goals/${goal.id}/edit`}
            className="mt-2 inline-block text-sm font-medium text-accent hover:text-accent/70"
          >
            {g.detail.editScope}
          </Link>
        </div>
      ) : (
        <>
          {/* KNOWLEDGE：范围章行 */}
          <Section title={g.detail.knowledge} className="mt-6" />
          <div className="mt-1">
            {scopeChapters.map((c) => {
              const mastery = plan.learner.byUnit[c.id]?.mastery ?? 0;
              return (
                <Link key={c.id} to={`/learn/${c.id}`}>
                  <KnowledgeRow
                    title={chapterDisplayTitle(c, plan.docTitleOf[c.id], m)}
                    tone={toneOf(mastery)}
                    mastery={mastery}
                  />
                </Link>
              );
            })}
          </div>

          {/* GAPS */}
          <Section title={g.detail.gapSection} className="mt-6" />
          {gaps.length === 0 ? (
            <p className="mt-1 text-sm text-ink-2">{g.detail.gapEmpty}</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-ink-3">{g.detail.gapHint}</p>
              <div className="mt-1">
                {gaps.map((c) => {
                  const mastery = plan.learner.byUnit[c.id]?.mastery ?? 0;
                  return (
                    <KnowledgeRow
                      key={c.id}
                      title={chapterDisplayTitle(c, plan.docTitleOf[c.id], m)}
                      tone="weak"
                      mastery={mastery}
                      actionLabel={g.detail.goLearn}
                      onAction={() => navigate(`/learn/${c.id}`)}
                    />
                  );
                })}
              </div>
            </>
          )}

          {/* LEARNING PATH：✓ / ● / ○ 分组 */}
          <Section title={g.detail.path} className="mt-6" action={<span className="text-xs text-ink-3">{g.detail.pathHint}</span>} />
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <PathCol
              title="✓"
              rows={masteredList}
              plan={plan}
              m={m}
              onClick={(id) => navigate(`/learn/${id}`)}
            />
            <PathCol
              title="●"
              rows={learningList}
              plan={plan}
              m={m}
              onClick={(id) => navigate(`/learn/${id}`)}
            />
            <PathCol
              title="○"
              rows={notStartedList}
              plan={plan}
              m={m}
              onClick={(id) => navigate(`/learn/${id}`)}
            />
          </div>

          {/* type=career 附加：TARGET ROLE（目标即岗位）+ 近期证据 */}
          {goal.type === "career" ? <CareerExtra goal={goal} evidence={loaded.evidence} scopeIds={scopeChapters.map((c) => c.id)} m={m} lang={lang} /> : null}
        </>
      )}
    </PageContainer>
  );
}

/** LEARNING PATH 一列（一组状态的章）。 */
function PathCol({
  title,
  rows,
  plan,
  m,
  onClick,
}: {
  title: string;
  rows: Chapter[];
  plan: ChapterLoopSnapshot;
  m: Messages;
  onClick: (id: string) => void;
}) {
  if (rows.length === 0) return <div className="text-xs text-ink-3">—</div>;
  return (
    <div className="rounded-lg border border-line bg-surface/60 p-3">
      <p className="text-sm font-semibold text-ink-1">{title}</p>
      <ul className="mt-1 space-y-1">
        {rows.slice(0, 12).map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onClick(c.id)}
              className="block w-full truncate text-left text-xs text-ink-2 transition-colors hover:text-accent"
              title={chapterDisplayTitle(c, plan.docTitleOf[c.id], m)}
            >
              {chapterDisplayTitle(c, plan.docTitleOf[c.id], m)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 职业型目标附加：TARGET ROLE + 范围/近期证据（全部来自 domain 字段）。 */
function CareerExtra({
  goal,
  evidence,
  scopeIds,
  m,
  lang,
}: {
  goal: LearningGoal;
  evidence: EvidenceEntry[];
  scopeIds: string[];
  m: Messages;
  lang: "zh" | "en";
}) {
  const inScope = new Set(scopeIds);
  const rows = evidence.filter((e) => inScope.has(e.subjectId)).slice(0, 4);
  return (
    <div className="mt-6 rounded-xl border border-line bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">TARGET ROLE</p>
      <h4 className="mt-1 text-base font-semibold text-ink-1">{goal.title}</h4>
      {goal.description ? (
        <p className="mt-1 text-sm text-ink-2">{goal.description}</p>
      ) : null}
      <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt className="text-xs text-ink-3">Scope</dt>
          <dd className="mt-0.5 font-medium text-ink-1">{scopeIds.length} chapters</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Created</dt>
          <dd className="mt-0.5 font-medium text-ink-1">{fmtDate(goal.createdAt, lang)}</dd>
        </div>
      </dl>
      {rows.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold text-ink-2">Evidence</p>
          {rows.map((e, i) => (
            <EvidenceRow
              key={`${e.at}-${i}`}
              time={fmtDate(e.at, lang)}
              title={m.units.action[e.kind === "assessment" ? "assessment" : "review-points"]}
              delta={e.delta === 0 ? undefined : `${e.delta > 0 ? "+" : ""}${(e.delta * 100).toFixed(0)}%`}
              deltaTone={e.delta > 0 ? "up" : e.delta < 0 ? "down" : "neutral"}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
