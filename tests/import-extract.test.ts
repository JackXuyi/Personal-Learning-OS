/**
 * 导入「提取层」单测：编码嗅探（G4）+ PDF 版式后处理（G5）+ 错误文案映射（G2）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:extract
 *
 * 纯逻辑直跑：**不加载 pdfjs**（版式函数只吃坐标字段，与 pdf.js 解耦），
 * 不触网络、不触 DOM —— 因此这些规则可以在 CI 里被逐条断言。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeBytes } from "../src/features/learn/import/decode.ts";
import {
  joinPageLines,
  promotePdfHeadings,
  reflowPageItems,
  stripRunningHeads,
} from "../src/features/learn/import/pdf-layout.ts";
import type { PdfTextItem } from "../src/features/learn/import/pdf-layout.ts";
import { githubErrorText, localErrorText } from "../src/features/learn/import/error-text.ts";
import { GithubImportError } from "../src/features/learn/import/github.ts";

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

/** 造一个带坐标的 text item：x = transform[4]，y = transform[5]（PDF 用户空间，y 向上）。 */
function it(str: string, x: number, y: number, width = 10, height = 10): PdfTextItem {
  return { str, transform: [height, 0, 0, height, x, y], width, height };
}

/** 字节数组 → ArrayBuffer（精确长度）。 */
function buf(bytes: readonly number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}

/** UTF-8 字节。 */
function utf8(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

const run = async () => {
  /* ---------------- G4 编码嗅探 ---------------- */

  await check("decode：纯 UTF-8 / UTF-8 BOM 正确解码", () => {
    const plain = decodeBytes(buf(utf8("# 标题\n正文")));
    assert.equal(plain.encoding, "utf-8");
    assert.equal(plain.text, "# 标题\n正文");

    const bom = decodeBytes(buf([0xef, 0xbb, 0xbf, ...utf8("带 BOM")]));
    assert.equal(bom.encoding, "utf-8");
    assert.equal(bom.text, "带 BOM", "BOM 必须剥离，不得混入正文");
  });

  await check("decode：UTF-16LE BOM 正确解码", () => {
    // "中文" 的 UTF-16LE 码元：4E2D → 2D 4E；6587 → 87 65
    const out = decodeBytes(buf([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]));
    assert.equal(out.encoding, "utf-16le");
    assert.equal(out.text, "中文");
  });

  await check("decode：非 UTF-8 的中文（GBK）走 GB18030 兜底而非乱码", () => {
    // "中文" 的 GBK 编码：D6D0 CEC4（这两个字节都不是合法 UTF-8 序列）
    const out = decodeBytes(buf([0xd6, 0xd0, 0xce, 0xc4]));
    assert.equal(out.encoding, "gb18030");
    assert.equal(out.text, "中文", "GBK 中文必须还原，不得变成 U+FFFD 乱码");
  });

  /* ---------------- G5 版式后处理 ---------------- */

  await check("reflow：按 y 聚类成行 + 行内按间距补空格", () => {
    const lines = reflowPageItems([
      it("world", 50, 100, 30),
      it("Hello", 0, 100, 30),
      it("line", 45, 80, 20),
      it("Second", 0, 80, 40),
    ]);
    assert.deepEqual(lines, ["Hello world", "Second line"]);
  });

  await check("reflow：间距过小不补空格（CJK 连排不被切碎）", () => {
    const lines = reflowPageItems([it("abc", 0, 50, 30), it("def", 30.5, 50, 30)]);
    assert.deepEqual(lines, ["abcdef"]);
  });

  await check("reflow：缺少坐标时退化为 hasEOL 顺序拼接（不丢内容）", () => {
    const lines = reflowPageItems([{ str: "A" }, { str: "B", hasEOL: true }, { str: "C" }]);
    assert.deepEqual(lines, ["AB", "C"]);
  });

  await check("reflow：双栏页按「通栏 → 左栏 → 右栏」重排阅读顺序", () => {
    const items = [
      it("TITLE", 200, 200, 200), // 200..400 跨越中线 300 → 通栏
      it("L1", 50, 100, 200), // 50..250 → 左栏
      it("R1", 350, 100, 200), // 350..550 → 右栏
      it("L2", 50, 80, 200),
      it("R2", 350, 80, 200),
    ];
    const lines = reflowPageItems(items, { pageWidth: 600 });
    assert.deepEqual(lines, ["TITLE", "", "L1", "L2", "", "R1", "R2"]);

    // 不提供页宽 → 不拆栏，退回 y 序（行内左右栏被空格拼在一行）
    const single = reflowPageItems(items);
    assert.deepEqual(single, ["TITLE", "L1 R1", "L2 R2"]);
  });

  await check("stripRunningHeads：跨页重复的页眉与页码行被去除", () => {
    const pages = [
      ["Running Head", "page one body", "1"],
      ["Running Head", "page two body", "2"],
      ["Running Head", "page three body", "3"],
      ["Running Head", "page four body", "4"],
    ];
    const cleaned = stripRunningHeads(pages);
    assert.deepEqual(cleaned, [
      ["page one body"],
      ["page two body"],
      ["page three body"],
      ["page four body"],
    ]);
  });

  await check("stripRunningHeads：页数 <3 时不做去噪（证据不足）", () => {
    const pages = [
      ["Head", "body A"],
      ["Head", "body B"],
    ];
    assert.deepEqual(stripRunningHeads(pages), pages);
  });

  await check("joinPageLines：行尾连字符 / 中文折行修复，句末与栏断保留", () => {
    assert.equal(joinPageLines(["embed-", "ding is fun"]), "embedding is fun");
    assert.equal(joinPageLines(["这是第一行", "继续第二行"]), "这是第一行继续第二行");
    assert.equal(joinPageLines(["这是第一行。", "第二段开始"]), "这是第一行。\n第二段开始");
    assert.equal(joinPageLines(["Left text", "", "Right text"]), "Left text\n\nRight text");
  });

  await check("promotePdfHeadings：疑似标题行提升为 ## ，普通行不动", () => {
    const src = [
      "第 1 章 神经网络",
      "本章介绍神经元与激活函数，内容较长因此不应被当作标题行处理。",
      "1.2 反向传播",
      "Chapter 3 Training",
      "以句号结尾的短句。",
      "# 已经是标题",
    ].join("\n");
    const out = promotePdfHeadings(src);
    assert.equal(out.promoted, 3);
    assert.ok(out.text.startsWith("## 第 1 章 神经网络"));
    assert.ok(out.text.includes("\n## 1.2 反向传播"));
    assert.ok(out.text.includes("\n## Chapter 3 Training"));
    assert.ok(out.text.includes("\n以句号结尾的短句。"), "句末标点的行不得提升");
    assert.ok(out.text.includes("\n# 已经是标题"), "已有标题不重复提升");
  });

  /* ---------------- G2 错误文案映射 ---------------- */

  await check("error-text：按 kind 取文案，不再暴露错误对象的 message", () => {
    const ghLabels = {
      invalid: "GH-invalid",
      unavailable: "GH-unavailable",
      network: "GH-network",
      "rate-limit": "GH-rate-limit",
      "too-many-files": "GH-too-many",
      "merged-too-large": "GH-too-large",
      "fetch-failed": "GH-fetch-failed",
      empty: "GH-empty",
    };
    assert.equal(githubErrorText(new GithubImportError("rate-limit"), ghLabels), "GH-rate-limit");
    assert.equal(githubErrorText(new GithubImportError("invalid", "not-markdown"), ghLabels), "GH-invalid");
    // 非 GithubImportError → message 兜底（不崩、不吞错）
    assert.equal(githubErrorText(new Error("boom"), ghLabels), "boom");

    const localLabels = {
      unsupported: "L-unsupported",
      "too-large": "L-too-large",
      "pdf-no-text": "L-no-text",
      "pdf-too-large": "L-pdf-too-large",
      "read-failed": "L-read-failed",
    };
    assert.equal(localErrorText({ error: "pdf-no-text" }, localLabels), "L-no-text");
    assert.equal(
      localErrorText({ error: "unsupported", detail: "a.docx" }, localLabels),
      "L-unsupported",
    );
  });

  await check("导入层不再产出面向用户的中文错误文案（G2 静态断言）", () => {
    // 直接扫源码：错误构造的第二参只允许语言中立 detail。
    const rel = (p: string) => new URL(`../${p}`, import.meta.url);
    const HAN = /[\u4e00-\u9fff]/;
    for (const file of [
      "src/features/learn/import/github.ts",
      "src/features/learn/import/local-files.ts",
      "src/features/learn/import/pdf.ts",
    ]) {
      const src: string = readFileSync(rel(file), "utf8");
      for (const [i, raw] of src.split("\n").entries()) {
        const line = raw.trim();
        if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) continue;
        const code = raw.replace(/\s*\/\/.*$/, "");
        for (const lit of code.match(/"[^"]*"|`[^`]*`|'[^']*'/g) ?? []) {
          if (HAN.test(lit)) {
            // 唯一豁免：source 数据标签（写入 SourceDocument.source，非错误文案）
            assert.ok(
              lit.includes("本地文件"),
              `${file}:${i + 1} 出现中文错误文案字面量 ${lit}`,
            );
          }
        }
      }
    }
  });

  console.log(results.join("\n"));
  console.log(`\nimport-extract: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
};

void run();
