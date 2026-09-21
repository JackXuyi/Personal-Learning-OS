/**
 * 「实体解析不到 → **绝不显示裸 id**」反模式锁（2026-09-21）。
 *
 * 背景：F6 决策 D7-A 立的是「主体解析不到就不显示裸 id」，但实施时只落了 goal 侧
 * （`capability.evidenceFallback`）。章侧在 2026-09-21 补齐（`units.subjectGone`），
 * 同批扫出**同族的 4 处裸 id 兜底**：
 *
 *   ① `features/progress/analytics.ts::buildTrend` —— `titleOf(id) ?? id`
 *      ⇒ `/progress` 趋势下拉**实际渲染出裸 id**
 *   ② `components/CommandPalette.tsx` 正文命中 —— `chapterTitle || docTitle || chunk.id`
 *   ③ `features/goals/capability/CapabilityReportView.tsx` —— `snap?.label ?? s.itemId`
 *   ④ `features/goals/CapabilityRunPage.tsx` —— `…?.label ?? itemId`
 *
 * 真实库取证：章 `chp-1e79433b` 随资料删除后仍留在 2 份卷的 `perChapter` 里，
 * 于是 `/progress` 趋势下拉真的多出一项 `chp-1e79433b`。
 *
 * 运行（Node 22 + 类型剥离直跑，见 package.json `test:rawid`）：
 *   npm run test:rawid
 *
 * ⚠️ 两处**刻意保留**的 id 用法，断言不得误伤：
 *   1. React `key=`（如 `key={s.itemId}`）—— 那是身份标识，不是给人看的标签；
 *   2. `engine/learning-planner.ts` 与 `engine/loop.ts` 的防御性兜底 —— 上游
 *      `filter`/`Map` 已用**同一把尺子**过滤过，`.get(x)?.title ?? x` 实际不可达，
 *      且不进入渲染路径。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTrend } from "../src/features/progress/analytics.ts";
import { en } from "../src/i18n/messages/en.ts";
import { zh } from "../src/i18n/messages/zh.ts";
import type { PaperResult } from "../src/domain/quiz.ts";

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

/* ---------------- 源码读取 ---------------- */

/** 读源码并剥掉注释 —— 注释里的**反面引用**会被正则误命中（本仓库已踩过两次）。 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** 取含 `needle` 的第一行（行级断言：只在**渲染那一行**上判，避免误伤 key= 等合法用法）。 */
function lineWith(src: string, needle: string): string {
  const line = src.split("\n").find((l) => l.includes(needle));
  assert.ok(line !== undefined, `源码中找不到含「${needle}」的行`);
  return line;
}

const ANALYTICS = "src/features/progress/analytics.ts";
const PROGRESS = "src/features/progress/ProgressPage.tsx";
const PALETTE = "src/components/CommandPalette.tsx";
const CAP_REPORT = "src/features/goals/capability/CapabilityReportView.tsx";
const CAP_RUN = "src/features/goals/CapabilityRunPage.tsx";

/* ---------------- fixtures ---------------- */

function paper(
  createdAt: number,
  perChapter: Record<string, { score: number; previousMastery: number; mastery: number }>,
): PaperResult {
  return { paperId: `p${createdAt}`, totalScore: 0, perChapter, wrongQuestions: [], createdAt };
}

/** 章标题解析器：只认 c1（模拟「章 c1 还在、ghost 已被删」）。 */
const titleOf = (id: string): string | undefined => (id === "c1" ? "第一章" : undefined);

async function main() {
  /* ---------- ① 行为层：数据保留、标签诚实 ---------- */

  await check("TC-RAWID-01 混合场景：可解析的章有标题、已删的章留空 —— 但两者序列都在", () => {
    const t = buildTrend(
      [
        paper(1, { c1: { score: 0.5, previousMastery: 0, mastery: 0.5 } }),
        paper(2, { ghost: { score: 0.4, previousMastery: 0, mastery: 0.4 } }),
      ],
      titleOf,
    );
    const c1 = t.chapters.find((c) => c.id === "c1");
    const ghost = t.chapters.find((c) => c.id === "ghost");
    assert.ok(c1 && ghost, "两个章的历史序列都必须保留");
    assert.equal(c1.title, "第一章", "可解析 → 正常标题");
    assert.equal(ghost.title, undefined, "解析不到 → 留空（不得回落成 id）");
    assert.equal(ghost.points.length, 1, "已删章的历史点不丢");
    assert.equal(t.chapters.length, 2, "不因解析失败而剔除序列");
  });

  /* ---------- ② 实现层：源码里不得再有 `?? id` 兜底 ---------- */

  await check("TC-RAWID-02 analytics.ts 的 series 构造不再回落到 id", () => {
    const src = codeOf(ANALYTICS);
    const push = lineWith(src, "chapters.push({");
    assert.match(push, /title: titleOf\(id\)/, "应原样透传 titleOf 的结果");
    assert.doesNotMatch(push, /\?\?\s*id\b/, "不得写成 titleOf(id) ?? id");
    assert.match(src, /title\?: string;/, "类型上 title 必须是可选（诚实表达「解析不到」）");
  });

  await check("TC-RAWID-03 ProgressPage 趋势下拉用兜底文案渲染 title", () => {
    const src = codeOf(PROGRESS);
    const line = lineWith(src, "m.units.subjectGone");
    assert.match(line, /c\.title \?\? m\.units\.subjectGone/, "应为 `c.title ?? m.units.subjectGone`");
    // 反证：不存在「未兜底直接渲染 title」的写法。
    assert.doesNotMatch(src, /\{c\.title\}/, "不得出现裸 `{c.title}` 渲染");
  });

  await check("TC-RAWID-04 CommandPalette 正文命中不再回落到 chunk.id", () => {
    const src = codeOf(PALETTE);
    const line = lineWith(src, "m.cmd.typeContent");
    assert.match(line, /m\.cmd\.contentGone/, "label 应使用兜底文案");
    assert.doesNotMatch(line, /chunk\.id/, "该行不得再出现 chunk.id");
    // key 用途的 chunk.id 是合法身份标识，应仍然存在（证明断言只针对 label 行）。
    assert.match(src, /s-content-\$\{chunk\.id\}/, "chunk.id 作为 React key 的用法应保留");
  });

  await check("TC-RAWID-05 CapabilityReportView 项标签不再回落到 itemId", () => {
    const src = codeOf(CAP_REPORT);
    const line = lineWith(src, "label={");
    assert.match(line, /c\.itemGone/, "label 应使用兜底文案");
    assert.doesNotMatch(line, /\?\?\s*s\.itemId/, "不得回落成 s.itemId");
    // key={s.itemId} 必须保留（身份标识）。
    assert.match(src, /key=\{s\.itemId\}/, "React key 用法应保留");
  });

  await check("TC-RAWID-06 CapabilityRunPage 的 labelOf 不再回落到 itemId", () => {
    const src = codeOf(CAP_RUN);
    const line = lineWith(src, "?.label ??");
    assert.match(line, /c\.itemGone/, "应为 `?.label ?? c.itemGone`");
    assert.doesNotMatch(line, /\?\?\s*itemId\b/, "不得回落成裸 itemId");
  });

  /* ---------- ③ 文案层：兜底键必须成对且真的译过 ---------- */

  await check("TC-RAWID-07 三个兜底键中英成对、非空、确实译过", () => {
    const pairs: [string, string, string][] = [
      ["units.subjectGone", zh.units.subjectGone, en.units.subjectGone],
      ["cmd.contentGone", zh.cmd.contentGone, en.cmd.contentGone],
      ["capability.itemGone", zh.capability.itemGone, en.capability.itemGone],
    ];
    for (const [key, cn, english] of pairs) {
      assert.ok(cn.trim().length > 0, `${key} 中文为空`);
      assert.ok(english.trim().length > 0, `${key} 英文为空`);
      assert.notEqual(cn, english, `${key} 中英相同，疑似漏译`);
    }
  });

  /* ---------------- 汇总 ---------------- */

  for (const r of results) console.log(r);
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  if (failures > 0) process.exitCode = 1;
}

await main();
