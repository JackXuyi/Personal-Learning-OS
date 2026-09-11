/**
 * 章节切分 · 短章合并兜底 单测（docs/learn-splitter-min-body-merge-design-2026-09.md §5）。
 *
 * 运行：npm run test:splitter
 *
 * 覆盖：
 *  1) UC-1 空壳边界章（GitHub 导入 `# 路径` 后紧跟正文标题）→ 并入下一章；
 *  2) UC-2 尾部短章 → 并入上一章；
 *  3) UC-3 首章短章 → 并入下一章；
 *  4) UC-4 阈值边界：恰为 200 不合并，199 合并；
 *  5) UC-5 防吞保护：总正文 > 10,000 且将收敛为单章 → 停止合并；
 *  6) UC-6 小文档全短章 → 收敛为 1 章；
 *  7) UC-7 minBodyCharsPerChapter: 0 → 关闭兜底，行为同旧版；
 *  8) UC-8 段落聚类路径不受影响。
 */
import assert from "node:assert/strict";
import { splitDocument } from "../src/engine/splitter-engine.ts";

// ------------------------------------------------------------- 用例工具

/** 由 contentRef 还原章正文（不丢内容校验用）。 */
function sliceAll(text: string, chapters: { contentRef: { start: number; end: number } }[]): string {
  return chapters.map((c) => text.slice(c.contentRef.start, c.contentRef.end)).join("");
}

/** 章正文（剔除标题行后）字符数，与引擎口径一致。 */
function bodyChars(text: string, c: { contentRef: { start: number; end: number } }): number {
  return text
    .slice(c.contentRef.start, c.contentRef.end)
    .replace(/^#{1,6}\s+.*$/gm, "")
    .trim().length;
}

// ------------------------------------------------------------- UC-1 空壳边界章

function testShellBoundaryChapter(): void {
  // 模拟 buildRepoMarkdown 产物：`# README.md` 边界后紧跟文件自身的一级标题与正文。
  const text = [
    "# README.md",
    "",
    "# 学习路线",
    "",
    "这里是第一章的正文，内容足够长，超过两百个字符的阈值。",
    "补一句。补两句。补三句。补四句。补五句。补六句。补七句。补八句。",
    "补一句。补两句。补三句。补四句。补五句。补六句。补七句。补八句。",
    "补一句。补两句。补三句。补四句。补五句。补六句。补七句。补八句。",
    "再补一段。再补一段。再补一段。再补一段。再补一段。再补一段。",
    "再补一段。再补一段。再补一段。再补一段。再补一段。再补一段。",
    "再补一段。再补一段。再补一段。再补一段。再补一段。再补一段。",
    "再补一段。再补一段。再补一段。再补一段。再补一段。再补一段。",
    "",
    "## 贡献",
    "",
    "欢迎 PR。",
  ].join("\n");

  const out = splitDocument({ documentId: "d1", text });
  assert.equal(out.strategy, "headings");
  // 「学习路线」章吸收了空壳边界章（start = 0），「贡献」并入「学习路线」→ 共 1 章。
  assert.equal(out.chapters.length, 1);
  assert.equal(out.chapters[0].title, "学习路线");
  assert.equal(out.chapters[0].contentRef.start, 0);
  assert.equal(out.chapters[0].contentRef.end, text.length);
  // 原文零丢失。
  assert.equal(sliceAll(text, out.chapters), text);
}

// ------------------------------------------------------------- UC-2 尾部短章

function testTailShortChapterMergedIntoPrevious(): void {
  const long = "正".repeat(300);
  const text = ["# 第一章", "", long, "", "## 贡献", "", "欢迎 PR。"].join("\n");
  const out = splitDocument({ documentId: "d2", text });
  assert.equal(out.chapters.length, 1);
  assert.equal(out.chapters[0].title, "第一章"); // 标题留上一章
  assert.equal(out.chapters[0].contentRef.start, 0);
  assert.equal(out.chapters[0].contentRef.end, text.length);
  assert.equal(sliceAll(text, out.chapters), text);
}

// ------------------------------------------------------------- UC-3 首章短章

function testHeadShortChapterMergedIntoNext(): void {
  const long = "正".repeat(300);
  const text = ["# README.md", "", "# 第一章", "", long].join("\n");
  const out = splitDocument({ documentId: "d3", text });
  // 首章「README.md」只剩标题行 → 并入「第一章」；注意「README.md」与「第一章」之间
  // 只隔标题行，首章剔除标题行后正文为 0 → 合并后仅剩 1 章。
  assert.equal(out.chapters.length, 1);
  assert.equal(out.chapters[0].title, "第一章");
  assert.equal(out.chapters[0].contentRef.start, 0);
  assert.equal(sliceAll(text, out.chapters), text);
}

// ------------------------------------------------------------- UC-4 阈值边界

function testThresholdBoundary(): void {
  const body200 = "正".repeat(200);
  const text200 = `# 甲\n\n${body200}\n\n# 乙\n\n${"乙".repeat(300)}`;
  const out200 = splitDocument({ documentId: "d4a", text: text200 });
  // 恰为 200 → 不算短章（< 严格判断），保留两章。
  assert.equal(out200.chapters.length, 2);

  const body199 = "正".repeat(199);
  const text199 = `# 甲\n\n${body199}\n\n# 乙\n\n${"乙".repeat(300)}`;
  const out199 = splitDocument({ documentId: "d4b", text: text199 });
  // 199 < 200 → 「甲」并入「乙」。
  assert.equal(out199.chapters.length, 1);
  assert.equal(out199.chapters[0].title, "乙");
}

// ------------------------------------------------------------- UC-5 防吞保护

function testAntiSwallowGuard(): void {
  // 两个短章 + 一个超长章前置于后：总正文 > 10,000 → 合并到剩 2 章即止。
  const long = "长".repeat(10_200);
  const text = ["# 短甲", "", "五十", "", "# 短乙", "", "六十", "", "# 超长", "", long].join("\n");
  const out = splitDocument({ documentId: "d5", text });
  // 短甲并入短乙（首章 → 下一章），短乙仍短；此时剩 2 章且 totalBody > 10,000 → 停止。
  assert.equal(out.chapters.length, 2);
  assert.equal(out.chapters[0].title, "短乙");
  assert.equal(out.chapters[1].title, "超长");
  assert.equal(sliceAll(text, out.chapters), text);
}

// ------------------------------------------------------------- UC-6 小文档收敛

function testSmallDocCollapsesToOne(): void {
  const text = ["# 甲", "", "内容很短。", "", "# 乙", "", "也很短。", "", "# 丙", "", "同样短。"].join(
    "\n",
  );
  const out = splitDocument({ documentId: "d6", text });
  // 总正文 ≤ 10,000 → 允许自然收敛为 1 章。
  assert.equal(out.chapters.length, 1);
  assert.equal(out.chapters[0].contentRef.start, 0);
  assert.equal(out.chapters[0].contentRef.end, text.length);
  assert.equal(sliceAll(text, out.chapters), text);
}

// ------------------------------------------------------------- UC-7 关闭开关

function testDisabledMerge(): void {
  const text = ["# 甲", "", "很短。", "", "# 乙", "", "也短。"].join("\n");
  const out = splitDocument({ documentId: "d7", text }, { minBodyCharsPerChapter: 0 });
  // 关闭兜底 → 短章保留（与旧版行为一致）。
  assert.equal(out.chapters.length, 2);
  assert.deepEqual(out.chapters.map((c) => c.title), ["甲", "乙"]);
}

// ------------------------------------------------------------- UC-8 段落聚类不受影响

function testParagraphPathUnaffected(): void {
  const paras = Array.from({ length: 6 }, (_, i) => `第 ${i} 段。${"内容".repeat(60)}`).join("\n\n");
  const out = splitDocument({ documentId: "d8", text: paras });
  assert.equal(out.strategy, "paragraphs");
  // 段落聚类按 1600 字符目标聚合：每段 ~130 字 × 6 段 ≈ 780 字，不足一章体量 → 单章。
  assert.equal(out.chapters.length, 1);
  assert.equal(sliceAll(paras, out.chapters), paras);
}

// ------------------------------------------------------------- 执行

const tests: [string, () => void][] = [
  ["UC-1 空壳边界章并入下一章", testShellBoundaryChapter],
  ["UC-2 尾部短章并入上一章", testTailShortChapterMergedIntoPrevious],
  ["UC-3 首章短章并入下一章", testHeadShortChapterMergedIntoNext],
  ["UC-4 阈值边界（200 不并 / 199 并）", testThresholdBoundary],
  ["UC-5 防吞保护（>10,000 保留 2 章）", testAntiSwallowGuard],
  ["UC-6 小文档收敛为 1 章", testSmallDocCollapsesToOne],
  ["UC-7 minBodyCharsPerChapter=0 关闭兜底", testDisabledMerge],
  ["UC-8 段落聚类不受影响", testParagraphPathUnaffected],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ❌ ${name}`);
    console.error(err);
  }
}
if (failed > 0) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log(`\n全部 ${tests.length} 项通过`);
