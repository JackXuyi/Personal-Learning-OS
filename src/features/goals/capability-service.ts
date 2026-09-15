/**
 * 目标级能力评测编排（capability-service）—— F6「我够格了吗」的唯一服务入口。
 *
 * 设计（docs/goal-capability-assessment-design-2026-09.md §8.11）：
 * - **六态返回**（`CapabilityOutcome`）：`ok` / `no-ai` / `no-scope` /
 *   `no-material` / `no-items` / `error{errorKind}`。文案一律由 UI 走 i18n，
 *   本层不抛中文（同 `restatement-service` 口径）。
 * - **落库前早退**：无 AI / 无素材 / 无能力项时**零写入**（不建 run、不建卷、
 *   不覆盖已有清单）—— 即使 UI 被绕过也不会留下半成品。
 * - **用户产出优先**：`submitCapabilityRun` 先把作答落库（`status:"collected"`）
 *   再调 AI 评分；评分失败时 run 仍在，可「重新评分」，作答零丢失。
 * - **零伪造引用**：AI 只产 `quotes`，`start/end` 一律由本层 `locateQuote`
 *   在**该任务的作答原文**里反查；锚不上即丢弃该条，全部锚不上 → `unanchored`
 *   显式警示（保留分数与理由，绝不展示伪引用）。
 * - **不碰掌握度**（决策 D5-A）：mastery 唯一写方仍是卷面；本层的闭环落在
 *   **能力报告**（append-only）与**证据流**（`kind:"capability"`, `delta:0`）。
 * - **阶段 1 客观卷不参与判定**（决策 D9-A）：仅作「知识底座参考分」写进报告的
 *   `objective` 块，不加权、不合成；缺考不阻断阶段 2 与报告生成。
 *
 * 纯 TS（无 React / 无 i18n / 无 store 订阅），`storage` / `provider` / `now`
 * 全部可注入 → 可被 `node --experimental-strip-types` 直跑单测。
 */
import type {
  CapabilityErrorKind,
  CapabilityItem,
  CapabilityItemSnapshot,
  CapabilityReport,
  CapabilityRun,
  Chapter,
  LearnerProfile,
  LearningGoal,
} from "../../domain";
import { capabilityItemId, capabilityTaskId, newId, snapshotItems } from "../../domain";
import type { CapabilityPerTaskScore } from "../../engine";
import {
  buildReport,
  CAPABILITY_LIMITS,
  CAPABILITY_THRESHOLD,
  createGoalPaper,
  PAPER_MODE_MIN_CHAPTERS,
} from "../../engine";
import type { CapabilityMaterial, CapabilityScoreDraft, IndexedCapabilityItem } from "../../ai/capability";
import {
  extractCapabilityItems,
  generateCapabilityTasks,
  scoreCapabilityWithAi,
  toIndexedItems,
} from "../../ai/capability";
import type { AIProvider } from "../../ai/types";
import { AiProviderError } from "../../ai/types";
import type { StorageAdapter } from "../../storage";
import { storage as defaultStorage } from "../../stores/useLoopStore";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { locateQuote } from "../learn/evidence-anchor";
import { loadChapterRows, scopeOf } from "./goal-util";

/* ------------------------------------------------------------------ */
/* 统一返回                                                            */
/* ------------------------------------------------------------------ */

export type CapabilityOutcome<T> =
  | { status: "ok"; data: T }
  | { status: "no-ai" }
  | { status: "no-scope" }
  | { status: "no-material" }
  | { status: "no-items" }
  | { status: "error"; errorKind: CapabilityErrorKind };

/** 阶段 1（客观摸底卷）状态。 */
export type ObjectiveStage =
  | { status: "skipped" }
  | { status: "pending"; paperId: string }
  | { status: "done"; paperId: string; totalScore: number };

/* ------------------------------------------------------------------ */
/* 作用域与素材                                                        */
/* ------------------------------------------------------------------ */

interface ResolvedScope {
  chapters: Chapter[];
  docChapters: Map<string, Chapter[]>;
}

/**
 * 目标作用域 → 范围章 + 各文档全量章（choice 干扰项源）。
 *
 * 回退语义与 `goal-util.scopeOf` 一致：`requiredChapterIds` 为空 → 全库章
 * （与章就绪度同源，不另造一套口径）。
 */
async function resolveScope(goal: LearningGoal, store: StorageAdapter): Promise<ResolvedScope> {
  const rows = await loadChapterRows(store);
  const scoped = scopeOf(goal, rows);
  const chapters = scoped.map((r) => r.chapter);
  const docChapters = new Map<string, Chapter[]>();
  for (const row of rows) {
    const list = docChapters.get(row.chapter.documentId) ?? [];
    list.push(row.chapter);
    docChapters.set(row.chapter.documentId, list);
  }
  return { chapters, docChapters };
}

/** 范围章 → AI 素材（标题 + 要点；两者皆空则不算素材）。 */
function materialOf(chapters: readonly Chapter[]): CapabilityMaterial[] {
  return chapters
    .map((c) => ({ chapterTitle: c.title, keyPoints: c.keyPoints }))
    .filter((m) => m.chapterTitle.trim().length > 0 || m.keyPoints.length > 0);
}

/**
 * 无范围章时的分类（对齐 TC-EDGE-02）。
 *
 * - 目标**显式圈定**过范围但一个都没解析到 → `no-scope`（范围已失效，需回去改目标）；
 * - 从未圈定（回退全库）且全库无章 → `no-material`（先导入资料）。
 */
function emptyScopeStatus(goal: LearningGoal): "no-scope" | "no-material" {
  return goal.requiredChapterIds && goal.requiredChapterIds.length > 0
    ? "no-scope"
    : "no-material";
}

/* ------------------------------------------------------------------ */
/* ① 能力框架：AI 提炼 / 手动建立 / 编辑保存                            */
/* ------------------------------------------------------------------ */

/**
 * AI 提炼能力项（**覆盖**清单）。
 *
 * 顺序固定：取目标 → 取范围素材 → 无 AI 早退 → 调用 → **落库**。
 * 失败（含解析失败）时**不覆盖已有清单**（UC-01 边界）。
 */
export async function proposeCapabilityItems(input: {
  goalId: string;
  storage?: StorageAdapter;
  provider?: AIProvider;
  learner?: LearnerProfile | undefined;
  now?: number;
}): Promise<CapabilityOutcome<{ items: CapabilityItem[]; truncated: boolean }>> {
  const store = input.storage ?? defaultStorage;
  const now = input.now ?? Date.now();
  const goal = (await store.listGoals()).find((g) => g.id === input.goalId);
  if (!goal) return { status: "error", errorKind: "generic" };

  const scope = await resolveScope(goal, store);
  if (scope.chapters.length === 0) return { status: emptyScopeStatus(goal) };
  const material = materialOf(scope.chapters);
  if (material.length === 0) return { status: "no-material" };

  // 无 AI：**落库之前**早退（零写入）
  const provider = input.provider ?? buildActiveProvider();
  if (!provider.isConfigured()) return { status: "no-ai" };

  try {
    const learner = input.learner ?? (await store.getProfile());
    const draft = await extractCapabilityItems(provider, {
      goalTitle: goal.title,
      goalType: goal.type,
      ...(goal.description ? { goalDescription: goal.description } : {}),
      material,
      ...(learner ? { learner } : {}),
    });
    if (draft.items.length === 0) return { status: "error", errorKind: "parse" };

    const items = buildItems(goal.id, draft.items, "ai", now);
    await store.saveCapabilityItems(goal.id, items);
    return {
      status: "ok",
      data: { items, truncated: draft.items.length >= CAPABILITY_LIMITS.maxItems },
    };
  } catch (err) {
    return { status: "error", errorKind: classifyCapabilityError(err) };
  }
}

/** 从 label / description 构建能力项（id 内容派生 ⇒ 同 label 同 id，历史报告不错配）。 */
function buildItems(
  goalId: string,
  rows: readonly { label: string; description?: string }[],
  source: CapabilityItem["source"],
  now: number,
): CapabilityItem[] {
  return rows.map((row, i) => ({
    id: capabilityItemId(goalId, row.label),
    goalId,
    label: row.label,
    ...(row.description !== undefined ? { description: row.description } : {}),
    weight: 1,
    threshold: CAPABILITY_THRESHOLD,
    source,
    // 递增 1ms：存储按 createdAt 升序返回 = 用户看到的顺序，避免同批同刻乱序。
    createdAt: now + i,
  }));
}

/**
 * 手动建立清单（无 AI 路径；UC-02）。
 *
 * 与既有清单按 id 合并且**保留既有项的 weight / threshold / createdAt** ——
 * 否则「只想补一个能力项」会把用户调过的阈值悄悄重置。
 */
export async function saveManualCapabilityItems(input: {
  goalId: string;
  labels: readonly string[];
  storage?: StorageAdapter;
  now?: number;
}): Promise<CapabilityOutcome<CapabilityItem[]>> {
  const store = input.storage ?? defaultStorage;
  const now = input.now ?? Date.now();
  const labels: string[] = [];
  for (const raw of input.labels) {
    const label = raw.trim().slice(0, CAPABILITY_LIMITS.labelChars);
    const id = capabilityItemId(input.goalId, label);
    if (!label || labels.some((l) => capabilityItemId(input.goalId, l) === id)) continue;
    labels.push(label);
  }
  if (labels.length === 0) return { status: "no-items" };
  if (labels.length > CAPABILITY_LIMITS.maxItems) return { status: "error", errorKind: "generic" };

  const existing = await store.listCapabilityItems(input.goalId);
  const byId = new Map(existing.map((i) => [i.id, i]));
  const next: CapabilityItem[] = labels.map((label, i) => {
    const id = capabilityItemId(input.goalId, label);
    const prev = byId.get(id);
    if (prev) return prev; // 同 label = 同一能力项：保留用户调过的 weight / threshold / createdAt
    return {
      id,
      goalId: input.goalId,
      label,
      weight: 1,
      threshold: CAPABILITY_THRESHOLD,
      source: "manual",
      createdAt: now + i,
    };
  });
  await store.saveCapabilityItems(input.goalId, next);
  return { status: "ok", data: next };
}

/**
 * 保存整份清单（页面上的改 label / 改阈值 / 增删项 → 一次全量写回）。
 *
 * 校验：label 非空、条数在 `1..maxItems`、`goalId` 一致（防止把别的目标的项
 * 串进来）；`id` 由内容派生，故「改 label」= 新项、「改阈值」= 同 id 更新。
 */
export async function saveCapabilityItemsForGoal(
  goalId: string,
  items: readonly CapabilityItem[],
  store: StorageAdapter = defaultStorage,
): Promise<CapabilityOutcome<CapabilityItem[]>> {
  const clean: CapabilityItem[] = [];
  for (const item of items) {
    const label = item.label.trim().slice(0, CAPABILITY_LIMITS.labelChars);
    if (!label || item.goalId !== goalId) continue;
    const id = capabilityItemId(goalId, label);
    if (clean.some((c) => c.id === id)) continue; // 同 label 去重
    const description = item.description?.trim().slice(0, CAPABILITY_LIMITS.descChars);
    clean.push({
      id,
      goalId,
      label,
      ...(description ? { description } : {}),
      weight: item.weight,
      threshold: item.threshold,
      source: item.source,
      createdAt: item.createdAt,
    });
  }
  if (clean.length === 0) return { status: "no-items" };
  if (clean.length > CAPABILITY_LIMITS.maxItems) return { status: "error", errorKind: "generic" };
  await store.saveCapabilityItems(goalId, clean);
  return { status: "ok", data: clean };
}

/* ------------------------------------------------------------------ */
/* ② 发起评测                                                          */
/* ------------------------------------------------------------------ */

/**
 * 发起一次评测：冻结能力项快照 → 生成场景任务 →（范围章 ≥3 时）建客观摸底卷。
 *
 * 无 AI 时**不建 run、不建卷**（§5.2）；任务生成失败时**已建的卷保留**
 * （用户可先答阶段 1，之后再来重试阶段 2）。
 */
export async function startCapabilityRun(input: {
  goalId: string;
  storage?: StorageAdapter;
  provider?: AIProvider;
  learner?: LearnerProfile | undefined;
  now?: number;
}): Promise<CapabilityOutcome<{ run: CapabilityRun; paperId?: string }>> {
  const store = input.storage ?? defaultStorage;
  const now = input.now ?? Date.now();
  const goal = (await store.listGoals()).find((g) => g.id === input.goalId);
  if (!goal) return { status: "error", errorKind: "generic" };

  // ⚠️ 顺序契约：**先判 AI 就绪，再判清单**（对齐 TC-UC06-01「未配置 AI 时
  // 两个入口都返 no-ai」）。UI 侧「开始评测」本身在清单为空时即禁用，故
  // no-ai 不会被误显示成「缺清单」。
  const provider = input.provider ?? buildActiveProvider();
  if (!provider.isConfigured()) return { status: "no-ai" }; // 零写入

  const items = await store.listCapabilityItems(input.goalId);
  if (items.length < CAPABILITY_LIMITS.minItems) return { status: "no-items" };

  const scope = await resolveScope(goal, store);
  if (scope.chapters.length === 0) return { status: emptyScopeStatus(goal) };
  const material = materialOf(scope.chapters);
  if (material.length === 0) return { status: "no-material" };

  const snapshot = snapshotItems(items);
  const indexed = toIndexedItems(snapshot);
  const runId = newId("caprun");

  try {
    const learner = input.learner ?? (await store.getProfile());
    const draft = await generateCapabilityTasks(provider, {
      goalTitle: goal.title,
      items: indexed,
      material,
      ...(learner ? { learner } : {}),
    });
    if (draft.tasks.length === 0) return { status: "error", errorKind: "parse" };

    const tasks = draft.tasks.map((t, i) => ({
      id: capabilityTaskId(runId, i),
      prompt: t.prompt,
      ...(t.deliverableHint !== undefined ? { deliverableHint: t.deliverableHint } : {}),
      rubric: t.itemIds.map((itemId) => ({ itemId, criteria: [...t.criteria] })),
    }));

    // 阶段 1：范围章 ≥ final-test 最小章数才出卷（不足则阶段 1 = skipped，
    // 不影响阶段 2 与报告 —— 决策 D9-A 口径 4）。
    let paperId: string | undefined;
    if (scope.chapters.length >= PAPER_MODE_MIN_CHAPTERS["final-test"]) {
      try {
        const paper = createGoalPaper({
          chapters: scope.chapters,
          docChapters: scope.docChapters,
          learnerState: await store.getLearnerState(),
          ...(learner ? { profile: learner } : {}),
          // 「客观摸底卷」：纯客观题，本地可判（不依赖 AI 批改）。
          allowSubjective: false,
          now,
        });
        if (paper.questions.length > 0) {
          await store.savePaper(paper);
          paperId = paper.id;
        }
      } catch {
        /* 阶段 1 建卷失败不阻塞阶段 2（卷可选，报告仅标「未完成」）。 */
      }
    }

    const run: CapabilityRun = {
      id: runId,
      goalId: input.goalId,
      status: "draft",
      items: snapshot,
      tasks,
      answers: {},
      ...(paperId ? { paperId } : {}),
      createdAt: now,
    };
    await store.saveCapabilityRun(run);
    return { status: "ok", data: { run, ...(paperId ? { paperId } : {}) } };
  } catch (err) {
    return { status: "error", errorKind: classifyCapabilityError(err) };
  }
}

/* ------------------------------------------------------------------ */
/* ③ 提交作答 → 评分 → 报告 → 证据流                                    */
/* ------------------------------------------------------------------ */

/**
 * 提交作答。内部顺序是**契约**（见方案 §8.11），不得调整：
 *
 * ① 读 run；② 校验能力项；③ 校验作答长度；④ 无 AI → 零写入返 `no-ai`；
 * ⑤ **先落 run(collected)**；⑥ AI 评分；⑦ 锚定；⑧ `buildReport`；
 * ⑨ 落报告 + run(scored)；⑩ 追加证据（失败不影响主流程）；⑪ 无阶段 1 前置校验。
 */
export async function submitCapabilityRun(input: {
  runId: string;
  answers: Record<string, string>;
  storage?: StorageAdapter;
  provider?: AIProvider;
  now?: number;
}): Promise<CapabilityOutcome<{ report: CapabilityReport; run: CapabilityRun }>> {
  const store = input.storage ?? defaultStorage;
  const now = input.now ?? Date.now();

  // ①
  const run = await store.getCapabilityRun(input.runId);
  if (!run) return { status: "error", errorKind: "generic" };
  // ②
  if (run.items.length < CAPABILITY_LIMITS.minItems) return { status: "no-items" };

  const answers: Record<string, string> = {};
  for (const task of run.tasks) answers[task.id] = (input.answers[task.id] ?? "").trim();

  // ③ 全部作答都低于下限 = 没有任何可评依据 → 拒绝（UI 同样会禁用提交）。
  // 部分过短允许提交：过短任务按「依据不足」计 0（§7.3 允许带提示提交）。
  const scoreable = run.tasks.filter(
    (t) => (answers[t.id] ?? "").length >= CAPABILITY_LIMITS.answerMinChars,
  );
  if (run.tasks.length > 0 && scoreable.length === 0) {
    return { status: "error", errorKind: "generic" };
  }

  // ④ 无 AI：**不改 run**（保留原 draft，作答草稿零丢失）
  const provider = input.provider ?? buildActiveProvider();
  if (!provider.isConfigured()) return { status: "no-ai" };

  // ⑤ 用户产出先落库（此后评分失败也可重评）
  const collected: CapabilityRun = { ...run, status: "collected", answers, submittedAt: now };
  await store.saveCapabilityRun(collected);

  try {
    const goal = (await store.listGoals()).find((g) => g.id === run.goalId);
    const learner = await store.getProfile();
    const indexed = toIndexedItems(run.items);
    const perTask: CapabilityPerTaskScore[] = [];

    for (const [i, task] of run.tasks.entries()) {
      const answer = answers[task.id] ?? "";
      // 空作答不调 AI：直接记 0 分 + 无引用（诚实标注「依据不足」，省一次调用）。
      if (answer.length === 0) {
        for (const r of task.rubric) {
          perTask.push({ taskId: task.id, itemId: r.itemId, score: 0, evidence: [], unanchored: true });
        }
        continue;
      }
      const draft = await scoreCapabilityWithAi(provider, {
        goalTitle: goal?.title ?? "",
        items: indexed,
        tasks: [
          {
            index: i + 1,
            prompt: task.prompt,
            criteria: task.rubric.flatMap((r) => r.criteria),
            answer,
          },
        ],
        ...(learner ? { learner } : {}),
      });
      perTask.push(
        ...anchorCapabilityEvidence({
          taskId: task.id,
          answer,
          draft,
          // 白名单：只采信本任务 rubric 覆盖的能力项（防模型越权给分）。
          itemIds: task.rubric.map((r) => r.itemId),
        }),
      );
    }

    const objective = await objectiveOf(run, store);
    const report = buildReport({
      goalId: run.goalId,
      runId: run.id,
      items: run.items,
      perTask,
      ...(objective ? { objective } : {}),
      now,
    });
    await store.saveCapabilityReport(report);
    const scored: CapabilityRun = { ...collected, status: "scored" };
    await store.saveCapabilityRun(scored);

    try {
      await store.appendEvidence({
        at: now,
        kind: "capability",
        subjectKind: "goal",
        subjectId: run.goalId,
        verdict: report.approved ? "pass" : "fail",
        delta: 0,
        sourceId: report.id,
      });
    } catch {
      /* 证据落库失败不阻塞报告主流程（与 scheduleRestatementReview 同款）。 */
    }
    return { status: "ok", data: { report, run: scored } };
  } catch (err) {
    return { status: "error", errorKind: classifyCapabilityError(err) };
  }
}

/** 阶段 1 参考分（判卷结果 → `objective` 块）；未判卷 → `undefined`。 */
async function objectiveOf(
  run: CapabilityRun,
  store: StorageAdapter,
): Promise<{ paperId: string; totalScore: number } | undefined> {
  if (!run.paperId) return undefined;
  const result = (await store.listPaperResults()).find((r) => r.paperId === run.paperId);
  return result ? { paperId: run.paperId, totalScore: result.totalScore } : undefined;
}

/**
 * 锚定（纯函数，可直跑单测）——「零伪造引用」落地点。
 *
 * 把 `draft.scores[].quotes` 逐条在**该任务的作答原文**里定位：
 * - **`itemIds` 白名单**：模型越出自己的 rubric 给分（任务只考察 1–2 项，却返回
 *   第三项的分）时**丢弃该条** —— 让任务去证明它没考察的能力项，正是决策 D9-A
 *   要防的「假因果」；
 * - 锚不上 → 丢弃该条引用（绝不糊一个近似区间）；
 * - 有条引用但一条都没锚上 → `unanchored: true`（保留分数与理由并显式警示）；
 * - 模型未给该能力项打分 → 不产条目（报告会判定为 `unknown`，不进加权分母）。
 *
 * ⚠️ 与方案 §8.11 ⑥ 的差异：签名要求显式 `taskId`（而非 `taskIdOfItem` 回调 +
 * 全部作答的 `answers` 映射），且只在**本任务作答**里锚定。原因：`buildReport`
 * 需要「逐任务逐项」的原始分才能算 `fromTaskIds`；把全部作答混在一起锚定，会让
 * B 任务的引文去支撑 A 任务的分数（跨任务串味）。
 */
export function anchorCapabilityEvidence(input: {
  taskId: string;
  answer: string;
  draft: CapabilityScoreDraft;
  /** 本任务 rubric 覆盖的能力项 id（白名单）；缺省 = 不过滤（单测直接用）。 */
  itemIds?: readonly string[];
}): CapabilityPerTaskScore[] {
  const allowed = input.itemIds ? new Set(input.itemIds) : undefined;
  const out: CapabilityPerTaskScore[] = [];
  for (const score of input.draft.scores) {
    if (allowed && !allowed.has(score.itemId)) continue; // 越出 rubric → 丢弃
    const evidence = [];
    for (const raw of score.quotes) {
      const quote = raw.trim();
      if (!quote) continue;
      const hit = locateQuote(input.answer, quote);
      if (!hit) continue; // 锚不上即丢弃
      evidence.push({ quote, start: hit.start, end: hit.end });
    }
    const unanchored = score.quotes.length > 0 && evidence.length === 0;
    out.push({
      taskId: input.taskId,
      itemId: score.itemId,
      score: score.score,
      ...(score.rationale !== undefined ? { rationale: score.rationale } : {}),
      evidence,
      ...(unanchored ? { unanchored: true } : {}),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* ④ 只读包装（避免 UI 直接摸 storage）                                 */
/* ------------------------------------------------------------------ */

export async function listGoalCapabilityItems(
  goalId: string,
  store: StorageAdapter = defaultStorage,
): Promise<CapabilityItem[]> {
  return store.listCapabilityItems(goalId);
}

export async function listGoalCapabilityRuns(
  goalId: string,
  store: StorageAdapter = defaultStorage,
): Promise<CapabilityRun[]> {
  return store.listCapabilityRuns(goalId);
}

export async function listGoalCapabilityReports(
  goalId: string,
  store: StorageAdapter = defaultStorage,
): Promise<CapabilityReport[]> {
  return store.listCapabilityReports(goalId);
}

/** 最近一份报告（`createdAt` 降序取首条）；无报告 → `undefined`。 */
export async function latestCapabilityReport(
  goalId: string,
  store: StorageAdapter = defaultStorage,
): Promise<CapabilityReport | undefined> {
  return (await store.listCapabilityReports(goalId))[0];
}

export async function getCapabilityRunById(
  id: string,
  store: StorageAdapter = defaultStorage,
): Promise<CapabilityRun | undefined> {
  return store.getCapabilityRun(id);
}

/** 阶段 1 状态：`run.paperId` 是否有判卷结果（阶段 2 **不依赖**它）。 */
export async function objectiveStageOf(
  run: CapabilityRun,
  store: StorageAdapter = defaultStorage,
): Promise<ObjectiveStage> {
  if (!run.paperId) return { status: "skipped" };
  const result = (await store.listPaperResults()).find((r) => r.paperId === run.paperId);
  return result
    ? { status: "done", paperId: run.paperId, totalScore: result.totalScore }
    : { status: "pending", paperId: run.paperId };
}

/* ------------------------------------------------------------------ */
/* ⑤ 异常分类                                                          */
/* ------------------------------------------------------------------ */

/**
 * 异常 → 稳定分类（不把异常栈丢给用户；文案由 UI 走 i18n）。
 * 与 `classifyRestatementError` 同口径：`not-configured` 是竞态，
 * `request-failed` 主要是解析失败，其余（storage 链路）归 `fetch`。
 */
function classifyCapabilityError(err: unknown): CapabilityErrorKind {
  if (err instanceof AiProviderError) {
    if (err.code === "not-configured") return "not-configured";
    if (err.code === "request-failed") return "parse";
    return "generic";
  }
  return "fetch";
}

/** 供 UI 复用的能力项快照视图（清单 → 报告渲染所需形状）。 */
export function snapshotOf(items: readonly CapabilityItem[]): CapabilityItemSnapshot[] {
  return snapshotItems(items);
}

/** 供 UI 复用的编号视图（与 AI 提示词里的编号一致）。 */
export function indexedOf(items: readonly CapabilityItemSnapshot[]): IndexedCapabilityItem[] {
  return toIndexedItems(items);
}
