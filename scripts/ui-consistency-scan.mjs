#!/usr/bin/env node
/**
 * UI 一致性扫描器 —— skills/plos-ui-system 的可执行判据。
 *
 * 为什么要有这个脚本：本仓库禁止主动起浏览器做视觉校验
 * （rules/no-headless-browser-validation），所以「同一个视觉模式是不是又被人手写了
 * 第三遍」这件事只能靠静态扫描判定。没有它，「复用 > 2 处必须抽取」就只是一句口号。
 *
 * 扫描三类问题：
 *   1) 重复类串：跨文件重复的 n 元 utility 序列（默认 n=4）→ 抽取候选
 *   2) 硬编码调色板色：text-slate-500 / bg-indigo-600 等绕过 main.css token 的写法
 *   3) focus 环分布：ring-ring/NN 的透明度取值分布 → 应收敛到唯一值 /50
 *   附：裸字号 text-[Npx] 分布
 *
 * 用法：
 *   node scripts/ui-consistency-scan.mjs                    # 出报告，退出码恒 0
 *   node scripts/ui-consistency-scan.mjs --top=25           # 重复类串取前 25 条
 *   node scripts/ui-consistency-scan.mjs --gram=5           # n-gram 长度调整为 5
 *   node scripts/ui-consistency-scan.mjs --min-files=4      # 只报跨 ≥4 文件的模式
 *   node scripts/ui-consistency-scan.mjs --fail-on=3        # 存在跨 ≥3 文件模式 → 退出码 1
 *   node scripts/ui-consistency-scan.mjs --json             # 机器可读输出
 *
 * 退出码：0 = 报告模式（或达标）；1 = 命中 --fail-on 阈值；2 = 参数/运行错误。
 *
 * 已知局限（有意为之的启发式，不是精确解析）：
 *   - 不做 AST 解析，只抽取源码里的字符串字面量，因此理论上会有「像 utility 其实不是」
 *     的噪声（import 路径已显式剔除，其余靠 n-gram 至少 4 连来压制）；
 *   - 同一模式串写法不同（如顺序调换）会被算成两条，故本脚本用于「发现候选」而非「定罪」，
 *     最终是否抽取由人按 references/extraction-playbook.md 判定。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** 默认扫描根目录（相对仓库根）。 */
const DEFAULT_ROOT = "src";
/** 这些路径永远不扫。 */
const ALWAYS_IGNORE = ["node_modules", "dist", "dist-ssr", "src-tauri", ".git", "coverage"];
/** 允许作为 utility 的「裸」类名（不含连字符）。 */
const BARE_UTILITIES = new Set([
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "block",
  "inline",
  "inline-block",
  "hidden",
  "relative",
  "absolute",
  "fixed",
  "sticky",
  "static",
  "truncate",
  "italic",
  "underline",
  "uppercase",
  "lowercase",
  "capitalize",
  "container",
  "isolate",
  "transform",
  "antialiased",
  "overflow-hidden",
  "overflow-auto",
  "whitespace-nowrap",
  "whitespace-pre-wrap",
  "pointer-events-none",
  "pointer-events-auto",
  "sr-only",
  "transition",
  "transition-colors",
  "transition-opacity",
  "shadow-sm",
  "shadow",
  "w-full",
  "h-full",
  "cursor-not-allowed",
  "cursor-pointer",
]);

/** 被禁止的 Tailwind 调色板色族（应改用 main.css 的语义 token）。 */
const BANNED_RAMP =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const BANNED_RE = new RegExp(
  `(?:text|bg|border|ring|from|to|via|decoration|outline|divide|shadow|fill|stroke)-(?:${BANNED_RAMP})-\\d{2,3}(?:/\\d+)?`,
  "g",
);

/** @param {string[]} argv */
function parseArgs(argv) {
  const opts = {
    root: DEFAULT_ROOT,
    gram: 4,
    minFiles: 3,
    top: 20,
    failOn: null,
    json: false,
  };
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`无法识别的参数：${arg}`);
    const [, key, raw] = m;
    const value = raw ?? "true";
    switch (key) {
      case "root":
        opts.root = value;
        break;
      case "gram":
        opts.gram = Number(value);
        break;
      case "min-files":
        opts.minFiles = Number(value);
        break;
      case "top":
        opts.top = Number(value);
        break;
      case "fail-on":
        opts.failOn = Number(value);
        break;
      case "json":
        opts.json = value !== "false";
        break;
      case "help":
        opts.help = true;
        break;
      default:
        throw new Error(`未知参数：--${key}`);
    }
  }
  if (!Number.isInteger(opts.gram) || opts.gram < 2) throw new Error("--gram 必须是 ≥2 的整数");
  if (!Number.isInteger(opts.minFiles) || opts.minFiles < 2)
    throw new Error("--min-files 必须是 ≥2 的整数");
  return opts;
}

/**
 * 递归收集源码文件。
 * @param {string} dir
 * @param {string[]} out
 */
function collectFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (ALWAYS_IGNORE.includes(name)) continue;
    const full = join(dir, name);
    const st = statSync(full, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) collectFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * 抽取源码里的字符串字面量，跳过单行/块注释。
 * @param {string} src
 * @returns {{value: string, before: string, index: number}[]}
 */
function stringLiterals(src) {
  /** 注释在前，避免把注释正文当成 class 串。 */
  const re =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|`((?:[^`\\]|\\.)*)`|"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g;
  const found = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const value = m[1] ?? m[2] ?? m[3];
    if (value === undefined) continue;
    found.push({ value, before: src.slice(Math.max(0, m.index - 12), m.index), index: m.index });
  }
  return found;
}

/** import / require 的模块路径不是类名，剔除。 */
function isModuleSpecifier(before) {
  return /(?:from|import|require|export)\s*\(?\s*$/.test(before);
}

/** @param {string} token */
function looksLikeUtility(token) {
  if (!token) return false;
  if (BARE_UTILITIES.has(token)) return true;
  if (!token.includes("-")) return false;
  const head = token.includes(":") ? token.slice(token.lastIndexOf(":") + 1) : token;
  return /^[a-z][a-z0-9]*(?:-[a-z0-9.[\]/%#()]+)+$/.test(head);
}

/**
 * 把一段 class 字符串拆成 utility token 序列。
 * @param {string} raw
 */
function tokenize(raw) {
  // 模板串里的插值先抹掉，避免 `${isActive ? "a" : "b"}` 污染 token 流
  const cleaned = raw.replace(/\$\{[^}]*\}/g, " ").replace(/\\./g, " ");
  return cleaned.split(/\s+/).filter(looksLikeUtility);
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (src[i] === "\n") line += 1;
  return line;
}

/**
 * 扫描一个文件，返回结构化结果。
 * @param {string} file
 * @param {number} gramSize
 */
function scanFile(file, gramSize) {
  const src = readFileSync(file, "utf8");
  const grams = new Set();
  const banned = [];
  const rings = [];
  const rawSizes = [];

  for (const lit of stringLiterals(src)) {
    if (isModuleSpecifier(lit.before)) continue;
    const tokens = tokenize(lit.value);
    for (let i = 0; i + gramSize <= tokens.length; i += 1) {
      grams.add(tokens.slice(i, i + gramSize).join(" "));
    }
  }

  let m;
  BANNED_RE.lastIndex = 0;
  while ((m = BANNED_RE.exec(src)) !== null) {
    banned.push({ cls: m[0], line: lineOf(src, m.index) });
  }
  const ringRe = /ring-ring\/(\d+)/g;
  while ((m = ringRe.exec(src)) !== null) {
    rings.push({ alpha: m[1], line: lineOf(src, m.index) });
  }
  const sizeRe = /text-\[(\d+)px\]/g;
  while ((m = sizeRe.exec(src)) !== null) {
    rawSizes.push({ px: m[1], line: lineOf(src, m.index) });
  }

  return { file, grams, banned, rings, rawSizes };
}

/** @param {string} file */
function layerOf(file) {
  return file.includes(`${sep}components${sep}ui${sep}`) ? "L1 UI Kit" : "业务层";
}

/** @param {Map<string, Set<string>>} gramFiles */
function topGrams(gramFiles, minFiles, top) {
  return [...gramFiles.entries()]
    .filter(([, files]) => files.size >= minFiles)
    .map(([gram, files]) => ({ gram, count: files.size, files: [...files].sort() }))
    .sort((a, b) => b.count - a.count || a.gram.localeCompare(b.gram))
    .slice(0, top);
}

function renderMarkdown(report, opts) {
  const lines = [];
  const p = (s = "") => lines.push(s);
  p(`# PLOS UI 一致性扫描报告`);
  p();
  p(`- 根目录：\`${opts.root}\``);
  p(`- 扫描文件：${report.fileCount} 个`);
  p(`- n-gram：${opts.gram}；跨文件阈值：≥${opts.minFiles}；Top：${opts.top}`);
  p();

  p(`## 1. 重复类串（抽取候选）`);
  if (report.grams.length === 0) {
    p(`无跨 ≥${opts.minFiles} 个文件的重复模式。`);
  } else {
    p(`| # | 模式串 | 命中文件数 | 示例文件 |`);
    p(`|---|--------|-----------|----------|`);
    report.grams.forEach((g, i) => {
      const sample = g.files[0];
      p(`| ${i + 1} | \`${g.gram}\` | ${g.count} | \`${sample}\` |`);
    });
  }
  p();

  p(`## 2. 硬编码调色板色（应改用语义 token）`);
  const totalBanned = report.banned.reduce((n, b) => n + b.hits.length, 0);
  p(`合计 **${totalBanned}** 处，分布在 **${report.banned.length}** 个文件。`);
  if (report.banned.length > 0) {
    p(`| 文件 | 层 | 命中 | 类名（次数） |`);
    p(`|------|----|------|--------------|`);
    for (const b of report.banned) {
      const tally = new Map();
      for (const h of b.hits) tally.set(h.cls, (tally.get(h.cls) ?? 0) + 1);
      const topCls = [...tally.entries()]
        .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
        .slice(0, 6)
        .map(([cls, n]) => `\`${cls}\`×${n}`)
        .join(" · ");
      p(`| \`${b.file}\` | ${b.layer} | ${b.hits.length} | ${topCls} |`);
    }
  }
  p();

  p(`## 3. focus 环透明度分布`);
  p(`| 透明度 | 处数 | 判定 |`);
  p(`|--------|------|------|`);
  for (const [alpha, n] of report.ringDistribution) {
    p(`| \`/${alpha}\` | ${n} | ${alpha === "50" ? "✅ 标准值" : "❌ 漂移"} |`);
  }
  p();

  p(`## 4. 裸字号分布`);
  if (report.rawSizeDistribution.length === 0) p(`无裸写 px 字号。`);
  else {
    p(`| 字号 | 处数 | 说明 |`);
    p(`|------|------|------|`);
    for (const [px, n] of report.rawSizeDistribution) {
      p(`| \`text-[${px}px]\` | ${n} | ${px === "10" ? "徽标/角标" : px === "11" ? "元信息行" : "需确认是否有语义"} |`);
    }
  }
  p();
  return lines.join("\n");
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`[ui-scan] ${err.message}\n`);
    process.exit(2);
  }
  if (opts.help) {
    process.stdout.write(readFileSync(new URL(import.meta.url), "utf8").slice(0, 1200));
    process.exit(0);
  }

  const rootAbs = join(process.cwd(), opts.root);
  const files = collectFiles(rootAbs, []).map((f) => relative(process.cwd(), f).split(sep).join("/"));
  if (files.length === 0) {
    process.stderr.write(`[ui-scan] 根目录 ${opts.root} 下没有 .ts/.tsx 文件\n`);
    process.exit(2);
  }

  const gramFiles = new Map();
  const banned = [];
  const rings = [];
  const rawSizes = [];
  for (const file of files) {
    const r = scanFile(file, opts.gram);
    for (const g of r.grams) {
      if (!gramFiles.has(g)) gramFiles.set(g, new Set());
      gramFiles.get(g).add(file);
    }
    if (r.banned.length) banned.push({ file, layer: layerOf(file), hits: r.banned });
    rings.push(...r.rings.map((x) => ({ ...x, file })));
    rawSizes.push(...r.rawSizes.map((x) => ({ ...x, file })));
  }

  const tally = (items, key) => {
    const map = new Map();
    for (const it of items) map.set(it[key], (map.get(it[key]) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };

  const grams = topGrams(gramFiles, opts.minFiles, opts.top);
  const report = {
    root: opts.root,
    fileCount: files.length,
    grams,
    banned: banned.sort((a, b) => b.hits.length - a.hits.length),
    ringDistribution: tally(rings, "alpha"),
    rawSizeDistribution: tally(rawSizes, "px"),
    ringFiles: rings,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderMarkdown(report, opts));
  }

  if (opts.failOn !== null) {
    const offenders = [...gramFiles.entries()].filter(([, f]) => f.size >= opts.failOn);
    if (offenders.length > 0) {
      process.stderr.write(
        `[ui-scan] 门禁未通过：${offenders.length} 个模式跨 ≥${opts.failOn} 个文件重复，需按 extraction-playbook 抽取\n`,
      );
      process.exit(1);
    }
  }
  process.exit(0);
}

main();
