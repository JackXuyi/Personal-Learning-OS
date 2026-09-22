/**
 * 证据流「原子查重追加」—— 重复落库的回归锁。
 *
 * 缺陷（2026-09-21 真实库取证）：`QuizReportPage::logAssessmentEvidence` 用
 * `listEvidence()` → `some()` → `appendEvidence()` 自己实现幂等，三步跨两次
 * `await`，**不是原子操作**。`src/main.tsx` 挂着 `<React.StrictMode>`，开发态
 * effect 双执行 → 两个调用双双读到「尚无」再双双写入。实测本机 6 份判卷
 * **每份都落了 2 条内容完全相同**的 assessment 证据（5 对 `at` 精确到毫秒相同）：
 *
 *   {kind:assessment, subjectId:chp-1e79433b, sourceId:paper-08c78f50, …} ×2
 *
 * 用户可见后果：① `/progress` 学习活动热力图按 evidence 条数计数 → 活动量虚增一倍；
 * ② 首页「最近证据」`slice(0, 6)` 连续出现两条一模一样的行；③ F4 导出把这批
 * 重复数据当成用户资产带走。
 *
 * 运行（Node 22 + 类型剥离直跑，见 package.json `test:evidence`）：
 *   npm run test:evidence
 *
 * 三层断言：
 *   ① **行为层（真跑并发）**：`InMemoryStorage` 上并发两次写入只落 1 条；
 *      同时用**旧三步写法**做对照，证明这批断言确实能抓到竞态（不是空断言）。
 *   ② **源码层**：`QuizReportPage` 不得再出现「先查后写」，`HomePage::logToView`
 *      章解析不到时**整行不渲染**（且绝不回落裸 `subjectId`）。
 *      ⚠️ 这条 2026-09-22 **改判过**：原断言是「必须走 `units.subjectGone` 兜底」
 *      （保留该行、只兜底标题）；实测证据流是**行为历史**、刻意不随资料级联清
 *      （见 `docs/document-cascade-cleanup-2026-09.md`），而「最近证据」是**当前资产**
 *      的视图 ⇒ 改为**跳过整行**。`units.subjectGone` 仍归 `/progress` 趋势下拉
 *      （历史序列，不得剔除）与首页旧组装兜底用，故文案键本身保留。
 *   ③ **文案层**：`units.subjectGone` 中英成对且确实译过（它仍在另外两处消费）。
 *
 * ⚠️ 测试**不重写** `EVIDENCE_LOG_MAX` 的值（「两把尺子」陷阱）—— 从
 * `storage/memory.ts` 导入，改上限时本测试自动跟随。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { EvidenceEntry } from "../src/domain/index.ts";
import { en } from "../src/i18n/messages/en.ts";
import { zh } from "../src/i18n/messages/zh.ts";
import { EVIDENCE_LOG_MAX, InMemoryStorage } from "../src/storage/memory.ts";

const results: string[] = [];
let failures = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ---------------- fixtures ---------------- */

/** 复刻真实库里那对重复条目（`at` 取实测值，便于对照日志）。 */
function assessment(sourceId: string, subjectId = "chp-1e79433b"): EvidenceEntry {
  return {
    at: 1_789_533_317_932,
    kind: "assessment",
    subjectId,
    verdict: "fail",
    delta: 0.43333333333333335,
    sourceId,
  };
}

/** 本次修的就是这个判据：同一试卷只允许一条 assessment。 */
const samePaper = (paperId: string) => (e: EvidenceEntry) =>
  e.kind === "assessment" && e.sourceId === paperId;

/**
 * **旧写法**（缺陷形态，仅用于对照）：三步之间跨两次 `await`。
 *
 * 保留它的唯一目的是证明 TC-EV-02 不是空断言 —— 同一组并发调用下它会落 2 条。
 */
async function legacyIdempotentAppend(
  store: InMemoryStorage,
  entry: EvidenceEntry,
  predicate: (existing: EvidenceEntry) => boolean,
): Promise<void> {
  const existing = await store.listEvidence();
  if (existing.some(predicate)) return;
  await store.appendEvidence(entry);
}

/* ---------------- 源码读取 ---------------- */

/** 读源码并剥掉注释 —— 源码断言只针对代码（注释里的反面引用会被正则误命中）。 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** 取出锚点后紧跟的第一个花括号块（含嵌套）。 */
function bracedBlockOf(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  assert.ok(at >= 0, `源码中找不到锚点：${anchor}`);
  const open = src.indexOf("{", at);
  assert.ok(open >= 0, `锚点后没有代码块：${anchor}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`代码块未闭合：${anchor}`);
}

const QUIZ = "src/features/quiz/QuizReportPage.tsx";
const HOME = "src/features/home/HomePage.tsx";
const MEMORY = "src/storage/memory.ts";

async function main() {
  /* ---------- ① 行为层：并发只落一条 ---------- */

  await check("TC-EV-01 predicated 追加：首次落库返回 true 且内容逐字段一致", async () => {
    const store = new InMemoryStorage();
    const entry = assessment("paper-1");
    assert.equal(await store.appendEvidenceUnless(entry, samePaper("paper-1")), true);
    const log = await store.listEvidence();
    assert.equal(log.length, 1);
    assert.deepEqual(log[0], entry);
  });

  await check("TC-EV-02 并发两次只落 1 条（StrictMode effect 双执行的真实形态）", async () => {
    const store = new InMemoryStorage();
    // ⚠️ 先不 await 第一个就发起第二个 —— 复刻「两个 effect 同时在途」。
    const [a, b] = await Promise.all([
      store.appendEvidenceUnless(assessment("paper-1"), samePaper("paper-1")),
      store.appendEvidenceUnless(assessment("paper-1"), samePaper("paper-1")),
    ]);
    assert.deepEqual(
      [a, b].sort(),
      [false, true],
      "并发两次应恰好一次落库、一次被挡下",
    );
    assert.equal((await store.listEvidence()).length, 1, "并发两次只允许落 1 条");

    // 反证：同一组并发下旧三步写法会落 2 条 ⇒ 上面的断言确实在测竞态。
    const legacy = new InMemoryStorage();
    await Promise.all([
      legacyIdempotentAppend(legacy, assessment("paper-1"), samePaper("paper-1")),
      legacyIdempotentAppend(legacy, assessment("paper-1"), samePaper("paper-1")),
    ]);
    assert.equal(
      (await legacy.listEvidence()).length,
      2,
      "旧写法（先查后写）在同样并发下应落 2 条 —— 若这里变成 1 条，说明对照组失效了",
    );
  });

  await check("TC-EV-03 顺序调用（非并发）：第二次被 predicate 挡下，不重复落库", async () => {
    const store = new InMemoryStorage();
    assert.equal(await store.appendEvidenceUnless(assessment("paper-1"), samePaper("paper-1")), true);
    assert.equal(
      await store.appendEvidenceUnless(assessment("paper-1"), samePaper("paper-1")),
      false,
    );
    assert.equal((await store.listEvidence()).length, 1);
  });

  await check("TC-EV-04 存储层不替调用方猜键：predicate 之外一律不参与去重", async () => {
    const store = new InMemoryStorage();
    const never = () => false;
    // 同一 sourceId 的 card 证据可以反复落库（同一张卡能反复评分）——
    // 这正是「键必须由调用方给」的理由：若存储层自作聪明按 sourceId 去重，卡片证据就废了。
    const card = (at: number): EvidenceEntry => ({
      at,
      kind: "card",
      subjectId: "chp-1",
      verdict: "good",
      delta: 0,
      sourceId: "card-1",
    });
    await store.appendEvidenceUnless(card(1), never);
    await store.appendEvidenceUnless(card(2), never);
    assert.equal((await store.listEvidence()).length, 2, "同 sourceId 的 card 证据不得被隐式去重");

    // 换成「按试卷」这个键，后一条就被挡下：去重范围严格等于 predicate 表达的范围。
    await store.appendEvidenceUnless(assessment("paper-1"), samePaper("paper-1"));
    assert.equal(
      await store.appendEvidenceUnless(assessment("paper-1", "chp-9"), samePaper("paper-1")),
      false,
    );
    assert.equal((await store.listEvidence()).length, 3);
  });

  await check("TC-EV-05 上限裁剪仍生效（走同一条 appendEvidence，未绕过）", async () => {
    const store = new InMemoryStorage();
    const n = EVIDENCE_LOG_MAX + 3;
    for (let i = 0; i < n; i += 1) {
      // predicate 恒 false：本用例只验上限，不验去重。
      await store.appendEvidenceUnless({ at: i, kind: "review", subjectId: "chp-1", delta: 0 }, () => false);
    }
    const log = await store.listEvidence();
    assert.equal(log.length, EVIDENCE_LOG_MAX, "不得突破 EVIDENCE_LOG_MAX");
    // 超出保留最新：最旧那条（at = 0）必须已被裁掉
    assert.equal(Math.min(...log.map((e) => e.at)), n - EVIDENCE_LOG_MAX);
  });

  /* ---------- ② 源码层：接线与兜底 ---------- */

  await check("TC-EV-06 QuizReportPage 不得再自己「先查后写」（跨 await 即竞态）", () => {
    const src = codeOf(QUIZ);
    const fn = bracedBlockOf(src, "async function logAssessmentEvidence");
    assert.ok(
      /appendEvidenceUnless\s*\(/.test(fn),
      "必须走存储层的原子查重追加 appendEvidenceUnless",
    );
    assert.ok(
      !/listEvidence\s*\(/.test(fn),
      "不得再先 listEvidence 再 some 再 append —— 三步跨两次 await，并发必重复落库",
    );
    assert.ok(!/appendEvidence\s*\(/.test(fn), "不得再直接 appendEvidence（绕过查重）");
  });

  await check("TC-EV-07 基类实现把「查」与「写」放在同一段同步代码里", () => {
    const impl = bracedBlockOf(codeOf(MEMORY), "async appendEvidenceUnless");
    const body = impl.slice(impl.indexOf("{") + 1);
    const guard = body.indexOf(".some(");
    const firstAwait = body.search(/\bawait\b/);
    assert.ok(guard >= 0, "必须先查重（some）");
    // ⚠️ 关键不变量：查重必须出现在**第一个 await 之前**。一旦「查」与「写」之间
    // 出现让出点，并发的第二次调用就能读到旧快照再写一遍 —— 缺陷原样复现。
    assert.ok(
      firstAwait > guard,
      `查重必须早于第一个 await（some 在 ${guard}，首个 await 在 ${firstAwait}）`,
    );
    // 动态派发：基类调 this.appendEvidence，LocalStorageAdapter 的覆写才会落盘
    assert.ok(
      /await this\.appendEvidence\s*\(/.test(body),
      "必须经 this.appendEvidence 动态派发，否则 LocalStorageAdapter 不会 persist",
    );
  });

  await check("TC-EV-08 HomePage 章主体解析不到时整行不渲染（D7-A 章侧，2026-09-22 改判）", () => {
    const src = codeOf(HOME);
    const fn = bracedBlockOf(src, "function logToView");
    assert.ok(
      /if\s*\(!chapter\)\s*return undefined;/.test(fn),
      "章解析不到必须整行跳过（return undefined），由调用方 filter 掉",
    );
    assert.ok(
      !/units\.subjectGone/.test(fn),
      "logToView 不得再用 subjectGone 占位 —— 幽灵行会挤掉真实行（该键仍归 /progress 趋势用）",
    );
    assert.ok(
      !/(\?\?|:)\s*entry\.subjectId\b/.test(fn),
      "不得把 entry.subjectId 当兜底显示（实测会漏出 chp-1e79433b 这种裸 id）",
    );
    // 主体解析必须用全量索引 —— plan 的 chaptersByDoc/docTitleOf 会按目标范围裁剪，
    // 范围外的活章会被误判成「不存在」。
    assert.ok(/index\.byId\.get\s*\(/.test(fn), "主体必须从全量章索引取");
    assert.ok(
      /await loadChapterIndex\s*\(\s*plan\.docs\s*\)/.test(src),
      "全量索引必须由 plan.docs（未裁剪）构建",
    );
    assert.ok(
      !/chapterIndexOf\s*\(/.test(src),
      "不得再用按目标范围裁剪的 chapterIndexOf 解析证据主体",
    );
    // ⚠️ 顺序：先过滤 undefined 再截断 —— 先 slice 会让幽灵行白占真实行名额。
    const filterAt = src.indexOf(".filter((v): v is EvidenceView => v !== undefined)");
    const sliceAt = src.indexOf(".slice(0, 6)");
    assert.ok(filterAt >= 0 && sliceAt >= 0, "必须有 filter 与 slice(0, 6)");
    assert.ok(filterAt < sliceAt, "先 slice 再 filter 会让幽灵行挤掉真实行");
  });

  /* ---------- ③ 文案层 ---------- */

  await check("TC-EV-09 units.subjectGone 中英成对、非空、确实译过", () => {
    const z = zh.units.subjectGone;
    const e = en.units.subjectGone;
    assert.equal(typeof z, "string");
    assert.equal(typeof e, "string");
    assert.ok(z.length > 0 && e.length > 0, "两侧都不得为空");
    assert.notEqual(z, e, "英文侧不得直接沿用中文");
    // 与 F6 的同类兜底同处「主体解析不到」这一族，便于一起阅读
    assert.equal(typeof zh.capability.evidenceFallback, "string");
    assert.equal(typeof en.capability.evidenceFallback, "string");
  });
}

await main();

for (const line of results) console.log(line);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
