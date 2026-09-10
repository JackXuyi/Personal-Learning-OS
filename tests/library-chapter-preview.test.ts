/**
 * 资料详情页 · 章正文切片 单测（docs/library-detail-page-v2-design-2026-09.md §8.16）。
 *
 * 运行：npm run test:preview
 *
 * 覆盖：
 *  1) 正常区间 → 精确切片、不截断、chars = 区间长度；
 *  2) 超上限 → 优先在末尾空行断开，truncated = true，chars = 整章长度（TC-EDGE-04）；
 *  3) 上限前的空行过早（< 60%）→ 退回硬截断，不交出过短内容；
 *  4) contentRef 越界（替换正文后未重切）→ 夹取，不抛错、不越界（TC-EDGE-02）；
 *  5) end <= start / textPreview 缺失或为空 → undefined（不给 UI 造空壳）；
 *  6) chapterCharCount：正常值 / 反向区间为 0。
 */
import assert from "node:assert/strict";
import {
  CHAPTER_PREVIEW_CHARS,
  chapterCharCount,
  chapterPreviewOf,
} from "../src/features/learn/chapter-preview.ts";

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

/** 构造文档（只用到 textPreview）；缺失时给空对象，贴近真实老数据。 */
const docOf = (text?: string) => (text === undefined ? {} : { textPreview: text });
/** 构造章的区间引用。 */
const refOf = (start: number, end: number) => ({ contentRef: { start, end } });

await check("正常区间：精确切片、不截断、chars = 区间长度", () => {
  const p = chapterPreviewOf(docOf("0123456789"), refOf(2, 5));
  assert.ok(p, "应返回预览");
  assert.equal(p.text, "234");
  assert.equal(p.truncated, false);
  assert.equal(p.chars, 3);
});

await check("恰好等于上限：不截断", () => {
  const body = "x".repeat(CHAPTER_PREVIEW_CHARS);
  const p = chapterPreviewOf(docOf(body), refOf(0, body.length));
  assert.ok(p);
  assert.equal(p.text.length, CHAPTER_PREVIEW_CHARS);
  assert.equal(p.truncated, false);
});

await check("超上限：在末尾空行断开，chars 仍为整章长度（TC-EDGE-04）", () => {
  const head = "a".repeat(900);
  const body = `${head}\n\n${"b".repeat(2000)}`;
  const p = chapterPreviewOf(docOf(body), refOf(0, body.length));
  assert.ok(p);
  assert.equal(p.text, head, "应在空行处断开，且不含空行本身");
  assert.equal(p.text.length, 900);
  assert.equal(p.truncated, true);
  assert.equal(p.chars, body.length, "chars 是整章长度，不是截断后的长度");
});

await check("空行过早（< 60%）：退回硬截断", () => {
  const body = `${"a".repeat(100)}\n\n${"b".repeat(3000)}`;
  const p = chapterPreviewOf(docOf(body), refOf(0, body.length));
  assert.ok(p);
  assert.equal(p.text.length, CHAPTER_PREVIEW_CHARS, "过短的空行不应被采纳");
  assert.equal(p.truncated, true);
});

await check("自定义 limit 生效", () => {
  const p = chapterPreviewOf(docOf("abcdefghij"), refOf(0, 10), 4);
  assert.ok(p);
  assert.equal(p.text, "abcd");
  assert.equal(p.truncated, true);
  assert.equal(p.chars, 10);
});

await check("区间越界：夹取到合法范围，不抛错（TC-EDGE-02）", () => {
  const p = chapterPreviewOf(docOf("0123456789"), refOf(5, 999));
  assert.ok(p);
  assert.equal(p.text, "56789");
  assert.equal(p.chars, 5);
});

await check("起点已越界：空区间 → undefined", () => {
  assert.equal(chapterPreviewOf(docOf("0123456789"), refOf(50, 80)), undefined);
});

await check("end <= start → undefined", () => {
  assert.equal(chapterPreviewOf(docOf("0123456789"), refOf(5, 5)), undefined);
  assert.equal(chapterPreviewOf(docOf("0123456789"), refOf(7, 3)), undefined);
});

await check("textPreview 缺失 / 为空 → undefined", () => {
  assert.equal(chapterPreviewOf(docOf(undefined), refOf(0, 10)), undefined);
  assert.equal(chapterPreviewOf(docOf(""), refOf(0, 10)), undefined);
});

await check("chapterCharCount：正常值 / 反向区间夹取为 0", () => {
  assert.equal(chapterCharCount(refOf(10, 35)), 25);
  assert.equal(chapterCharCount(refOf(0, 0)), 0);
  assert.equal(chapterCharCount(refOf(9, 4)), 0, "反向区间不应出现负数");
});

console.log(results.join("\n"));
if (failures > 0) {
  console.error(`\n[library-chapter-preview] ${results.length - failures}/${results.length} 通过`);
  process.exit(1);
}
console.log(`\n[library-chapter-preview] ${results.length}/${results.length} 通过`);
