/**
 * EPUB 导入单测（F8 范围 4）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:epub
 *
 * **fixture 一律现场构造**（`jszip` 已是直接依赖）：仓库里不存二进制 .epub，
 * 每个用例的「这本书长什么样」在代码里一眼可见，改一个字段就能造出边界形态。
 *
 * ⚠️ 与 `import-docx.test.ts` 的差异（刻意）：DOCX 那边自写了最小 ZIP 写入器，
 *    因为当时 `jszip` 只是 `mammoth` 的传递依赖、不该被测试直接引用；
 *    EPUB 这边把 `jszip` 提为直接依赖后，直接用它是**正确**做法（少 100 行 CRC32 手工实现）。
 *
 * ⚠️ 测试**不 import 任何 `.tsx`**（`--experimental-strip-types` 不支持 JSX）。
 *
 * 设计依据：docs/epub-import-design-2026-10.md §8。
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { parseHTML } from "linkedom";
import {
  entryPath,
  hasZipMagic,
  openEpub,
  EpubBadArchiveError,
  EpubDrmError,
} from "../src/features/learn/import/epub-archive.ts";
import {
  extractEpubMarkdown,
  EpubNoTextError,
  EpubTooLargeError,
} from "../src/features/learn/import/epub.ts";
import type { EpubLimits } from "../src/features/learn/import/epub.ts";
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

/**
 * 单测用解析器（生产走 `browserHtmlParser`，node 下没有 `DOMParser` 全局）。
 * ⚠️ `linkedom` 的 `parseHTML` 返回 `{ document, window, ... }`，**不是** `Document` ——
 *    必须取 `.document` 才与 `HtmlParser` 的返回类型同形（踩过一次：直接 cast 整个对象
 *    会让 `dom.body` 恒为 `undefined`，所有用例都报 `no-text`）。
 */
const parseHtml = (html: string) => parseHTML(html).document as unknown as Document;

/** 断言某段异步逻辑抛出指定错误 class（并按需校验其实例语义）。 */
async function expectThrow<T extends Error>(
  cls: new (...args: never[]) => T,
  fn: () => Promise<unknown>,
  label: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof cls, `${label}：期望 ${cls.name}，实得 ${String(err)}`);
    return;
  }
  assert.fail(`${label}：期望抛 ${cls.name}，但成功返回了`);
}

/* ---------------- EPUB fixture 构造器 ---------------- */

interface ChapterSpec {
  /** manifest 里的 href（相对 OPF 目录）。 */
  href: string;
  /** `<body>` 内容。 */
  body: string;
  /** `<title>` 内容；`undefined` ⇒ 不写 title 标签。 */
  docTitle?: string;
  /** media-type 覆盖（用于「非 xhtml 条目被跳过」）。 */
  mediaType?: string;
  /** 归档内**实际**路径覆盖（默认与 href 同目录）；用于 `../` 归一与大小写回退。 */
  filePath?: string;
  /** 直接给字节（用于非 UTF-8 编码用例）；给了就忽略 `body` / `docTitle`。 */
  rawBytes?: Uint8Array;
  /** 章节 XHTML 的 encoding 声明（默认 utf-8）。 */
  encoding?: string;
}

interface EpubSpec {
  chapters: ChapterSpec[];
  /** `dc:title`；不传则不写。 */
  title?: string;
  /** `META-INF/encryption.xml` 里的条目。 */
  encrypted?: { algorithm: string; uri: string }[];
  /** 不写 `META-INF/container.xml`。 */
  omitContainer?: boolean;
  /** container 指向一个不存在的 OPF。 */
  bogusOpf?: boolean;
  /** OPF 路径（默认 `OEBPS/content.opf`）。 */
  opfPath?: string;
  /** spine 里追加一个 manifest 不存在的 idref。 */
  bogusSpineRef?: string;
  /** 不写 mimetype（很多 epub 不 STORED 它 —— 本实现刻意不硬校验）。 */
  omitMimetype?: boolean;
}

/** 造一个 epub 的字节流（全部现场生成，不落盘）。 */
async function makeEpub(spec: EpubSpec): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const opfPath = spec.opfPath ?? "OEBPS/content.opf";
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";

  if (!spec.omitMimetype) {
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  }

  if (!spec.omitContainer) {
    const target = spec.bogusOpf ? `${dir || "OEBPS"}/missing.opf` : opfPath;
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${target}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    );
  }

  const items = spec.chapters
    .map(
      (c, i) =>
        `<item id="c${i}" href="${c.href}" media-type="${c.mediaType ?? "application/xhtml+xml"}"/>`,
    )
    .join("");
  const refs =
    spec.chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("") +
    (spec.bogusSpineRef ? `<itemref idref="${spec.bogusSpineRef}"/>` : "");

  zip.file(
    opfPath,
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${spec.title ? `<dc:title>${spec.title}</dc:title>` : ""}
    <dc:identifier id="id">urn:uuid:test</dc:identifier>
  </metadata>
  <manifest>${items}</manifest>
  <spine>${refs}</spine>
</package>`,
  );

  for (const c of spec.chapters) {
    const target = c.filePath ?? (dir ? `${dir}/${c.href}` : c.href);
    if (c.rawBytes) {
      zip.file(target, c.rawBytes);
      continue;
    }
    const encoding = c.encoding ?? "utf-8";
    const titleTag = c.docTitle !== undefined ? `<title>${c.docTitle}</title>` : "";
    zip.file(
      target,
      `<?xml version="1.0" encoding="${encoding}"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head>${titleTag}</head>
<body>${c.body}</body></html>`,
    );
  }

  if (spec.encrypted?.length) {
    const blocks = spec.encrypted
      .map(
        (e) => `<EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
  <EncryptionMethod Algorithm="${e.algorithm}"/>
  <CipherData><CipherReference URI="${e.uri}"/></CipherData>
</EncryptedData>`,
      )
      .join("");
    zip.file(
      "META-INF/encryption.xml",
      `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">${blocks}</encryption>`,
    );
  }

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  // ⚠️ node Buffer 的 `.buffer` 可能来自共享池（byteOffset ≠ 0）⇒ 必须切精确区间。
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** 走编排层（默认护栏，可注入小值验证）。 */
const extract = (buf: ArrayBuffer, limits?: Partial<EpubLimits>) =>
  extractEpubMarkdown(buf, { parseHtml }, limits);

/** 两章的标准书（多数用例的底子）。 */
const basicSpec = (): EpubSpec => ({
  title: "探针之书",
  chapters: [
    {
      href: "ch1.xhtml",
      docTitle: "第一章 起点",
      body: `<h1>第一章 起点</h1><p>第一章正文，用于验证抽取与切分链路是否完整。</p>`,
    },
    {
      href: "ch2.xhtml",
      docTitle: "第二章 终局",
      body: `<h1>第二章 终局</h1><p>第二章正文，同样用于验证。</p>`,
    },
  ],
});

async function main() {
  /* ================= A 归档解析 ================= */

  await check("TC-EPUB-A1 openEpub 解出 container → OPF → manifest / spine / title", async () => {
    const pkg = await openEpub(await makeEpub(basicSpec()));
    assert.equal(pkg.opfPath, "OEBPS/content.opf");
    assert.equal(pkg.opfDir, "OEBPS");
    assert.equal(pkg.title, "探针之书");
    assert.deepEqual(pkg.spine, ["c0", "c1"]);
    assert.equal(pkg.manifest.size, 2);
    const first = pkg.manifest.get("c0");
    assert.ok(first);
    assert.equal(first.href, "ch1.xhtml");
    assert.equal(first.mediaType, "application/xhtml+xml");
    assert.equal(entryPath(pkg, first), "OEBPS/ch1.xhtml");
  });

  await check("TC-EPUB-A2 缺 META-INF/container.xml ⇒ EpubBadArchiveError", async () => {
    const buf = await makeEpub({ ...basicSpec(), omitContainer: true });
    await expectThrow(EpubBadArchiveError, () => openEpub(buf), "omitContainer");
  });

  await check("TC-EPUB-A3 container 指向不存在的 OPF ⇒ EpubBadArchiveError", async () => {
    const buf = await makeEpub({ ...basicSpec(), bogusOpf: true });
    await expectThrow(EpubBadArchiveError, () => openEpub(buf), "bogusOpf");
  });

  await check("TC-EPUB-A4 条目名大小写不一致时回退匹配（OEBPS/Ch1.xhtml vs href=ch1.xhtml）", async () => {
    const buf = await makeEpub({
      chapters: [
        {
          href: "ch1.xhtml",
          filePath: "OEBPS/Ch1.xhtml",
          docTitle: "大小写",
          body: `<h1>大小写</h1><p>归档里的实际文件名大小写与 href 不一致，仍应读到。</p>`,
        },
      ],
    });
    const out = await extract(buf);
    assert.ok(out.text.includes("大小写"), "大小写回退失败 ⇒ 该章被静默跳过");
    assert.equal(out.spineCount, 1);
  });

  await check("TC-EPUB-A5 href 含 ../ 的相对路径被归一（opf 在 OEBPS/，href=../text/ch1.xhtml）", async () => {
    const buf = await makeEpub({
      chapters: [
        {
          href: "../text/ch1.xhtml",
          filePath: "text/ch1.xhtml",
          docTitle: "上一层",
          body: `<h1>上一层</h1><p>路径里含 ../ 时也必须能找到条目。</p>`,
        },
      ],
    });
    const pkg = await openEpub(buf);
    const item = pkg.manifest.get("c0");
    assert.ok(item);
    assert.equal(entryPath(pkg, item), "text/ch1.xhtml");
    const out = await extract(buf);
    assert.ok(out.text.includes("上一层"));
  });

  /* ================= B spine 编排 ================= */

  await check("TC-EPUB-B1 按 spine 顺序拼接（不是 manifest 顺序）", async () => {
    const out = await extract(await makeEpub(basicSpec()));
    const i1 = out.text.indexOf("# 第一章 起点");
    const i2 = out.text.indexOf("# 第二章 终局");
    assert.ok(i1 >= 0 && i2 >= 0, "两章标题都应出现");
    assert.ok(i1 < i2, `spine 顺序错乱：${i1} vs ${i2}`);
    assert.equal(out.spineCount, 2);
    assert.equal(out.headings, 2);
  });

  await check("TC-EPUB-B2 非 xhtml 条目（media-type=text/css）被跳过", async () => {
    const out = await extract(
      await makeEpub({
        chapters: [
          { href: "style.css", mediaType: "text/css", body: "body{color:red}" },
          {
            href: "ch1.xhtml",
            docTitle: "唯一章",
            body: `<h1>唯一章</h1><p>样式表不该被当成正文。</p>`,
          },
        ],
      }),
    );
    assert.ok(!out.text.includes("color:red"), "CSS 被误当正文");
    assert.equal(out.spineCount, 1);
  });

  await check("TC-EPUB-B3 spine 为空 ⇒ EpubBadArchiveError", async () => {
    const buf = await makeEpub({ chapters: [] });
    // 没有章节时 manifest 为空、spine 为空 ⇒ 视为坏归档（而不是「无正文」：
    // 「无正文」用于「有 spine 但抽不出字」，语义不同）。
    await expectThrow(EpubBadArchiveError, () => openEpub(buf), "emptySpine");
  });

  await check("TC-EPUB-B4 spine 含 manifest 不存在的 idref ⇒ 跳过该项不崩", async () => {
    const buf = await makeEpub({ ...basicSpec(), bogusSpineRef: "ghost" });
    const out = await extract(buf);
    assert.equal(out.spineCount, 2, "幽灵 idref 不应计入，也不应让整本失败");
    assert.ok(out.text.includes("第二章 终局"));
  });

  /* ================= C 标题三级兜底 ================= */

  await check("TC-EPUB-C1 正文有 h1 ⇒ 用正文标题，不重复补 <title>", async () => {
    const out = await extract(await makeEpub(basicSpec()));
    assert.ok(out.text.startsWith("# 第一章 起点"));
    assert.ok(!out.text.includes("# 第一章 起点\n\n# "), "不应把 <title> 也补成标题");
  });

  await check("TC-EPUB-C2 正文只有 h2 ⇒ 归一化为 #（否则整本切不出章）", async () => {
    const out = await extract(
      await makeEpub({
        chapters: [
          {
            href: "ch1.xhtml",
            docTitle: "只用 h2 的书",
            body: `<h2>第一节</h2><p>正文。</p><h2>第二节</h2><p>正文。</p>`,
          },
        ],
      }),
    );
    assert.ok(out.text.startsWith("# 第一节"), out.text.slice(0, 40));
    assert.ok(out.text.includes("\n# 第二节"), "第二个 h2 也应归一化为 #");
    assert.equal(out.headings, 2);
  });

  await check("TC-EPUB-C3 无正文标题但有 <title> 且正文够长 ⇒ 补 # <title> 独立成章", async () => {
    const long = "正文内容重复填充。".repeat(30); // ≥ 200 字
    const out = await extract(
      await makeEpub({
        chapters: [
          {
            href: "ch1.xhtml",
            docTitle: "补出来的章",
            body: `<p>${long}</p>`,
          },
        ],
      }),
    );
    assert.ok(out.text.startsWith("# 补出来的章"), out.text.slice(0, 40));
    assert.equal(out.headings, 1);
  });

  await check("TC-EPUB-C4 无正文标题且正文过短 ⇒ 并入前章（不造假章）", async () => {
    const out = await extract(
      await makeEpub({
        chapters: [
          {
            href: "ch1.xhtml",
            docTitle: "真章",
            body: `<h1>真章</h1><p>${"第一章的正文。".repeat(40)}</p>`,
          },
          {
            href: "ch2.xhtml",
            docTitle: "版权页",
            body: `<p>短短一行。</p>`,
          },
        ],
      }),
    );
    assert.equal(out.headings, 1, "过短的附属页不应另起一章");
    assert.ok(!out.text.includes("# 版权页"), "不应生成「版权页」章");
    assert.ok(out.text.includes("短短一行。"), "但它的正文不能丢");
  });

  /* ================= D 编码 ================= */

  await check("TC-EPUB-D1 UTF-8 BOM 的 XHTML 正常解码", async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const rest = new TextEncoder().encode(
      `<?xml version="1.0"?><html><head><title>BOM</title></head><body><h1>带 BOM 的章</h1><p>正文。</p></body></html>`,
    );
    const bytes = new Uint8Array(bom.length + rest.length);
    bytes.set(bom);
    bytes.set(rest, bom.length);

    const out = await extract(
      await makeEpub({ chapters: [{ href: "ch1.xhtml", body: "", rawBytes: bytes }] }),
    );
    assert.ok(out.text.includes("带 BOM 的章"));
    assert.equal(out.encodings, undefined, "纯 utf-8 不打扰用户");
  });

  await check("TC-EPUB-D2 无声明 GBK 字节 ⇒ 嗅探落 gb18030（不静默乱码）", async () => {
    // 「中文正文」的 GB18030 编码：d6 d0 ce c4 d5 fd ce c4
    const head = new TextEncoder().encode(
      `<?xml version="1.0"?><html><head><title>GBK</title></head><body><h1>`,
    );
    const gbk = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 0xd5, 0xfd, 0xce, 0xc4]);
    const tail = new TextEncoder().encode(`</h1><p>ok</p></body></html>`);
    const bytes = new Uint8Array(head.length + gbk.length + tail.length);
    bytes.set(head);
    bytes.set(gbk, head.length);
    bytes.set(tail, head.length + gbk.length);

    const out = await extract(
      await makeEpub({ chapters: [{ href: "ch1.xhtml", body: "", rawBytes: bytes }] }),
    );
    assert.ok(out.text.includes("中文正文"), `GBK 未还原：${out.text.slice(0, 60)}`);
  });

  await check("TC-EPUB-D3 非 utf-8 时回报 encodings（G4：不静默兜底）", async () => {
    const head = new TextEncoder().encode(
      `<?xml version="1.0"?><html><head></head><body><h1>`,
    );
    const gbk = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]);
    const tail = new TextEncoder().encode(`</h1></body></html>`);
    const bytes = new Uint8Array(head.length + gbk.length + tail.length);
    bytes.set(head);
    bytes.set(gbk, head.length);
    bytes.set(tail, head.length + gbk.length);

    const out = await extract(
      await makeEpub({ chapters: [{ href: "ch1.xhtml", body: "", rawBytes: bytes }] }),
    );
    assert.ok(out.encodings?.includes("gb18030"), `实得 ${JSON.stringify(out.encodings)}`);
  });

  /* ================= E 错误分类 ================= */

  await check("TC-EPUB-E1 正文被加密 ⇒ EpubDrmError", async () => {
    const buf = await makeEpub({
      chapters: [
        { href: "ch1.xhtml", docTitle: "加密书", body: `<h1>加密书</h1><p>正文。</p>` },
      ],
      encrypted: [
        { algorithm: "http://www.w3.org/2001/04/xmlenc#aes256-cbc", uri: "OEBPS/ch1.xhtml" },
      ],
    });
    await expectThrow(EpubDrmError, () => openEpub(buf), "drm");

    // 端到端：抽取器的语义化错误必须在 `fileToUnit` 映射为 `kind`（G2，文案由 UI 查表）。
    const unit = await fileToUnit(new File([buf], "加密书.epub"), { parseHtml });
    assert.ok("error" in unit, "DRM 书不应导入成功");
    if ("error" in unit) assert.equal(unit.error, "epub-drm");
  });

  await check("TC-EPUB-E2 字体混淆（idpf embedding）**不算** DRM ⇒ 正常导入", async () => {
    const buf = await makeEpub({
      chapters: [
        { href: "ch1.xhtml", docTitle: "正版书", body: `<h1>正版书</h1><p>正文。</p>` },
      ],
      encrypted: [
        { algorithm: "http://www.idpf.org/2008/embedding", uri: "OEBPS/fonts/serif.otf" },
      ],
    });
    const out = await extract(buf);
    assert.ok(out.text.includes("正版书"), "字体混淆被误判为 DRM ⇒ 误杀大量正版书");
  });

  await check("TC-EPUB-E3 有 spine 但抽不到字 ⇒ EpubNoTextError", async () => {
    const buf = await makeEpub({
      chapters: [{ href: "ch1.xhtml", docTitle: "", body: `<div></div>` }],
    });
    await expectThrow(EpubNoTextError, () => extract(buf), "no-text");
  });

  await check("TC-EPUB-E4 非 ZIP 字节 ⇒ EpubBadArchiveError（魔数拦截）", async () => {
    const junk = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer; // "%PDF-"
    assert.equal(hasZipMagic(new Uint8Array(junk)), false);
    await expectThrow(EpubBadArchiveError, () => openEpub(junk), "not-zip");
  });

  /* ================= F 护栏（三把尺子） ================= */

  await check("TC-EPUB-F1 解压总量超限 ⇒ EpubTooLargeError（zip bomb 防线）", async () => {
    const buf = await makeEpub({
      chapters: [
        {
          href: "ch1.xhtml",
          docTitle: "大书",
          body: `<h1>大书</h1><p>${"很多字。".repeat(200)}</p>`,
        },
      ],
    });
    await expectThrow(
      EpubTooLargeError,
      () => extract(buf, { epubUnzippedBytes: 64 }),
      "unzipped",
    );
  });

  await check("TC-EPUB-F2 正文字符超限 ⇒ EpubTooLargeError（入库尺子）", async () => {
    const buf = await makeEpub({
      chapters: [
        {
          href: "ch1.xhtml",
          docTitle: "长书",
          body: `<h1>长书</h1><p>${"字".repeat(500)}</p>`,
        },
      ],
    });
    await expectThrow(EpubTooLargeError, () => extract(buf, { epubMaxChars: 50 }), "chars");
  });

  await check("TC-EPUB-F3 文件字节线独立于解压线与正文线（classifyLocalFile / fileToUnit）", async () => {
    assert.deepEqual(classifyLocalFile({ name: "a.epub", size: 100 }), {
      kind: "epub",
      overLimit: false,
    });
    assert.equal(
      classifyLocalFile({ name: "a.epub", size: LIMITS.localEpubBytes + 1 }).overLimit,
      true,
    );
    assert.equal(classifyLocalFile({ name: "a.epub", size: LIMITS.localEpubBytes }).overLimit, false);
    // 三条线必须彼此不同，且都有限（禁 Infinity）。
    assert.ok(LIMITS.localEpubBytes < LIMITS.epubUnzippedBytes);
    assert.notEqual(LIMITS.epubUnzippedBytes, LIMITS.epubMaxChars);
    assert.ok(Number.isFinite(LIMITS.epubUnzippedBytes));
    assert.equal(stripExtension("三体.epub"), "三体");

    // 坏包（非 ZIP）在解包前即被魔数拦下 ⇒ 映射为 epub-bad-zip，而不是笼统的 read-failed。
    const junk = await fileToUnit(new File([new Uint8Array(16)], "坏书.epub"), { parseHtml });
    assert.ok("error" in junk);
    if ("error" in junk) assert.equal(junk.error, "epub-bad-zip");
  });

  /* ================= G 契约（与共享管道的接法） ================= */

  await check("TC-EPUB-G1 format 固定 epub；splitFormat 随 headings 切换", async () => {
    const withHeadings = await fileToUnit(
      new File([await makeEpub(basicSpec())], "探针之书.epub"),
      { parseHtml },
    );
    assert.ok(!("error" in withHeadings), JSON.stringify(withHeadings));
    if ("error" in withHeadings) return;
    assert.equal(withHeadings.format, "epub", "写 markdown 会让资料卡显示错类型");
    assert.equal(withHeadings.splitFormat, "markdown");
    assert.equal(withHeadings.title, "探针之书", "文件名优先（D8）");

    const plain = await makeEpub({
      chapters: [
        {
          href: "ch1.xhtml",
          docTitle: "",
          body: `<p>${"没有标题的正文。".repeat(40)}</p>`,
        },
      ],
    });
    const noHeadings = await fileToUnit(new File([plain], "无结构.epub"), { parseHtml });
    assert.ok(!("error" in noHeadings));
    if (!("error" in noHeadings)) {
      assert.equal(noHeadings.splitFormat, "txt", "headings=0 ⇒ 段落聚类");
      assert.equal(noHeadings.extract?.headings, 0);
    }
  });

  await check("TC-EPUB-G2 走 runUnitImport：资料 + 章节全部落库", async () => {
    const store = new InMemoryStorage();
    const unit = await fileToUnit(
      new File([await makeEpub(basicSpec())], "探针之书.epub"),
      { parseHtml },
    );
    assert.ok(!("error" in unit));
    if ("error" in unit) return;

    const res = await runUnitImport(unit, {
      storage: store,
      split: { minBodyCharsPerChapter: 0 },
    });
    assert.equal(res.chapterIds.length, 2);
    assert.ok(res.chapterTitles[0]?.includes("第一章"));

    const docs = await store.listDocuments();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].format, "epub");
    assert.equal(docs[0].title, "探针之书");
    assert.equal((await store.listChapters(res.docId)).length, 2);
  });

  await check("TC-EPUB-G3 dc:title 只在文件名退化时兜底", async () => {
    // 文件名有内容 ⇒ 用文件名。
    const named = await fileToUnit(
      new File([await makeEpub(basicSpec())], "我下载的书.epub"),
      { parseHtml },
    );
    assert.ok(!("error" in named));
    if (!("error" in named)) assert.equal(named.title, "我下载的书");

    // 文件名为空的极端情况 ⇒ 落 dc:title。
    const unnamed = await fileToUnit(new File([await makeEpub(basicSpec())], ".epub"), {
      parseHtml,
    });
    assert.ok(!("error" in unnamed));
    if (!("error" in unnamed)) assert.equal(unnamed.title, "探针之书");
  });

  /* ================= H 卫生（库接触面隔离） ================= */

  await check("TC-EPUB-H1 import 目录下只有 epub-archive.ts 直接 import jszip", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const dir = join(here, "..", "src", "features", "learn", "import");
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
      const src = readFileSync(join(dir, name), "utf8");
      if (/from\s+["']jszip["']/.test(src) && name !== "epub-archive.ts") {
        offenders.push(name);
      }
    }
    assert.deepEqual(offenders, [], `只有 epub-archive.ts 可以 import jszip，实际：${offenders}`);
  });

  await check("TC-EPUB-H2 epub.ts 不 import jszip（编排层与归档层分离）", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, "..", "src", "features", "learn", "import", "epub.ts"),
      "utf8",
    );
    assert.ok(!/from\s+["']jszip["']/.test(src), "epub.ts 不应直接依赖 jszip");
    // 但必须从归档层取能力。
    assert.ok(/from\s+["']\.\/epub-archive["']/.test(src));
  });

  for (const line of results) console.log(line);
  console.log(`\n[import-epub] ${results.length - failures}/${results.length} 通过`);
  if (failures > 0) process.exit(1);
}

void main();
