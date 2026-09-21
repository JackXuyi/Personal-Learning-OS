/**
 * 数据可携带单测（F4；方案 docs/data-portability-export-import-design-2026-09.md §11/§12）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:portability
 *
 * 覆盖：round-trip（导出 → 空库 → 导入 → 再导出，逐字段深比较）、版本与损坏拒绝、
 * merge/replace 语义与冲突规则、`saveGraph` 收口、证据去重与上限、孤儿、Markdown、
 * `clearAll` 的三后端语义、白名单覆盖率、以及两条「反模式守卫」（导出零写入、
 * 导出不重复读库）。
 *
 * 全部跑在 `InMemoryStorage`（零 IO / 零 IPC / 零浏览器）；`local` 后端用最小
 * localStorage 替身验证键清理契约（本仓库禁起浏览器，见
 * rules/no-headless-browser-validation.mdc）。
 */
import assert from "node:assert/strict";
import { InMemoryStorage, EVIDENCE_LOG_MAX } from "../src/storage/memory.ts";
import type { StorageAdapter } from "../src/storage/types.ts";
import {
  BACKUP_FIELDS,
  BACKUP_KIND,
  COUNT_KEYS,
  EXPORT_VERSION,
  chapterMarkdownName,
  countsOf,
  defaultBackupName,
  humanBytes,
  migrateBackup,
  parseBackup,
  preImportBackupName,
} from "../src/features/data/portability/backup-format.ts";
import type { BackupData, BackupFile } from "../src/features/data/portability/backup-format.ts";
import { exportBackup } from "../src/features/data/portability/export-service.ts";
import { importBackup } from "../src/features/data/portability/import-service.ts";
import { chapterBodyOf, chapterToMarkdown } from "../src/features/data/portability/markdown-export.ts";
import { installFakeLocalStorage } from "./fake-local-storage.ts";

const results: string[] = [];
let failures = 0;

function check(name: string, fn: () => void | Promise<void>): void | Promise<void> {
  const record = (ok: boolean, detail?: string): void => {
    if (ok) results.push(`✓ ${name}`);
    else {
      failures += 1;
      results.push(`✗ ${name}\n    ${detail ?? ""}`);
    }
  };
  try {
    const out = fn();
    if (out instanceof Promise) {
      return out.then(
        () => record(true),
        (err: unknown) => record(false, errText(err)),
      );
    }
    record(true);
  } catch (err) {
    record(false, errText(err));
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? `${err.message}` : String(err);
}

/* ================================================================== */
/* fixture                                                             */
/* ================================================================== */

/** 段落正文：同一段在文档里**出现两次**（方案 §11.2 要求的样本形态）。 */
const PARA = "编码器把输入序列映射为隐向量，再由解码器逐词生成输出。";
const FULL_TEXT = `${PARA}\n\n中间插一段别的说明。\n\n${PARA}\n`;

/** 一个覆盖全部 20 类实体的样本（每类 ≥2 条）。 */
async function makeFullSample(storage: StorageAdapter): Promise<void> {
  // 1 documents（2 份；一含 overview/analysis，一含 textPreview）
  await storage.saveDocument({
    id: "doc-1",
    title: "注意力机制导论",
    format: "pdf",
    path: "/tmp/a.pdf",
    importedAt: 1_700_000_000_000,
    status: "ready",
    goalIds: ["goal-1"],
    rawSizeBytes: 12345,
    textPreview: FULL_TEXT,
    analysis: { chaptersAt: 1_700_000_100_000, conceptsAt: 1_700_000_200_000, keyPointsAt: 1_700_000_300_000, model: "qwen3.5:4b" },
    overview: {
      gist: "讲清注意力与编解码结构的关系。",
      sections: [{ heading: "背景", detail: "序列建模的老问题。" }],
      prerequisites: ["线性代数"],
      keywords: ["注意力", "Transformer"],
      generatedAt: 1_700_000_400_000,
      sourceChars: FULL_TEXT.length,
      mode: "single",
      model: "qwen3.5:4b",
    },
  });
  await storage.saveDocument({
    id: "doc-2",
    title: "向量检索入门",
    format: "markdown",
    importedAt: 1_700_000_500_000,
    status: "imported",
    textPreview: "检索是把查询映射到同一空间再比距离。",
  });

  // 2 chapters（doc-1 两章、doc-2 一章）
  await storage.saveChapters("doc-1", [
    {
      id: "ch-1",
      documentId: "doc-1",
      order: 1,
      title: "第 1 章 编码器",
      contentRef: { start: 0, end: PARA.length },
      keyPoints: ["编码器输出是定长隐向量", "多头注意力提供多个子空间", "4.2.2", "."],
      keyPointRefs: [
        { point: "编码器输出是定长隐向量", quote: "编码器把输入序列映射为隐向量", start: 0, end: 15 },
        { point: "多头注意力提供多个子空间", quote: "由解码器逐词生成输出", start: 24, end: 34 },
      ],
      unitIds: ["u-1"],
      status: "ready",
      createdAt: 1_700_000_600_000,
    },
    {
      id: "ch-2",
      documentId: "doc-1",
      order: 2,
      title: "第 2 章 解码器",
      contentRef: { start: 0, end: FULL_TEXT.length },
      keyPoints: ["自回归逐词生成"],
      unitIds: ["u-2"],
      status: "not-started",
      createdAt: 1_700_000_700_000,
    },
  ]);
  await storage.saveChapters("doc-2", [
    {
      id: "ch-3",
      documentId: "doc-2",
      order: 1,
      title: "第 1 章 相似度",
      contentRef: { start: 0, end: 12 },
      keyPoints: [],
      unitIds: [],
      status: "learning",
      createdAt: 1_700_000_800_000,
    },
  ]);

  // 3 sections
  await storage.saveSections([
    {
      id: "sec-1",
      chapterId: "ch-1",
      documentId: "doc-1",
      title: "1.1 结构",
      level: 2,
      index: 0,
      contentRef: { start: 0, end: 10 },
      createdAt: 1_700_000_900_000,
    },
    {
      id: "sec-2",
      chapterId: "ch-2",
      documentId: "doc-1",
      title: "2.1 生成",
      level: 2,
      index: 1,
      contentRef: { start: 10, end: 20 },
      createdAt: 1_700_001_000_000,
    },
  ]);

  // 4 chunks（doc-1 两条保证「同一段文字出现两次」）
  await storage.saveChunks([
    {
      id: "ck-1",
      documentId: "doc-1",
      chapterId: "ch-1",
      sectionId: "sec-1",
      content: PARA,
      position: 0,
      tokenCount: 36,
      knowledgeIds: ["u-1"],
      metadata: { heading: "1.1 结构", page: 3, sourceLocation: "1.1" },
      createdAt: 1_700_001_100_000,
    },
    {
      id: "ck-2",
      documentId: "doc-1",
      chapterId: "ch-2",
      content: PARA,
      position: 1,
      knowledgeIds: [],
      createdAt: 1_700_001_200_000,
    },
  ]);

  // 5/6/7 概念、关系、向量（向量本体必须被导出侧剥掉 —— D4）
  await storage.saveKnowledgeUnits([
    {
      id: "u-1",
      title: "自注意力",
      kind: "concept",
      summary: "序列内部两两加权。",
      sourceDocumentId: "doc-1",
      tags: ["注意力"],
      createdAt: 1_700_001_300_000,
      evidence: { documentId: "doc-1", start: 0, end: 10, quote: "编码器把输入序列" },
    },
    { id: "u-2", title: "解码", kind: "procedure", tags: [], createdAt: 1_700_001_400_000 },
  ]);
  await storage.saveRelations([
    { id: "rel-1", fromId: "u-1", toId: "u-2", type: "prerequisite", strength: 0.7 },
    { id: "rel-2", fromId: "u-2", toId: "u-1", type: "related" },
  ]);
  await storage.saveEmbeddings([
    {
      id: "emb-1",
      targetType: "chunk",
      targetId: "ck-1",
      model: "qwen3-0.6b",
      vectorDim: 3,
      vector: [0.1, 0.2, 0.3],
      createdAt: 1_700_001_500_000,
    },
    {
      id: "emb-2",
      targetType: "chunk",
      targetId: "ck-2",
      model: "qwen3-0.6b",
      vectorDim: 3,
      vector: [0.4, 0.5, 0.6],
      createdAt: 1_700_001_600_000,
    },
  ]);

  // 8/9/10 试卷、草稿、判卷
  await storage.savePaper({
    id: "paper-1",
    scope: { chapterIds: ["ch-1"], mode: "unit-test" },
    title: "第 1 章小测",
    questions: [
      {
        id: "q-1",
        chapterId: "ch-1",
        type: "choice",
        cognitiveLevel: "understand",
        prompt: "自注意力的作用？",
        options: ["加权聚合", "降维"],
        answer: "0",
        difficulty: 0.3,
      },
      {
        id: "q-2",
        chapterId: "ch-1",
        type: "qa",
        cognitiveLevel: "apply",
        prompt: "举例说明多头注意力。",
        referenceAnswer: "多个子空间并行。",
        difficulty: 0.6,
      },
    ],
    status: "open",
    createdAt: 1_700_001_700_000,
  });
  await storage.savePaper({
    id: "paper-2",
    scope: { chapterIds: ["ch-2"], mode: "stage-test" },
    title: "阶段测",
    questions: [],
    status: "done",
    createdAt: 1_700_001_800_000,
    submittedAt: 1_700_001_900_000,
  });
  await storage.savePaperDraft("paper-1", { "q-1": "0" });
  await storage.savePaperResult({
    paperId: "paper-2",
    totalScore: 0.72,
    perChapter: { "ch-2": { score: 0.72, previousMastery: 0, mastery: 0.72 } },
    wrongQuestions: [{ questionId: "q-1", yourAnswer: "1", aiFeedback: "再看定义" }],
    objective: { weight: 1, earned: 0.72 },
    subjectiveAnswers: { "q-2": "并行子空间" },
    subjectiveScores: { "q-2": 0.8 },
    createdAt: 1_700_002_000_000,
  });

  // 11/12 学习进度、画像
  await storage.saveLearnerState({
    byUnit: {
      "ch-1": {
        mastery: 0.8,
        confidence: 0.7,
        attempts: 3,
        correctCount: 2,
        cognitiveLevel: "understand",
        misconceptions: ["把注意力当成线性层"],
        lastReviewedAt: 1_700_002_100_000,
        lastAssessmentAt: 1_700_002_000_000,
        nextReviewAt: 1_700_100_000_000,
        applicationAbility: 0.5,
        interviewAbility: 0.4,
      },
      "ch-2": {
        mastery: 0.3,
        confidence: 0.4,
        attempts: 1,
        correctCount: 0,
        cognitiveLevel: "remember",
        misconceptions: [],
        applicationAbility: 0.1,
        interviewAbility: 0.1,
      },
    },
  });
  await storage.saveProfile({
    level: "intermediate",
    weeklyMinutes: 420,
    preferences: { depth: "depth", style: "reading" },
    background: "写过一些后端",
    backgroundSource: "manual",
    updatedAt: 1_700_002_200_000,
  });

  // 13/14/15 复述、自测卡、划线
  await storage.saveRestatement({
    id: "rest-1",
    documentId: "doc-1",
    chapterId: "ch-1",
    text: "注意力就是对输入做加权求和。",
    createdAt: 1_700_002_300_000,
    feedback: {
      at: 1_700_002_400_000,
      covered: [{ point: "加权", quote: "加权聚合", start: 0, end: 4 }],
      missed: [{ point: "多头", quote: "", start: 0, end: 0 }],
      errors: [
        {
          quote: "线性层",
          start: 5,
          end: 8,
          correction: "不是线性层，是加权聚合",
          evidence: { quote: "并行", start: 0, end: 2 },
        },
      ],
      advice: "再补一句多头。",
      coverage: 0.5,
      truncated: false,
    },
  });
  await storage.saveRestatement({
    id: "rest-2",
    documentId: "doc-2",
    chapterId: "ch-3",
    text: "检索就是算距离。",
    createdAt: 1_700_002_500_000,
  });
  await storage.saveCardState({
    cardId: "card-1",
    chapterId: "ch-1",
    documentId: "doc-1",
    nextReviewAt: 1_700_200_000_000,
    lastReviewedAt: 1_700_002_600_000,
    reps: 2,
    lastRating: "good",
    lapses: 1,
  });
  await storage.saveCardState({
    cardId: "card-2",
    chapterId: "ch-2",
    documentId: "doc-1",
    lastReviewedAt: 1_700_002_700_000,
    reps: 1,
    lastRating: "hard",
    lapses: 0,
  });
  await storage.saveAnnotation({
    id: "ann-1",
    documentId: "doc-1",
    chapterId: "ch-1",
    quote: "隐向量",
    start: 8,
    end: 11,
    note: "和 embedding 是一回事吗",
    createdAt: 1_700_002_800_000,
    updatedAt: 1_700_002_900_000,
  });
  await storage.saveAnnotation({
    id: "ann-2",
    documentId: "doc-1",
    chapterId: "ch-2",
    quote: "逐词生成",
    start: 24,
    end: 28,
    note: "",
    createdAt: 1_700_003_000_000,
    updatedAt: 1_700_003_000_000,
  });

  // 16 目标
  await storage.saveGoal({
    id: "goal-1",
    type: "career",
    title: "AI 应用工程师",
    description: "读懂 Transformer 栈",
    importance: "high",
    requiredUnitIds: ["u-1"],
    requiredChapterIds: ["ch-1"],
    createdAt: 1_700_003_100_000,
    deadlineAt: 1_720_000_000_000,
  });
  await storage.saveGoal({
    id: "goal-2",
    type: "hobby",
    title: "了解检索",
    importance: "low",
    requiredUnitIds: [],
    createdAt: 1_700_003_200_000,
  });

  // 17 证据（at 互不相同 → 排序确定性可断言）
  await storage.appendEvidence({
    at: 1_700_003_300_000,
    kind: "assessment",
    subjectId: "ch-1",
    verdict: "pass",
    delta: 0.2,
    sourceId: "paper-2",
  });
  await storage.appendEvidence({
    at: 1_700_003_400_000,
    kind: "card",
    subjectId: "card-1",
    verdict: "good",
    delta: 0,
    sourceId: "card-1",
  });

  // 18/19/20 能力项、评测、报告
  await storage.saveCapabilityItems("goal-1", [
    {
      id: "cap-1",
      goalId: "goal-1",
      label: "能解释注意力",
      description: "口述清楚",
      weight: 2,
      threshold: 0.7,
      source: "ai",
      createdAt: 1_700_003_500_000,
    },
    {
      id: "cap-2",
      goalId: "goal-1",
      label: "能实现多头",
      weight: 1,
      threshold: 0.6,
      source: "manual",
      createdAt: 1_700_003_600_000,
    },
  ]);
  await storage.saveCapabilityRun({
    id: "run-1",
    goalId: "goal-1",
    status: "scored",
    items: [
      { id: "cap-1", label: "能解释注意力", description: "口述清楚", weight: 2, threshold: 0.7 },
    ],
    tasks: [{ id: "task-1", prompt: "讲讲自注意力", deliverableHint: "200 字", rubric: [{ itemId: "cap-1", criteria: ["讲清加权"] }] }],
    answers: { "task-1": "自注意力是加权求和" },
    paperId: "paper-2",
    createdAt: 1_700_003_700_000,
    submittedAt: 1_700_003_800_000,
  });
  await storage.saveCapabilityReport({
    id: "rep-1",
    goalId: "goal-1",
    runId: "run-1",
    items: [
      {
        itemId: "cap-1",
        score: 0.8,
        verdict: "pass",
        rationale: "讲清了加权。",
        evidence: [{ quote: "加权求和", start: 5, end: 9 }],
        fromTaskIds: ["task-1"],
      },
    ],
    overall: 0.8,
    approved: true,
    uncoveredItemIds: [],
    objective: { paperId: "paper-2", totalScore: 0.72 },
    createdAt: 1_700_003_900_000,
  });
}

/** 只含空库能承载的最小备份（用于「空备份」用例）。 */
async function emptyBackupJson(): Promise<string> {
  const s = new InMemoryStorage();
  return (await exportBackup(s)).json;
}

/* ================================================================== */
/* 工具                                                                */
/* ================================================================== */

/** 写方法名集合（「零写入」断言用）。 */
const WRITE_PREFIXES = ["save", "delete", "append", "clear"];

interface Counting<T> {
  proxy: T;
  calls: Record<string, number>;
}

/**
 * 调用计数代理：断言「导出是纯读」「被拒绝的导入零写入」这类**负向契约**。
 * 方法统一以真实实例为 `this` 调用，避免 protected 字段被 proxy 干扰。
 */
function counting<T extends object>(target: T): Counting<T> {
  const calls: Record<string, number> = {};
  const proxy = new Proxy(target, {
    get(t, prop, recv) {
      const value = Reflect.get(t, prop, recv) as unknown;
      if (typeof value !== "function") return value;
      const name = String(prop);
      return (...args: unknown[]) => {
        calls[name] = (calls[name] ?? 0) + 1;
        return (value as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  });
  return { proxy: proxy as T, calls };
}

function writeCalls(calls: Record<string, number>): number {
  return Object.entries(calls)
    .filter(([name]) => WRITE_PREFIXES.some((p) => name.startsWith(p)))
    .reduce((sum, [, n]) => sum + n, 0);
}

/** 只比较内容（排除时间戳 / 后端 / 版本这些包级元数据）。 */
function dataOf(file: BackupFile): BackupData {
  return file.data;
}

/** 导出 → 解析（验证「导出的东西一定导得回来」）。 */
function parseOk(json: string): BackupFile {
  const parsed = parseBackup(json);
  assert.ok(parsed.ok, `导出包自身应可解析：${parsed.ok ? "" : parsed.kind}`);
  return parsed.file;
}

/**
 * 最小 localStorage 替身 —— 已抽到 `tests/fake-local-storage.ts`（与 F10 的
 * `storage-documents.test.ts` 共用；两处各抄一份就是脚手架层面的两把尺子）。
 * 本文件的断言**一字未改**，只换了来源。
 */

/* ================================================================== */
/* TC-UC01 · 导出                                                      */
/* ================================================================== */

await check("TC-UC01-01 全量导出产出合法 JSON（kind / exportVersion / backend）", async () => {
  const s = new InMemoryStorage();
  await makeFullSample(s);
  const { json, file } = await exportBackup(s);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  assert.equal(parsed.kind, BACKUP_KIND);
  assert.equal(parsed.exportVersion, EXPORT_VERSION);
  assert.equal(parsed.backend, "memory");
  assert.equal(file.appVersion.length > 0, true);
  assert.ok(file.exportedAt > 0);
  // 无向量本体（D4）
  assert.ok(file.data.embeddings.every((e) => e.vector === undefined), "向量本体不该进包");
});

await check("TC-UC01-02 counts 与 data 同源（不变量 1）+ 派生口径正确", async () => {
  const s = new InMemoryStorage();
  await makeFullSample(s);
  const { file } = await exportBackup(s);
  assert.deepEqual(file.counts, countsOf(file.data));
  // 逐字段与真实数组长度对齐（章 / 能力项是「分组求和」，最容易写错的两个）
  assert.equal(file.counts.documents, file.data.documents.length);
  assert.equal(file.counts.chapters, 3);
  assert.equal(file.counts.capabilityItems, 2);
  assert.equal(file.counts.learnerUnits, 2);
  assert.equal(file.counts.profile, 1);
  assert.equal(COUNT_KEYS.length, 20);
  assert.equal(BACKUP_FIELDS.length, 20);
});

await check("TC-UC01-03 空库可导出（所有 counts 为 0）", async () => {
  const s = new InMemoryStorage();
  const { file } = await exportBackup(s);
  assert.ok(COUNT_KEYS.every((k) => file.counts[k] === 0));
  assert.deepEqual(file.data.documents, []);
  assert.equal("profile" in file.data, false, "未填写画像不该写 key");
});

await check("TC-UC02-01 非 Tauri 环境不触碰桌面通道（守卫返回兜底值）", async () => {
  // node 里没有 Tauri 上下文 → isTauri() 为 false；
  // 这里只断言「守卫的兜底语义」，真实 IPC 不在本仓库自动验证范围（§12.2）。
  const { isDesktopBackupAvailable, backupList } = await import(
    "../src/features/data/portability/desktop-backup.ts"
  );
  assert.equal(isDesktopBackupAvailable(), false);
  assert.deepEqual(await backupList(), []);
});

await check("TC-EDGE-06 白名单覆盖率：20 个字段在样本里都有非空内容", async () => {
  const s = new InMemoryStorage();
  await makeFullSample(s);
  const { file } = await exportBackup(s);
  const data = file.data as unknown as Record<string, unknown>;
  for (const field of BACKUP_FIELDS) {
    const value = data[field];
    assert.ok(value !== undefined, `字段 ${field} 缺失`);
    const size = Array.isArray(value)
      ? value.length
      : Object.keys(value as Record<string, unknown>).length;
    assert.ok(size > 0, `字段 ${field} 在样本里为空 —— 加实体时忘了导出？`);
  }
});

await check("TC-EDGE-07 导出是纯读（写方法零调用）", async () => {
  const { proxy, calls } = counting(new InMemoryStorage());
  await makeFullSample(proxy);
  const before = writeCalls(calls);
  await exportBackup(proxy);
  assert.equal(writeCalls(calls) - before, 0, "导出过程中出现了写调用");
});

await check("TC-EDGE-08 反「两把尺子」：counts 不另起一次读取", async () => {
  const { proxy, calls } = counting(new InMemoryStorage());
  await makeFullSample(proxy);
  const baseline = { ...calls };
  await exportBackup(proxy);
  assert.equal((calls.listDocuments ?? 0) - (baseline.listDocuments ?? 0), 1, "文档被读了两次");
  assert.equal((calls.listEvidence ?? 0) - (baseline.listEvidence ?? 0), 1, "证据被读了两次");
});

/* ================================================================== */
/* TC-UC03 · merge                                                     */
/* ================================================================== */

await check("TC-UC03-01 导出 → 空库 merge 导入 → 再导出，逐字段一致", async () => {
  const source = new InMemoryStorage();
  await makeFullSample(source);
  const { json: backup } = await exportBackup(source);

  const target = new InMemoryStorage();
  const out = await importBackup(target, backup, { mode: "merge" });
  assert.ok(out.ok, `导入失败：${out.ok ? "" : out.kind}`);

  const { file: re } = await exportBackup(target);
  assert.deepEqual(dataOf(re), dataOf(parseOk(backup)));
});

await check("TC-UC03-02 merge 保留本机独有资料（不被备份覆盖）", async () => {
  const source = new InMemoryStorage();
  await makeFullSample(source);
  const { json: backup } = await exportBackup(source);

  const target = new InMemoryStorage();
  await target.saveDocument({
    id: "doc-local",
    title: "本机独有",
    format: "note",
    importedAt: 1,
    status: "imported",
  });
  const out = await importBackup(target, backup, { mode: "merge" });
  assert.ok(out.ok);
  const docs = await target.listDocuments();
  assert.equal(docs.length, 3);
  assert.ok(docs.some((x) => x.id === "doc-local"), "本机独有资料被吃掉了");
});

await check(
  "TC-UC03-03/04/05 learnerState 冲突规则（较新取胜 / 平局与缺失保留本机）",
  async () => {
    const source = new InMemoryStorage();
    await makeFullSample(source);
    const { json: backup } = await exportBackup(source);

    // 情形 A：本机较新（远超样本里的 1_700_002_100_000）→ 保留本机并计数
    const older = new InMemoryStorage();
    await older.saveLearnerState({
      byUnit: {
        "ch-1": {
          mastery: 0.9,
          confidence: 0.9,
          attempts: 9,
          correctCount: 9,
          cognitiveLevel: "apply",
          misconceptions: [],
          lastReviewedAt: 1_800_000_000_000,
          applicationAbility: 0.9,
          interviewAbility: 0.9,
        },
      },
    });
    const a = await importBackup(older, backup, { mode: "merge" });
    assert.ok(a.ok);
    const unit = (await older.getLearnerState()).byUnit["ch-1"];
    assert.equal(unit.mastery, 0.9, "本机较新时不该被备份覆盖");
    assert.equal(a.stats.learnerStateKept, 1);

    // 情形 B：备份较新（样本里 ch-1 = 1_700_002_100_000）→ 采用备份
    const newer = new InMemoryStorage();
    await newer.saveLearnerState({
      byUnit: {
        "ch-1": {
          mastery: 0.1,
          confidence: 0.1,
          attempts: 1,
          correctCount: 0,
          cognitiveLevel: "remember",
          misconceptions: [],
          lastReviewedAt: 100,
          applicationAbility: 0,
          interviewAbility: 0,
        },
      },
    });
    const b = await importBackup(newer, backup, { mode: "merge" });
    assert.ok(b.ok);
    assert.equal((await newer.getLearnerState()).byUnit["ch-1"].mastery, 0.8);
    assert.equal(b.stats.learnerStateKept, 0);

    // 情形 C：两边时间戳都缺失 → 保留本机（确定性规则）
    const timeless = new InMemoryStorage();
    await timeless.saveLearnerState({
      byUnit: {
        "ch-2": {
          mastery: 0.42,
          confidence: 0,
          attempts: 0,
          correctCount: 0,
          cognitiveLevel: "remember",
          misconceptions: [],
          applicationAbility: 0,
          interviewAbility: 0,
        },
      },
    });
    const c = await importBackup(timeless, backup, { mode: "merge" });
    assert.ok(c.ok);
    assert.equal((await timeless.getLearnerState()).byUnit["ch-2"].mastery, 0.42);
    assert.equal(c.stats.learnerStateKept, 1);
    // 样本里 ch-1 有条目、本机没有 → 应被写入
    assert.equal((await timeless.getLearnerState()).byUnit["ch-1"].mastery, 0.8);
  },
);

await check("TC-UC03-06 备份缺画像 → 本机画像不被清空（saveProfile 零调用）", async () => {
  const source = new InMemoryStorage();
  await makeFullSample(source);
  const { json: backup } = await exportBackup(source);

  const without = { ...(JSON.parse(backup) as BackupFile) };
  delete (without.data as Partial<BackupData>).profile;
  without.counts = countsOf(without.data);

  const target = new InMemoryStorage();
  await target.saveProfile({
    level: "beginner",
    preferences: { depth: "breadth", style: "quiz" },
    updatedAt: 1,
  });
  const { proxy, calls } = counting(target);
  const out = await importBackup(proxy, JSON.stringify(without), { mode: "merge" });
  assert.ok(out.ok);
  assert.equal(calls.saveProfile ?? 0, 0, "saveProfile(undefined) 是清除语义，绝不能误触");
  assert.equal((await target.getProfile())?.level, "beginner");
  assert.equal(out.stats.written.profile, undefined);
});

await check("TC-UC03-07/08 saveGraph 收口：图完整且不删本机独有概念", async () => {
  const source = new InMemoryStorage();
  await makeFullSample(source);
  const { json: backup } = await exportBackup(source);

  const target = new InMemoryStorage();
  // 本机独有概念 + 一条备份里没有的关系
  await target.saveKnowledgeUnit({
    id: "u-local",
    title: "本机独有概念",
    kind: "fact",
    tags: [],
    createdAt: 1,
  });
  await target.saveRelation({ id: "rel-local", fromId: "u-local", toId: "u-1", type: "related" });

  const out = await importBackup(target, backup, { mode: "merge" });
  assert.ok(out.ok);

  const graph = await target.getGraph();
  const ids = graph.units.map((u) => u.id).sort();
  assert.deepEqual(ids, ["u-1", "u-2", "u-local"], "概念图丢了本机独有概念");
  const relIds = graph.relations.map((r) => r.id).sort();
  assert.deepEqual(relIds, ["rel-1", "rel-2", "rel-local"]);
  // 与 listKnowledgeUnits 口径一致（blob 与两表/两 key 不分叉）
  assert.equal(graph.units.length, (await target.listKnowledgeUnits()).length);
});

/* ================================================================== */
/* TC-UC04 · replace                                                   */
/* ================================================================== */

await check("TC-UC04-01 replace：库内容 == 备份内容（本机独有消失）", async () => {
  const source = new InMemoryStorage();
  await makeFullSample(source);
  const { json: backup } = await exportBackup(source);

  const target = new InMemoryStorage();
  await makeFullSample(target);
  await target.saveDocument({
    id: "doc-local",
    title: "本机独有",
    format: "note",
    importedAt: 1,
    status: "imported",
  });

  const out = await importBackup(target, backup, { mode: "replace" });
  assert.ok(out.ok);
  assert.equal(out.stats.mode, "replace");
  const { file: re } = await exportBackup(target);
  assert.deepEqual(dataOf(re), dataOf(parseOk(backup)));
  assert.equal((await target.listDocuments()).some((x) => x.id === "doc-local"), false);
});

await check("TC-UC04-02 replace 前自动预备份（入参是可解析的备份 JSON）", async () => {
  const target = new InMemoryStorage();
  await makeFullSample(target);
  const backup = await emptyBackupJson();

  const seen: string[] = [];
  const out = await importBackup(target, backup, {
    mode: "replace",
    preBackup: async (json) => {
      seen.push(json);
      return "/tmp/pre-import-x.plosbak.json";
    },
  });
  assert.ok(out.ok);
  assert.equal(seen.length, 1);
  const snap = parseOk(seen[0]);
  assert.equal(snap.data.documents.length, 2, "预备份应包含本机当前内容");
  assert.equal(out.stats.preBackupPath, "/tmp/pre-import-x.plosbak.json");
});

await check("TC-UC04-03 clearAll 抛错 → sqlite-blocked 且零写入", async () => {
  const target = new InMemoryStorage();
  await makeFullSample(target);
  const backup = await emptyBackupJson();

  const failing = new Proxy(target, {
    get(t, prop, recv) {
      if (prop === "clearAll") return async () => {
        throw new Error("db_clear_rag failed");
      };
      const value = Reflect.get(t, prop, recv) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(t) : value;
    },
  });

  const { proxy: counted, calls } = counting(failing as unknown as InMemoryStorage);
  const out = await importBackup(counted, backup, { mode: "replace" });
  assert.equal(out.ok, false);
  assert.equal(out.ok ? "" : out.kind, "sqlite-blocked");
  // clearAll 自身被调用一次（然后抛错）—— 关键是**没有别的写操作**发生。
  assert.equal((calls.clearAll ?? 0), 1);
  assert.equal(writeCalls(calls) - (calls.clearAll ?? 0), 0, "清空失败后仍有写入");
  assert.equal((await target.listDocuments()).length, 2, "数据应保持原样");
});

/* ================================================================== */
/* TC-UC05 · 单章 Markdown                                             */
/* ================================================================== */

await check("TC-UC05-01 章 + 要点 → Markdown（标题 / 正文 / 要点）", async () => {
  const s = new InMemoryStorage();
  await makeFullSample(s);
  const doc = (await s.getDocument("doc-1"))!;
  const chapter = (await s.listChapters("doc-1"))[0];
  const md = chapterToMarkdown({
    chapter,
    body: chapterBodyOf(doc, chapter),
    pointsHeading: "要点",
  });
  assert.ok(md.startsWith("# 第 1 章 编码器"));
  assert.ok(md.includes(PARA), "正文缺失");
  assert.ok(md.includes("## 要点"));
  assert.ok(md.includes("- 编码器输出是定长隐向量"));
  // 带原文出处（UC-05 期望结果）
  assert.ok(md.includes("  > 编码器把输入序列映射为隐向量"));
});

await check("TC-UC05-02 要点噪声被 cleanKeyPoints 过滤（复用单一真源）", async () => {
  const md = chapterToMarkdown({
    chapter: { title: "T", keyPoints: ["正常要点甲", "4.2.2", ".", "", "正常要点甲"] },
  });
  assert.ok(md.includes("- 正常要点甲"));
  assert.equal(md.includes("4.2.2"), false);
  assert.equal(md.split("- 正常要点甲").length - 1, 1, "去重应只留一条");
});

await check("TC-UC05-03 章无要点 → 只出正文，不写空标题", async () => {
  const md = chapterToMarkdown({ chapter: { title: "T", keyPoints: [] }, body: "正文一段。" });
  assert.ok(md.includes("# T"));
  assert.ok(md.includes("正文一段。"));
  assert.equal(md.includes("## 要点"), false);
});

await check("TC-UC05-04 正文区间越界时夹取（不抛错，与 chapter-preview 同口径）", async () => {
  const body = chapterBodyOf(
    { textPreview: "短文本" },
    { contentRef: { start: 0, end: 9999 } },
  );
  assert.equal(body, "短文本");
});

/* ================================================================== */
/* TC-UC06 · 版本与损坏拒绝（零写入）                                  */
/* ================================================================== */

await check("TC-UC06-01…04 四类非法输入各自归类", async () => {
  const good = parseOk(await emptyBackupJson());

  const cases: [string, string, string][] = [
    ["TC-UC06-04 非法 JSON", "not json{", "not-json"],
    ["TC-UC06-03 kind 不符", JSON.stringify({ kind: "something" }), "not-backup"],
    [
      "TC-UC06-01 版本更新",
      JSON.stringify({ ...good, exportVersion: EXPORT_VERSION + 1 }),
      "version-newer",
    ],
    [
      "TC-UC06-02 counts 与 data 不一致",
      JSON.stringify({ ...good, counts: { ...good.counts, documents: 99 } }),
      "corrupt",
    ],
  ];
  for (const [name, raw, kind] of cases) {
    const parsed = parseBackup(raw);
    assert.equal(parsed.ok, false, `${name} 应被拒`);
    assert.equal(parsed.ok ? "" : parsed.kind, kind, name);
  }
  // 版本号缺失 / 非整数
  const noVersion = parseBackup(JSON.stringify({ kind: BACKUP_KIND, data: good.data }));
  assert.equal(noVersion.ok ? "" : noVersion.kind, "corrupt");
  // 缺字段
  const missing = { ...good, data: { ...good.data } } as Record<string, unknown>;
  delete (missing.data as Record<string, unknown>).chunks;
  const missingParsed = parseBackup(JSON.stringify(missing));
  assert.equal(missingParsed.ok ? "" : missingParsed.kind, "corrupt");
  // 版本低于 1
  const ancient = parseBackup(JSON.stringify({ ...good, exportVersion: 0 }));
  assert.equal(ancient.ok ? "" : ancient.kind, "unsupported-version");
});

await check("TC-UC06-05 拒绝发生在写入之前（写方法零调用 + 库逐字节不变）", async () => {
  const s = new InMemoryStorage();
  await makeFullSample(s);
  const before = JSON.stringify((await exportBackup(s)).file.data);

  const { proxy, calls } = counting(s);
  const bad: [string, string][] = [
    ["not json{", "not-json"],
    ['{"kind":"nope"}', "not-backup"],
  ];
  for (const [raw, kind] of bad) {
    const out = await importBackup(proxy, raw, { mode: "replace" });
    assert.equal(out.ok ? "" : out.kind, kind);
  }
  assert.equal(writeCalls(calls), 0, "非法输入触发了写调用");
  const after = JSON.stringify((await exportBackup(s)).file.data);
  assert.equal(after, before, "库内容发生了变化");
});

await check("TC-UC07-01 导入后无脏 activeGoal（回退首个目标，不抛错）", async () => {
  const source = new InMemoryStorage();
  await makeFullSample(source);
  const { json: backup } = await exportBackup(source);
  // 备份里刻意不含 activeGoalId（白名单外）
  assert.equal(backup.includes("activeGoalId"), false);

  const target = new InMemoryStorage();
  const out = await importBackup(target, backup, { mode: "merge" });
  assert.ok(out.ok);
  const active = await target.getActiveGoal();
  assert.equal(active?.id, "goal-1");
  await target.setActiveGoal("missing-id");
  assert.equal((await target.getActiveGoal())?.id, "goal-1", "id 失效应回退首个目标");
});

/* ================================================================== */
/* TC-EDGE                                                            */
/* ================================================================== */

await check("TC-EDGE-01 证据超上限：写入数 + 被裁数 == 实际追加数", async () => {
  const s = new InMemoryStorage();
  const extra = EVIDENCE_LOG_MAX + 1000;
  const data: BackupData = {
    documents: [],
    chaptersByDocument: {},
    sections: [],
    chunks: [],
    knowledgeUnits: [],
    knowledgeRelations: [],
    embeddings: [],
    papers: [],
    paperDrafts: {},
    paperResults: [],
    learnerState: { byUnit: {} },
    restatements: [],
    cardStates: {},
    annotations: [],
    goals: [],
    evidence: Array.from({ length: extra }, (_, i) => ({
      at: 1_000_000 + i,
      kind: "review" as const,
      subjectId: "ch-1",
      delta: 0,
    })),
    capabilityItems: {},
    capabilityRuns: [],
    capabilityReports: [],
  };
  const file: BackupFile = {
    kind: BACKUP_KIND,
    exportVersion: EXPORT_VERSION,
    appVersion: "test",
    exportedAt: Date.now(),
    backend: "memory",
    counts: countsOf(data),
    data,
  };
  const out = await importBackup(s, JSON.stringify(file), { mode: "merge" });
  assert.ok(out.ok);
  assert.equal(out.stats.written.evidence, extra);
  assert.equal(out.stats.evidenceDropped, extra - EVIDENCE_LOG_MAX);
  assert.equal((await s.listEvidence()).length, EVIDENCE_LOG_MAX);
  // 保留的是最新的一批（溢出丢最旧）
  const kept = await s.listEvidence();
  assert.equal(Math.max(...kept.map((e) => e.at)), 1_000_000 + extra - 1);
});

await check("TC-EDGE-02 证据去重：同样本 merge 两次不翻倍", async () => {
  const source = new InMemoryStorage();
  await makeFullSample(source);
  const { json: backup, file } = await exportBackup(source);

  const target = new InMemoryStorage();
  const first = await importBackup(target, backup, { mode: "merge" });
  assert.ok(first.ok);
  const second = await importBackup(target, backup, { mode: "merge" });
  assert.ok(second.ok);
  assert.equal(second.stats.evidenceSkipped, file.counts.evidence);
  assert.equal((await target.listEvidence()).length, file.counts.evidence);
});

await check("TC-EDGE-03 文件内孤儿：只计数不重建", async () => {
  const source = new InMemoryStorage();
  await makeFullSample(source);
  const { json } = await exportBackup(source);
  const mutated = JSON.parse(json) as BackupFile;
  mutated.data.sections = mutated.data.sections.map((s, i) =>
    i === 0 ? { ...s, chapterId: "chapter-does-not-exist" } : s,
  );
  mutated.data.chunks = mutated.data.chunks.map((c, i) =>
    i === 0 ? { ...c, documentId: "doc-does-not-exist" } : c,
  );

  const target = new InMemoryStorage();
  const out = await importBackup(target, JSON.stringify(mutated), { mode: "merge" });
  assert.ok(out.ok);
  assert.equal(out.stats.orphansSkipped, 2);
  const sections = await target.listSections("chapter-does-not-exist");
  assert.equal(sections.length, 0, "孤儿不该被重建");
  assert.equal((await target.listChunksByDocument("doc-1")).length, 1);
});

await check("TC-EDGE-04 空备份：merge 是 no-op，replace 清空", async () => {
  const empty = await emptyBackupJson();

  const mergeTarget = new InMemoryStorage();
  await makeFullSample(mergeTarget);
  const m = await importBackup(mergeTarget, empty, { mode: "merge" });
  assert.ok(m.ok);
  assert.equal((await mergeTarget.listDocuments()).length, 2, "merge 空备份不该动数据");

  const replaceTarget = new InMemoryStorage();
  await makeFullSample(replaceTarget);
  const r = await importBackup(replaceTarget, empty, { mode: "replace" });
  assert.ok(r.ok);
  assert.equal((await replaceTarget.listDocuments()).length, 0);
  assert.equal((await replaceTarget.listKnowledgeUnits()).length, 0);
  assert.equal((await replaceTarget.listEvidence()).length, 0);
});

await check("TC-EDGE-05 clearAll 在 local 后端：22 个 key 全清、偏好与迁移标记保留", async () => {
  const { LocalStorageAdapter } = await import("../src/storage/local.ts");
  const store = installFakeLocalStorage();
  try {
    const adapter = new LocalStorageAdapter();
    await makeFullSample(adapter);
    // UI 偏好与内部迁移标记（**不该**被清）
    localStorage.setItem("plos:settings:v1", JSON.stringify({ endpoint: "http://x" }));
    localStorage.setItem("plos:lang:v1", "zh");
    localStorage.setItem("plos.rag.migrated.v1", "1");
    localStorage.setItem("plos.graph.migrated.v2", "1");

    const plosKeys = () => [...store.keys()].filter((k) => k.startsWith("plos"));
    assert.ok(plosKeys().length >= 20, "样本应写入 ≥20 个 plos key");

    await adapter.clearAll();

    const leftover = plosKeys().filter((k) => !k.startsWith("plos:") && !k.includes("migrated"));
    assert.deepEqual(leftover, [], `清库后仍有残留：${leftover.join(", ")}`);
    assert.equal(await adapter.getDocument("doc-1"), undefined);
    assert.equal((await adapter.listDocuments()).length, 0);
    assert.equal((await adapter.getProfile()), undefined);
    assert.equal((await adapter.listKnowledgeUnits()).length, 0);
    // 偏好与迁移标记仍在
    assert.equal(localStorage.getItem("plos:lang:v1"), "zh");
    assert.ok(localStorage.getItem("plos:settings:v1"));
    assert.equal(localStorage.getItem("plos.rag.migrated.v1"), "1");
    assert.equal(localStorage.getItem("plos.graph.migrated.v2"), "1");
    // 幂等
    await adapter.clearAll();
  } finally {
    store.uninstall();
  }
});

await check("TC-EDGE-09 画像 undefined 语义：合法但无画像的备份不改动本机画像", async () => {
  const source = new InMemoryStorage();
  await makeFullSample(source);
  const { json } = await exportBackup(source);
  const file = parseOk(json);
  delete (file.data as Partial<BackupData>).profile;
  file.counts = countsOf(file.data); // 重算 → 仍是合法包（只是没有画像）

  const target = new InMemoryStorage();
  await target.saveProfile({
    level: "advanced",
    preferences: { depth: "depth", style: "practice" },
    updatedAt: 1,
  });
  const { proxy, calls } = counting(target);
  const out = await importBackup(proxy, JSON.stringify(file), { mode: "merge" });
  assert.ok(out.ok);
  assert.equal(calls.saveProfile ?? 0, 0, "saveProfile(undefined) = 清除，绝不能误触");
  assert.equal((await target.getProfile())?.level, "advanced");
});

await check("TC-EDGE-11 前置校验缺失时 migrateBackup 的判别式接口可用", async () => {
  const good = parseOk(await emptyBackupJson());
  const ok = migrateBackup(good);
  assert.equal(ok.ok, true);
  const newer = migrateBackup({ ...good, exportVersion: EXPORT_VERSION + 1 });
  assert.equal(newer.ok, false);
  assert.equal(newer.ok ? "" : newer.kind, "version-newer");
});

await check("文件命名与体积格式化（导出名恒定合法字符集）", () => {
  const ts = new Date(2026, 8, 17, 14, 32, 5).getTime();
  assert.equal(defaultBackupName(ts), "plos-backup-20260917-143205.plosbak.json");
  assert.equal(preImportBackupName(ts), "pre-import-20260917-143205.plosbak.json");
  assert.equal(chapterMarkdownName(ts), "plos-chapter-20260917-143205.md");
  // 名字只由 [A-Za-z0-9._-] 组成（Rust 侧白名单的镜像断言；白名单真源在 Rust）
  assert.match(defaultBackupName(ts), /^[A-Za-z0-9._-]+$/);
  assert.match(preImportBackupName(ts), /^[A-Za-z0-9._-]+$/);
  assert.match(chapterMarkdownName(ts), /^[A-Za-z0-9._-]+$/);
  assert.equal(humanBytes(0), "0 B");
  assert.equal(humanBytes(2048), "2.0 KB");
  assert.equal(humanBytes(12_582_912), "12.0 MB");
});

/* ================================================================== */
/* 汇总                                                                */
/* ================================================================== */

// 上面的 await 保证了顺序执行；这里只做输出。
console.log(`\n[data-portability] ${results.length - failures}/${results.length} 通过\n`);
for (const line of results) console.log("  " + line);
if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exitCode = 1;
}
