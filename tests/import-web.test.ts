/**
 * 网页来源导入单测（F8 范围 5）。
 *
 * 运行（Node 22 + 类型剥离直跑）：`npm run test:web`
 *
 * **三层结构**（对齐方案 §11.1）：
 * 1. **输出层层**（`html-markdown.ts`）：直接喂 `linkedom` 解析出的 DOM 片段 ——
 *    标题层级归一化 / 列表 / 代码块 / 表格 / 噪声跳过 / 图片计数都在这儿测，精确可控；
 * 2. **编排层**（`web-page.ts`）：`fetchPage` 注入假实现（**不联网**）+ 真实
 *    `Readability` + `linkedom`，覆盖 URL 规范化 / 编码判定 / 二进制预筛 / 错误路径；
 * 3. **契约层**：Rust 令牌的 TS 解析端（`web-error.ts`）、桥层守卫（`desktop-fetch.ts`）、
 *    常量同一把尺子（`LIMITS`）、源文件卫生守卫。
 *
 * ⚠️ 测试**不 import 任何 `.tsx`**（`--experimental-strip-types` 不支持 JSX）；
 *    React 渲染路径由 runbook T13 的桌面手工验收覆盖（`rules/no-headless-browser-validation`）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { htmlNodesToMarkdown } from "../src/features/learn/import/html-markdown.ts";
import {
  buildWebUnit,
  decodeHtml,
  htmlCharsetOf,
  isBinaryContentType,
  parseWebUrl,
} from "../src/features/learn/import/web-page.ts";
import type { HtmlParser, WebUnitDeps } from "../src/features/learn/import/web-page.ts";
import { WebImportError, webErrorKindOf } from "../src/features/learn/import/web-error.ts";
import { fetchUrl, isWebImportAvailable } from "../src/features/learn/import/desktop-fetch.ts";
import type { FetchedPage } from "../src/features/learn/import/desktop-fetch.ts";
import { LIMITS } from "../src/features/learn/import/types.ts";
import type { ImportUnit } from "../src/features/learn/import/types.ts";
import { splitDocument } from "../src/engine/splitter-engine.ts";
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

/* ------------------------------------------------------------------ */
/* 基础设施                                                            */
/* ------------------------------------------------------------------ */

/** linkedom 解析器（生产走 webview 的 `DOMParser`）。 */
const parseHtml: HtmlParser = (html) => parseHTML(html).document as unknown as Document;

/** 把一段 HTML 片段（`<body>` 内）当根节点喂给输出层。 */
function mdOf(bodyInner: string) {
  const html = `<!doctype html><html><body>${bodyInner}</body></html>`;
  const doc = parseHTML(html).document;
  return htmlNodesToMarkdown(doc.body as unknown as Parameters<typeof htmlNodesToMarkdown>[0]);
}

/** 假抓取器：把字符串当 UTF-8 页面回传（**不发任何网络请求**）。 */
function fakeFetch(
  body: string,
  opts: { finalUrl?: string; contentType?: string } = {},
): (url: string) => Promise<FetchedPage> {
  const bytes = Buffer.from(body, "utf-8");
  return async (url) => ({
    finalUrl: opts.finalUrl ?? url,
    status: 200,
    contentType: opts.contentType ?? "text/html; charset=utf-8",
    bytesBase64: bytes.toString("base64"),
    byteLen: bytes.length,
  });
}

/** 拼接字节段（ASCII 字符串 + 原始字节序列），用于手工构造非 UTF-8 页面。 */
function concatBytes(...parts: (string | Uint8Array)[]): Uint8Array {
  const chunks = parts.map((p) => (typeof p === "string" ? new TextEncoder().encode(p) : p));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** "中文测试" 的 GBK / GB2312 字节（D6 D0 = 中，CE C4 = 文，B2 E2 = 测，CA D4 = 试）。 */
const GBK_TEXT = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4]);

/** 断言同步函数抛指定 kind 的 WebImportError。 */
function expectWebErrorSync(fn: () => unknown, kind: string): void {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof WebImportError, `期望 WebImportError，实际 ${String(err)}`);
    assert.equal(err.kind, kind);
    return;
  }
  assert.fail(`期望抛 WebImportError(${kind})，但没有抛出`);
}

/** 断言异步函数抛指定 kind 的 WebImportError。 */
async function expectWebError(fn: () => Promise<unknown>, kind: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof WebImportError, `期望 WebImportError，实际 ${String(err)}`);
    assert.equal(err.kind, kind);
    return;
  }
  assert.fail(`期望抛 WebImportError(${kind})，但没有抛出`);
}

/* ------------------------------------------------------------------ */
/* 静态文章 fixture（服务端渲染的博客页）                                */
/* ------------------------------------------------------------------ */

const P1 =
  "关键词匹配依赖字面重合，同义改写与近义表达往往召不回来，这是召回率上不去的常见原因之一。".repeat(3);
const P2 =
  "把稀疏检索与稠密检索的结果用倒数排序融合合并，既能保住精确匹配，又能补上语义召回。".repeat(3);
const P3 = "重排阶段只处理前若干候选，成本可控；阈值与候选数需要按语料规模实测标定。".repeat(3);

const ARTICLE_HTML = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>向量检索入门</title></head>
<body>
<nav><a href="/">首页</a><a href="/tags">标签云</a></nav>
<header><h1>向量检索入门</h1></header>
<article>
<h2>一、为什么需要向量检索</h2><p>${P1}</p>
<h2>二、混合检索与 RRF 融合</h2><p>${P2}</p>
<h2>三、工程实践与阈值标定</h2><p>${P3}</p>
</article>
<footer><p>版权所有 © 某博客</p></footer>
<script>window.analytics = { track() {} };</script>
</body></html>`;

/** 只有导航与页脚的「标题党空页」（UC-02 的第二种形态）。 */
const EMPTY_HTML = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>空页</title></head>
<body><nav><a href="/">首页</a><a href="/about">关于</a></nav><footer><p>版权所有 © 某站</p></footer></body>
</html>`;

async function main() {
  /* ---------------- A 组：URL 规范化（TC-EDGE-01 / 02 / 03） ---------------- */

  await check("TC-EDGE-01 无 scheme 的输入自动补 https://", () => {
    assert.equal(parseWebUrl("example.com/a"), "https://example.com/a");
    assert.equal(parseWebUrl("  example.com/a  "), "https://example.com/a");
    assert.equal(parseWebUrl("http://example.com/a"), "http://example.com/a");
  });

  await check("TC-EDGE-02 非 http(s) / 空串一律 invalid", () => {
    for (const bad of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "",
      "   ",
    ]) {
      expectWebErrorSync(() => parseWebUrl(bad), "invalid");
    }
  });

  await check("TC-EDGE-03 无 host 的 URL → invalid", () => {
    expectWebErrorSync(() => parseWebUrl("https://"), "invalid");
    // ⚠️ 实测踩坑（不要再把下面这类写进本用例）：WHATWG URL 会把 `https:///only-path`
    //    解析成 host="only-path"（跳过空 authority），它是**合法** URL，不是「无 host」。
    //    真正无 host 只有 `new URL` 直接抛错的形态（如上面那条）。
    expectWebErrorSync(() => parseWebUrl("https://:8080/x"), "invalid");
  });

  /* ---------------- B 组：编码判定（TC-UC05-01/02、TC-EDGE-10） ---------------- */

  await check("TC-UC05-01a 无任何 charset 声明 → 嗅探链落 gb18030", () => {
    const bytes = concatBytes(
      "<!doctype html><html><body><p>",
      GBK_TEXT,
      "</p></body></html>",
    );
    const { html, encoding } = decodeHtml(Buffer.from(bytes).toString("base64"), undefined);
    assert.equal(encoding, "gb18030");
    assert.ok(html.includes("中文测试"), `GBK 字节应解出中文，实际 ${html.slice(0, 80)}`);
  });

  await check("TC-UC05-01b <meta charset=gbk> → 采信页面自述的标签名", () => {
    const bytes = concatBytes(
      '<!doctype html><html><head><meta charset="gbk"></head><body><p>',
      GBK_TEXT,
      "</p></body></html>",
    );
    const { html, encoding } = decodeHtml(Buffer.from(bytes).toString("base64"), undefined);
    // ⚠️ 刻意断言 `gbk` 而不是 `gb18030`：页面自述的标签名要**原样**回传给结果卡，
    //    归一化会谎报「已按 gb18030 解码」。（方案用例原写 gb18030，实施期更正 —— 见偏差表。）
    assert.equal(encoding, "gbk");
    assert.ok(html.includes("中文测试"));
  });

  await check("TC-UC05-02 HTTP 头 charset 优先于 <meta>", () => {
    assert.equal(htmlCharsetOf("text/html; charset=GBK", '<meta charset="big5">'), "gbk");
    assert.equal(htmlCharsetOf(undefined, '<meta charset="gbk">'), "gbk");
    assert.equal(htmlCharsetOf("text/html", "<html><head></head>"), undefined);
    assert.equal(htmlCharsetOf(undefined, "<html><head></head>"), undefined);

    // 端到端同一条事实：header=gbk 压过 meta=big5 ⇒ 中文可读。
    const bytes = concatBytes(
      '<!doctype html><html><head><meta charset="big5"></head><body><p>',
      GBK_TEXT,
      "</p></body></html>",
    );
    const r = decodeHtml(Buffer.from(bytes).toString("base64"), "text/html; charset=gbk");
    assert.equal(r.encoding, "gbk");
    assert.ok(r.html.includes("中文测试"));
  });

  await check("TC-EDGE-10 二进制 Content-Type 预筛（缺失不判死）", () => {
    assert.equal(isBinaryContentType(undefined), false);
    assert.equal(isBinaryContentType("text/html; charset=utf-8"), false);
    assert.equal(isBinaryContentType("application/xhtml+xml"), false);
    assert.equal(isBinaryContentType("application/pdf"), true);
    assert.equal(isBinaryContentType("image/png"), true);
    assert.equal(isBinaryContentType("application/zip"), true);
    assert.equal(isBinaryContentType("application/octet-stream"), true);
  });

  /* ---------------- C 组：输出层（DOM → Markdown） ---------------- */

  await check("TC-UC01-03 噪声标签整棵跳过（不依赖 Readability 清干净）", () => {
    const md = mdOf(
      `<nav><a href="/">首页</a></nav><p>正文一句</p><footer>版权所有</footer>` +
        `<script>var a = 1;</script><style>.a{}</style><aside>侧栏</aside>`,
    );
    assert.ok(md.text.includes("正文一句"));
    for (const bad of ["首页", "版权所有", "var a = 1", ".a{}", "侧栏"]) {
      assert.ok(!md.text.includes(bad), `不应包含 ${bad}`);
    }
  });

  await check("TC-UC01-04 链接只取文字，不产链接语法（D7）", () => {
    const md = mdOf(`<p>参见<a href="/x">术语表</a>一节</p>`);
    assert.ok(md.text.includes("参见术语表一节"));
    assert.ok(!md.text.includes("]("), "不应产出 markdown 链接语法");
    assert.ok(!md.text.includes("/x"), "不应保留 href");
  });

  await check("TC-EDGE-11 标题层级归一化：h3/h4 当小节 ⇒ 整体上移到 #/##", () => {
    const md = mdOf(`<h3>甲</h3><p>a</p><h4>乙</h4><p>b</p>`);
    assert.deepEqual(md.levels, { min: 3, max: 4 }, "levels 记归一化前的原始层级");
    assert.ok(md.text.startsWith("# 甲\n\n"), `实际开头：${JSON.stringify(md.text.slice(0, 20))}`);
    assert.ok(md.text.includes("\n\n## 乙\n\n"));
    assert.equal(md.headings, 2);
  });

  await check("TC-EDGE-12 h1 无正文 + h2 小节 ⇒ 引擎识别主标题、h2 成章", () => {
    const md = mdOf(`<h1>文章主标题</h1><h2>第一节</h2><p>正文内容。</p>`);
    assert.equal(md.levels.min, 1, "最浅标题已是 # ⇒ 不做位移");
    assert.ok(md.text.startsWith("# 文章主标题"));
    const split = splitDocument(
      { documentId: "doc-h12", text: md.text, format: "markdown" },
      { minBodyCharsPerChapter: 0 },
    );
    assert.deepEqual(split.chapters.map((c) => c.title), ["第一节"]);
    assert.equal(split.documentHeading, "文章主标题");
  });

  await check("TC-EDGE-14 图片跳过且计数（含嵌在 p 内的图）", () => {
    const md = mdOf(
      `<p>前<img src="a.png" alt="图">后</p><figure><img src="b.png"></figure>`,
    );
    assert.equal(md.skippedImages, 2);
    assert.ok(!md.text.includes("base64"));
    assert.ok(!md.text.includes("!["));
    assert.ok(md.text.includes("前后"));
  });

  await check("TC-EDGE-15 列表 / 代码块 / 引用 / GFM 表格", () => {
    const md = mdOf(
      `<ul><li>甲</li><li>乙</li></ul>` +
        `<ol><li>第一</li><li>第二</li></ol>` +
        `<pre>def f():\n    return 1</pre>` +
        `<blockquote><p>引用一句话</p></blockquote>` +
        `<table><thead><tr><th>列A</th><th>列B</th></tr></thead>` +
        `<tbody><tr><td>1</td><td>2</td></tr></tbody></table>`,
    );
    assert.ok(md.text.includes("- 甲"));
    assert.ok(md.text.includes("- 乙"));
    assert.ok(md.text.includes("1. 第一"));
    assert.ok(md.text.includes("2. 第二"));
    assert.ok(md.text.includes("```\ndef f():\n    return 1\n```"), "代码块必须保留缩进");
    assert.ok(md.text.includes("    return 1"), "行内缩进不得被折叠");
    assert.ok(md.text.includes("> 引用一句话"));
    assert.ok(md.text.includes("| 列A | 列B |"));
    assert.ok(md.text.includes("| --- | --- |"));
    assert.equal(md.tables, 1);
  });

  await check("TC-EDGE-15b 单行表格降级为文本（不造假表头）", () => {
    const md = mdOf(`<table><tr><td>只有一个单元格</td></tr></table>`);
    assert.equal(md.tables, 0);
    assert.ok(md.text.includes("只有一个单元格"));
    assert.ok(!md.text.includes("---"));
  });

  await check("TC-EDGE-15c 嵌套列表缩进一层", () => {
    const md = mdOf(`<ul><li>父项<ul><li>子项</li></ul></li></ul>`);
    assert.ok(md.text.includes("- 父项"));
    assert.ok(md.text.includes("  - 子项"));
  });

  await check("TC-EDGE-17 多层 div 包裹透明递归，内容不丢", () => {
    const md = mdOf(`<div><div><section><p>深藏正文</p></section></div></div>`);
    assert.ok(md.text.includes("深藏正文"));
  });

  await check("TC-EDGE-16b 表格单元格内 | 转义", () => {
    const md = mdOf(
      `<table><tr><td>a|b</td><td>c</td></tr><tr><td>d</td><td>e</td></tr></table>`,
    );
    assert.ok(md.text.includes("a\\|b"), `实际：${md.text}`);
  });

  /* ---------------- D 组：提取与编排 ---------------- */

  let articleUnit: ImportUnit;
  await check("TC-UC01-01 静态文章 → ImportUnit（format/splitFormat/source/title）", async () => {
    articleUnit = await buildWebUnit({
      fetchPage: fakeFetch(ARTICLE_HTML),
      parseHtml,
      sourceUrl: "https://blog.example.com/vec-search",
    });
    assert.equal(articleUnit.format, "web");
    assert.equal(articleUnit.splitFormat, "markdown");
    assert.equal(articleUnit.titleSource, "derived");
    assert.equal(articleUnit.title, "向量检索入门");
    assert.equal(articleUnit.source, "https://blog.example.com/vec-search");
    assert.equal(articleUnit.extract?.encoding, "utf-8");
    assert.ok((articleUnit.extract?.headings ?? 0) >= 3, "应识别到至少 3 个标题");
    assert.ok(articleUnit.text.includes("混合检索"));
    // Readability 已清掉页脚 / 脚本；输出层再兜一道 ⇒ 两重保证都不出现在正文里。
    assert.ok(!articleUnit.text.includes("版权所有"));
    assert.ok(!articleUnit.text.includes("analytics"));
    assert.ok(!articleUnit.text.includes("首页"));
  });

  await check("TC-UC01-02 章节标题 = 文章小标题（标题切分，非段落聚类）", () => {
    const split = splitDocument(
      { documentId: "doc-web", text: articleUnit.text, format: articleUnit.splitFormat },
      { minBodyCharsPerChapter: 0 },
    );
    assert.equal(split.strategy, "headings", "必须是标题切分路径");
    const titles = split.chapters.map((c) => c.title);
    assert.equal(titles.length, 3, `实际标题：${JSON.stringify(titles)}`);
    assert.ok(titles[0]?.includes("为什么需要向量检索"));
    assert.ok(titles[1]?.includes("混合检索"));
    assert.ok(titles[2]?.includes("工程实践"));
  });

  await check("TC-UC02-01 提不到正文 ⇒ no-text，且结构上不可能写入资料", async () => {
    const store = new InMemoryStorage();
    let unit: ImportUnit | undefined;
    // ⚠️ 提取失败发生在管道**之前**（`buildWebUnit` 根本拿不到 storage）——
    //    所以「不写任何数据」是结构保证，这里连调用管道的机会都没有。
    await expectWebError(async () => {
      unit = await buildWebUnit({
        fetchPage: fakeFetch(EMPTY_HTML),
        parseHtml,
        sourceUrl: "https://spa.example.com/app",
      });
    }, "no-text");
    assert.equal(unit, undefined);
    assert.equal((await store.listDocuments()).length, 0);
  });

  await check("TC-EDGE-08 正文超 webMaxChars ⇒ too-large（不静默截断）", async () => {
    await expectWebError(
      () =>
        buildWebUnit(
          { fetchPage: fakeFetch(ARTICLE_HTML), parseHtml, sourceUrl: "https://blog.example.com/x" },
          { webMaxChars: 10 },
        ),
      "too-large",
    );
  });

  await check("TC-EDGE-09 Content-Type 为 PDF ⇒ not-html（不进提取器）", async () => {
    await expectWebError(
      () =>
        buildWebUnit({
          fetchPage: fakeFetch("%PDF-1.4 ...", { contentType: "application/pdf" }),
          parseHtml,
          sourceUrl: "https://example.com/paper.pdf",
        }),
      "not-html",
    );
  });

  await check("TC-UC04-01 source 用终址 ⇒ 短链 / 带参变体归一到同一 source", async () => {
    const a = await buildWebUnit({
      fetchPage: fakeFetch(ARTICLE_HTML, { finalUrl: "https://blog.example.com/post" }),
      parseHtml,
      sourceUrl: "https://blog.example.com/post?utm_source=twitter",
    });
    const b = await buildWebUnit({
      fetchPage: fakeFetch(ARTICLE_HTML, { finalUrl: "https://blog.example.com/post" }),
      parseHtml,
      sourceUrl: "https://t.cn/abc123",
    });
    assert.equal(a.source, "https://blog.example.com/post");
    assert.equal(a.source, b.source);
  });

  await check("TC-EDGE-21 抓取错误经桥层转译后仍是 kind（不泄漏令牌字符串）", async () => {
    const deps: WebUnitDeps = {
      fetchPage: async () => {
        // 模拟 Rust 侧返回 `http-error:503` 经 `desktop-fetch` 转译后的结果。
        throw new WebImportError("http-error", "503");
      },
      parseHtml,
      sourceUrl: "https://down.example.com/",
    };
    await expectWebError(() => buildWebUnit(deps), "http-error");
  });

  /* ---------------- E 组：令牌契约与桥层守卫 ---------------- */

  await check("TC-EDGE-04 Rust 令牌 → 类别（带 detail）", () => {
    assert.deepEqual(webErrorKindOf("http-error:404"), { kind: "http-error", detail: "404" });
    assert.deepEqual(webErrorKindOf("too-large:5242880"), { kind: "too-large", detail: "5242880" });
    assert.deepEqual(webErrorKindOf("invalid-url"), { kind: "invalid" });
  });

  await check("TC-EDGE-05 网络类令牌合并为一类；未知令牌不崩、归 network", () => {
    for (const t of ["network", "timeout", "too-many-redirects"]) {
      assert.equal(webErrorKindOf(t).kind, "network");
    }
    assert.equal(webErrorKindOf("wat").kind, "network");
    assert.equal(webErrorKindOf("wat").detail, "wat");
    assert.equal(webErrorKindOf("build-client:boom").kind, "network");
    assert.equal(webErrorKindOf("network:x:y").kind, "network");
  });

  await check("TC-UC03-01 非桌面端调 fetchUrl ⇒ desktop-only（不发 IPC）", async () => {
    assert.equal(isWebImportAvailable(), false, "node 环境不是 Tauri");
    await expectWebError(() => fetchUrl("https://example.com"), "desktop-only");
  });

  /* ---------------- F 组：源文件卫生与常量 ---------------- */

  const importDir = new URL("../src/features/learn/import/", import.meta.url);
  const readSrc = (name: string) => readFileSync(new URL(name, importDir), "utf-8");

  await check("TC-EDGE-18 纯逻辑层不依赖 UI / 桌面桥", () => {
    for (const f of ["web-page.ts", "html-markdown.ts", "web-error.ts"]) {
      const src = readSrc(f);
      assert.ok(!/from\s+"react"/.test(src), `${f} 不得 import react`);
      assert.ok(!/from\s+"@tauri-apps\//.test(src), `${f} 不得 import @tauri-apps`);
    }
    // web-page 允许 **仅类型** 引用桌面桥的 FetchedPage（运行时零依赖）。
    const page = readSrc("web-page.ts");
    assert.ok(/import type \{[^}]*FetchedPage[^}]*\} from "\.\/desktop-fetch"/.test(page));
  });

  await check("TC-EDGE-19 webMaxChars 与「入库正文」同一把尺子", () => {
    assert.equal(LIMITS.webMaxChars, LIMITS.pasteMaxChars);
    assert.equal(LIMITS.webMaxChars, LIMITS.docxMaxChars);
    assert.equal(LIMITS.webMaxChars, LIMITS.githubTotalChars);
  });

  await check("TC-EDGE-20 ImportTab 含 web；网页来源固定 markdown", () => {
    const src = readSrc("types.ts");
    assert.ok(/ImportTab\s*=\s*[^;]*"web"/.test(src), "ImportTab 应含 \"web\"");
  });

  /* ---------------- G 组：端到端共享管道 ---------------- */

  await check("TC-INT-01 网页 unit 走 runUnitImport：资料 + 章节 + source 全部落库", async () => {
    const store = new InMemoryStorage();
    const unit = await buildWebUnit({
      fetchPage: fakeFetch(ARTICLE_HTML),
      parseHtml,
      sourceUrl: "https://blog.example.com/vec-search",
    });
    const res = await runUnitImport(unit, {
      storage: store,
      split: { minBodyCharsPerChapter: 0 },
    });
    assert.equal(res.chapterIds.length, 3);
    assert.equal(res.chapterTitles[0]?.includes("为什么需要向量检索"), true);

    const docs = await store.listDocuments();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].format, "web");
    assert.equal(docs[0].source, "https://blog.example.com/vec-search");
    assert.equal(docs[0].title, "向量检索入门");

    const chapters = await store.listChapters(res.docId);
    assert.equal(chapters.length, 3);
  });

  await check("TC-INT-02 同源再导入命中查重（source 相等 ⇒ 可跳过）", async () => {
    const store = new InMemoryStorage();
    const unit = await buildWebUnit({
      fetchPage: fakeFetch(ARTICLE_HTML),
      parseHtml,
      sourceUrl: "https://blog.example.com/vec-search",
    });
    await runUnitImport(unit, { storage: store, split: { minBodyCharsPerChapter: 0 } });
    const again = await runUnitImport(unit, {
      storage: store,
      split: { minBodyCharsPerChapter: 0 },
      onDuplicate: "skip",
    });
    assert.equal(again.skippedAsDuplicate, true);
    assert.equal((await store.listDocuments()).length, 1, "skip 不应新增资料");
  });

  for (const line of results) console.log(line);
  console.log(`\n[import-web] ${results.length - failures}/${results.length} 通过`);
  if (failures > 0) process.exit(1);
}

await main();
