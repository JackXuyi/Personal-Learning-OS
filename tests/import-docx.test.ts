/**
 * DOCX 导入单测（F8 范围 3）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:docx
 *
 * **两层结构**（刻意如此，见 docs/library-import-docx-design-2026-09.md §11.2）：
 * 1. **AST 字面量层**：`docx-markdown.ts` 的用例直接喂普通对象，**不构造 DOCX 字节、
 *    不 import mammoth** —— 四层标题判定 / 表格 / 列表 / 图片跳过都在这儿测，快且稳；
 * 2. **真字节层**：`mammoth-reader.ts` + `docx.ts` 的用例用本文件内的**最小 ZIP 写入器**
 *    （`store` 方式 + 自算 CRC32）造出真 `.docx` 字节 —— 覆盖 AST 契约形状与错误路径。
 *
 * ⚠️ 契约守卫（TC-DOCX-17）：mammoth 的 AST 字段**未文档化**
 *    （`transformDocument` 在 d.ts 里只有 `(element: any) => any`），
 *    本文件的真字节用例把实测形状焊死；mammoth 升级破坏契约时**立刻变红**。
 */
import assert from "node:assert/strict";
import { docxNodesToMarkdown } from "../src/features/learn/import/docx-markdown.ts";
import type { MammothNode } from "../src/features/learn/import/docx-markdown.ts";
import {
  extractDocxMarkdown,
  DocxBadArchiveError,
  DocxLegacyError,
  DocxNoTextError,
  DocxTooLargeError,
} from "../src/features/learn/import/docx.ts";
import { readDocumentNodes } from "../src/features/learn/import/mammoth-reader.ts";
import { classifyLocalFile, stripExtension, LIMITS } from "../src/features/learn/import/types.ts";
import { fileToUnit } from "../src/features/learn/import/local-files.ts";
import { runUnitImport } from "../src/features/learn/import/pipeline.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";

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

/* ---------------- AST 字面量构造器（形状照 §3.3d 实测） ---------------- */

const t = (value: string): MammothNode => ({ type: "text", value });
const run = (value: string, size?: number, bold = false): MammothNode => ({
  type: "run",
  fontSize: size ?? null,
  isBold: bold,
  children: [t(value)],
});
const para = (children: MammothNode[], extra: Partial<MammothNode> = {}): MammothNode => ({
  type: "paragraph",
  children,
  ...extra,
});
/** 一个普通段落：单个 run，指定字号。 */
const body = (value: string, size = 12): MammothNode => para([run(value, size)]);
const table = (rows: string[][]): MammothNode => ({
  type: "table",
  children: rows.map((cells) => ({
    type: "tableRow",
    children: cells.map((cell) => ({ type: "tableCell", children: [body(cell)] })),
  })),
});
const img = (): MammothNode => ({ type: "image", contentType: "image/png" });

/* ---------------- 最小 ZIP 写入器（只为造真 .docx 字节） ---------------- */

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    crcTable = table;
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** `store`（不压缩）方式打包 —— 免掉 deflate 实现，mammoth 侧走 jszip 全兼容。 */
function zipStore(entries: readonly { name: string; text: string }[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = encoder.encode(entry.text);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(8, 0, true); // method = store
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(10, 0, true); // method = store
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);

    chunks.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + 22);
  let p = 0;
  for (const chunk of [...chunks, ...centrals, eocd]) {
    out.set(chunk, p);
    p += chunk.length;
  }
  return out.buffer;
}

/** 造一份最小合法 DOCX：只放 `word/document.xml`（mammoth 对缺失部件有 fallback）。 */
function docxBytes(bodyXml: string): ArrayBuffer {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${bodyXml}</w:body></w:document>`;
  return zipStore([{ name: "word/document.xml", text: xml }]);
}

/** 一个段落 XML：`runs` 形如 `[字号, 文本, 粗体?]`（字号 = 半磅，`w:sz`）。 */
function pXml(runs: readonly [number, string, boolean?][], numId?: number): string {
  const rPrText = runs
    .map(([sz, text, bold]) => {
      const rPr = `<w:rPr><w:sz w:val="${sz}"/>${bold ? "<w:b/>" : ""}</w:rPr>`;
      return `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
    })
    .join("");
  const numPr =
    numId === undefined ? "" : `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>`;
  return `<w:p>${numPr}${rPrText}</w:p>`;
}

const BODY_TEXT = "本节持续展开，逐层深入地讲解核心概念与推导细节。".repeat(4);

/**
 * 每节 3 个正文段。
 * ⚠️ 刻意写长（每段 ≈240 字）：切分器的 `mergeShortChapters`（200 字）会把过短章节并掉，
 * 夹具若太短，`chapterIds.length >= 2` 这条断言测的就不是「标题识别」而是「合并规则」。
 */
const SECTION_BODY = [
  "本节持续展开，逐层深入地讲解核心概念与推导细节，并给出可核对的判据。".repeat(8),
  "规范物料取样活动，确保样品的代表性，并说明取样量与取样工具的具体要求。".repeat(8),
  "适用范围覆盖本公司所有进厂物料的取样活动、记录与复核流程。".repeat(8),
];

const runTests = async () => {
  /* ================= 第一层：AST 字面量 ================= */

  await check("TC-DOCX-01 字号显著大于基准 → 按档位定级（24 → #，18 → ##，12 不成标题）", () => {
    const r = docxNodesToMarkdown([
      para([run("物料取样管理规程", 24, true)]),
      para([run("1 目的", 18, true)]),
      body("规范物料取样活动，确保样品的代表性。"),
      body(BODY_TEXT),
    ]);
    assert.equal(r.headings, 2);
    assert.equal(r.headingVia.size, 2);
    assert.ok(r.text.startsWith("# 物料取样管理规程"));
    assert.ok(r.text.includes("\n## 1 目的"));
    assert.ok(!r.text.includes("# 规范物料取样活动"));
  });

  await check("TC-DOCX-02 命名样式 Heading1 / 标题2 / 数字 styleId 2", () => {
    const r = docxNodesToMarkdown([
      para([t("甲")], { styleId: "Heading1" }),
      para([t("乙")], { styleName: "标题2" }),
      para([t("丙")], { styleId: "2" }),
    ]);
    assert.deepEqual(
      r.text.split("\n"),
      ["# 甲", "## 乙", "## 丙"],
    );
    assert.equal(r.headingVia.style, 2);
    assert.equal(r.headingVia.styleNum, 1);
  });

  await check("TC-DOCX-03 无字号分层时，编号形态兜底为 ##（与 PDF 同判据）", () => {
    const r = docxNodesToMarkdown([body("正文若干"), body("2.1 例外情形"), body("第 3 章 变更控制"), body("10 件")]);
    assert.equal(r.headingVia.pattern, 2, "「2.1 …」「第 3 章 …」应命中，而「10 件」不命中");
    assert.ok(r.text.includes("## 2.1 例外情形"));
    assert.ok(r.text.includes("## 第 3 章 变更控制"));
    assert.ok(!r.text.includes("## 10 件"));
  });

  await check("TC-DOCX-04 长行 / 句末标点的「大字号段」不判为标题", () => {
    const long =
      "这是一段明显超过四十个字符的说明文字，用来验证长度护栏不会被字号层绕过，也不该被误判为标题。";
    const r = docxNodesToMarkdown([
      body(BODY_TEXT),
      body("以句号结尾的短句。", 20),
      body(long, 20),
    ]);
    assert.ok(long.length > 40, "夹具本身必须 >40 字，否则这条用例什么都没测");
    assert.equal(r.headings, 0);
  });

  await check("TC-DOCX-A4 正文基准按**字符**加权（不是段落数加权）", () => {
    // 5 个短标题段（14pt）+ 1 个长正文段（12pt）：
    //   字符加权 → 基准 12 ⇒ 14pt 成标题（识别 5 个）；
    //   段落数加权 → 基准 14 ⇒ 14pt 不算显著 ⇒ 一个标题都没有。
    const r = docxNodesToMarkdown([
      ...["甲", "乙", "丙", "丁", "戊"].map((s) => body(s, 14)),
      body("本节持续展开，逐层深入地讲解核心概念与推导细节。".repeat(4), 12),
    ]);
    assert.equal(r.headings, 5);
    assert.equal(r.headingVia.size, 5);
  });

  await check("TC-DOCX-06/07/08 表格：多行产 GFM、单行不造假表头、| 转义", () => {
    const multi = docxNodesToMarkdown([table([["物料类别", "取样量"], ["原料", "3×检验量"], ["包材", "10 件"]])]);
    assert.equal(multi.tables, 1);
    assert.equal(multi.headings, 0);
    assert.ok(multi.text.includes("| 物料类别 | 取样量 |"));
    assert.ok(multi.text.includes("| --- | --- |"));
    // 单元格文本只出现一次（不得同时作为正文段再输出一遍）
    assert.equal(multi.text.split("原料").length - 1, 1);

    const single = docxNodesToMarkdown([table([["只有一行", "两列"]])]);
    assert.equal(single.tables, 0, "单行表不计入 tables");
    assert.ok(!single.text.includes("---"), "单行表不得产出分隔行");

    const escaped = docxNodesToMarkdown([table([["a|b", "c"], ["d", "e"]])]);
    assert.ok(escaped.text.includes("a\\|b"), "单元格内的 | 必须转义");
  });

  await check("TC-DOCX-09 列表：numbering.isOrdered → 有序 / 无序 + level 缩进", () => {
    const ordered = docxNodesToMarkdown([para([run("取样工具应清洁", 12)], { numbering: { isOrdered: true, level: "0" } })]);
    assert.equal(ordered.text, "1. 取样工具应清洁");
    const bullet = docxNodesToMarkdown([para([run("取样量不少于三倍检验量", 12)], { numbering: { isOrdered: false, level: "0" } })]);
    assert.equal(bullet.text, "- 取样量不少于三倍检验量");
    // 首行缩进会被整串 trim 吃掉（设计如此），故前面垫一段正文再断言。
    const nested = docxNodesToMarkdown([
      body("取样要求如下："),
      para([run("子项", 12)], { numbering: { isOrdered: false, level: "1" } }),
      para([run("更深子项", 12)], { numbering: { isOrdered: false, level: "2" } }),
    ]);
    assert.ok(nested.text.includes("\n  - 子项"));
    assert.ok(nested.text.includes("\n    - 更深子项"));
  });

  await check("TC-DOCX-10 图片节点被跳过：不计文本、计 skippedImages、正文零 base64", () => {
    const r = docxNodesToMarkdown([
      para([run("前", 12), img(), run("后", 12)]),
      para([img()]),
    ]);
    assert.equal(r.skippedImages, 2);
    assert.equal(r.text, "前后");
    assert.ok(!r.text.includes("base64"));
    assert.ok(!r.text.includes("data:image"));
  });

  await check("TC-DOCX-15 多 run 拼一句话不插入额外空格", () => {
    const r = docxNodesToMarkdown([para([run("取样", 12), run("量不少于", 12), run("三倍检验量", 12)])]);
    assert.equal(r.text, "取样量不少于三倍检验量");
  });

  await check("TC-DOCX-16 空段归并：连续空行压成一个段落分隔", () => {
    const r = docxNodesToMarkdown([body("甲段"), para([]), para([]), para([]), body("乙段")]);
    assert.equal(r.text, "甲段\n\n乙段");
  });

  await check("TC-DOCX-A1 行内 tab / break 渲染为空格（相邻文本不粘连）", () => {
    const r = docxNodesToMarkdown([
      para([run("甲", 12), { type: "break" }, run("乙", 12), { type: "tab" }, run("丙", 12)]),
    ]);
    assert.equal(r.text, "甲 乙 丙");
  });

  await check("TC-DOCX-A2 表格内段落不参与正文基准（全表格文档不产生假标题）", () => {
    const rows = Array.from({ length: 4 }, (_, i) => [`参数${i}`, "值"]);
    const r = docxNodesToMarkdown([table(rows), body("极短正文")]);
    assert.equal(r.headings, 0);
    assert.equal(r.tables, 1);
  });

  /* ================= 第二层：真 DOCX 字节 ================= */

  const realDocx = docxBytes(
    pXml([[48, "物料取样管理规程", true]]) +
      pXml([[36, "1 目的", true]]) +
      SECTION_BODY.map((s) => pXml([[24, s]])).join("") +
      pXml([[36, "2 适用范围", true]]) +
      SECTION_BODY.map((s) => pXml([[24, s]])).join(""),
  );

  await check("TC-DOCX-17 AST 契约形状（fontSize 为磅 / isBold 布尔 / value 字符串 / table 块）", async () => {
    const nodes = await readDocumentNodes(realDocx);
    const paras = nodes.filter((n) => n.type === "paragraph");
    assert.ok(paras.length >= 6, `块级应含多个 paragraph，实际 ${nodes.map((n) => n.type).join(",")}`);
    const first = paras[0]?.children?.[0];
    assert.equal(typeof first?.fontSize, "number", "run.fontSize 必须是数字（单位：磅）");
    assert.equal(first?.fontSize, 24, "w:sz=48（半磅）→ 24 磅");
    assert.equal(typeof first?.isBold, "boolean");
    assert.equal(typeof first?.children?.[0]?.value, "string");

    // 表格块同形状存在
    const withTable = await readDocumentNodes(
      docxBytes(
        `<w:tbl><w:tr><w:tc>${pXml([[24, "甲"]])}</w:tc><w:tc>${pXml([[24, "乙"]])}</w:tc></w:tr>` +
          `<w:tr><w:tc>${pXml([[24, "丙"]])}</w:tc><w:tc>${pXml([[24, "丁"]])}</w:tc></w:tr></w:tbl>`,
      ),
    );
    assert.ok(withTable.some((n) => n.type === "table"), "tbl 必须产 table 块");
  });

  await check("TC-DOCX-11 OLE 魔数（老 .doc / 加密）→ DocxLegacyError", async () => {
    const ole = new Uint8Array(64);
    ole.set([0xd0, 0xcf, 0x11, 0xe0]);
    await assert.rejects(() => extractDocxMarkdown(ole.buffer), (e: unknown) => e instanceof DocxLegacyError);
  });

  await check("TC-DOCX-12 随机字节（非 ZIP）→ DocxBadArchiveError", async () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).buffer;
    await assert.rejects(() => extractDocxMarkdown(junk), (e: unknown) => e instanceof DocxBadArchiveError);
  });

  await check("TC-DOCX-13 合法 ZIP 但缺 word/document.xml → DocxBadArchiveError", async () => {
    const zip = zipStore([{ name: "hello.txt", text: "not a docx" }]);
    await assert.rejects(() => extractDocxMarkdown(zip), (e: unknown) => e instanceof DocxBadArchiveError);
  });

  await check("TC-EDGE-03 有 document.xml 但无文本 → DocxNoTextError", async () => {
    const zip = docxBytes(pXml([[24, ""]]));
    await assert.rejects(() => extractDocxMarkdown(zip), (e: unknown) => e instanceof DocxNoTextError);
  });

  await check("TC-EDGE-04 正文超 docxMaxChars → DocxTooLargeError（护栏在抽取器内）", async () => {
    const big = "字".repeat(LIMITS.docxMaxChars + 1);
    const zip = docxBytes(pXml([[24, big]]));
    await assert.rejects(() => extractDocxMarkdown(zip), (e: unknown) => e instanceof DocxTooLargeError);
  });

  await check("TC-DOCX-14 结构化 DOCX → extract 结果 → 管道切章（runUnitImport）", async () => {
    const out = await extractDocxMarkdown(realDocx);
    assert.equal(out.headings, 3, "24pt 标题 + 两个 18pt 小节");
    assert.equal(out.headingVia.size, 3);
    const s = new InMemoryStorage();
    const r = await runUnitImport(
      {
        title: "物料取样管理规程",
        format: "markdown",
        splitFormat: out.headings > 0 ? "markdown" : "txt",
        text: out.text,
        source: "本地文件 · 物料取样管理规程.docx",
      },
      { storage: s },
    );
    assert.ok(r.chapterIds.length >= 2, `应切出多章，实际 ${r.chapterIds.length}`);
    assert.equal((await s.listDocuments()).length, 1);
    const doc = (await s.listDocuments())[0];
    assert.ok(doc?.textPreview.includes("## 1 目的"), "入库正文应保留标题结构");
  });

  await check("TC-DOCX-05 无标题证据 → splitFormat 降级 txt（fileToUnit 端到端）", async () => {
    const plain = docxBytes(pXml([[24, BODY_TEXT]]) + pXml([[24, "另一段同样字号的正文。"]]));
    const file = new File([plain], "无结构.docx");
    const unit = await fileToUnit(file);
    assert.ok(!("error" in unit), `不应失败：${JSON.stringify(unit)}`);
    if ("error" in unit) return;
    assert.equal(unit.format, "markdown");
    assert.equal(unit.splitFormat, "txt", "headings=0 ⇒ 段落聚类");
    assert.equal(unit.extract?.headings, 0);
    assert.ok(unit.text.includes(BODY_TEXT), "正文零丢失");
  });

  await check("TC-DOCX-A3 fileToUnit：DOCX 成功 / 伪装成 .docx 的 OLE 报 docx-legacy", async () => {
    const ok = await fileToUnit(new File([realDocx], "规程.docx"));
    assert.ok(!("error" in ok));
    if (!("error" in ok)) {
      assert.equal(ok.title, "规程");
      assert.equal(ok.splitFormat, "markdown");
      assert.equal(ok.extract?.headings, 3);
    }

    const ole = new Uint8Array(64);
    ole.set([0xd0, 0xcf, 0x11, 0xe0]);
    const bad = await fileToUnit(new File([ole.buffer], "老文档.docx"));
    assert.ok("error" in bad);
    if ("error" in bad) assert.equal(bad.error, "docx-legacy");

    const broken = await fileToUnit(new File([new Uint8Array([1, 2, 3, 4]).buffer], "坏文档.docx"));
    assert.ok("error" in broken);
    if ("error" in broken) assert.equal(broken.error, "docx-bad-zip");
  });

  /* ================= 回归：分类与扩展名 ================= */

  await check("TC-EDGE-01/02 classifyLocalFile 与 stripExtension 认 .docx", () => {
    assert.deepEqual(classifyLocalFile({ name: "a.docx", size: 100 }), { kind: "docx", overLimit: false });
    assert.deepEqual(classifyLocalFile({ name: "B.DOCX", size: 100 }), { kind: "docx", overLimit: false });
    assert.equal(classifyLocalFile({ name: "a.docx", size: LIMITS.localDocxBytes + 1 }).overLimit, true);
    assert.equal(classifyLocalFile({ name: "a.docx", size: LIMITS.localDocxBytes }).overLimit, false);
    // .doc / .docm / .dotx 明确不支持（OLE 二进制 / 宏 / 模板）
    assert.deepEqual(classifyLocalFile({ name: "a.doc", size: 100 }), { error: "unsupported" });
    assert.deepEqual(classifyLocalFile({ name: "a.docm", size: 100 }), { error: "unsupported" });
    assert.deepEqual(classifyLocalFile({ name: "a.dotx", size: 100 }), { error: "unsupported" });
    assert.equal(stripExtension("物料取样管理规程.docx"), "物料取样管理规程");
  });

  console.log(results.join("\n"));
  console.log(`\nimport-docx: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
};

void runTests();
