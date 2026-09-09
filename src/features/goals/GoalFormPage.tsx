/**
 * Goal 新建/编辑（/goals/new 与 /goals/:goalId/edit 复用）—— UI Workbench U6 §20 表单。
 *
 * 两段式：
 * 1 · 基本信息：title / type / description / importance / deadline；
 * 2 · 章节范围：从资料库按文档分组多选（空 = 全库回退语义）。
 *
 * 保存经 store.saveGoal（goal repo）→ 重算快照；新建后落到详情页。
 * type=career 的 requiredUnitIds 概念层本期不编辑（N5 概念回归后再扩展）。
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Card, SectionTitle } from "../../components/primitives";
import { Checkbox } from "../../components/ui/checkbox";
import { Select } from "../../components/ui/select";
import { PageContainer, openImportModal } from "../../components/layout/AppShell";
import { newId } from "../../domain";
import type { GoalImportance, GoalType, LearningGoal } from "../../domain";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { useI18n } from "../../i18n";
import { type ChapterRow, loadChapterRows } from "./goal-util";

type GoalTypes = GoalType[];

const GOAL_TYPES: GoalTypes = ["career", "study", "exam", "personal", "research", "project"];
const IMPORTANCE: GoalImportance[] = ["high", "medium", "low"];

/** 原生 input[type=date] 的 value ⇄ epoch ms。 */
function dateToInput(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function inputToDate(v: string): number | undefined {
  if (!v) return undefined;
  const ms = new Date(`${v}T00:00:00`).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

export default function GoalFormPage() {
  const { goalId } = useParams(); // 存在 = 编辑模式
  const navigate = useNavigate();
  const { m } = useI18n();
  const f = m.goals.form;
  const saveGoal = useLoopStore((s) => s.saveGoal);

  const [title, setTitle] = useState("");
  const [type, setType] = useState<GoalType>("career");
  const [description, setDescription] = useState("");
  const [importance, setImportance] = useState<GoalImportance>("high");
  const [deadline, setDeadline] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowsByDoc, setRowsByDoc] = useState<Map<string, ChapterRow[]>>(new Map());
  const [docsOrder, setDocsOrder] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  useEffect(() => {
    void (async () => {
      const rows = await loadChapterRows(storage);
      const grouped = new Map<string, ChapterRow[]>();
      const order: string[] = [];
      for (const r of rows) {
        if (!grouped.has(r.docTitle)) {
          grouped.set(r.docTitle, []);
          order.push(r.docTitle);
        }
        grouped.get(r.docTitle)!.push(r);
      }
      setRowsByDoc(grouped);
      setDocsOrder(order);

      // 编辑模式：预填目标 + 现有范围。
      if (goalId) {
        const goal = (await storage.listGoals()).find((g) => g.id === goalId);
        if (!goal) {
          setMissing(true);
          setReady(true);
          return;
        }
        setTitle(goal.title);
        setType(goal.type);
        setDescription(goal.description ?? "");
        setImportance(goal.importance);
        setDeadline(dateToInput(goal.deadlineAt));
        setSelected(new Set(goal.requiredChapterIds ?? []));
      }
      setReady(true);
    })();
  }, [goalId]);

  const toggleChapter = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDoc = (_docTitle: string, docRows: ChapterRow[]) => {
    const ids = docRows.map((r) => r.chapter.id);
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = ids.every((id) => next.has(id));
      if (allIn) for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      return next;
    });
  };

  const clearScope = () => setSelected(new Set());

  const onSubmit = async () => {
    if (saving) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setErr(f.invalidTitle);
      return;
    }
    setErr(undefined);
    setSaving(true);
    const now = Date.now();
    const goal: LearningGoal = {
      id: goalId ?? newId("goal"),
      type,
      title: trimmed,
      description: description.trim() || undefined,
      importance,
      // 概念层（N5）本期不编辑：编辑时保留旧概念范围，新建为空。
      requiredUnitIds: goalId
        ? ((await storage.listGoals()).find((g) => g.id === goalId)?.requiredUnitIds ?? [])
        : [],
      // 章级范围：空 = 全库回退（语义见 goal-util.scopeOf）。
      requiredChapterIds: selected.size > 0 ? [...selected] : [],
      createdAt: goalId
        ? ((await storage.listGoals()).find((g) => g.id === goalId)?.createdAt ?? now)
        : now,
      deadlineAt: inputToDate(deadline),
    };
    try {
      await saveGoal(goal, m);
      setSavedFlash(true);
      window.setTimeout(() => {
        navigate(`/goals/${goal.id}`, { replace: true });
      }, 350);
    } finally {
      setSaving(false);
    }
  };

  if (missing) {
    return (
      <PageContainer>
        <Card>
          <p className="text-lg font-semibold text-ink-1">{m.goals.notFound}</p>
          <p className="mt-1 text-sm text-ink-2">{m.goals.notFoundDesc}</p>
          <Link to="/goals" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            {m.goals.backToList}
          </Link>
        </Card>
      </PageContainer>
    );
  }

  if (!ready) {
    return (
      <PageContainer>
        <Card>
          <p className="text-sm text-ink-3">{m.goals.listLoading}</p>
        </Card>
      </PageContainer>
    );
  }

  const docList = docsOrder.map((docTitle) => ({ docTitle, rows: rowsByDoc.get(docTitle)! }));

  return (
    <PageContainer>
      <SectionTitle
        title={goalId ? f.editTitle : f.newTitle}
        subtitle={goalId ? title || " " : undefined}
        action={
          <Link
            to={goalId ? `/goals/${goalId}` : "/goals"}
            className="text-xs font-medium text-ink-3 hover:text-primary"
          >
            {goalId ? f.back : m.goals.backToList}
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 基本信息 */}
        <Card className="lg:col-span-2">
          <h3 className="mb-3 text-xs font-semibold tracking-wide text-ink-2">{f.stepBasics}</h3>
          <div className="space-y-4">
            <div>
              <label htmlFor="goal-title" className="mb-1 block text-xs font-medium text-ink-2">
                {f.titleLabel}
              </label>
              <input
                id="goal-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={f.titlePlaceholder}
                className="w-full rounded-md border border-line bg-app-bg px-3 py-2 text-sm text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-primary"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">
                  {f.typeLabel}
                </label>
                <Select
                  id="goal-type"
                  ariaLabel={f.typeLabel}
                  value={type}
                  onValueChange={(v) => setType(v as GoalType)}
                  options={GOAL_TYPES.map((t) => ({
                    value: t,
                    label: m.units.goalType[t],
                  }))}
                  className="bg-app-bg"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">
                  {f.importanceLabel}
                </label>
                <Select
                  id="goal-importance"
                  ariaLabel={f.importanceLabel}
                  value={importance}
                  onValueChange={(v) => setImportance(v as GoalImportance)}
                  options={IMPORTANCE.map((im) => ({
                    value: im,
                    label: m.units.importance[im],
                  }))}
                  className="bg-app-bg"
                />
              </div>
            </div>

            <div>
              <label htmlFor="goal-desc" className="mb-1 block text-xs font-medium text-ink-2">
                {f.descLabel}
              </label>
              <textarea
                id="goal-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={f.descPlaceholder}
                rows={3}
                className="w-full resize-none rounded-md border border-line bg-app-bg px-3 py-2 text-sm text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-primary"
              />
            </div>

            <div className="sm:w-56">
              <label htmlFor="goal-deadline" className="mb-1 block text-xs font-medium text-ink-2">
                {f.deadlineLabel}
              </label>
              <input
                id="goal-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-md border border-line bg-app-bg px-3 py-2 text-sm text-ink-1 outline-none focus:border-primary"
              />
            </div>
          </div>
        </Card>

        {/* 章节范围 */}
        <Card className="lg:col-span-1">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-semibold tracking-wide text-ink-2">{f.stepScope}</h3>
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <span>{f.selectedOf(selected.size)}</span>
              {selected.size > 0 ? (
                <button type="button" onClick={clearScope} className="font-medium text-ink-2 hover:text-primary">
                  {f.clearScope}
                </button>
              ) : null}
            </div>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{f.scopeHint}</p>

          {docList.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-line p-4 text-center">
              <p className="text-sm text-ink-2">{f.scopeEmpty}</p>
              <button
                type="button"
                onClick={openImportModal}
                className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/90"
              >
                {f.goImport}
              </button>
            </div>
          ) : (
            <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
              {docList.map(({ docTitle, rows }) => {
                const docIds = rows.map((r) => r.chapter.id);
                const allIn = docIds.every((id) => selected.has(id));
                return (
                  <div key={docTitle} className="rounded-lg border border-line bg-subtle/40 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-1">
                        {f.docGroup(docTitle, rows.length)}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleDoc(docTitle, rows)}
                        className="shrink-0 text-[11px] font-medium text-primary hover:text-primary/70"
                      >
                        {allIn ? "−" : f.selectAll}
                      </button>
                    </div>
                    <div className="mt-1.5 space-y-0.5">
                      {rows.map((r) => {
                        const c = r.chapter;
                        const checked = selected.has(c.id);
                        return (
                          <div
                            key={c.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-ink-2 transition-colors hover:bg-surface"
                            onClick={(e) => {
                              if ((e.target as HTMLElement).closest("[data-slot=checkbox]")) return;
                              toggleChapter(c.id);
                            }}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleChapter(c.id)}
                            />
                            <span className="truncate">
                              {c.title?.trim() || m.chapter.ordinal(c.order)}（第 {c.order} 章）
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* 保存栏 */}
      <div className="mt-6 flex items-center gap-3">
        {err ? <p className="text-sm text-state-failed">{err}</p> : null}
        {savedFlash ? <span className="text-sm text-state-mastered">{f.saved}</span> : null}
        <button
          type="button"
          disabled={saving}
          onClick={() => void onSubmit()}
          className="ml-auto rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? f.saving : f.save}
        </button>
        <Link
          to={goalId ? `/goals/${goalId}` : "/goals"}
          className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-subtle"
        >
          {f.cancel}
        </Link>
      </div>
    </PageContainer>
  );
}
