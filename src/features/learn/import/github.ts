/**
 * GitHub 公开仓库导入适配器（整库/子目录/单文件 md）。
 *
 * 链路：URL 解析 → 仓库元信息（default_branch）→ git trees 递归文件树 →
 * 过滤 Markdown → raw.githubusercontent.com 并行拉取 → 合并为一份 Markdown。
 *
 * 设计要点（docs/knowledge-import-design-2026-09.md §4.2）：
 * - 仅公开仓库（无 token）；api.github.com 未认证限流 60 次/时 → trees 只调 1 次，
 *   单文件走 raw CDN（不受同一配额限制），并发上限 4；
 * - 纯函数（parseGithubUrl / buildRepoMarkdown）+ 可注入 fetch 的薄封装，
 *   便于 node 单测 mock（不依赖真实网络，避免 CI 限流）；
 * - 体积护栏集中在 LIMITS（types.ts），超限不静默截断、给出可读错误。
 */
import { LIMITS } from "./types";
import type { ImportUnit } from "./types";
/** 可注入的 fetch（默认浏览器/Node 全局 fetch；单测替换为 mock）。 */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type GhErrorKind =
  | "invalid"          // URL 无法解析 / 非 github.com
  | "unavailable"      // 仓库不存在或为私有（匿名 API 对两者都返回 404）
  | "network"          // 网络失败 / 超时
  | "rate-limit"       // API 限流（未认证 60/h/IP）
  | "too-many-files"   // md 文件数超过护栏
  | "merged-too-large" // 合并正文超过字符护栏
  | "empty";           // 目标范围内没有任何 md

export class GithubImportError extends Error {
  readonly kind: GhErrorKind;
  constructor(kind: GhErrorKind, message: string) {
    super(message);
    this.name = "GithubImportError";
    this.kind = kind;
  }
}

/** GitHub 链接解析结果：三类目标。 */
export type GhTarget =
  | { kind: "repo"; owner: string; repo: string }
  | { kind: "tree"; owner: string; repo: string; ref: string; path: string }
  | { kind: "blob"; owner: string; repo: string; ref: string; path: string };

/** 仓库元信息（listMarkdownFiles / 预览卡用）。 */
export interface GhRepoMeta {
  fullName: string;
  description?: string;
  defaultBranch: string;
}

export interface MdFileRef {
  /** 仓库内相对路径（含文件名，如 docs/01-intro.md）。 */
  path: string;
  /** trees 返回的 blob size（bytes）。 */
  size: number;
}

export interface MdFileContent extends MdFileRef {
  text: string;
}

/** 解析 github.com 链接。支持：仓库根 / tree 子目录 / blob 单文件。 */
export function parseGithubUrl(raw: string): GhTarget | { error: GhErrorKind } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: "invalid" };
  }
  if (url.hostname !== "github.com") return { error: "invalid" };
  const seg = url.pathname.split("/").filter(Boolean); // 去空段（首尾斜杠）
  // github.com/owner/repo[/tree|blob/ref[/path…]] ；owner 单独一段视作无效
  if (seg.length < 2) return { error: "invalid" };
  const [owner, repo] = seg;
  if (seg.length === 2) return { kind: "repo", owner, repo };
  const [verb, ref, ...rest] = seg.slice(2);
  if (!ref) return { error: "invalid" };
  if (verb === "tree") {
    return { kind: "tree", owner, repo, ref, path: rest.join("/") };
  }
  if (verb === "blob") {
    return { kind: "blob", owner, repo, ref, path: rest.join("/") };
  }
  return { error: "invalid" };
}

/* ---------------------------------------------------------------- */
/* HTTP 薄封装（可注入 fetch）                                        */
/* ---------------------------------------------------------------- */

/** 段编码：path 中每段独立 encode，保留 "/" 分隔。 */
function encodeSegments(p: string): string {
  return p
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
}

/** 统一把响应错误映射为 GhErrorKind。 */
async function mapError(url: string, res: Response): Promise<never> {
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    throw new GithubImportError("rate-limit", "GitHub API 限流（未认证 60 次/时），请稍后重试。");
  }
  if (res.status === 404) {
    throw new GithubImportError("unavailable", "仓库不存在或为私有仓库。");
  }
  throw new GithubImportError(
    "network",
    `GitHub 请求失败（HTTP ${res.status}）：${url}`,
  );
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Accept: "application/vnd.github+json" } });
  } catch (err) {
    throw new GithubImportError(
      "network",
      `GitHub 请求失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) return mapError(url, res);
  return res.json() as Promise<unknown>;
}

/** 拉取仓库元信息（default_branch / 描述）。仅 repo/tree 预览与默认分支解析需要。 */
export async function fetchRepoMeta(
  fetchImpl: FetchLike,
  owner: string,
  repo: string,
): Promise<GhRepoMeta> {
  const raw = await getJson(fetchImpl, `https://api.github.com/repos/${encodeSegments(`${owner}/${repo}`)}`);
  const record = raw as { full_name?: unknown; description?: unknown; default_branch?: unknown };
  const fullName = typeof record.full_name === "string" ? record.full_name : `${owner}/${repo}`;
  const defaultBranch =
    typeof record.default_branch === "string" ? record.default_branch : "HEAD";
  return {
    fullName,
    ...(typeof record.description === "string" && record.description ? { description: record.description } : {}),
    defaultBranch,
  };
}

/** 树接口返回的一条 entry。 */
interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

/** 判断是否属于目标前缀（子目录导入：路径 == prefix 或以 prefix/ 开头）。 */
function underPrefix(path: string, prefix: string): boolean {
  return prefix === "" || path === prefix || path.startsWith(`${prefix}/`);
}

const MD_RE = /\.(md|markdown|mdx)$/i;
/** 常见噪声目录（合并时排除，避免把依赖/构建产物当学习资料）。 */
const EXCLUDED_DIRS = new Set(["node_modules", ".git", ".github", "vendor", "dist", "build", "coverage", "target"]);

/** 从 git trees 递归响应中过滤出目标范围内的 Markdown blob。 */
export function pickMarkdownEntries(
  tree: TreeEntry[],
  prefix: string,
  limits: { maxCount: number; maxBytes: number } = {
    maxCount: LIMITS.githubFileCount,
    maxBytes: LIMITS.githubFileBytes,
  },
): { files: MdFileRef[]; skipped: number } {
  const files: MdFileRef[] = [];
  let skipped = 0;
  for (const entry of tree) {
    if (entry.type !== "blob") continue;
    const { path } = entry;
    if (!underPrefix(path, prefix)) continue;
    if (!MD_RE.test(path)) continue;
    const firstDir = path.split("/")[0];
    if (EXCLUDED_DIRS.has(firstDir) && path.includes("/")) continue;
    // 顶层入口在仓库根下不排除（根 README 之类）；嵌套在噪声目录下的整个跳过。
    if (path.includes("/") && path.split("/").slice(0, -1).some((d) => EXCLUDED_DIRS.has(d))) continue;
    if (entry.size !== undefined && entry.size > limits.maxBytes) {
      skipped += 1;
      continue;
    }
    files.push({ path, size: entry.size ?? 0 });
    if (files.length > limits.maxCount) {
      throw new GithubImportError(
        "too-many-files",
        `Markdown 文件超过上限（${limits.maxCount}），请改用子目录或单文件链接。`,
      );
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}

/** 拉取目标范围内的 Markdown 文件清单。repo 目标需先解析 default_branch。 */
export async function listMarkdownFiles(
  fetchImpl: FetchLike,
  owner: string,
  repo: string,
  ref: string,
  prefix: string,
): Promise<{ files: MdFileRef[]; skipped: number; branch: string }> {
  const url = `https://api.github.com/repos/${encodeSegments(`${owner}/${repo}`)}/git/trees/${encodeSegments(ref)}?recursive=1`;
  const raw = await getJson(fetchImpl, url);
  const record = raw as { tree?: unknown; truncated?: unknown };
  if (!Array.isArray(record.tree)) {
    throw new GithubImportError("unavailable", "GitHub 未返回文件树（仓库可能为空或过深）。");
  }
  return { ...pickMarkdownEntries(record.tree as TreeEntry[], prefix), branch: ref };
}

/** 拉取单个文件原文（raw.githubusercontent.com；目标文件超护栏在此也兜底）。 */
export async function fetchRawText(
  fetchImpl: FetchLike,
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<string> {
  const url = `https://raw.githubusercontent.com/${encodeSegments(`${owner}/${repo}/${ref}/${path}`)}`;
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    throw new GithubImportError(
      "network",
      `文件拉取失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) return mapError(url, res);
  const text = await res.text();
  if (text.length > LIMITS.githubTotalChars) {
    throw new GithubImportError("merged-too-large", "单文件超出合并文本上限，请改用子目录导入。");
  }
  return text;
}

/** 并发拉取一批文件（默认并发 4），逐文件容错（失败 → 计入 failed 不中断整体）。 */
export async function fetchMdContents(
  fetchImpl: FetchLike,
  owner: string,
  repo: string,
  ref: string,
  files: readonly MdFileRef[],
  concurrency = 4,
): Promise<{ contents: MdFileContent[]; failed: MdFileRef[] }> {
  const contents: MdFileContent[] = [];
  const failed: MdFileRef[] = [];
  let next = 0;
  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= files.length) return;
      const file = files[i];
      try {
        const text = await fetchRawText(fetchImpl, owner, repo, ref, file.path);
        contents.push({ ...file, text });
      } catch {
        failed.push(file);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, files.length)) }, () => worker()),
  );
  // 保持与清单一致的排序（README 置首逻辑见 buildRepoMarkdown）。
  contents.sort((a, b) => a.path.localeCompare(b.path));
  return { contents, failed };
}

/* ---------------------------------------------------------------- */
/* 合并（纯函数，可单测）                                             */
/* ---------------------------------------------------------------- */

/** 是否根目录 README（不区分大小写；合并时置首，作为「仓库总纲」）。 */
function isRootReadme(path: string): boolean {
  return /^readme(\.md|\.markdown|\.mdx)?$/i.test(path);
}

/**
 * 合并规则（docs/knowledge-import-design-2026-09.md UC-03）：
 * 每个文件前插入一行 `# <相对路径>` 作为章节边界（splitDocument 按 #/## 切分），
 * 根 README.md 置首作为资料开篇；文件内原有 #/## 标题保留（多切一层不破坏阅读顺序，
 * 由 AI 精修/人工合并兜底过碎章节）。
 */
export function buildRepoMarkdown(files: readonly { path: string; text: string }[]): string {
  const ordered = [...files].sort((a, b) => {
    const ra = isRootReadme(a.path) ? 0 : 1;
    const rb = isRootReadme(b.path) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.path.localeCompare(b.path);
  });
  const parts: string[] = [];
  for (const f of ordered) {
    const body = f.text.trim();
    if (!body) continue;
    parts.push(`# ${f.path}\n\n${body}`);
  }
  return parts.join("\n\n");
}

/* ---------------------------------------------------------------- */
/* 高层编排（GithubPanel / pipeline 调用）                            */
/* ---------------------------------------------------------------- */

/** 解析完成后供 UI 预览卡展示的会话状态。 */
export interface GithubPreview {
  /** 原始输入链接（source 溯源用）。 */
  sourceUrl: string;
  /** 解析出的目标（repo | tree | blob）。 */
  target: GhTarget;
  /** 元信息（fullName / description / defaultBranch）。 */
  meta: GhRepoMeta;
  /** 实际内容分支（repo→defaultBranch；tree/blob→链接里的 ref）。 */
  branch: string;
  /** tree 子目录前缀（repo/blob 为空）。 */
  prefix: string;
  /** 范围内 md 清单（blob：单文件占位，size 未知给 0，导入时实测）。 */
  files: MdFileRef[];
  /** 因超 1MB 护栏被跳过的文件数（blob 恒 0）。 */
  skipped: number;
}

/**
 * 解析 GitHub 链接并拉取文件清单（不做正文拉取，供预览卡展示）。
 *
 * 流程：parseGithubUrl → fetchRepoMeta（拿 default_branch / 描述）→
 * listMarkdownFiles（repo/tree）或 直接构造单文件（blob，绕过 60 上限）。
 * 私有/不存在仓库（404）→ unavailable；文件数超护栏 → too-many-files。
 */
export async function resolveGithubUrl(
  fetchImpl: FetchLike,
  rawUrl: string,
): Promise<GithubPreview> {
  const parsed = parseGithubUrl(rawUrl);
  if ("error" in parsed) {
    throw new GithubImportError(
      parsed.error,
      parsed.error === "invalid"
        ? "无法解析该链接：请粘贴公开 github.com 仓库 / 子目录 / 单文件链接。"
        : "该链接不受支持。",
    );
  }
  const { owner, repo } = parsed;
  const meta = await fetchRepoMeta(fetchImpl, owner, repo);

  if (parsed.kind === "repo") {
    const { files, skipped } = await listMarkdownFiles(fetchImpl, owner, repo, meta.defaultBranch, "");
    if (files.length === 0) {
      throw new GithubImportError("empty", "该仓库内没有可导入的 Markdown 文件。");
    }
    return {
      sourceUrl: rawUrl,
      target: parsed,
      meta,
      branch: meta.defaultBranch,
      prefix: "",
      files,
      skipped,
    };
  }

  if (parsed.kind === "tree") {
    const { files, skipped, branch } = await listMarkdownFiles(
      fetchImpl, owner, repo, parsed.ref, parsed.path,
    );
    if (files.length === 0) {
      throw new GithubImportError("empty", "该目录下没有 Markdown 文件，请改用整库或单文件链接。");
    }
    return {
      sourceUrl: rawUrl,
      target: parsed,
      meta,
      branch,
      prefix: parsed.path,
      files,
      skipped,
    };
  }

  // blob：单文件（绕过 60 上限）。文件存在性/大小在导入拉取时实测。
  if (!MD_RE.test(parsed.path)) {
    throw new GithubImportError(
      "invalid",
      "该链接不是 Markdown 文件：请粘贴 .md 文件链接（如 …/blob/main/README.md）。",
    );
  }
  return {
    sourceUrl: rawUrl,
    target: parsed,
    meta,
    branch: parsed.ref,
    prefix: parsed.path,
    files: [{ path: parsed.path, size: 0 }],
    skipped: 0,
  };
}

/** 预览卡用的标题（repo→owner/repo；tree→父目录名；blob→文件名去扩展）。 */
export function githubPreviewTitle(p: GithubPreview): string {
  const { target } = p;
  if (target.kind === "repo") return p.meta.fullName;
  if (target.kind === "blob") {
    const seg = target.path.split("/");
    return (seg[seg.length - 1] ?? target.path).replace(/\.(md|markdown|mdx)$/i, "");
  }
  // tree：取子目录末段
  const seg = p.prefix.split("/").filter(Boolean);
  const last = seg[seg.length - 1];
  return last ? `${p.meta.fullName} · ${last}` : p.meta.fullName;
}

/**
 * 按预览会话拉取正文并构建「一份资料」ImportUnit。
 *
 * - repo/tree：并发拉取清单内各 md → 合并 Markdown（文件路径为章节边界）；
 * - blob：拉取单文件原文（校验 ≤1MB / 非空）；
 * - 合并文本超总字符护栏 → merged-too-large。
 */
export async function buildGithubUnit(
  fetchImpl: FetchLike,
  p: GithubPreview,
): Promise<ImportUnit> {
  const { owner, repo } = p.target;
  if (p.target.kind === "blob") {
    const text = await fetchRawText(fetchImpl, owner, repo, p.branch, p.prefix);
    if (!text.trim()) {
      throw new GithubImportError("empty", "该文件为空，没有可导入内容。");
    }
    return {
      title: githubPreviewTitle(p),
      format: "markdown",
      splitFormat: "markdown",
      text,
      source: p.sourceUrl,
    };
  }

  const { contents, failed } = await fetchMdContents(
    fetchImpl, owner, repo, p.branch, p.files,
  );
  if (contents.length === 0) {
    throw new GithubImportError(
      "empty",
      failed.length > 0 ? "Markdown 拉取全部失败，请检查网络后重试。" : "没有可导入的 Markdown 内容。",
    );
  }
  const text = buildRepoMarkdown(contents);
  if (text.length > LIMITS.githubTotalChars) {
    throw new GithubImportError(
      "merged-too-large",
      `合并文本超过大小上限（${Math.round(LIMITS.githubTotalChars / 10_000) / 100} 万字符），请改用子目录或单文件链接。`,
    );
  }
  return {
    title: githubPreviewTitle(p),
    format: "markdown",
    splitFormat: "markdown",
    text,
    source: p.sourceUrl,
  };
}
