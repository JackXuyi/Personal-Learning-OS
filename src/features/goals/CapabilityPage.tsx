/**
 * 目标级能力评测页（/goals/:goalId/capability）—— F6 能力框架 + 报告中心。
 *
 * 布局（docs/goal-capability-assessment-design-2026-09.md §7.1/§7.2）：
 * - 框架区：空态 / 清单（内联编辑）/ 「由 AI 提炼」/「手动添加」/「开始评测」；
 * - 最新报告：`CapabilityReportView`（只读快照渲染）；
 * - 历史评测：报告列表，点击切换展示（append-only，历史永不原地更新）。
 *
 * 边界：
 * - 页面本地 `useState` 承载 busy / errorKind / 选中报告 —— 能力评测不进全局
 *   store（它不参与首页主行动，无需订阅）；
 * - 所有读写经 `capability-service`（UI 不直接摸 storage 的业务语义）；
 * - 无 AI 时提炼入口给引导条，**手动维护仍可用**（local-first 兜底）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Card, Section } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type {
  CapabilityErrorKind,
  CapabilityItem,
  CapabilityReport,
  CapabilityRun,
  CapabilityStatus,
  LearningGoal,
} from "../../domain";
import { CAPABILITY_LIMITS, capabilityStatsOf } from "../../engine";
import { capabilityItemId } from "../../domain";
import { useI18n } from "../../i18n";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { storage } from "../../stores/useLoopStore";
import { fmtDate } from "./GoalsPage";
import {
  listGoalCapabilityItems,
  listGoalCapabilityReports,
  listGoalCapabilityRuns,
  proposeCapabilityItems,
  saveCapabilityItemsForGoal,
  startCapabilityRun,
} from "./capability-service";
import { CapabilityReportView } from "./capability/CapabilityReportView";
import { capabilityStatusText, wantsAiSettings, wantsScopeEdit } from "./capability/status-text";

/** 非 ok 状态（服务层六态 + 细分错误）。 */
type BadStatus = Exclude<CapabilityStatus, "ok"> | CapabilityErrorKind;

interface Loaded {
  goal: LearningGoal;
  items: CapabilityItem[];
  runs: CapabilityRun[];
  reports: CapabilityReport[];
}

export default function CapabilityPage() {
  const { goalId = "" } = useParams();
  const navigate = useNavigate();
  const { m, lang } = useI18n();
  const c = m.capability;

  const [loaded, setLoaded] = useState<Loaded>();
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<"refine" | "start" | "save" | undefined>();
  const [bad, setBad] = useState<BadStatus>();
  const [aiReady, setAiReady] = useState(true);
  const [confirmRefine, setConfirmRefine] = useState(false);
  const [editing, setEditing] = useState<CapabilityItem | "new" | undefined>();
  const [selectedId, setSelectedId] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [goals, items, runs, reports] = await Promise.all([
        storage.listGoals(),
        listGoalCapabilityItems(goalId, storage),
        listGoalCapabilityRuns(goalId, storage),
        listGoalCapabilityReports(goalId, storage),
      ]);
      const goal = goals.find((g) => g.id === goalId);
      if (!goal) {
        setMissing(true);
        return;
      }
      setLoaded({ goal, items, runs, reports });
    } catch {
      setBad("fetch");
    }
  }, [goalId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setAiReady(buildActiveProvider().isConfigured());
  }, []);

  /** 选中报告（缺省 = 最新）；快照取自其 run（历史不随清单编辑漂移）。 */
  const shown = useMemo(() => {
    if (!loaded || loaded.reports.length === 0) return undefined;
    const report = loaded.reports.find((r) => r.id === selectedId) ?? loaded.reports[0];
    const snapshot = loaded.runs.find((r) => r.id === report.runId)?.items ?? [];
    return { report, snapshot };
  }, [loaded, selectedId]);

  const doRefine = async () => {
    if (busy) return;
    setBusy("refine");
    setBad(undefined);
    try {
      const out = await proposeCapabilityItems({ goalId, storage });
      if (out.status === "ok") await load();
      else setBad(out.status === "error" ? out.errorKind : out.status);
    } finally {
      setBusy(undefined);
      setConfirmRefine(false);
    }
  };

  const doStart = async () => {
    if (busy) return;
    setBusy("start");
    setBad(undefined);
    try {
      const out = await startCapabilityRun({ goalId, storage });
      if (out.status === "ok") {
        navigate(`/goals/${goalId}/capability/run/${out.data.run.id}`);
      } else {
        setBad(out.status === "error" ? out.errorKind : out.status);
      }
    } finally {
      setBusy(undefined);
    }
  };

  /** 清单全量写回（编辑 / 增删共用；校验与 id 派生在服务层）。 */
  const saveItems = async (next: readonly CapabilityItem[]): Promise<boolean> => {
    setBusy("save");
    setBad(undefined);
    try {
      const out = await saveCapabilityItemsForGoal(goalId, next, storage);
      if (out.status !== "ok") {
        setBad(out.status === "error" ? out.errorKind : out.status);
        return false;
      }
      setLoaded((prev) => (prev ? { ...prev, items: out.data } : prev));
      return true;
    } finally {
      setBusy(undefined);
    }
  };

  if (missing) {
    return (
      <PageContainer>
        <Card>
          <p className="text-lg font-semibold text-ink-1">{m.goals.notFound}</p>
          <p className="mt-1 text-sm text-ink-2">{m.goals.notFoundDesc}</p>
          <Link
            to="/goals"
            className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
          >
            {m.goals.backToList}
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

  const { goal, items, reports } = loaded;

  return (
    <PageContainer>
      <div data-testid="cap-page-root">
        <Link to={`/goals/${goal.id}`} className="text-xs font-medium text-ink-3 hover:text-primary">
          {c.backToGoal}
        </Link>
        <h2 className="mt-2 text-xl font-semibold text-ink-1">{c.title}</h2>
        <p className="mt-1 text-sm text-ink-2">{c.subtitle}</p>
        <p className="mt-1 text-xs text-ink-3">{goal.title}</p>

        {/* 状态引导条（无 AI / 无范围 / 无素材 / 解析失败…） */}
        {bad ? (
          <div
            data-testid="cap-status"
            className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-2"
          >
            <span className="text-xs text-state-weak">{capabilityStatusText(bad, c)}</span>
            {wantsAiSettings(bad) ? (
              <Link to="/settings" className="text-xs font-medium text-primary hover:underline">
                {c.err.goSettings}
              </Link>
            ) : null}
            {wantsScopeEdit(bad) ? (
              <Link
                to={`/goals/${goal.id}/edit`}
                className="text-xs font-medium text-primary hover:underline"
              >
                {c.err.editScope}
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* ① 框架区 */}
        <div className="mt-6">
          <Section
            title={c.framework}
            action={<span className="text-xs text-ink-3">{c.itemsCount(items.length)}</span>}
          />
          <p className="mt-1 text-[11px] text-ink-3">{c.frameworkHint}</p>

          {items.length === 0 && editing === undefined ? (
            <div className="mt-3 rounded-xl border border-dashed border-line bg-surface/60 px-4 py-5">
              <p className="text-sm font-medium text-ink-1">{c.emptyTitle}</p>
              <p className="mt-1 text-xs text-ink-2">{c.emptyHint}</p>
              {!aiReady ? (
                <p className="mt-2 text-[11px] text-state-weak">
                  {c.err.noAi}{" "}
                  <Link to="/settings" className="font-medium text-primary hover:underline">
                    {c.err.goSettings}
                  </Link>
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  data-testid="cap-refine"
                  loading={busy === "refine"}
                  disabled={!aiReady || busy !== undefined}
                  onClick={() => void doRefine()}
                >
                  {c.refine}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="cap-add-item"
                  disabled={busy !== undefined}
                  onClick={() => setEditing("new")}
                >
                  {c.addItem}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
                {items.map((item) => (
                  <li key={item.id} className="px-4 py-2.5" data-testid={`cap-item-${item.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-1">{item.label}</p>
                        {item.description ? (
                          <p className="mt-0.5 text-xs text-ink-2">{item.description}</p>
                        ) : null}
                        <p className="mt-0.5 text-[11px] text-ink-3">
                          {c.weightField} {item.weight} · {c.thresholdField}{" "}
                          {Math.round(item.threshold * 100)}%
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          disabled={busy !== undefined}
                          onClick={() => setEditing(item)}
                          className="rounded border border-line px-2 py-0.5 text-[11px] font-medium text-ink-2 hover:bg-subtle disabled:opacity-40"
                        >
                          {c.editItem}
                        </button>
                        <button
                          type="button"
                          disabled={busy !== undefined}
                          onClick={() =>
                            void saveItems(items.filter((i) => i.id !== item.id))
                          }
                          className="rounded border border-line px-2 py-0.5 text-[11px] font-medium text-state-failed hover:bg-subtle disabled:opacity-40"
                        >
                          {c.deleteItem}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {editing !== undefined ? (
                <ItemEditor
                  key={editing === "new" ? "new" : editing.id}
                  initial={editing === "new" ? undefined : editing}
                  goalId={goal.id}
                  savedCount={items.length}
                  busy={busy === "save"}
                  c={c}
                  onCancel={() => setEditing(undefined)}
                  onSave={async (next) => {
                    const others = items.filter((i) => i.id !== next.id);
                    const ok = await saveItems([...others, next]);
                    if (ok) setEditing(undefined);
                  }}
                />
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  data-testid="cap-start"
                  loading={busy === "start"}
                  disabled={busy !== undefined || items.length < CAPABILITY_LIMITS.minItems}
                  onClick={() => void doStart()}
                >
                  {c.startRun}
                </Button>
                {!confirmRefine ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== undefined || !aiReady}
                    onClick={() => setConfirmRefine(true)}
                  >
                    {c.refineAgain}
                  </Button>
                ) : (
                  <span className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-1.5">
                    <span className="text-[11px] text-ink-2">{c.refineConfirm}</span>
                    <Button size="sm" loading={busy === "refine"} onClick={() => void doRefine()}>
                      {c.refineAgain}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setConfirmRefine(false)}
                      className="text-[11px] font-medium text-ink-3 hover:text-ink-1"
                    >
                      {c.cancel}
                    </button>
                  </span>
                )}
                {editing === undefined ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== undefined || items.length >= CAPABILITY_LIMITS.maxItems}
                    onClick={() => setEditing("new")}
                  >
                    {c.addItem}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* ② 最新报告 / ③ 历史评测 */}
        <div className="mt-8">
          <Section title={c.latestReport} />
          {!shown ? (
            <div className="mt-2 rounded-xl border border-line bg-surface px-4 py-5">
              <p className="text-sm font-medium text-ink-1">{c.noReport}</p>
              <p className="mt-1 text-xs text-ink-2">{c.reportEmptyHint}</p>
            </div>
          ) : (
            <>
              <p className="mt-1 text-[11px] text-ink-3">
                {c.snapshotNote(fmtDate(shown.report.createdAt, lang))}
              </p>
              <div className="mt-2">
                <CapabilityReportView
                  report={shown.report}
                  snapshot={shown.snapshot}
                  m={m}
                  testId="cap-report"
                />
              </div>
            </>
          )}
        </div>

        {reports.length > 1 ? (
          <div className="mt-6">
            <Section title={c.history} />
            <ul className="mt-1 divide-y divide-line rounded-xl border border-line bg-surface">
              {reports.map((r) => {
                const stats = capabilityStatsOf(r);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      className={`flex w-full items-center justify-between px-4 py-2 text-left text-xs transition-colors hover:bg-subtle ${
                        shown?.report.id === r.id ? "text-primary" : "text-ink-2"
                      }`}
                    >
                      <span>{fmtDate(r.createdAt, lang)}</span>
                      <span className="tabular-nums">
                        {c.rateOf(stats.passed, stats.total)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </PageContainer>
  );
}

/** 能力项内联编辑（新增 / 修改同表单；id 由 label 内容派生，改动 = 新项）。 */
function ItemEditor({
  initial,
  goalId,
  savedCount,
  busy,
  c,
  onCancel,
  onSave,
}: {
  initial?: CapabilityItem;
  goalId: string;
  savedCount: number;
  busy: boolean;
  c: ReturnType<typeof useI18n>["m"]["capability"];
  onCancel: () => void;
  onSave: (item: CapabilityItem) => Promise<void>;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [weight, setWeight] = useState(String(initial?.weight ?? 1));
  const [threshold, setThreshold] = useState(String(initial?.threshold ?? 0.8));

  const labelOk = label.trim().length > 0;
  const weightNum = Number(weight);
  const thresholdNum = Number(threshold);
  const numbersOk =
    Number.isFinite(weightNum) &&
    weightNum >= 0 &&
    Number.isFinite(thresholdNum) &&
    thresholdNum >= 0 &&
    thresholdNum <= 1;

  const submit = () => {
    const clean = label.trim();
    if (!clean || !numbersOk) return;
    const desc = description.trim();
    void onSave({
      id: capabilityItemId(goalId, clean),
      goalId,
      label: clean,
      ...(desc ? { description: desc } : {}),
      weight: weightNum,
      threshold: thresholdNum,
      source: "manual",
      createdAt: initial?.createdAt ?? Date.now(),
    });
  };

  return (
    <div
      data-testid="cap-item-editor"
      className="mt-2 rounded-xl border border-line bg-surface px-4 py-3"
    >
      <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr]">
        <label className="text-xs text-ink-3">
          {c.labelField}
          <Input
            value={label}
            maxLength={CAPABILITY_LIMITS.labelChars}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1"
          />
        </label>
        <label className="text-xs text-ink-3">
          {c.weightField}
          <Input
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="mt-1"
          />
        </label>
        <label className="text-xs text-ink-3">
          {c.thresholdField}
          <Input
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="mt-1"
          />
        </label>
      </div>
      <label className="mt-2 block text-xs text-ink-3">
        {c.descField}
        <Input
          value={description}
          maxLength={CAPABILITY_LIMITS.descChars}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1"
        />
      </label>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" loading={busy} disabled={!labelOk || !numbersOk} onClick={submit}>
          {c.saveItem}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {c.cancel}
        </Button>
        {savedCount >= CAPABILITY_LIMITS.maxItems && !initial ? (
          <span className="text-[11px] text-state-weak">
            {CAPABILITY_LIMITS.maxItems}
          </span>
        ) : null}
      </div>
    </div>
  );
}
