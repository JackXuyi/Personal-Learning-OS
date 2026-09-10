/**
 * chunk-engine 单测（docs/rag-wiring-design-2026-09.md §12）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:chunk
 *
 * 覆盖：段落聚合、硬切（有/无标点）、全局 position、越界夹取、确定性、
 * metadata/tokenCount 填充、空正文边界。
 */
import assert from "node:assert/strict";
import type { Chapter, Chunk, SourceDocument } from "../src/domain/index.ts";
import { estimateTokenCount } from "../src/domain/chunk.ts";
import {
  chapterBodyOf,
  chunkChapter,
  chunkDocument,
  DEFAULT_HARD_MAX_TOKENS,
  DEFAULT_TARGET_TOKENS,
} from "../src/engine/chunk-engine.ts";

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

// ===== 构造辅助 =====

/** 一段纯中文正文（不含标点，便于精确控制 token）。 */
function cn(n: number): string {
  return "学".repeat(n);
}

/** 用空行拼接段落。 */
function paras(...ps: string[]): string {
  return ps.join("\n\n");
}

function chapter(id: string, start: number, end: number, title = `第 ${id} 章`): Chapter {
  return {
    id,
    documentId: "doc1",
    order: 0,
    title,
    contentRef: { start, end },
    keyPoints: [],
    unitIds: [],
    status: "not-started",
    createdAt: 1,
  };
}

/** 去掉所有空白后比较（硬切会折叠块首空白，正文不得丢）。 */
function squeeze(s: string): string {
  return s.replace(/\s+/g, "");
}

const run = async () => {
  // ===== A. 段落聚合 =====

  await check("A1 空正文 / 纯空白 → 不产出 chunk，不抛错（TC-EDGE-01）", () => {
    const base = { documentId: "doc1", chapterId: "ch1", chapterTitle: "T", startPosition: 0 };
    assert.deepEqual(chunkChapter({ ...base, text: "" }), []);
    assert.deepEqual(chunkChapter({ ...base, text: "   \n\n  \t " }), []);
  });

  await check("A2 单段不足 target → 1 块", () => {
    const out = chunkChapter({
      documentId: "doc1",
      chapterId: "ch1",
      chapterTitle: "注意力机制",
      text: cn(60), // 60 中文字 ≈ 40 token
      startPosition: 0,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].content, cn(60));
    assert.equal(out[0].position, 0);
    assert.equal(out[0].tokenCount, estimateTokenCount(cn(60)));
    assert.deepEqual(out[0].metadata, { heading: "注意力机制" });
    assert.deepEqual(out[0].knowledgeIds, []);
  });

  await check("A3 段落聚合到 target 即 flush（12×100 字 → 5/5/2 三段）", () => {
    const text = paras(...Array.from({ length: 12 }, () => cn(100)));
    const out = chunkChapter(
      { documentId: "doc1", chapterId: "ch1", chapterTitle: "T", text, startPosition: 0 },
      { now: 1 },
    );
    assert.equal(out.length, 3);
    // 每块内部的段落数（按 "\n\n" 数 + 1 计）
    assert.deepEqual(
      out.map((c) => c.content.split("\n\n").length),
      [5, 5, 2],
      `每块段落数应随 target=${DEFAULT_TARGET_TOKENS} token 切分`,
    );
    assert.deepEqual(
      out.map((c) => c.position),
      [0, 1, 2],
    );
    // 聚合不丢正文
    assert.equal(squeeze(out.map((c) => c.content).join("")), squeeze(text));
  });

  await check("A4 空标题不写 metadata.heading", () => {
    const out = chunkChapter({
      documentId: "doc1",
      chapterId: "ch1",
      chapterTitle: "   ",
      text: cn(10),
      startPosition: 0,
    });
    assert.equal(out[0].metadata, undefined);
  });

  // ===== B. 硬切 =====

  await check("B1 超长段无标点 → 硬截断，正文不丢（TC-EDGE-02）", () => {
    const text = "a".repeat(2050); // 2050/4 ≈ 513 token > hardMax 512
    const out = chunkChapter(
      { documentId: "doc1", chapterId: "ch1", chapterTitle: "T", text, startPosition: 0 },
      { now: 1 },
    );
    assert.ok(out.length >= 2, `应切成多块，实际 ${out.length}`);
    assert.equal(out.map((c) => c.content).join(""), text, "硬截断不得丢字符");
    for (const c of out) {
      assert.ok(
        (c.tokenCount ?? 0) <= DEFAULT_HARD_MAX_TOKENS,
        `单块不得超过硬上限：${c.tokenCount}`,
      );
    }
  });

  await check("B2 超长段有句末标点 → 优先在标点处断开", () => {
    const text = `${"a".repeat(2000)}。${"a".repeat(50)}`;
    const out = chunkChapter(
      { documentId: "doc1", chapterId: "ch1", chapterTitle: "T", text, startPosition: 0 },
      { now: 1 },
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].content.length, 2001, "应在句号之后断开");
    assert.ok(out[0].content.endsWith("。"));
    assert.equal(out.map((c) => c.content).join(""), text, "断开不丢字符");
  });

  await check("B3 中英混排超长段：块数与字符完整性", () => {
    const text = `${cn(600)}\n\n${"word ".repeat(400)}`;
    const out = chunkChapter(
      { documentId: "doc1", chapterId: "ch1", chapterTitle: "T", text, startPosition: 0 },
      { now: 1 },
    );
    assert.ok(out.length >= 2);
    assert.equal(squeeze(out.map((c) => c.content).join("")), squeeze(text));
  });

  // ===== C. 确定性 =====

  await check("C1 同输入恒同输出（除 id）", () => {
    const input = {
      documentId: "doc1",
      chapterId: "ch1",
      chapterTitle: "T",
      text: paras(cn(100), cn(100), cn(100)),
      startPosition: 3,
    };
    const a = chunkChapter(input, { now: 42 });
    const b = chunkChapter(input, { now: 42 });
    const strip = (list: Chunk[]) => list.map(({ id: _id, ...rest }) => rest);
    assert.deepEqual(strip(a), strip(b));
    assert.notEqual(a[0].id, b[0].id, "id 应各自生成");
    assert.equal(a[0].createdAt, 42, "now 可注入");
  });

  // ===== D. chapterBodyOf 夹取 =====

  await check("D1 contentRef 越界 → 夹取不抛错（TC-EDGE-03）", () => {
    const doc: Pick<SourceDocument, "textPreview"> = { textPreview: "12345" };
    assert.equal(chapterBodyOf(doc, chapter("ch1", 2, 100)), "345");
    assert.equal(chapterBodyOf(doc, chapter("ch1", -5, 3)), "123");
    assert.equal(chapterBodyOf(doc, chapter("ch1", 9, 12)), "");
    assert.equal(chapterBodyOf({ textPreview: undefined }, chapter("ch1", 0, 5)), "");
  });

  // ===== E. chunkDocument =====

  await check("E1 跨章 position 全局连续，空章跳过", () => {
    // 布局：p1(60) \n\n p2(60) \n\n\n\n p3(60) —— 中间的 4 换行被切成一章「空白章」
    const p1 = cn(60);
    const p2 = cn(60);
    const p3 = cn(60);
    const text = `${p1}\n\n${p2}\n\n\n\n${p3}`;
    const cut1 = p1.length + 2 + p2.length; // p1 段尾
    const cut2 = cut1 + 4; // 空白章段尾

    const doc: Pick<SourceDocument, "id" | "textPreview"> = { id: "doc1", textPreview: text };
    const chapters = [
      chapter("ch1", 0, cut1), // p1 + p2 → 1 块
      chapter("ch2", cut1, cut2), // 纯空白 → 0 块
      chapter("ch3", cut2, text.length), // p3 → 1 块
    ];
    const out = chunkDocument(doc, chapters, { now: 1 });

    assert.equal(out.length, 2, "空白章不产出 chunk");
    assert.deepEqual(
      out.map((c) => c.position),
      [0, 1],
      "position 必须从 0 起全局连续无空洞",
    );
    assert.deepEqual(
      out.map((c) => c.chapterId),
      ["ch1", "ch3"],
    );
    assert.ok(
      out.every((c) => c.id.startsWith("chk-")),
      "id 前缀应为 chk-",
    );
  });

  await check("E2 章顺序按 order 归一（乱序输入不影响产出顺序）", () => {
    const p1 = cn(60);
    const p2 = cn(60);
    const text = `${p1}\n\n${p2}`;
    const doc = { id: "doc1", textPreview: text };
    const a = { ...chapter("a", 0, p1.length), order: 2 };
    const b = { ...chapter("b", p1.length + 2, text.length), order: 1 };
    const out = chunkDocument(doc, [a, b], { now: 1 });
    assert.deepEqual(
      out.map((c) => c.chapterId),
      ["b", "a"],
      "order 小的章其 chunk 应排在前面",
    );
  });

  await check("E3 零章 → 空数组", () => {
    assert.deepEqual(chunkDocument({ id: "doc1", textPreview: "任何正文" }, []), []);
  });

  console.log(results.join("\n"));
  console.log(`\nchunk-engine: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
};

void run();
