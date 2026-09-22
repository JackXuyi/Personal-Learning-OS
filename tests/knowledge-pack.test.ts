/**
 * 社区知识包单测（F10；方案 docs/community-knowledge-pack-design-2026-09.md §11 / §12.1）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:pack
 *
 * 覆盖：格式与校验（TC-PACK）、泄漏守卫（TC-LEAK）、导出（TC-EXPORT）、
 * 导入与 id 重映射（TC-IMPORT）、四层体积判定（TC-VOL）、导入后派生一致性（TC-REG）、
 * 远程拉取（TC-REMOTE）、主页面读库失败的错误态（TC-PAGE）。
 * TC-RUST-01..08 / TC-DOC-01..12 分别在
 * `src-tauri/src/backup.rs` / `src-tauri/src/db/*` 与 `tests/storage-documents.test.ts`。
 *
 * 全部跑在 `InMemoryStorage`（零 IO / 零 IPC / 零浏览器）；远程层注入 mock `fetch`
 * （**不触网**）。本仓库禁起浏览器（`rules/no-headless-browser-validation.mdc`），
 * 故「真的跑在 Worker 线程里」「100 MiB 真实大包」「CORS 实际行为」一律登记为
 * 手工验收（方案 §12.3），不在这里假装覆盖。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InMemoryStorage } from "../src/storage/memory.ts";
import type { StorageAdapter } from "../src/storage/types.ts";
import { TauriStorage } from "../src/storage/tauri.ts";
import { PACK_LOCAL_STORE_BUDGET_BYTES, stableStringify, utf8BytesOf } from "../src/domain/index.ts";
import type { Chapter, Chunk, KnowledgeUnit, Section, SourceDocument } from "../src/domain/index.ts";
import {
  FORBIDDEN_KEYS,
  PACK_FIELDS,
  PACK_HARD_MAX_BYTES,
  PACK_SUFFIX,
  PACK_VERSION,
  PACK_WORKER_MIN_BYTES,
  contentHashOf,
  countsOfPack,
  defaultPackName,
  parsePack,
} from "../src/features/data/portability/pack-format.ts";
import type { PackData } from "../src/features/data/portability/pack-format.ts";
import { buildPack } from "../src/features/data/portability/pack-export-service.ts";
import { importPack, remapPackIds } from "../src/features/data/portability/pack-import-service.ts";
import { findExisting, packRowsOf, recordOfPack } from "../src/features/data/portability/pack-registry.ts";
import { PackRemoteError, fetchPackText, parsePackUrl } from "../src/features/data/portability/pack-remote.ts";
import type { FetchLike } from "../src/features/data/portability/pack-remote.ts";
import { errorText, packCountsText, warningText } from "../src/features/data/portability/pack-texts.ts";
import { buildHeatmap, buildWeakness } from "../src/features/progress/analytics.ts";
import { zh } from "../src/i18n/messages/zh.ts";
import { installFakeLocalStorage } from "./fake-local-storage.ts";

/* ================================================================== */
/* 测试脚手架（与 data-portability.test.ts 同款：顺序执行 + 汇总）        */
/* ================================================================== */

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
  return err instanceof Error ? err.message : String(err);
}

/** 源码守卫用：读仓库内文件（相对本测试文件）。 */
function src(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

/** 去掉所有空白 —— 体积字面量守卫要能同时抓 `100*1024*1024` 与 `100 * 1024 * 1024`。 */
function squeeze(text: string): string {
  return text.replace(/\s+/g, "");
}

/* ================================================================== */
/* fixture                                                             */
/* ================================================================== */

/** 方案 §11.2 的固定时间基准（入口注入，模块内不取 `Date.now()`）。 */
const NOW = 1_800_000_000_000;

const PARA = "编码器把输入序列映射为隐向量，再由解码器逐词生成输出。";
const FULL_TEXT = `${PARA}\n\n中间插一段别的说明。\n\n${PARA}\n`;

/**
 * 固定 id 生成器：`n-doc-1` / `n-ch-2` …（可复现；不用真实 `newId` 的随机性）。
 *
 * ⚠️ `n-` 前缀是必需的：样本 id 形如 `doc-1`，若生成器也产 `doc-*`，
 * 「id 必须全部重分配」这条断言会因为**撞车**而假绿（那正是第一版踩的坑）。
 */
function seqIdGen(): (prefix: string) => string {
  let n = 0;
  return (prefix: string) => `n-${prefix}-${(n += 1)}`;
}

/** 去掉注释后的源码（源码守卫用）：注释里出现 `Date.now()` 是正常表述，不是调用。 */
function codeOf(rel: string): string {
  return src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const TITLE = "注意力机制导论（社区包）";

/**
 * 样本（方案 §11.2）：2 份资料（1 份带全文 + 2 章；1 份 `textPreview` 为空）+
 * 30 个概念（doc-1 二十个 / doc-2 十个 → 让「按文档过滤」与「端点必须都在包内」
 * 两条规则都有反例）+ 40 条关系（25 条包内、15 条跨文档）+ 个人数据（导入必须零污染）。
 */
async function makePackSample(s: StorageAdapter): Promise<void> {
  await s.saveDocument({
    id: "doc-1",
    title: "注意力机制导论",
    format: "pdf",
    // ⚠️ 本机绝对路径与目标关联：导出侧必须剥离（TC-LEAK-02）
    path: "/Users/x/secret.pdf",
    goalIds: ["goal-secret-42"],
    importedAt: NOW - 9_000,
    status: "ready",
    textPreview: FULL_TEXT,
    analysis: { chaptersAt: NOW - 8_000, keyPointsAt: NOW - 7_000, model: "qwen3.5:4b" },
    overview: {
      gist: "讲清注意力与编解码结构。",
      sections: [{ heading: "背景", detail: "序列建模的老问题。" }],
      prerequisites: ["线性代数"],
      keywords: ["注意力"],
      generatedAt: NOW - 6_000,
      sourceChars: FULL_TEXT.length,
      mode: "single",
      model: "qwen3.5:4b",
    },
  });
  await s.saveDocument({
    id: "doc-2",
    title: "向量检索入门",
    format: "markdown",
    importedAt: NOW - 5_000,
    status: "imported",
    textPreview: "", // 空正文 → 导出必须报 doc-without-body
  });

  await s.saveChapters("doc-1", [
    {
      id: "ch-1",
      documentId: "doc-1",
      order: 1,
      title: "第 1 章 编码器",
      contentRef: { start: 0, end: PARA.length },
      keyPoints: ["编码器输出是定长隐向量"],
      keyPointRefs: [{ point: "编码器输出是定长隐向量", quote: "编码器把输入序列映射为隐向量", start: 0, end: 15 }],
      unitIds: ["u-1", "u-2"],
      status: "ready", // 非 not-started → 导入侧必须报「外来进度已丢弃」（D5）
      createdAt: NOW - 4_000,
    },
    {
      id: "ch-2",
      documentId: "doc-1",
      order: 2,
      title: "第 2 章 解码器",
      contentRef: { start: 0, end: FULL_TEXT.length },
      keyPoints: [],
      unitIds: ["u-3"],
      status: "mastered", // 同上
      createdAt: NOW - 3_000,
    },
  ]);
  await s.saveChapters("doc-2", [
    {
      id: "ch-3",
      documentId: "doc-2",
      order: 1,
      title: "第 1 章 相似度",
      contentRef: { start: 0, end: 12 },
      keyPoints: [],
      unitIds: ["u-21"],
      status: "not-started",
      createdAt: NOW - 2_000,
    },
  ]);

  await s.saveSections([
    { id: "sec-1", chapterId: "ch-1", documentId: "doc-1", title: "1.1 结构", level: 2, index: 0, contentRef: { start: 0, end: 10 }, createdAt: NOW - 1_000 },
    { id: "sec-2", chapterId: "ch-3", documentId: "doc-2", title: "1.1 距离", level: 2, index: 0, contentRef: { start: 0, end: 10 }, createdAt: NOW - 900 },
  ]);

  await s.saveChunks([
    { id: "ck-1", documentId: "doc-1", chapterId: "ch-1", sectionId: "sec-1", content: PARA, position: 0, knowledgeIds: ["u-1"], createdAt: NOW - 800 },
    { id: "ck-2", documentId: "doc-1", chapterId: "ch-2", content: PARA, position: 1, knowledgeIds: [], createdAt: NOW - 700 },
    // doc-2 **没有** chunk → 导出必须报 doc-without-chunks
  ]);

  const units: KnowledgeUnit[] = [];
  for (let i = 1; i <= 30; i += 1) {
    const onDoc1 = i <= 20;
    units.push({
      id: `u-${i}`,
      title: `概念 ${i}`,
      kind: "concept",
      sourceDocumentId: onDoc1 ? "doc-1" : "doc-2",
      tags: ["样本"],
      createdAt: NOW - 600 + i,
      // u-1 带原文出处（`KnowledgeUnit.evidence` 是**同名异实体**，见 TC-LEAK-01）
      ...(i === 1
        ? { evidence: { documentId: "doc-1", start: 0, end: 15, quote: "编码器把输入序列映射为隐向量" } }
        : {}),
    });
  }
  const relations = [];
  for (let i = 1; i <= 25; i += 1) {
    // 两端都落在 u-1..u-20（doc-1）→ 只选 doc-1 时 25 条全留
    relations.push({ id: `rel-${i}`, fromId: `u-${((i - 1) % 20) + 1}`, toId: `u-${(i % 20) + 1}`, type: "related" as const });
  }
  for (let i = 1; i <= 15; i += 1) {
    // 跨文档：另一端落在 u-21..u-30（doc-2）→ 只选 doc-1 时必须整条丢弃
    relations.push({ id: `rel-x${i}`, fromId: `u-${i}`, toId: `u-${20 + ((i - 1) % 10) + 1}`, type: "related" as const });
  }
  // ⚠️ 概念 / 关系有**两张表**：批量写入口（`knowledgeUnits` / `knowledgeRelations` 映射，
  //    `listKnowledgeUnits` 读它）与 `graph` blob（`getGraph()` 读它）。真实分析流程两者都写
  //    → 样本必须照做，否则「包里有 N 个概念」这类断言会拿到 0。
  await s.saveKnowledgeUnits(units);
  await s.saveRelations(relations);
  await s.saveGraph({ units, relations });

  // ===== 个人数据（导入零污染的证据） =====
  await s.saveLearnerState({
    byUnit: {
      "ch-1": { mastery: 0.9, confidence: 0.8, attempts: 3, correctCount: 3, cognitiveLevel: "understand", misconceptions: ["把注意力当线性层"], applicationAbility: 0.5, interviewAbility: 0.4 },
      "ch-2": { mastery: 0.2, confidence: 0.3, attempts: 1, correctCount: 0, cognitiveLevel: "remember", misconceptions: [], applicationAbility: 0.1, interviewAbility: 0.1 },
    },
  });
  await s.saveProfile({ level: "intermediate", weeklyMinutes: 420, preferences: { depth: "depth", style: "reading" }, backgroundSource: "manual", updatedAt: NOW - 500 });
  for (let i = 1; i <= 5; i += 1) {
    await s.appendEvidence({ at: NOW - 400 + i, kind: "assessment", subjectId: "ch-1", verdict: "pass", delta: 0.1, sourceId: `paper-${i}` });
  }
  await s.saveAnnotation({ id: "ann-1", documentId: "doc-1", chapterId: "ch-1", quote: "隐向量", start: 8, end: 11, note: "和 embedding 是一回事吗", createdAt: NOW - 300, updatedAt: NOW - 300 });
  await s.saveRestatement({ id: "rest-1", documentId: "doc-1", chapterId: "ch-1", text: "注意力就是加权求和。", createdAt: NOW - 200 });
  await s.saveCardState({ cardId: "card-1", chapterId: "ch-1", documentId: "doc-1", lastReviewedAt: NOW - 100, reps: 2, lastRating: "good", lapses: 1 });
  await s.saveGoal({ id: "goal-secret-42", type: "career", title: "AI 应用工程师", importance: "high", requiredUnitIds: ["u-1"], requiredChapterIds: ["ch-1"], createdAt: NOW - 90 });
  await s.savePaper({
    id: "paper-1",
    scope: { chapterIds: ["ch-1"], mode: "unit-test" },
    title: "第 1 章小测",
    questions: [{ id: "q-1", chapterId: "ch-1", type: "choice", cognitiveLevel: "understand", prompt: "自注意力的作用？", options: ["加权聚合", "降维"], answer: "0", difficulty: 0.3 }],
    status: "done",
    createdAt: NOW - 80,
    submittedAt: NOW - 70,
  });
  await s.savePaperResult({
    paperId: "paper-1",
    totalScore: 0.72,
    perChapter: { "ch-1": { score: 0.72, previousMastery: 0.5, mastery: 0.72 } },
    wrongQuestions: [],
    objective: { weight: 1, earned: 0.72 },
    subjectiveAnswers: {},
    subjectiveScores: {},
    createdAt: NOW - 60,
  });
}

/** 新库 + 样本（每次调用都给一套干净的库，避免用例互相污染）。 */
async function sampleStorage(): Promise<StorageAdapter> {
  const s = new InMemoryStorage();
  await makePackSample(s);
  return s;
}

/** 小型库（1 资料 · 1 章 · 1 小节 · 1 块）：容量类用例用它，体积可预期。 */
async function tinyStorage(): Promise<StorageAdapter> {
  const s = new InMemoryStorage();
  await s.saveDocument({ id: "doc-t", title: "小资料", format: "markdown", importedAt: NOW, status: "ready", textPreview: PARA });
  await s.saveChapters("doc-t", [
    { id: "ch-t", documentId: "doc-t", order: 1, title: "唯一一章", contentRef: { start: 0, end: PARA.length }, keyPoints: [], unitIds: [], status: "not-started", createdAt: NOW },
  ]);
  await s.saveSections([{ id: "sec-t", chapterId: "ch-t", documentId: "doc-t", title: "1.1", level: 2, index: 0, contentRef: { start: 0, end: 4 }, createdAt: NOW }]);
  await s.saveChunks([{ id: "ck-t", documentId: "doc-t", chapterId: "ch-t", sectionId: "sec-t", content: PARA, position: 0, knowledgeIds: [], createdAt: NOW }]);
  return s;
}

const ALL_DOCS = ["doc-1", "doc-2"];
const SEL_ALL = { documentIds: ALL_DOCS, manifest: { title: TITLE, author: "阿一", license: "cc-by" as const } };

/**
 * 容量可注入的适配器（D16 的测试替身）。
 *
 * ⚠️ 基类的 `storeCapacityBytes` 是**类字段**（`readonly` 只是编译期约束，运行时是
 * 自有可写属性）→ 这里用 `Object.defineProperty` 覆盖。**真实子类走 `override`**
 * （`TauriStorage` 就是 `override readonly storeCapacityBytes = undefined`）。
 */
class CappedStorage extends InMemoryStorage {
  constructor(capacity: number | undefined) {
    super();
    Object.defineProperty(this, "storeCapacityBytes", { value: capacity, writable: false, enumerable: true, configurable: true });
  }
}

/** 前 N 次写 chunk 抛配额错误（TC-IMPORT-08）。 */
class QuotaStorage extends InMemoryStorage {
  override async saveChunks(): Promise<void> {
    const err = new Error("quota");
    err.name = "QuotaExceededError";
    throw err;
  }
}

/** 调用计数代理（TC-EXPORT-05：导出**不得**重复读库）。 */
function counting(target: StorageAdapter, counts: Record<string, number>): StorageAdapter {
  return new Proxy(target, {
    get(obj, prop, recv) {
      const value = Reflect.get(obj, prop, recv);
      if (typeof value === "function" && typeof prop === "string") {
        return (...args: unknown[]): unknown => {
          counts[prop] = (counts[prop] ?? 0) + 1;
          return (value as (...a: unknown[]) => unknown).apply(obj, args);
        };
      }
      return value;
    },
  });
}

/** 库快照（零写入 / 零污染断言用）：只取会随包变动的 6 类实体。 */
async function packScopeSnapshot(s: StorageAdapter): Promise<string> {
  const docs = await s.listDocuments();
  const chapters: Chapter[] = [];
  for (const d of docs) chapters.push(...(await s.listChapters(d.id)));
  const sections: Section[] = [];
  for (const c of chapters) sections.push(...(await s.listSections(c.id)));
  const chunks: Chunk[] = [];
  for (const d of docs) chunks.push(...(await s.listChunksByDocument(d.id)));
  return stableStringify({
    docs,
    chapters,
    sections,
    chunks,
    units: await s.listKnowledgeUnits(),
    relations: await s.listRelations(),
  });
}

/** 个人数据快照（TC-IMPORT-04：导入必须零污染）。 */
async function personalSnapshot(s: StorageAdapter): Promise<string> {
  return stableStringify({
    learner: await s.getLearnerState(),
    profile: await s.getProfile(),
    evidence: await s.listEvidence(),
    goals: await s.listGoals(),
    cards: await s.listCardStates(),
    papers: await s.listPapers(),
    results: await s.listPaperResults(),
    restatements: await s.listAllRestatements(),
    annotations: await s.listAllAnnotations(),
    units: await s.listKnowledgeUnits("doc-1"),
    memoryDoc: await s.getMemoryDoc(),
    packs: await s.listImportedPacks(),
  });
}

/** 全表外键扫描（TC-IMPORT-02：导入后不得有任何悬空引用）。 */
async function danglingRefs(s: StorageAdapter): Promise<string[]> {
  const bad: string[] = [];
  const docs = await s.listDocuments();
  const docIds = new Set(docs.map((d) => d.id));
  const unitIds = new Set((await s.listKnowledgeUnits()).map((u) => u.id));
  const chapterIds = new Set<string>();
  const sectionIds = new Set<string>();
  const chunks: Chunk[] = [];
  for (const d of docs) {
    for (const c of await s.listChapters(d.id)) {
      chapterIds.add(c.id);
      if (!docIds.has(c.documentId)) bad.push(`chapter ${c.id} → document ${c.documentId}`);
      for (const u of c.unitIds) if (!unitIds.has(u)) bad.push(`chapter ${c.id} → unit ${u}`);
      for (const sec of await s.listSections(c.id)) {
        sectionIds.add(sec.id);
        if (!chapterIds.has(sec.chapterId)) bad.push(`section ${sec.id} → chapter ${sec.chapterId}`);
      }
    }
    chunks.push(...(await s.listChunksByDocument(d.id)));
  }
  for (const c of chunks) {
    if (!docIds.has(c.documentId)) bad.push(`chunk ${c.id} → document ${c.documentId}`);
    if (!chapterIds.has(c.chapterId)) bad.push(`chunk ${c.id} → chapter ${c.chapterId}`);
    if (c.sectionId !== undefined && !sectionIds.has(c.sectionId)) bad.push(`chunk ${c.id} → section ${c.sectionId}`);
    for (const k of c.knowledgeIds) if (!unitIds.has(k)) bad.push(`chunk ${c.id} → unit ${k}`);
  }
  for (const u of await s.listKnowledgeUnits()) {
    if (u.sourceDocumentId !== undefined && !docIds.has(u.sourceDocumentId)) bad.push(`unit ${u.id} → document ${u.sourceDocumentId}`);
    if (u.evidence !== undefined && !docIds.has(u.evidence.documentId)) bad.push(`unit ${u.id} → evidence document ${u.evidence.documentId}`);
  }
  for (const r of await s.listRelations()) {
    if (!unitIds.has(r.fromId)) bad.push(`relation ${r.id} → from ${r.fromId}`);
    if (!unitIds.has(r.toId)) bad.push(`relation ${r.id} → to ${r.toId}`);
  }
  return bad;
}

/**
 * round-trip 归一化：把「重映射必然会变」的部分抹平，其余**逐字段**参与比较。
 *
 * 抹平的三类：`id`（全量重分配）、`Chapter.status`（D5 重置为 `not-started`）、
 * `SourceDocument.path` / `goalIds`（导出侧剥离）。
 *
 * ⚠️ id **重写成序号**而不是删掉：删掉会把**引用拓扑**（章→概念、块→概念、关系两端）
 * 一起删掉，于是「导入后关系错位」这类缺陷就测不出来了。序号按稳定内容键排序后取下标
 * （标题 / 位置 / 章序），故「第几个」在两侧一致，可用于比较。
 *
 * ⚠️ 其余字段**逐字段参与比较** —— 尤其是 `contentRef` / `keyPointRefs` /
 * `ConceptEvidence` 的 `start`-`end`：它们都是**相对 `doc.textPreview` 的偏移**，
 * 正文随包带入 ⇒ 偏移必须逐字不变（这是「偏移字段一律不动」那条决策的回归证据）。
 */
function normalizeIds(data: PackData): unknown {
  const documents = [...data.documents].sort((a, b) => a.title.localeCompare(b.title));
  const docIdx = new Map(documents.map((d, i) => [d.id, `D${i}`]));
  const chapters: Chapter[] = Object.values(data.chaptersByDocument)
    .flat()
    .sort((a, b) => (docIdx.get(a.documentId) ?? "").localeCompare(docIdx.get(b.documentId) ?? "") || a.order - b.order);
  const chapterIdx = new Map(chapters.map((c, i) => [c.id, `C${i}`]));
  const sections = [...data.sections].sort((a, b) => a.title.localeCompare(b.title));
  const sectionIdx = new Map(sections.map((s, i) => [s.id, `S${i}`]));
  const chunks = [...data.chunks].sort((a, b) => a.position - b.position);
  const chunkIdx = new Map(chunks.map((c, i) => [c.id, `Z${i}`]));
  const units = [...data.knowledgeUnits].sort((a, b) => a.title.localeCompare(b.title));
  const unitIdx = new Map(units.map((u, i) => [u.id, `K${i}`]));
  const m = (map: Map<string, string>, id?: string): string | undefined =>
    id === undefined ? undefined : (map.get(id) ?? "MISSING");

  return {
    documents: documents.map((d) => { const { id: _i, path: _p, goalIds: _g, ...rest } = d; return rest; }),
    chapters: chapters.map((c) => {
      const { id: _i, documentId, status: _s, unitIds, ...rest } = c;
      return { ...rest, doc: m(docIdx, documentId), units: unitIds.map((u) => m(unitIdx, u)) };
    }),
    sections: sections.map((s) => {
      const { id: _i, chapterId, documentId, ...rest } = s;
      return { ...rest, ch: m(chapterIdx, chapterId), doc: m(docIdx, documentId) };
    }),
    chunks: chunks.map((c) => {
      const { id: _i, documentId, chapterId, sectionId, knowledgeIds, ...rest } = c;
      return { ...rest, doc: m(docIdx, documentId), ch: m(chapterIdx, chapterId), sec: m(sectionIdx, sectionId), ks: knowledgeIds.map((k) => m(unitIdx, k)) };
    }),
    units: units.map((u) => {
      const { id: _i, sourceDocumentId, evidence, ...rest } = u;
      return {
        ...rest,
        doc: m(docIdx, sourceDocumentId),
        ev: evidence ? { doc: m(docIdx, evidence.documentId), start: evidence.start, end: evidence.end, quote: evidence.quote } : undefined,
      };
    }),
    relations: data.knowledgeRelations
      .map((r) => ({ type: r.type, strength: r.strength, from: m(unitIdx, r.fromId), to: m(unitIdx, r.toId) }))
      .sort((a, b) => `${a.from}>${a.to}>${a.type}`.localeCompare(`${b.from}>${b.to}>${b.type}`)),
  };
}

/** 合法的最小包文件（TC-PACK 系列大量以「改一个地方再校验」的方式构造）。 */
function minimalFile(over: Record<string, unknown> = {}): Record<string, unknown> {
  const data: PackData = {
    documents: [{ id: "d1", title: "T", format: "markdown", importedAt: 1, status: "ready", textPreview: "abc" } as SourceDocument],
    chaptersByDocument: { d1: [{ id: "c1", documentId: "d1", order: 1, title: "C", keyPoints: [], unitIds: [], status: "not-started", createdAt: 1 } as Chapter] },
    sections: [],
    chunks: [],
    knowledgeUnits: [],
    knowledgeRelations: [],
  };
  return {
    kind: "plos.pack",
    packVersion: PACK_VERSION,
    appVersion: "0.1.0",
    exportedAt: 1,
    manifest: { title: "T", sources: [], aiDerived: false, contentHash: contentHashOf(data) },
    counts: countsOfPack(data),
    data,
    ...over,
  };
}

/* ================================================================== */
/* TC-PACK：格式与校验                                                  */
/* ================================================================== */

await check("TC-PACK-01 非 JSON 文本 → not-json", async () => {
  const r = await parsePack("这不是 JSON", { parseInWorker: false });
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.kind, "not-json");
});

await check("TC-PACK-02 误把 F4 备份当包 / kind 缺失 → not-pack", async () => {
  const asBackup = await parsePack(JSON.stringify({ ...minimalFile(), kind: "plos.backup" }), { parseInWorker: false });
  assert.equal(asBackup.ok ? "" : asBackup.kind, "not-pack");
  const noKind = await parsePack(JSON.stringify({ ...minimalFile(), kind: undefined }), { parseInWorker: false });
  assert.equal(noKind.ok ? "" : noKind.kind, "not-pack");
});

await check("TC-PACK-03 版本判定：更新 / 过旧 / 非整数", async () => {
  const newer = await parsePack(JSON.stringify({ ...minimalFile(), packVersion: PACK_VERSION + 1 }), { parseInWorker: false });
  assert.equal(newer.ok ? "" : newer.kind, "version-newer");
  const old = await parsePack(JSON.stringify({ ...minimalFile(), packVersion: 0 }), { parseInWorker: false });
  assert.equal(old.ok ? "" : old.kind, "unsupported-version");
  const frac = await parsePack(JSON.stringify({ ...minimalFile(), packVersion: 1.5 }), { parseInWorker: false });
  assert.equal(frac.ok ? "" : frac.kind, "corrupt");
});

await check("TC-PACK-04 counts 不自洽 / 白名单字段缺失 / manifest 缺失 → corrupt", async () => {
  const base = minimalFile();
  const bumped = JSON.parse(JSON.stringify(base));
  bumped.counts.documents += 1;
  const a = await parsePack(JSON.stringify(bumped), { parseInWorker: false });
  assert.equal(a.ok ? "" : a.kind, "corrupt");
  assert.equal(a.ok ? "" : a.detail, "counts-mismatch");

  // 逐个字段删（白名单 6 项一个都不许缺）
  for (const key of PACK_FIELDS) {
    const broken = JSON.parse(JSON.stringify(base));
    delete broken.data[key];
    const r = await parsePack(JSON.stringify(broken), { parseInWorker: false });
    assert.equal(r.ok ? "" : r.kind, "corrupt", `删掉 data.${key} 应判 corrupt`);
  }
  const noManifest = JSON.parse(JSON.stringify(base));
  delete noManifest.manifest;
  const r2 = await parsePack(JSON.stringify(noManifest), { parseInWorker: false });
  assert.equal(r2.ok ? "" : r2.kind, "corrupt");
  assert.equal(r2.ok ? "" : r2.detail, "manifest");
});

await check("TC-PACK-05 ① 体积前置拒发生在 JSON.parse 之前 + 产品常量锁死", async () => {
  // 非法 JSON 前缀：若体积判定在 parse 之后，这里会先报 not-json（顺序的证据）
  const garbage = `{{{${"x".repeat(80)}`;
  const r = await parsePack(garbage, { parseInWorker: false, maxBytes: 64 });
  assert.equal(r.ok ? "" : r.kind, "too-large");
  // 产品值以常量断言锁死（**不构造** 100 MiB 字符串）
  assert.equal(PACK_HARD_MAX_BYTES, 100 * 1024 * 1024);
  assert.equal(PACK_WORKER_MIN_BYTES, 8 * 1024 * 1024);
  assert.equal(PACK_SUFFIX, ".ploskp.json");
  assert.match(defaultPackName(NOW), /^[A-Za-z0-9._-]+$/);
});

await check("TC-PACK-06 空包 → empty（0 份资料 / 有资料但 0 章）", async () => {
  const empty = minimalFile();
  const d = empty.data as PackData;
  d.documents = [];
  d.chaptersByDocument = {};
  empty.counts = countsOfPack(d); // ⚠️ counts 必须同步清，否则先撞 counts-mismatch
  const a = await parsePack(JSON.stringify(empty), { parseInWorker: false });
  assert.equal(a.ok ? "" : a.kind, "empty");

  const noChapter = minimalFile();
  const d2 = noChapter.data as PackData;
  d2.chaptersByDocument = {};
  noChapter.counts = countsOfPack(d2);
  const b = await parsePack(JSON.stringify(noChapter), { parseInWorker: false });
  assert.equal(b.ok ? "" : b.kind, "empty");
});

await check("TC-PACK-07 白名单覆盖率：6 项与 countsOfPack 读的键同集", async () => {
  const s = await sampleStorage();
  const { file } = await buildPack(s, SEL_ALL);
  assert.deepEqual(Object.keys(file.data).sort(), [...PACK_FIELDS].sort());
  // 两遍：同一份 data 的 counts 必须稳定（防「加了实体忘了进白名单」）
  assert.equal(stableStringify(countsOfPack(file.data)), stableStringify(countsOfPack(file.data)));
});

/* ================================================================== */
/* TC-LEAK：泄漏守卫                                                    */
/* ================================================================== */

await check("TC-LEAK-01 导出 JSON 不含任何禁止导出的实体键名", async () => {
  const s = await sampleStorage();
  const { json } = await buildPack(s, SEL_ALL);
  // ⚠️ `evidence` 是**同名异实体**：`BackupData.evidence`（证据流，禁止导出）与
  //    `KnowledgeUnit.evidence`（概念原文出处，**必须**随包带走）。故裸串检查避开它，
  //    改判「证据流」独有的数组形态 `"evidence":[`（概念出处恒为对象）。
  for (const key of FORBIDDEN_KEYS.filter((k) => k !== "evidence")) {
    assert.ok(!json.includes(`"${key}"`), `包内不应出现 ${key}`);
  }
  assert.ok(!json.includes('"evidence":['), "包内不应出现证据流");
  assert.ok(!json.includes("learner-profiles"), "包内不应出现画像键");
});

await check("TC-LEAK-02 导出剥离本机绝对路径与目标关联", async () => {
  const s = await sampleStorage();
  const { json, file } = await buildPack(s, SEL_ALL);
  assert.equal(json.includes("/Users/"), false, "包内不应出现本机路径");
  assert.equal(json.includes("goal-secret-42"), false, "包内不应出现目标关联");
  assert.equal(json.includes(".pdf"), false, "包内不应出现本机 pdf 路径");
  // 溯源引用仍在（标题 / 格式），只是没有 path
  assert.deepEqual(file.manifest.sources.map((x) => [x.title, x.format]), [
    ["注意力机制导论", "pdf"],
    ["向量检索入门", "markdown"],
  ]);
});

/* ================================================================== */
/* TC-EXPORT：导出                                                      */
/* ================================================================== */

await check("TC-EXPORT-01 只选 doc-1：未选中的资料 / 概念 / 关系零泄漏", async () => {
  const s = await sampleStorage();
  const { file } = await buildPack(s, { documentIds: ["doc-1"], manifest: { title: TITLE } });
  assert.deepEqual(file.data.documents.map((d) => d.id), ["doc-1"]);
  assert.deepEqual(Object.keys(file.data.chaptersByDocument), ["doc-1"]);
  assert.equal(file.counts.documents, 1);
  assert.equal(file.counts.chapters, 2);
  assert.equal(file.counts.knowledgeUnits, 20, "只收 sourceDocumentId === doc-1 的概念");
  assert.equal(file.counts.knowledgeRelations, 25, "跨文档端点必须整条丢弃");
});

await check("TC-EXPORT-02 概念按 sourceDocumentId 过滤；关系两端都须在选中集合内", async () => {
  const s = await sampleStorage();
  const { file } = await buildPack(s, { documentIds: ["doc-1"], manifest: { title: TITLE } });
  assert.ok(file.data.knowledgeUnits.every((u) => u.sourceDocumentId === "doc-1"));
  const ids = new Set(file.data.knowledgeUnits.map((u) => u.id));
  assert.ok(file.data.knowledgeRelations.every((r) => ids.has(r.fromId) && ids.has(r.toId)));
  assert.equal(file.manifest.aiDerived, true, "有 overview / 概念 → 诚实标注含 AI 派生内容");
});

await check("TC-EXPORT-03 counts.chars === 包内各 textPreview.length 之和（与 bytes 不同尺子）", async () => {
  const s = await sampleStorage();
  const build = await buildPack(s, SEL_ALL);
  const sum = build.file.data.documents.reduce((n, d) => n + (d.textPreview?.length ?? 0), 0);
  assert.equal(build.file.counts.chars, sum);
  assert.ok(build.bytes > sum, "bytes 含 JSON 结构开销，必然大于纯字符数");
  assert.equal(build.bytes, utf8BytesOf(build.json));
});

await check("TC-EXPORT-04 导出零写入：库快照逐字节不变", async () => {
  const s = await sampleStorage();
  const before = await packScopeSnapshot(s);
  await buildPack(s, SEL_ALL);
  assert.equal(await packScopeSnapshot(s), before);
});

await check("TC-EXPORT-05 导出不重复读库：listDocuments / listKnowledgeUnits 各一次", async () => {
  const inner = await sampleStorage();
  const counts: Record<string, number> = {};
  await buildPack(counting(inner, counts), SEL_ALL);
  assert.equal(counts.listDocuments, 1, "listDocuments 必须恰好 1 次");
  assert.equal(counts.listKnowledgeUnits, 1, "listKnowledgeUnits 必须恰好 1 次");
  assert.equal(counts.listRelations, 1, "listRelations 必须恰好 1 次");
  assert.equal(counts.listChapters, 2, "章按文档逐份取（2 份资料）");
});

await check("TC-EXPORT-06 警告：无正文 / 无切片 / 超本机容量（且不阻断导出）", async () => {
  const s = await sampleStorage();
  const plain = await buildPack(s, SEL_ALL);
  const kinds = plain.warnings.map((w) => w.kind);
  assert.ok(kinds.includes("doc-without-body"), "doc-2 无正文");
  assert.ok(kinds.includes("doc-without-chunks"), "doc-2 无切片");
  assert.ok(!kinds.includes("too-large"), "默认后端容量 4 MiB，本样本远小于它");

  // 容量线由 storage 给出（不是常量）：注入 1 KiB → 必出 too-large，json 照常产出
  const capped = new CappedStorage(1024);
  await makePackSample(capped);
  const warned = await buildPack(capped, SEL_ALL);
  assert.ok(warned.warnings.some((w) => w.kind === "too-large" && w.count === 1));
  assert.ok(warned.bytes > 1024 && warned.json.length > 0, "警告不阻断导出");
});

/* ================================================================== */
/* TC-IMPORT：导入与 id 重映射                                          */
/* ================================================================== */

await check("TC-IMPORT-01 round-trip：逐字段一致 + 再导出投影完全相同", async () => {
  const from = await sampleStorage();
  const first = await buildPack(from, SEL_ALL);

  const into = new InMemoryStorage();
  const outcome = await importPack(into, first.json, { idGen: seqIdGen(), now: NOW, parseInWorker: false });
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.kind);

  const newDocIds = (await into.listDocuments()).map((d) => d.id);
  assert.equal(newDocIds.length, 2);
  assert.equal(newDocIds.filter((id) => ALL_DOCS.includes(id)).length, 0, "id 必须全部重分配");
  // 选第二份（doc-2 的副本）—— 顺序与 selection 一致，但**读库顺序不保证**，故按标题定位
  const byTitle = new Map((await into.listDocuments()).map((d) => [d.title, d.id]));

  const second = await buildPack(into, {
    documentIds: [byTitle.get("注意力机制导论")!, byTitle.get("向量检索入门")!],
    manifest: { title: TITLE },
  });
  // 先锁「比较的投影本身是有内容的」—— 否则两侧同为「空」也会假绿
  const n1 = normalizeIds(first.file.data) as unknown as Record<string, unknown[]>;
  for (const [key, n] of [["documents", 2], ["chapters", 3], ["sections", 2], ["chunks", 2], ["units", 30], ["relations", 40]] as const) {
    assert.equal(n1[key].length, n, `归一化投影的 ${key} 条数`);
  }

  assert.deepEqual(normalizeIds(second.file.data), normalizeIds(first.file.data));
  assert.equal(
    stableStringify(normalizeIds(second.file.data)),
    stableStringify(normalizeIds(first.file.data)),
    "规范化 JSON 必须逐字节相同",
  );
});

await check("TC-IMPORT-02 无悬空 id：全表外键扫描为空", async () => {
  const from = await sampleStorage();
  const { json } = await buildPack(from, SEL_ALL);
  const into = new InMemoryStorage();
  await importPack(into, json, { idGen: seqIdGen(), now: NOW, parseInWorker: false });
  assert.deepEqual(await danglingRefs(into), []);
});

await check("TC-IMPORT-03 同一包导入两次：id 交集为空、记录合并 documentIds", async () => {
  const from = await sampleStorage();
  const { json, file } = await buildPack(from, SEL_ALL);
  const into = new InMemoryStorage();

  // ⚠️ **同一个**生成器实例：两次各 new 一个会让计数器各自从 1 开始 → 「id 不共用」假红
  const gen = seqIdGen();
  const a = await importPack(into, json, { idGen: gen, now: NOW, parseInWorker: false });
  const b = await importPack(into, json, { idGen: gen, now: NOW + 1, parseInWorker: false });
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;

  const idsA = new Set(a.stats.importedDocumentIds);
  assert.equal(b.stats.importedDocumentIds.some((id) => idsA.has(id)), false, "两次导入不得共用 id");
  assert.equal((await into.listDocuments()).length, 4);

  // 记录：去重键 = contentHash；第二次必须覆盖同一条**并累积** documentIds
  const r1 = recordOfPack(file, a.stats, { now: NOW });
  const r2 = recordOfPack(file, b.stats, { now: NOW + 1, previous: r1 });
  assert.equal(r1.contentHash, r2.contentHash);
  assert.equal(r2.documentIds.length, 4, "documentIds 是累积事实，不是「最后一次带了什么」");
  assert.equal(new Set(r2.documentIds).size, 4);
  assert.equal(findExisting([r1], r2.contentHash)?.contentHash, r1.contentHash);
});

await check("TC-IMPORT-04 零污染：个人数据逐字节不变", async () => {
  const from = await sampleStorage();
  const { json } = await buildPack(from, SEL_ALL);
  // 目标库里也放一份个人数据（用同一套样本即可，导入须原样不动）
  const into = await sampleStorage();
  const before = await personalSnapshot(into);
  await importPack(into, json, { idGen: seqIdGen(), now: NOW, parseInWorker: false });
  assert.equal(await personalSnapshot(into), before);
  assert.equal((await into.listEvidence()).length, 5);
  assert.equal((await into.listGoals()).length, 1);
});

await check("TC-IMPORT-05 章节状态全部重置 + 如实上报丢弃条数（D5）", async () => {
  const from = await sampleStorage();
  const { json } = await buildPack(from, SEL_ALL);
  const into = new InMemoryStorage();
  const outcome = await importPack(into, json, { idGen: seqIdGen(), now: NOW, parseInWorker: false });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  // 样本里 ch-1 = ready、ch-2 = mastered → 恰好 2 条被丢弃
  assert.equal(outcome.stats.foreignProgressDropped, 2);
  assert.equal(outcome.stats.chapters, 3);
  for (const d of await into.listDocuments()) {
    for (const c of await into.listChapters(d.id)) {
      assert.equal(c.status, "not-started", `${c.title} 必须重置为未开始`);
    }
  }
});

await check("TC-IMPORT-06 收口不倒灌：本机独有概念在导入后仍在", async () => {
  const from = await sampleStorage();
  const { json } = await buildPack(from, SEL_ALL);
  const into = new InMemoryStorage();
  await into.saveKnowledgeUnit({ id: "mine-1", title: "本机概念甲", kind: "concept", tags: [], createdAt: 1 });
  await into.saveKnowledgeUnit({ id: "mine-2", title: "本机概念乙", kind: "concept", tags: [], createdAt: 2 });
  await importPack(into, json, { idGen: seqIdGen(), now: NOW, parseInWorker: false });
  const ids = new Set((await into.listKnowledgeUnits()).map((u) => u.id));
  assert.ok(ids.has("mine-1") && ids.has("mine-2"), "本机独有概念不得被 saveGraph 的 diff-delete 抹掉");
  assert.equal(ids.size, 32, "本机 2 + 包内 30");
});

await check("TC-IMPORT-07 本机已有同 id 资料：导入后本机那份逐字段不变", async () => {
  const from = await sampleStorage();
  const { json } = await buildPack(from, SEL_ALL);
  const into = new InMemoryStorage();
  const mine: SourceDocument = { id: "doc-1", title: "我的同名资料", format: "txt", importedAt: 42, status: "ready", textPreview: "我的正文" };
  await into.saveDocument(mine);
  await importPack(into, json, { idGen: seqIdGen(), now: NOW, parseInWorker: false });
  assert.deepEqual(await into.getDocument("doc-1"), mine, "全量重映射的直接证据");
});

await check("TC-IMPORT-08 配额错误 → quota + partial 统计（已写部分如实上报）", async () => {
  const from = await tinyStorage();
  const { json } = await buildPack(from, { documentIds: ["doc-t"], manifest: { title: TITLE } });
  const into = new QuotaStorage();
  const outcome = await importPack(into, json, { idGen: seqIdGen(), now: NOW, parseInWorker: false });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.kind, "quota");
  assert.equal(outcome.partial?.documents, 1, "资料已写入，chunks 才失败");
});

await check("TC-IMPORT-09 源码守卫：导入服务不碰 AI / 不清库 / 不写学习状态", async () => {
  const text = src("src/features/data/portability/pack-import-service.ts");
  for (const forbidden of ['from "../../../ai', "clearAll(", "appendEvidence", "saveLearnerState", "saveProfile", "saveGoal"]) {
    assert.ok(!text.includes(forbidden), `pack-import-service.ts 不应出现 ${forbidden}`);
  }
});

await check("TC-IMPORT-10 时间基准唯一：importedAt === 注入的 now；源码不取 Date.now()", async () => {
  const from = await sampleStorage();
  const { json, file } = await buildPack(from, SEL_ALL);
  const into = new InMemoryStorage();
  const outcome = await importPack(into, json, { idGen: seqIdGen(), now: NOW, parseInWorker: false });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const rec = recordOfPack(file, outcome.stats, { now: NOW });
  assert.equal(rec.importedAt, NOW);
  // 只看**代码**（注释里写着「本模块不自己取 `Date.now()`」是表述，不是调用）
  assert.ok(!codeOf("src/features/data/portability/pack-import-service.ts").includes("Date.now()"));
});

await check("TC-IMPORT-11 悬空处理：chunk.sectionId 置空、端点缺失的关系整条丢弃", () => {
  const data: PackData = {
    documents: [{ id: "d1", title: "T", format: "markdown", importedAt: 1, status: "ready" } as SourceDocument],
    chaptersByDocument: { d1: [{ id: "c1", documentId: "d1", order: 1, title: "C", keyPoints: [], unitIds: [], status: "not-started", createdAt: 1 } as Chapter] },
    sections: [],
    chunks: [{ id: "k1", documentId: "d1", chapterId: "c1", sectionId: "sec-outside", content: "x", position: 0, knowledgeIds: [], createdAt: 1 } as Chunk],
    knowledgeUnits: [
      { id: "u1", title: "A", kind: "concept", tags: [], createdAt: 1 } as KnowledgeUnit,
      { id: "u2", title: "B", kind: "concept", tags: [], createdAt: 1 } as KnowledgeUnit,
    ],
    knowledgeRelations: [
      { id: "r1", fromId: "u1", toId: "u2", type: "related" },
      { id: "r2", fromId: "u1", toId: "u-outside", type: "related" },
    ],
  };
  const out = remapPackIds(data, seqIdGen());
  // sectionId 不在包内 → 置 undefined（**不丢 chunk**，chunk 仍有 document/chapter 归属）
  assert.equal(out.data.chunks.length, 1);
  assert.equal(out.data.chunks[0].sectionId, undefined);
  assert.equal(out.danglingCleared, 1, "sectionId 悬空计一次");
  assert.equal(out.relationsDropped, 1, "端点缺失的关系整条丢弃");
  assert.equal(out.data.knowledgeRelations.length, 1);
});

/* ================================================================== */
/* TC-VOL：四层体积判定（一把尺子）                                      */
/* ================================================================== */

await check("TC-VOL-01 utf8BytesOf 与 TextEncoder 逐例一致，且恒 >= 字符数", () => {
  for (const sample of ["", "abc", "中文", "a中b文", "😀", "混合 😀 ab 中文", "\u0000\uffff"]) {
    assert.equal(utf8BytesOf(sample), new TextEncoder().encode(sample).length, `样本 ${JSON.stringify(sample)}`);
    assert.ok(utf8BytesOf(sample) >= sample.length, "① 上界预判的正确性前提");
  }
});

await check("TC-VOL-02 三后端容量线：memory/local = 4 MiB；tauri = undefined（D16）", () => {
  assert.equal(new InMemoryStorage().storeCapacityBytes, PACK_LOCAL_STORE_BUDGET_BYTES);
  assert.equal(PACK_LOCAL_STORE_BUDGET_BYTES, 4 * 1024 * 1024);

  const fake = installFakeLocalStorage();
  try {
    // TauriStorage 继承 LocalStorageAdapter 的构造（读 localStorage）→ 必须先装替身
    const tauri = new TauriStorage();
    assert.equal(tauri.storeCapacityBytes, undefined, "文档 / 章节已下沉 SQLite → 不设应用层上限");
    assert.equal(tauri.name, "tauri");
  } finally {
    fake.uninstall();
  }
});

await check("TC-VOL-03 ③ 容量前置拒：too-large-for-store 且库快照逐字节不变", async () => {
  const from = await tinyStorage();
  const build = await buildPack(from, { documentIds: ["doc-t"], manifest: { title: TITLE } });
  assert.ok(build.bytes > 1024, `样本包应大于 1 KiB（实测 ${build.bytes}）`);

  const into = new CappedStorage(1024);
  const before = await packScopeSnapshot(into);
  const outcome = await importPack(into, build.json, { idGen: seqIdGen(), now: NOW, parseInWorker: false });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? "" : outcome.kind, "too-large-for-store");
  assert.equal(await packScopeSnapshot(into), before, "前置拒必须发生在零写入阶段");
});

await check("TC-VOL-04 源码守卫：三个服务文件不得出现体积字面量", () => {
  const files = [
    "src/features/data/portability/pack-import-service.ts",
    "src/features/data/portability/pack-export-service.ts",
    "src/features/data/portability/pack-remote.ts",
  ];
  const forbidden = ["100*1024*1024", "8*1024*1024", "4*1024*1024", "5_000_000", "5000000", "5242880"];
  for (const f of files) {
    const text = squeeze(codeOf(f));
    for (const needle of forbidden) {
      assert.ok(!text.includes(needle), `${f} 不应出现体积字面量 ${needle}（只能来自 domain 常量 / storage.storeCapacityBytes）`);
    }
  }
});

await check("TC-VOL-05 导出警告读 storage.storeCapacityBytes 而非常量", async () => {
  const s = new CappedStorage(64);
  await makePackSample(s);
  const build = await buildPack(s, SEL_ALL);
  assert.ok(build.warnings.some((w) => w.kind === "too-large"));
  assert.ok(build.json.length > 0, "警告不阻断");
  // 同一份数据在默认后端（4 MiB）下**不该**出现该警告
  const plain = await buildPack(await sampleStorage(), SEL_ALL);
  assert.ok(!plain.warnings.some((w) => w.kind === "too-large"));
});

await check("TC-VOL-06 解析路径等价：node 无 Worker 时默认路径不报错且结果与显式关闭一致", async () => {
  const auto = await parsePack(JSON.stringify(minimalFile()));
  const sync = await parsePack(JSON.stringify(minimalFile()), { parseInWorker: false });
  assert.equal(auto.ok, true);
  assert.deepEqual(auto, sync, "Worker 只搬解析，不改结果");
});

await check("TC-VOL-07 容量为 undefined → 跳过 ③（D16 的锁）", async () => {
  const from = await tinyStorage();
  const build = await buildPack(from, { documentIds: ["doc-t"], manifest: { title: TITLE } });
  const into = new CappedStorage(undefined); // 「这条线不存在」
  const outcome = await importPack(into, build.json, { idGen: seqIdGen(), now: NOW, parseInWorker: false });
  assert.equal(outcome.ok, true, "无容量线必须放行，不得退化成「零容量，一条包都进不来」");
  assert.equal((await into.listDocuments()).length, 1);
});

/* ================================================================== */
/* TC-TEXT：分类 → 文案映射的完备性（卡片侧的「空白一行」防线）             */
/* ================================================================== */

await check("TC-TEXT-01 每个失败 / 警告分类都有非空文案（漏一个就是空白一行）", () => {
  const p = zh.settings.storage.data.pack;
  const d = zh.settings.storage.data;
  // 三处 enum 的全集 + 兜底。新增分类而忘了文案时，这条会先红 —— 而不是等用户看到空白。
  const kinds = [
    "not-json", "not-pack", "version-newer", "unsupported-version", "corrupt", "too-large", "empty",
    "too-large-for-store", "write-failed", "quota", "invalid", "network", "unknown",
  ];
  for (const k of kinds) {
    assert.ok(errorText(k as never, p).trim().length > 0, `${k} 缺文案`);
  }
  for (const kind of ["too-large", "doc-without-body", "doc-without-chunks", "orphan-units", "orphan-relations"] as const) {
    assert.ok(warningText(p, { kind, count: 3 }).trim().length > 0, `${kind} 缺文案`);
  }
  // 条数串：0 值不展示；全 0 → 空串（调用方据此走「—」兜底）
  assert.equal(packCountsText(d, { documents: 2, chapters: 0, knowledgeUnits: 0 }), "资料 2");
  assert.equal(packCountsText(d, {}), "");
});

/* ================================================================== */
/* TC-REG：记录投影与导入后派生一致性                                    */
/* ================================================================== */

await check("TC-REG-01 导入不产生新证据 → /progress 派生输出不变", async () => {
  const from = await sampleStorage();
  const { json } = await buildPack(from, SEL_ALL);
  const into = await sampleStorage();

  const titles = new Map<string, string>();
  for (const d of await into.listDocuments()) for (const c of await into.listChapters(d.id)) titles.set(c.id, c.title);
  const titleOf = (id: string): string | undefined => titles.get(id);
  const derive = async (): Promise<string> =>
    stableStringify({
      heatmap: buildHeatmap(await into.listEvidence(), { now: NOW }),
      weakness: buildWeakness(await into.getLearnerState(), await into.listPaperResults(), titleOf, 5),
    });

  const before = await derive();
  assert.ok(before.length > 0);
  await importPack(into, json, { idGen: seqIdGen(), now: NOW, parseInWorker: false });
  assert.equal(await derive(), before, "导入既不加证据、也不动 byUnit");
});

await check("TC-REG-02 列表投影：失效 id 被过滤，全部失效才报 allGone", async () => {
  const live = new Set(["doc-1", "doc-9"]);
  const rows = packRowsOf(
    [
      { contentHash: "h1", title: "部分在", importedAt: 2, documentIds: ["doc-1", "doc-gone"], counts: countsOfPack(minimalFile().data as PackData) },
      { contentHash: "h2", title: "全没了", importedAt: 1, documentIds: ["doc-x"], counts: countsOfPack(minimalFile().data as PackData) },
    ],
    live,
  );
  assert.deepEqual(rows[0].documentIds, ["doc-1"], "绝不把裸 id / 失效 id 交给 UI");
  assert.equal(rows[0].allGone, false);
  assert.deepEqual(rows[1].documentIds, []);
  assert.equal(rows[1].allGone, true);
});

/* ================================================================== */
/* TC-REMOTE：链接拉取（mock fetch，零真实网络）                          */
/* ================================================================== */

/** 造一个 `Response` 替身（node 有全局 `Response` / `Headers`，但 body 流需要自己搭）。 */
function fakeResponse(init: { status?: number; headers?: Record<string, string>; body?: ReadableStream<Uint8Array> | null; text?: string }): Response {
  const status = init.status ?? 200;
  return {
    ok: status < 400,
    status,
    headers: new Headers(init.headers ?? {}),
    body: init.body ?? null,
    text: async (): Promise<string> => init.text ?? "",
  } as unknown as Response;
}

await check("TC-REMOTE-01 只允许 https：http / file / 非法 URL → invalid 且零请求", async () => {
  let called = 0;
  const spy: FetchLike = async () => {
    called += 1;
    return fakeResponse({});
  };
  assert.deepEqual(parsePackUrl("http://x/a.ploskp.json"), { ok: false, kind: "invalid" });
  assert.deepEqual(parsePackUrl("file:///tmp/a.ploskp.json"), { ok: false, kind: "invalid" });
  assert.deepEqual(parsePackUrl("not a url"), { ok: false, kind: "invalid" });
  assert.deepEqual(parsePackUrl("https://x/a.ploskp.json"), { ok: true, url: "https://x/a.ploskp.json" });

  for (const bad of ["http://x/a.json", "file:///a.json", "nonsense"]) {
    await assert.rejects(
      () => fetchPackText(spy, bad),
      (err: unknown) => err instanceof PackRemoteError && err.kind === "invalid",
      `${bad} 应判 invalid`,
    );
  }
  assert.equal(called, 0, "非法链接不得发出任何请求");
});

await check("TC-REMOTE-02 网络类失败：404 / reject / 超时 → network", async () => {
  const notFound: FetchLike = async () => fakeResponse({ status: 404 });
  await assert.rejects(
    () => fetchPackText(notFound, "https://x/a.json"),
    (err: unknown) => err instanceof PackRemoteError && err.kind === "network" && err.message.includes("404"),
  );

  const refused: FetchLike = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(
    () => fetchPackText(refused, "https://x/a.json"),
    (err: unknown) => err instanceof PackRemoteError && err.kind === "network",
  );

  // 永不 resolve 的 fetch：只能靠 AbortController + 超时把它解开
  const hanging: FetchLike = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  await assert.rejects(
    () => fetchPackText(hanging, "https://x/a.json", { timeoutMs: 1 }),
    (err: unknown) => err instanceof PackRemoteError && err.kind === "network",
  );
});

await check("TC-REMOTE-03 体积护栏：Content-Length 预检 + 流式超限提前 cancel", async () => {
  // ① 声明超限 → 连 `getReader()` 都不该被调用。
  //    ⚠️ 不用 `ReadableStream` 计数：它的默认 HWM=1 会在**构造时就**预拉一块，
  //    计数会假报警。改为「一读就抛」的替身 —— 一旦实现顺序写反，异常会直接冒出来。
  const untouched = {
    getReader(): never {
      throw new Error("Content-Length 预检必须早于读 body");
    },
  } as unknown as ReadableStream<Uint8Array>;
  await assert.rejects(
    () => fetchPackText(async () => fakeResponse({ headers: { "content-length": "4096" }, body: untouched }), "https://x/a.json", { maxBytes: 1024 }),
    (err: unknown) => err instanceof PackRemoteError && err.kind === "too-large",
  );

  // ② 无 content-length，body 每块 700 B、上限 1000 B → 第 2 次读就超限 → 立即 cancel
  let reads = 0;
  let cancelled = false;
  const body = {
    getReader() {
      return {
        async read(): Promise<{ done: boolean; value?: Uint8Array }> {
          reads += 1;
          return reads <= 3 ? { done: false, value: new Uint8Array(700) } : { done: true };
        },
        async cancel(): Promise<void> {
          cancelled = true;
        },
      };
    },
  } as unknown as ReadableStream<Uint8Array>;
  await assert.rejects(
    () => fetchPackText(async () => fakeResponse({ body }), "https://x/a.json", { maxBytes: 1000 }),
    (err: unknown) => err instanceof PackRemoteError && err.kind === "too-large",
  );
  assert.equal(reads, 2, "超限后立即断流，不等 body 读完");
  assert.equal(cancelled, true, "必须显式 cancel 掉未读完的流");
});

await check("TC-REMOTE-04 拉回来的不是包（HTML 404 页）→ not-json", async () => {
  const html: FetchLike = async () => fakeResponse({ text: "<!doctype html><html>404</html>", headers: {} });
  const text = await fetchPackText(html, "https://x/a.json");
  const parsed = await parsePack(text, { parseInWorker: false });
  assert.equal(parsed.ok ? "" : parsed.kind, "not-json");
  // 而合法 JSON 但不是包 → not-pack（两条分类不混淆）
  const wrong: FetchLike = async () => fakeResponse({ text: JSON.stringify({ kind: "plos.backup" }) });
  const parsed2 = await parsePack(await fetchPackText(wrong, "https://x/a.json"), { parseInWorker: false });
  assert.equal(parsed2.ok ? "" : parsed2.kind, "not-pack");
});

/* ================================================================== */
/* TC-PAGE：主页面读库失败的错误态（方案 §12.2 收口项）                    */
/* ================================================================== */

/**
 * `Document` / `Chapter` 下沉 SQLite（D12–D16）之后，「读库失败」从理论问题
 * 变成了真实路径：SQLite 不可用时 `listDocuments()` 抛 `StorageUnavailableError`。
 *
 * 资料库页原先直接 `await`，失败会落到 `docs.length === 0` 的空态 —— 与真正的
 * 「空库」渲染**同一个页面**，用户会以为资料丢了（§12.3 手工验收第 11 条）。
 *
 * ⚠️ 只断言两条语义，不锁具体写法（重构时不误伤）：
 * ① `load()` 捕获失败；② 渲染时错误态排在空态**之前**。
 * HomePage 无需在此断言 —— 它的错误态由 `useLoopStore.refresh` 的 catch
 * （`set({ error })`）统一承担，属既有机制。
 */
await check("TC-PAGE-01 资料库页：读库失败要被捕获，且错误态排在空态之前", () => {
  const code = codeOf("src/features/learn/LibraryPage.tsx");

  const loadAt = code.indexOf("const load = async () => {");
  assert.ok(loadAt >= 0, "LibraryPage 应有 load()");
  const nextAt = code.indexOf("useEffect(", loadAt);
  const loadBody = code.slice(loadAt, nextAt > loadAt ? nextAt : undefined);
  assert.ok(
    loadBody.includes("catch"),
    "load() 必须捕获读库失败 —— 否则 rejection 无人接管，docs 停在 [] 即空态",
  );

  const errAt = code.indexOf("lib.loadFailedTitle");
  const emptyAt = code.indexOf("lib.emptyTitle");
  assert.ok(errAt >= 0, "错误态应走 i18n 文案 lib.loadFailedTitle（不硬编码文案）");
  assert.ok(emptyAt >= 0, "空态应走 i18n 文案 lib.emptyTitle");
  assert.ok(errAt < emptyAt, "错误态必须排在空态之前，否则「读不出来」会显示成「还没有资料」");
});

/**
 * TC-PAGE-02 试卷中心：同病不同症。QuizCenterPage 的 `rows` 初值是
 * `undefined`，`load()` 失败时若不记错，页面会**永远停在「正在加载…」**
 * —— 与真在加载无法区分（比假空态更让人干等）。
 * 语义同 TC-PAGE-01：① `load()`（useCallback）捕获失败；② 错误态排在
 * loading 之前。`loadError` 存在时副标题也要让位（「学完一章后出卷测验」
 * 在故障下是误导）。
 */
await check("TC-PAGE-02 试卷中心：读库失败要被捕获，且错误态排在 loading 之前", () => {
  const code = codeOf("src/features/quiz/QuizCenterPage.tsx");

  const loadAt = code.indexOf("load = useCallback(async () => {");
  assert.ok(loadAt >= 0, "QuizCenterPage 应有 useCallback 形式的 load()");
  const nextAt = code.indexOf("useEffect(", loadAt);
  const loadBody = code.slice(loadAt, nextAt > loadAt ? nextAt : undefined);
  assert.ok(
    loadBody.includes("catch"),
    "load() 必须捕获读库失败 —— 否则 rows 停在 undefined，页面永远停在加载中",
  );
  assert.ok(
    loadBody.includes("setLoadError"),
    "失败必须写入 loadError state，而不是吞掉异常",
  );

  const errAt = code.indexOf("c.loadFailedTitle");
  const loadingAt = code.indexOf("c.loading");
  assert.ok(errAt >= 0, "错误态应走 i18n 文案 c.loadFailedTitle（不硬编码文案）");
  assert.ok(loadingAt >= 0, "loading 应走 i18n 文案 c.loading");
  assert.ok(errAt < loadingAt, "错误态必须排在 loading 之前，否则失败时永远显示「正在加载…」");
  assert.ok(
    code.includes("loadError\n            ? undefined"),
    "读库失败时 SectionTitle 副标题必须让位（故障下显示「学完一章后出卷测验」是误导）",
  );
});

/* ================================================================== */
/* 汇总                                                                */
/* ================================================================== */

console.log(`\n[knowledge-pack] ${results.length - failures}/${results.length} 通过\n`);
for (const line of results) console.log("  " + line);
if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exitCode = 1;
}
