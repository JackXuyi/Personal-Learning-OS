/**
 * 知识库多来源导入 · 核心层单测（docs/knowledge-import-design-2026-09.md §11/§12）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:import
 *
 * 覆盖（纯逻辑层；React 组件/PDF worker/真实网络不在此测）：
 *  1) classifyLocalFile：扩展名白名单 + 大小护栏（md 1MB / pdf 30MB）
 *  2) stripExtension / formatBytes
 *  3) parseGithubUrl：仓库 / tree 子目录 / blob 单文件 / 无效链接
 *  4) buildRepoMarkdown：README 置首 + 路径即章节边界
 *  5) pickMarkdownEntries：前缀过滤 + 噪声目录排除 + 超限跳过
 *  6) resolveGithubUrl / buildGithubUnit：mock fetch（repo / blob 两态）
 *  7) pipeline.runUnitImport：md 有结构切章；过短仅保存；批量失败不阻断
 *  8) stripMarkdownNoise：图片/链接噪音清洗 + 管道接线（入库正文无图片语法）
 */
import assert from "node:assert/strict";
import { classifyLocalFile, stripExtension, formatBytes, LIMITS } from "../src/features/learn/import/types.ts";
import {
  parseGithubUrl,
  buildRepoMarkdown,
  pickMarkdownEntries,
  resolveGithubUrl,
  buildGithubUnit,
  GithubImportError,
} from "../src/features/learn/import/github.ts";
import { runUnitImport, runBatchImport } from "../src/features/learn/import/pipeline.ts";
import { stripMarkdownNoise } from "../src/features/learn/import/normalize-text.ts";
import { InMemoryStorage } from "../src/storage/memory.ts";
import type { ImportUnit } from "../src/features/learn/import/types.ts";

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

/** 可注入 fetch：按 host + pathname（+query 子串）精确路由返回 JSON/文本。
 *  netFail=true 模拟网络级失败（连接被阻断/超时，fetch reject 而非 HTTP 错误）。 */
function mockFetch(routes: { host: string; pathname: string; query?: string; json?: unknown; text?: string; status?: number; netFail?: boolean }[]) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    for (const r of routes) {
      if (url.hostname !== r.host) continue;
      if (r.pathname !== undefined && url.pathname !== r.pathname) continue;
      if (r.query && !url.search.includes(r.query)) continue;
      if (r.netFail) throw new TypeError("mock network failure");
      const status = r.status ?? 200;
      if (r.json !== undefined) {
        return new Response(JSON.stringify(r.json), { status, headers: { "content-type": "application/json" } });
      }
      if (r.text !== undefined) {
        return new Response(r.text, { status, headers: { "content-type": "text/plain" } });
      }
      // 只有 status：返回空体错误响应（无 body 路由）。
      return new Response("error", { status });
    }
    return new Response("not found", { status: 404 });
  };
}

const REPO_TREE = {
  tree: [
    { path: "README.md", type: "blob", size: 120 },
    { path: "docs/01-intro.md", type: "blob", size: 400 },
    { path: "docs/02-rag.md", type: "blob", size: 900 },
    { path: "assets/logo.svg", type: "blob", size: 5000 },
    { path: "node_modules/x.md", type: "blob", size: 10 },
    { path: "docs/big.md", type: "blob", size: 5 * 1024 * 1024 },
  ],
};

const run = async () => {
  // ---- 1) classifyLocalFile ----
  await check("classify md / pdf / docx / unsupported", () => {
    assert.deepEqual(classifyLocalFile({ name: "a.md", size: 100 }), { kind: "md", overLimit: false });
    assert.deepEqual(classifyLocalFile({ name: "b.markdown", size: 100 }), { kind: "md", overLimit: false });
    assert.deepEqual(classifyLocalFile({ name: "c.PDF", size: 100 }), { kind: "pdf", overLimit: false });
    // F8 范围 3：.docx 已是可导入类型；旧格式（OLE / 宏 / 模板）仍明确拒绝。
    assert.deepEqual(classifyLocalFile({ name: "d.docx", size: 100 }), { kind: "docx", overLimit: false });
    assert.deepEqual(classifyLocalFile({ name: "e.doc", size: 100 }), { error: "unsupported" });
  });

  await check("classify 大小护栏（md>1MB / pdf>30MB / docx>20MB）", () => {
    assert.equal(classifyLocalFile({ name: "a.md", size: LIMITS.localMdBytes + 1 }).overLimit, true);
    assert.equal(classifyLocalFile({ name: "b.md", size: LIMITS.localMdBytes }).overLimit, false);
    assert.equal(classifyLocalFile({ name: "c.pdf", size: LIMITS.localPdfBytes + 1 }).overLimit, true);
    assert.equal(classifyLocalFile({ name: "d.docx", size: LIMITS.localDocxBytes + 1 }).overLimit, true);
  });

  // ---- 2) stripExtension / formatBytes ----
  await check("stripExtension 去扩展名", () => {
    assert.equal(stripExtension("rag-notes.md"), "rag-notes");
    assert.equal(stripExtension("paper-2024.pdf"), "paper-2024");
    assert.equal(stripExtension("no-ext"), "no-ext");
  });

  await check("formatBytes 单位换算", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2 KB");
    assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
  });

  // ---- 3) parseGithubUrl ----
  await check("parseGithubUrl 仓库 / tree / blob / 无效", () => {
    assert.deepEqual(parseGithubUrl("https://github.com/owner/repo"), { kind: "repo", owner: "owner", repo: "repo" });
    assert.deepEqual(parseGithubUrl("https://github.com/o/r/tree/main/docs"), {
      kind: "tree", owner: "o", repo: "r", ref: "main", path: "docs",
    });
    assert.deepEqual(parseGithubUrl("https://github.com/o/r/blob/main/README.md"), {
      kind: "blob", owner: "o", repo: "r", ref: "main", path: "README.md",
    });
    assert.ok("error" in parseGithubUrl("https://gitlab.com/o/r"));
    assert.ok("error" in parseGithubUrl("https://github.com/onlyowner"));
  });

  // ---- 4) buildRepoMarkdown ----
  await check("buildRepoMarkdown README 置首 + 路径为章节边界", () => {
    const out = buildRepoMarkdown([
      { path: "docs/b.md", text: "正文 B" },
      { path: "README.md", text: "仓库说明" },
      { path: "a.md", text: "正文 A" },
    ]);
    const blocks = out.split("\n\n");
    // 每个文件以路径标题开头，形成章节边界
    assert.equal(blocks[0], "# README.md");
    assert.equal(blocks[1], "仓库说明");
    assert.ok(out.includes("# docs/b.md"));
    assert.ok(out.includes("# a.md"));
  });

  await check("buildRepoMarkdown 空文件跳过", () => {
    const out = buildRepoMarkdown([{ path: "a.md", text: "  " }, { path: "b.md", text: "x" }]);
    assert.ok(!out.includes("a.md"));
    assert.ok(out.includes("# b.md"));
  });

  // ---- 5) pickMarkdownEntries ----
  await check("pickMarkdownEntries 前缀过滤 + 排除噪声目录 + 超限跳过", () => {
    const { files, skipped } = pickMarkdownEntries(REPO_TREE.tree as never, "docs", {
      maxCount: 60,
      maxBytes: LIMITS.githubFileBytes,
    });
    const paths = files.map((f) => f.path).sort();
    assert.deepEqual(paths, ["docs/01-intro.md", "docs/02-rag.md"]);
    assert.equal(skipped, 1); // docs/big.md 超 1MB
  });

  await check("pickMarkdownEntries 整库模式含 README 排除 node_modules", () => {
    const { files } = pickMarkdownEntries(REPO_TREE.tree as never, "", { maxCount: 60, maxBytes: 1e9 });
    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("README.md"));
    assert.ok(!paths.some((p) => p.startsWith("node_modules")));
  });

  await check("pickMarkdownEntries 超过上限抛 too-many-files", () => {
    assert.throws(
      () => pickMarkdownEntries(REPO_TREE.tree as never, "", { maxCount: 2, maxBytes: 1e9 }),
      (e: unknown) => e instanceof GithubImportError && e.kind === "too-many-files",
    );
  });

  // ---- 6) resolveGithubUrl / buildGithubUnit（mock fetch）----
  await check("resolveGithubUrl repo 预览含清单", async () => {
    const fetchImpl = mockFetch([
      { host: "api.github.com", pathname: "/repos/o/r", json: { full_name: "o/r", description: "desc", default_branch: "main" } },
      { host: "api.github.com", pathname: "/repos/o/r/git/trees/main", query: "recursive=1", json: REPO_TREE },
    ]);
    const p = await resolveGithubUrl(fetchImpl, "https://github.com/o/r");
    assert.equal(p.meta.fullName, "o/r");
    assert.equal(p.branch, "main");
    assert.ok(p.files.length >= 2);
    assert.ok(p.files.some((f) => f.path === "README.md"));
  });

  await check("resolveGithubUrl blob 目标绕过树接口", async () => {
    const fetchImpl = mockFetch([
      { host: "api.github.com", pathname: "/repos/o/r", json: { full_name: "o/r", default_branch: "main" } },
    ]);
    const p = await resolveGithubUrl(fetchImpl, "https://github.com/o/r/blob/main/docs/01.md");
    assert.equal(p.target.kind, "blob");
    assert.equal(p.files.length, 1);
    assert.equal(p.files[0].path, "docs/01.md");
  });

  await check("resolveGithubUrl blob 非 md 文件拒绝", async () => {
    const fetchImpl = mockFetch([
      { host: "api.github.com", pathname: "/repos/o/r", json: { full_name: "o/r", default_branch: "main" } },
    ]);
    const p = await resolveGithubUrl(fetchImpl, "https://github.com/o/r/blob/main/LICENSE").catch((e: unknown) => e);
    assert.ok(p instanceof GithubImportError);
    assert.equal((p as GithubImportError).kind, "invalid");
  });

  await check("resolveGithubUrl 私有/不存在仓库 → unavailable", async () => {
    const fetchImpl = mockFetch([{ host: "api.github.com", pathname: "/repos/o/r", status: 404 }]);
    const p = await resolveGithubUrl(fetchImpl, "https://github.com/o/r").catch((e: unknown) => e);
    assert.ok(p instanceof GithubImportError);
    assert.equal((p as GithubImportError).kind, "unavailable");
  });

  await check("buildGithubUnit blob 拉单文件为一份资料", async () => {
    const fetchImpl = mockFetch([
      { host: "api.github.com", pathname: "/repos/o/r", json: { full_name: "o/r", default_branch: "main" } },
      { host: "raw.githubusercontent.com", pathname: "/o/r/main/docs/01.md", text: "# 标题\n正文内容" },
    ]);
    const p = await resolveGithubUrl(fetchImpl, "https://github.com/o/r/blob/main/docs/01.md");
    const unit = await buildGithubUnit(fetchImpl, p);
    assert.equal(unit.title, "01");
    assert.ok(unit.text.includes("# 标题"));
    assert.equal(unit.splitFormat, "markdown");
  });

  await check("buildGithubUnit repo 并发拉取并合并", async () => {
    const fetchImpl = mockFetch([
      { host: "api.github.com", pathname: "/repos/o/r", json: { full_name: "o/r", default_branch: "main" } },
      { host: "api.github.com", pathname: "/repos/o/r/git/trees/main", query: "recursive=1", json: REPO_TREE },
      { host: "raw.githubusercontent.com", pathname: "/o/r/main/README.md", text: "仓库说明" },
      { host: "raw.githubusercontent.com", pathname: "/o/r/main/docs/01-intro.md", text: "# 第一章\n内容" },
      { host: "raw.githubusercontent.com", pathname: "/o/r/main/docs/02-rag.md", text: "# 第二章\n内容" },
    ]);
    const p = await resolveGithubUrl(fetchImpl, "https://github.com/o/r");
    const unit = await buildGithubUnit(fetchImpl, p);
    assert.equal(unit.format, "markdown");
    assert.ok(unit.text.includes("# docs/01-intro.md"));
    assert.ok(unit.text.startsWith("# README.md"));
  });

  await check("buildGithubUnit raw 网络级失败 → api contents 兜底", async () => {
    // raw 域名不可达（如中国大陆网络被阻断）：fetch 直接 reject → 走 api.github.com 兜底。
    const fetchImpl = mockFetch([
      { host: "api.github.com", pathname: "/repos/o/r", json: { full_name: "o/r", default_branch: "main" } },
      { host: "api.github.com", pathname: "/repos/o/r/git/trees/main", query: "recursive=1", json: REPO_TREE },
      { host: "raw.githubusercontent.com", netFail: true },
      { host: "api.github.com", pathname: "/repos/o/r/contents/README.md", query: "ref=main", text: "仓库说明（经 API 兜底）" },
      { host: "api.github.com", pathname: "/repos/o/r/contents/docs/01-intro.md", query: "ref=main", text: "# 第一章\n内容" },
      { host: "api.github.com", pathname: "/repos/o/r/contents/docs/02-rag.md", query: "ref=main", text: "# 第二章\n内容" },
    ]);
    const p = await resolveGithubUrl(fetchImpl, "https://github.com/o/r");
    const unit = await buildGithubUnit(fetchImpl, p);
    assert.ok(unit.text.includes("仓库说明（经 API 兜底）"));
    assert.ok(unit.text.includes("# docs/01-intro.md"));
  });

  await check("buildGithubUnit raw HTTP 404 → 不走 API 兜底", async () => {
    // raw 的 HTTP 状态错误是真实答复（省 API 配额）：404 直接计入失败。
    const fetchImpl = mockFetch([
      { host: "api.github.com", pathname: "/repos/o/r", json: { full_name: "o/r", default_branch: "main" } },
      { host: "api.github.com", pathname: "/repos/o/r/git/trees/main", query: "recursive=1", json: REPO_TREE },
      { host: "raw.githubusercontent.com", status: 404 },
    ]);
    const p = await resolveGithubUrl(fetchImpl, "https://github.com/o/r");
    const unit = await buildGithubUnit(fetchImpl, p).catch((e: unknown) => e);
    assert.ok(unit instanceof GithubImportError);
    assert.equal((unit as GithubImportError).kind, "fetch-failed");
  });

  // ---- 7) pipeline：注入内存后端 ----
  const mdUnit = (over: Partial<ImportUnit> = {}): ImportUnit => ({
    title: "样本",
    format: "markdown",
    splitFormat: "markdown",
    text: "# 第一章\n\n这是足够长的一段内容，用于切分出章节。\n本节持续展开，逐层深入地讲解核心概念与推导细节。".concat("本节持续展开，逐层深入地讲解核心概念与推导细节。".repeat(8), "\n\n## 小节甲\n\n继续正文，凑足段落。\n\n## 小节乙\n\n更多正文以形成多个段落结构。\n\n# 第二章\n\n第二章正文内容，同样需要足够长度。\n\n再来一段。\n本节持续展开，逐层深入地讲解核心概念与推导细节。").concat("本节持续展开，逐层深入地讲解核心概念与推导细节。".repeat(8), "\n"),
    ...over,
  });

  await check("runUnitImport md 有结构 → 切章并落库", async () => {
    const s = new InMemoryStorage();
    const r = await runUnitImport(mdUnit(), { storage: s });
    assert.ok(r.chapterIds.length >= 2);
    assert.equal(r.chapterTitles.length, r.chapterIds.length);
    assert.ok(r.totalPoints >= 0);
    assert.equal((await s.listDocuments()).length, 1);
    const chapters = await s.listChapters(r.docId);
    assert.equal(chapters.length, r.chapterIds.length);
  });

  await check("runUnitImport 无结构正文 → 仅保存 0 章", async () => {
    const s = new InMemoryStorage();
    const r = await runUnitImport(mdUnit({ text: "", title: "空文" }), { storage: s });
    assert.equal(r.chapterIds.length, 0);
    assert.equal((await s.listDocuments()).length, 1);
    assert.equal((await s.listChapters(r.docId)).length, 0);
  });

  await check("runUnitImport 空标题回退 Untitled", async () => {
    const s = new InMemoryStorage();
    const r = await runUnitImport(mdUnit({ title: "   " }), { storage: s });
    const doc = (await s.listDocuments()).find((d) => d.id === r.docId);
    assert.equal(doc?.title, "Untitled");
  });

  await check("runBatchImport 单份失败不阻断其它", async () => {
    // saveDocument 对 title 含 "fail" 的文档抛错 → 该份进入 failed，其它正常。
    class FlakyStorage extends InMemoryStorage {
      override async saveDocument(doc: { title: string }): Promise<void> {
        if (doc.title.includes("fail")) throw new Error("模拟写入失败");
        return super.saveDocument(doc as never);
      }
    }
    const s = new FlakyStorage();
    const summary = await runBatchImport(
      [mdUnit({ title: "ok-1" }), mdUnit({ title: "fail-2" }), mdUnit({ title: "ok-3" })],
      { storage: s },
    );
    assert.equal(summary.ok.length, 2);
    assert.equal(summary.failed.length, 1);
    assert.equal(summary.failed[0].title, "fail-2");
    assert.equal((await s.listDocuments()).length, 2);
  });

  // ---- 8) stripMarkdownNoise：markdown 噪音清洗（README 图片残留案例） ----
  await check("stripMarkdownNoise：图片保留 alt 文字，纯装饰图清空", () => {
    assert.equal(
      stripMarkdownNoise("看 ![架构图](https://example.com/a.png) 这张图"),
      "看 架构图 这张图",
    );
    assert.equal(stripMarkdownNoise("- ![](https://x.y/b.png)"), "");
    assert.equal(stripMarkdownNoise("![覆盖说明](local/path.png)"), "覆盖说明");
  });

  await check("stripMarkdownNoise：链接保文字去 URL，HTML img 删除", () => {
    assert.equal(
      stripMarkdownNoise("参见 [官方文档](https://docs.example.com) 与 <img src=\"x.gif\" /> 结束"),
      "参见 官方文档 与  结束",
    );
  });

  await check("stripMarkdownNoise：纯装饰图残留的空 bullet 行删除（带 alt 的保留文字）", () => {
    assert.equal(
      stripMarkdownNoise("- ![](https://x.y/b.png)\n- 保留项\n- ![logo](x)\n"),
      "- 保留项\n- logo\n",
    );
  });

  await check("stripMarkdownNoise：HTML 样式壳剥标签保内容，script/style 连内容删除", () => {
    // 线上案例：README 标题区的排版 div 以字面文本混进正文（截图 `<div align="center">`）。
    const md = [
      "<div align=\"center\">",
      "# Advanced RAG Techniques",
      "",
      "A community-driven hub of notebooks.",
      "</div>",
    ].join("\n");
    const out = stripMarkdownNoise(md);
    assert.ok(!out.includes("<div"), "开标签不应残留");
    assert.ok(!out.includes("</div>"), "闭标签不应残留");
    assert.ok(out.includes("Advanced RAG Techniques"), "壳内标题内容应保留");
    assert.ok(out.includes("A community-driven hub"), "壳内正文内容应保留");

    // `<br>` 转换行（剥壳后前后行不拼接）；script/style 连内容整段删除。
    assert.equal(stripMarkdownNoise("第一行<br>第二行"), "第一行\n第二行");
    assert.equal(stripMarkdownNoise("前<script>var x = 1;</script>后"), "前后");
    assert.equal(stripMarkdownNoise("<style>.a { color: red }</style>正文"), "正文");
    assert.equal(stripMarkdownNoise('跨行属性\n<div\n  align="center">\n内容'), "跨行属性\n\n内容");

    // ``` 围栏内的 HTML 教学示例不受剥壳影响（网页导入 pushPre 的代码块同口径）。
    const fenced = "说明：\n\n```html\n<div align=\"center\">示例</div>\n```\n\n<div>壳外</div>";
    const fencedOut = stripMarkdownNoise(fenced);
    assert.ok(fencedOut.includes('<div align="center">示例</div>'), "围栏内标签应原样保留");
    assert.ok(!fencedOut.includes("<div>壳外</div>") && fencedOut.includes("壳外"), "围栏外照常剥壳保内容");
  });

  await check("stripMarkdownNoise：普通文本 / 代码块不误伤", () => {
    const plain = "# 标题\n\n正文段落，含 [a](b) 吗？";
    assert.equal(stripMarkdownNoise(plain), "# 标题\n\n正文段落，含 a 吗？");
    assert.equal(stripMarkdownNoise(""), "");
  });

  await check("runUnitImport：markdown 来源入库正文不含图片语法（管道接线）", async () => {
    const s = new InMemoryStorage();
    const r = await runUnitImport(
      mdUnit({ title: "img-noise", text: "# 章\n\n- ![banner](https://x.y/b.png)\n\n正文一段。\n\n正文两段。\n\n正文三段。" }),
      { storage: s },
    );
    const doc = (await s.listDocuments()).find((d) => d.id === r.docId);
    assert.ok(doc?.textPreview);
    assert.ok(!doc.textPreview.includes("![banner]"), "图片语法不应残留在入库正文");
    assert.ok(doc.textPreview.includes("正文一段"), "正常正文不受影响");
  });

  await check("stripMarkdownNoise：badge 行整行删除、引用式图片保 alt、定义行与 HTML 注释删除（T3）", () => {
    const md = [
      "<!-- 协作说明注释 -->",
      "[![Build](https://img.shields.io/x.svg)](https://ci.example.com) [![Cov](https://img.shields.io/y.svg)](https://cov.example.com)",
      "正文开始。",
      "![徽标][logo-ref]",
      "",
      "[logo-ref]: https://example.com/logo.png",
    ].join("\n");
    const out = stripMarkdownNoise(md);
    assert.ok(!out.includes("shields.io"), "纯 badge 行应整行删除");
    assert.ok(!out.includes("<!--"), "HTML 注释应删除");
    assert.ok(!out.includes("logo-ref"), "引用式定义行应删除");
    assert.ok(out.includes("徽标"), "引用式图片保留 alt 文字");
    assert.ok(out.includes("正文开始"), "普通文本不受影响");
  });

  await check("runUnitImport onDuplicate=skip：同 source 已存在 → 不写入并标记（T4/D1）", async () => {
    const s = new InMemoryStorage();
    const first = await runUnitImport(mdUnit({ source: "github://demo" }), { storage: s });
    assert.ok(!first.skippedAsDuplicate);
    const second = await runUnitImport(mdUnit({ source: "github://demo" }), {
      storage: s,
      onDuplicate: "skip",
    });
    assert.equal(second.skippedAsDuplicate, true);
    assert.equal(second.docId, first.docId, "docId 应指向已存在的旧资料");
    assert.equal((await s.listDocuments()).length, 1, "不应产生新资料");
  });

  await check("runUnitImport onDuplicate=overwrite：级联删旧后重建（T4/D1）", async () => {
    const s = new InMemoryStorage();
    await runUnitImport(mdUnit({ source: "github://demo" }), { storage: s });
    const again = await runUnitImport(mdUnit({ source: "github://demo", title: "覆盖版" }), {
      storage: s,
      onDuplicate: "overwrite",
    });
    assert.ok(!again.skippedAsDuplicate);
    const docs = await s.listDocuments();
    assert.equal(docs.length, 1, "旧资料应被级联删除");
    assert.equal(docs[0]?.title, "覆盖版");
    assert.ok((await s.listChapters(again.docId)).length >= 1, "新章节应写入");
  });

  await check("runUnitImport 缺省（create）：同 source 仍新建，现状行为不回归（T4/D1）", async () => {
    const s = new InMemoryStorage();
    await runUnitImport(mdUnit({ source: "github://demo" }), { storage: s });
    await runUnitImport(mdUnit({ source: "github://demo" }), { storage: s });
    assert.equal((await s.listDocuments()).length, 2);
  });

  await check("runBatchImport：skip 的份进 summary.skipped，不进 ok（T4/D1）", async () => {
    const s = new InMemoryStorage();
    await runUnitImport(mdUnit({ source: "s1" }), { storage: s });
    const out = await runBatchImport(
      [mdUnit({ source: "s1", title: "dup" }), mdUnit({ source: "s2", title: "fresh" })],
      { storage: s, onDuplicate: "skip" },
    );
    assert.equal(out.ok.length, 1);
    assert.equal(out.skipped.length, 1);
    assert.equal(out.skipped[0]?.title, "dup");
    assert.equal((await s.listDocuments()).length, 2);
  });

  console.log(results.join("\n"));
  console.log(`\nimport-core: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
};

void run();
