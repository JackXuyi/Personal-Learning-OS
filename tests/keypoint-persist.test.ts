/**
 * 要点分析「中断不丢 + 可分次收敛」—— 覆盖度、选目标与落库位置的回归锁。
 *
 * 被锁的口径来自 `docs/library-keypoint-persist-design-2026-09.md`：
 * 要点分析原本把唯一的 `saveChapters` 放在 42 章循环**之外**（全有全无），
 * 且没有 `onlyMissing`（无法续跑）。本机实测两份资料（42 章 / 2 章）的
 * `keyPointRefs` 全为 0，且日志里**从未出现过**「要点分析完成」——
 * 0 引用的成因是「一轮没跑完」，不是「跑了但锚不上」。
 *
 * 运行（Node 22 + 类型剥离直跑，见 package.json `test:keypersist`）：
 *   npm run test:keypersist
 *
 * 两层断言（与 `tests/session-rating.test.ts` 同一手法）：
 *   ① **纯函数层**：`keypoint-coverage.ts` 的覆盖度与选目标真值直跑
 *      （判据只有一把尺子 `hasKeyPointRefs`，覆盖度与选目标必须互相咬合）。
 *   ② **源码层**：落库位置（循环内写 chapter / 循环外写 `keyPointsAt`）、
 *      UI 不许再内联数第二遍、两个按钮必须显式传参 —— 这些是
 *      `analyzeKeyPointsNow` 与 `.tsx` 里的接线事实，行为测试覆盖不到全部入口，
 *      故读源码 + 正则（本仓库处理「UI 层不变量」的既有惯例）。
 *
 * ⚠️ 刻意**不**构造假 provider 去跑真实 AI 管道：`extractKeyPointsMapped` 在
 * 单块失败时是「计入 skippedBlocks 而非抛错」，用假 provider 反推 `failed[]`
 * 会与管道的真实错误语义耦合。选目标与覆盖度已抽成纯函数直测，接线由源码级
 * 断言锁死，两者合起来覆盖同一组不变量。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Chapter } from "../src/domain/index.ts";
import {
  hasKeyPointRefs,
  keyPointCoverage,
  keyPointsTargets,
} from "../src/features/learn/keypoint-coverage.ts";
import { en } from "../src/i18n/messages/en.ts";
import { zh } from "../src/i18n/messages/zh.ts";

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

/** 造一章：`refs === undefined` = 老数据缺字段；`0` = 有字段但无引用。 */
function chapter(id: string, refs: number | undefined): Chapter {
  const c: Chapter = {
    id,
    documentId: "doc-1",
    order: Number(id.replace(/\D/g, "")) || 1,
    title: `章 ${id}`,
    contentRef: { start: 0, end: 10 },
    keyPoints: [],
    unitIds: [],
    status: "not-started",
    createdAt: 0,
  };
  if (refs !== undefined) {
    c.keyPointRefs = Array.from({ length: refs }, (_, i) => ({
      point: `要点 ${i}`,
      quote: `原文 ${i}`,
      start: i,
      end: i + 1,
    }));
  }
  return c;
}

/* ---------------- 源码读取 ---------------- */

/**
 * 读源码并**剥掉注释** —— 源码断言只针对代码。
 *
 * 不这么做的话，注释里为说明「为什么会中断」而写出的字面量（如
 * `saveChapters`）会被自己的正则命中，把「说明」判成「接线」。实测踩过。
 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** 取出锚点后紧跟的第一个花括号块（含嵌套），用于「在循环体内」类断言。 */
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

const countLines = (file: string): number => readFileSync(file, "utf8").split("\n").length;

const SVC = "src/features/learn/analyze-service.ts";
const KT = "src/features/learn/detail/KnowledgeTab.tsx";

async function main() {
  /* ---------- ① 覆盖度：从章节数据派生「跑到哪了」 ---------- */

  await check("TC-KP-COV-01 无章：全零且 incomplete=false（没有可补的对象）", () => {
    assert.deepEqual(keyPointCoverage([]), {
      withRefs: 0,
      total: 0,
      missing: 0,
      incomplete: false,
    });
  });

  await check("TC-KP-COV-02 全无引用：missing=total、incomplete=true", () => {
    assert.deepEqual(keyPointCoverage([chapter("c1", 0), chapter("c2", 0)]), {
      withRefs: 0,
      total: 2,
      missing: 2,
      incomplete: true,
    });
  });

  await check("TC-KP-COV-03 全有引用：missing=0、incomplete=false", () => {
    assert.deepEqual(keyPointCoverage([chapter("c1", 1), chapter("c2", 3)]), {
      withRefs: 2,
      total: 2,
      missing: 0,
      incomplete: false,
    });
  });

  await check("TC-KP-COV-04 部分引用（1/0/2）：只数「有引用」的章", () => {
    assert.deepEqual(
      keyPointCoverage([chapter("c1", 1), chapter("c2", 0), chapter("c3", 2)]),
      { withRefs: 2, total: 3, missing: 1, incomplete: true },
    );
  });

  await check("TC-KP-COV-05 老数据无 keyPointRefs 字段 → 视为缺失（不报错）", () => {
    assert.deepEqual(keyPointCoverage([chapter("c1", undefined)]), {
      withRefs: 0,
      total: 1,
      missing: 1,
      incomplete: true,
    });
    assert.equal(hasKeyPointRefs(chapter("c1", undefined)), false);
    assert.equal(hasKeyPointRefs(chapter("c1", 0)), false);
    assert.equal(hasKeyPointRefs(chapter("c1", 1)), true);
  });

  /* ---------- ② 选目标：onlyMissing 的语义 ---------- */

  const mixed = [chapter("c1", 0), chapter("c2", 2), chapter("c3", 0)];

  await check("TC-KP-TGT-01 onlyMissing=false → 全部章（与改造前等价）", () => {
    const targets = keyPointsTargets(mixed, false);
    assert.deepEqual(
      targets.map((c) => c.id),
      ["c1", "c2", "c3"],
    );
  });

  await check("TC-KP-TGT-02 onlyMissing=true → 只挑无引用的章，顺序不变", () => {
    assert.deepEqual(
      keyPointsTargets(mixed, true).map((c) => c.id),
      ["c1", "c3"],
    );
  });

  await check("TC-KP-TGT-03 onlyMissing=true 且全部已有引用 → 空目标（零 AI 调用）", () => {
    assert.deepEqual(keyPointsTargets([chapter("c1", 1), chapter("c2", 2)], true), []);
  });

  await check("TC-KP-TGT-04 没有章时两种模式都是空目标（不抛错）", () => {
    assert.deepEqual(keyPointsTargets([], true), []);
    assert.deepEqual(keyPointsTargets([], false), []);
  });

  await check("TC-KP-TGT-05 一把尺子：覆盖度与选目标必须互相咬合", () => {
    // 若两处各写一份判据，最可能的漂移就是「数出来的 missing」与「真去补的条数」不等。
    for (const set of [[], [chapter("c1", 0)], mixed, [chapter("c1", 1), chapter("c2", 2)]]) {
      const cov = keyPointCoverage(set);
      assert.equal(
        cov.missing,
        keyPointsTargets(set, true).length,
        `missing(${cov.missing}) 与 onlyMissing 目标数应一致`,
      );
    }
  });

  /* ---------- ③ 源码层：落库位置与人机接口 ---------- */

  await check("TC-KP-WIRE-01 每章都写库：saveChapters 出现在 for 循环体内", () => {
    const fn = bracedBlockOf(codeOf(SVC), "export async function analyzeKeyPointsNow");
    const loop = bracedBlockOf(fn, "for (let i = 0; i < targets.length; i++)");
    assert.ok(
      /storage\.saveChapters\s*\(/.test(loop),
      "循环体内必须有 saveChapters —— 否则又回到「整轮跑完才写」的全有全无",
    );
    const total = fn.match(/storage\.saveChapters\s*\(/g)?.length ?? 0;
    assert.equal(total, 2, `函数内应有 2 处 saveChapters（逐章 1 + 收尾 flush 1），实际 ${total}`);
  });

  await check("TC-KP-WIRE-02 选目标走共享纯函数，服务层不得自己数 keyPointRefs", () => {
    const src = codeOf(SVC);
    assert.ok(
      /keyPointsTargets\s*\(\s*chapters\s*,\s*onlyMissing\s*\)/.test(src),
      "必须用 keyPointsTargets(chapters, onlyMissing) 选目标",
    );
    assert.ok(
      !/keyPointRefs\?\.\s*length/.test(src),
      "服务层不得内联 keyPointRefs 长度判断（判据只允许在 keypoint-coverage.ts）",
    );
    // 判据本身的定义处：谓词必须真的读 keyPointRefs
    const cov = codeOf("src/features/learn/keypoint-coverage.ts");
    const pred = bracedBlockOf(cov, "export function hasKeyPointRefs");
    assert.ok(/keyPointRefs/.test(pred), "hasKeyPointRefs 必须读 keyPointRefs");
  });

  await check("TC-KP-WIRE-03 keyPointsAt 只在整轮结束后写（循环体内不得出现）", () => {
    const fn = bracedBlockOf(codeOf(SVC), "export async function analyzeKeyPointsNow");
    const loop = bracedBlockOf(fn, "for (let i = 0; i < targets.length; i++)");
    assert.ok(!/keyPointsAt/.test(loop), "跑一半不得写 keyPointsAt —— 那是「跑完」的语义");
    assert.ok(!/saveDocument\s*\(/.test(loop), "循环体内不得写 doc（时间戳/模型只整轮写一次）");
    assert.ok(/keyPointsAt/.test(fn), "整轮结束后仍必须写一次 keyPointsAt");
  });

  await check("TC-KP-WIRE-04 onlyMissing 默认 false（既有调用行为不得被悄悄改成「只补齐」）", () => {
    assert.ok(
      /onlyMissing\s*=\s*false/.test(codeOf(SVC)),
      "解构处必须写 onlyMissing = false",
    );
  });

  await check("TC-KP-WIRE-05 UI 不内联数第二遍：覆盖度只走 keyPointCoverage", () => {
    const src = codeOf(KT);
    assert.ok(/keyPointCoverage\s*\(/.test(src), "KnowledgeTab 必须用 keyPointCoverage");
    assert.ok(
      !/\.keyPointRefs\?\.\s*length/.test(src),
      "KnowledgeTab 不得再内联数 keyPointRefs（一把尺子）",
    );
    // 覆盖度行仍然渲染（复用既有 pointsDone，不新增第二个文案键）
    assert.ok(/pointsDone\s*\(/.test(src), "覆盖度行必须仍在渲染");
  });

  await check("TC-KP-WIRE-06 两个入口显式传参（onClick 直接挂函数会把 MouseEvent 当 onlyMissing）", () => {
    const src = codeOf(KT);
    assert.ok(/analyzePoints\s*\(\s*true\s*\)/.test(src), "「仅补齐缺失」必须传 true");
    assert.ok(/analyzePoints\s*\(\s*false\s*\)/.test(src), "「AI 分析要点」必须传 false");
    assert.ok(
      !/onClick=\{analyzePoints\}/.test(src),
      "不得直接把 analyzePoints 挂到 onClick —— MouseEvent 恒真，等于悄悄变成「仅补齐」",
    );
    assert.ok(
      /!coverage\.incomplete/.test(src),
      "「仅补齐缺失」按钮必须按 coverage.incomplete 置灰",
    );
  });

  /* ---------- ④ 边界与回归 ---------- */

  await check("TC-KP-REG-04 端点规模：两个被改文件均 ≤700 行", () => {
    for (const f of [SVC, KT]) {
      const n = countLines(f);
      assert.ok(n <= 700, `${f} 已 ${n} 行（上限 700）`);
    }
  });

  await check("TC-KP-REG-05 i18n 双语成对且确实译过（不是复制粘贴）", () => {
    const zhText = zh.learn.detail.knowledge.onlyMissingPoints;
    const enText = en.learn.detail.knowledge.onlyMissingPoints;
    assert.equal(typeof zhText, "string");
    assert.equal(typeof enText, "string");
    assert.ok(zhText.length > 0 && enText.length > 0, "两侧文案都不得为空");
    assert.notEqual(zhText, enText, "英文侧不得直接沿用中文");
    // 与既有覆盖度文案同处一个命名空间，方便一起阅读
    assert.equal(typeof zh.learn.detail.knowledge.pointsDone, "function");
    assert.equal(typeof en.learn.detail.knowledge.pointsDone, "function");
  });
}

await main();

for (const line of results) console.log(line);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
