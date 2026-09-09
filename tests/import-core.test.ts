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

/** 可注入 fetch：按 host + pathname（+query 子串）精确路由返回 JSON/文本。 */
function mockFetch(routes: { host: string; pathname: string; query?: string; json?: unknown; text?: string; status?: number }[]) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    for (const r of routes) {
      if (url.hostname !== r.host || url.pathname !== r.pathname) continue;
      if (r.query && !url.search.includes(r.query)) continue;
      const status = r.status ?? 200;
      if (r.json !== undefined) {
        return new Response(JSON.stringify(r.json), { status, headers: { "content-type": "application/json" } });
      }
      if (r.text !== undefined) {
        return new Response(r.text, { status, headers: { "content-type": "text/plain" } });
      }
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
  await check("classify md / pdf / unsupported", () => {
    assert.deepEqual(classifyLocalFile({ name: "a.md", size: 100 }), { kind: "md", overLimit: false });
    assert.deepEqual(classifyLocalFile({ name: "b.markdown", size: 100 }), { kind: "md", overLimit: false });
    assert.deepEqual(classifyLocalFile({ name: "c.PDF", size: 100 }), { kind: "pdf", overLimit: false });
    assert.deepEqual(classifyLocalFile({ name: "d.docx", size: 100 }), { error: "unsupported" });
  });

  await check("classify 大小护栏（md>1MB / pdf>30MB）", () => {
    assert.equal(classifyLocalFile({ name: "a.md", size: LIMITS.localMdBytes + 1 }).overLimit, true);
    assert.equal(classifyLocalFile({ name: "b.md", size: LIMITS.localMdBytes }).overLimit, false);
    assert.equal(classifyLocalFile({ name: "c.pdf", size: LIMITS.localPdfBytes + 1 }).overLimit, true);
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

  // ---- 7) pipeline：注入内存后端 ----
  const mdUnit = (over: Partial<ImportUnit> = {}): ImportUnit => ({
    title: "样本",
    format: "markdown",
    splitFormat: "markdown",
    text: "# 第一章\n\n这是足够长的一段内容，用于切分出章节。\n\n## 小节甲\n\n继续正文，凑足段落。\n\n## 小节乙\n\n更多正文以形成多个段落结构。\n\n# 第二章\n\n第二章正文内容，同样需要足够长度。\n\n再来一段。\n",
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

  console.log(results.join("\n"));
  console.log(`\nimport-core: ${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
};

void run();
