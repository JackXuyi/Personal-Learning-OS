/**
 * 资料详情页 · 原文锚定 单测（docs/library-detail-page-design-2026-09.md §11.1）。
 *
 * 运行：npm run test:library
 *
 * 覆盖（TC-ANCHOR-01…03）：
 *  1) 精确命中 → 返回正确区间；
 *  2) quote 含多余空白（AI 把换行写成空格）→ 折叠后命中并**还原原始偏移**；
 *  3) quote 不存在 → undefined；
 *  4) quote 为空 / 超长（>2000 字，防 AI 灌水）→ undefined；
 *  5) anchorToDocument 正确叠加章起始偏移；
 *  6) 越界 / 空 body 不抛错，返回 undefined。
 */
import assert from "node:assert/strict";
import {
  anchorToDocument,
  foldWhitespace,
  locateQuote,
  MAX_QUOTE_CHARS,
} from "../src/features/learn/evidence-anchor.ts";

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

const BODY = "第一章 概述\n\n向量化把文本映射为向量。\n嵌入是稠密表示。";

await check("精确匹配：命中并返回 [start,end)", () => {
  const hit = locateQuote(BODY, "向量化把文本映射为向量。");
  assert.ok(hit, "应命中");
  assert.equal(BODY.slice(hit.start, hit.end), "向量化把文本映射为向量。");
});

await check("空白折叠：quote 用空格代替换行，仍能命中并还原原始偏移", () => {
  // 原文里是「概述\n\n向量化」，AI 常写成「概述 向量化」。
  const quote = "概述 向量化把文本";
  const hit = locateQuote(BODY, quote);
  assert.ok(hit, "折叠空白后应命中");
  // 还原出的原始片段必须真的来自原文（含换行），且包含 quote 的关键内容。
  const raw = BODY.slice(hit.start, hit.end);
  assert.ok(raw.includes("向量化把文本"), `还原片段异常：${JSON.stringify(raw)}`);
  assert.equal(hit.start, BODY.indexOf("概述"));
});

await check("未命中：返回 undefined", () => {
  assert.equal(locateQuote(BODY, "这段正文里根本没有这句话"), undefined);
});

await check("非法输入：空 quote / 超长 quote / 空 body → undefined", () => {
  assert.equal(locateQuote(BODY, ""), undefined);
  assert.equal(locateQuote(BODY, "   "), undefined);
  assert.equal(locateQuote(BODY, "x".repeat(MAX_QUOTE_CHARS + 1)), undefined);
  assert.equal(locateQuote("", "概述"), undefined);
});

await check("anchorToDocument：叠加章起始偏移得到文档绝对区间", () => {
  const base = 1000;
  const hit = anchorToDocument(BODY, "嵌入是稠密表示。", base);
  assert.ok(hit, "应命中");
  assert.equal(hit.start, base + BODY.indexOf("嵌入是稠密表示。"));
  assert.equal(hit.end - hit.start, "嵌入是稠密表示。".length);
});

await check("foldWhitespace：折叠后 map 能把下标映射回原始串", () => {
  const s = "a\n\n  b\u3000c";
  const { folded, map } = foldWhitespace(s);
  assert.equal(folded, "a b c");
  const isWs = (ch: string) => /\s/.test(ch);
  for (let i = 0; i < folded.length; i++) {
    const orig = s[map[i]];
    // 折叠出的空格锚定在原始空白字符上（可能是 \n / \u3000），非空白字符必须逐字相等。
    if (folded[i] === " ") assert.ok(isWs(orig), `下标 ${i} 应锚定空白，实际 '${orig}'`);
    else assert.equal(orig, folded[i], `下标 ${i} 映射错误：'${orig}' != '${folded[i]}'`);
  }
});

await check("body 短于 quote：返回 undefined 且不抛错", () => {
  assert.equal(locateQuote("短", "短文本里根本不存在的内容"), undefined);
});

console.log(results.join("\n"));
if (failures > 0) {
  console.error(`\n[library-anchor] ${results.length - failures}/${results.length} 通过`);
  process.exit(1);
}
console.log(`\n[library-anchor] ${results.length}/${results.length} 通过`);
