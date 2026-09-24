#!/usr/bin/env node
/**
 * 分层边界扫描器 —— 把「层序」从散文规则变成可执行判据。
 *
 * 为什么要有它：本次越界（`stores → features`，6 行）能长期存在，根因是
 * `rules/` 只写了「domain/engine/ai/storage 不得 import features」，
 * 而 `stores` 从没被禁（见 docs/architecture-service-layer-design-2026-09.md §1.2 ②）。
 * 规则不落成代码，就只是一句口号。
 *
 * 断言 6 条不变量（A1–A6，见同方案 §4.1）：
 *   A1  domain/** 不得 import 任何其它业务层
 *   A2  engine / ai / storage 不得 import stores / services / features / components / hooks
 *   A3  stores / services 不得 import features / components；components 不得 import features
 *   A4  engine / ai 不得「值」导入 i18n/messages/*（`import type` 与 i18n/types 豁免）
 *   A5  模块级「值」依赖图无环（`import type` 不计）
 *   A6  lib/** 不得 import 任何其它层
 *
 * ⚠️ A3 的 `components ↛ features` 属**实现期发现**（方案原口径只写 stores/services）：
 *   实测 `components/` 有 4 条指向 `features/` 的导入，其中 1 条被第 3 批顺手修掉（改指
 *   services），余 3 条登记为基线（见 KNOWN_EDGES）。方案 §2 目标②本就承诺
 *   「`components/**` → `features/**` 归零」，本脚本只是把这条承诺落成可执行判据。
 *
 * 用法：
 *   node scripts/layer-boundary-scan.mjs                     # 出报告，退出码恒 0
 *   node scripts/layer-boundary-scan.mjs --fail-on-violation # 有「基线之外」的违规 → 退出码 1
 *   node scripts/layer-boundary-scan.mjs --json              # 机器可读输出
 *
 * 退出码：0 = 达标 / 报告模式；1 = 命中 --fail-on-violation；2 = 参数或运行错误。
 *
 * 基线机制：既存债务（不在本批范围、已登记在 docs/code-gap-review-2026-09.md）列在
 * KNOWN_EDGES / KNOWN_CYCLES。**检测是全量的**（报告里照样列出来），只是不计入退出码——
 * 这样「不再新增」可被机器守住，而「存量还没还」不会被伪装成绿的。
 *
 * 已知局限（有意为之的启发式，不是精确解析）：
 *   - 不做 AST 解析，import 语句用正则抽取：理论上字符串字面量里出现
 *     「import ... from "x"」会被误抽（本仓库无此写法）；
 *   - 动态 `import("x")` 计入依赖边（它同样是运行时依赖）；
 *   - `import { type A }` 这种行内类型限定符按**值**导入计（保守：宁可多报）；
 *   - 相对路径解析支持 `.ts` / `.tsx` / `/index.ts` 补全；解析不到的 specifier 记为
 *     `unresolved` 并打印，不参与判定。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, resolve as pathResolve, sep } from "node:path";

/** 扫描根（相对仓库根）。 */
const SRC_ROOT = "src";
/** 永远不扫的目录名。 */
const ALWAYS_IGNORE = new Set([
  "node_modules",
  "dist",
  "dist-ssr",
  "src-tauri",
  ".git",
  "coverage",
]);

/**
 * 层级序号：依赖只允许「向下或同层」（target.tier <= self.tier）。
 * 同层互换（engine↔ai、stores↔services）天然满足该条件。
 */
const TIER = {
  domain: 0,
  lib: 0,
  engine: 1,
  ai: 1,
  storage: 1,
  stores: 2,
  services: 2,
  features: 3,
  components: 3,
  hooks: 3,
};

/** 归为「UI 文案叶子」的 i18n 路径（tier 0）。其余 i18n 文件（如 I18nProvider.tsx）按 Tier 3 处理。 */
const I18N_LEAF_RE = /^i18n\/(?:messages\/|types\.ts$)/;

/** 显式例外白名单（带理由）。key = `<自身相对 src 的路径> -> <目标相对 src 的路径>`。 */
const ALLOWED_EDGES = new Set([
  // Provider 是 React 组件（Tier 3），stores 属 Tier 2 —— 按 tier 规则天然合规；
  // 显式登记是为了「记录意图」：日后调整 i18n 目录层级时这条边不会被误判。
  "i18n/I18nProvider.tsx -> stores/useLangStore",
]);

/**
 * 既存边基线（2026-09-24 实测；**第 3 批不修**）。
 * 都是 `components → features`（Tier 3 内部的语义反向）：共享 UI 层不得依赖业务页面。
 * 修它们需要动 UI 挂载结构（AppShell / ImportModal / units / chapter-action 的归属），
 * 超出第 3 批「纯结构重构、零 UI 变化」的定位 ⇒ 登记为债务，另开批次。
 * 已登记：docs/code-gap-review-2026-09.md §三「第 3 批顺带发现」。
 */
const KNOWN_EDGES = [
  "components/layout/AppShell.tsx -> features/learn/ImportModal.tsx",
  "components/CommandPalette.tsx -> features/units.ts",
  "components/CommandPalette.tsx -> features/plan/chapter-action.ts",
];

/**
 * 既存环基线（2026-09-24 扫描实测；**第 3 批不修**）。
 *   ① engine 内部：profile-band ⇄ quiz-engine（同层 Tier 1，与分层无关，属模块拆分问题）
 *   ② UI 内部：AppShell ⇄ CommandPalette ⇄ ImportModal（Tier 3，UI 事件总线式互引）
 * 已登记：docs/code-gap-review-2026-09.md §三「第 3 批顺带发现」。
 */
const KNOWN_CYCLES = [
  ["src/engine/profile-band.ts", "src/engine/quiz-engine.ts"],
  [
    "src/components/CommandPalette.tsx",
    "src/components/layout/AppShell.tsx",
    "src/features/learn/ImportModal.tsx",
  ],
].map((c) => [...c].sort().join(" | "));

/** 用户友好的不变量标签。 */
const INVARIANT_LABEL = {
  A1: "domain 是叶子：不得依赖任何其它业务层",
  A2: "engine / ai / storage 不得依赖 stores / services / features / components / hooks",
  A3: "stores / services ↛ features / components；components ↛ features",
  A4: "engine / ai 不得值导入 i18n/messages/*",
  A5: "模块级值依赖图必须无环",
  A6: "lib 是叶子：不得依赖任何其它层",
};

/** @param {string[]} argv */
function parseArgs(argv) {
  const opts = { failOnViolation: false, json: false, help: false };
  for (const arg of argv) {
    switch (arg) {
      case "--fail-on-violation":
        opts.failOnViolation = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        throw new Error(`无法识别的参数：${arg}`);
    }
  }
  return opts;
}

/** 递归收集 src 下的 .ts/.tsx（忽略 .d.ts 与忽略目录）。返回仓库根相对的 posix 路径。 */
function collectFiles(dirAbs, out) {
  let entries;
  try {
    entries = readdirSync(dirAbs);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (ALWAYS_IGNORE.has(name)) continue;
    const full = join(dirAbs, name);
    const st = statSync(full, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) collectFiles(full, out);
    else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(relative(process.cwd(), full).split(sep).join("/"));
    }
  }
  return out;
}

/** 取相对 `src/` 的路径（posix）；不在 src/ 下返回 null。 */
function insideSrc(relPath) {
  const prefix = `${SRC_ROOT}/`;
  return relPath.startsWith(prefix) ? relPath.slice(prefix.length) : null;
}

/**
 * 归属层：取 `src/` 后的首段；`i18n` 按文件特判（messages/** 与 types.ts 是叶子）。
 * @returns {{ name: string, tier: number, inSrc: string } | null}
 */
function layerOf(relPath) {
  const inner = insideSrc(relPath);
  if (!inner) return null;
  const head = inner.split("/")[0];
  if (head === "i18n") {
    const tier = I18N_LEAF_RE.test(inner) ? 0 : 3;
    return { name: tier === 0 ? "i18n(leaf)" : "i18n(ui)", tier, inSrc: inner };
  }
  if (!(head in TIER)) return null;
  return { name: head, tier: TIER[head], inSrc: inner };
}

const STATIC_RE = /(?:^|[\n;])\s*(import|export)\s+([^;]*?)\s*from\s*["']([^"']+)["']/g;
const BARE_RE = /(?:^|[\n;])\s*import\s*["']([^"']+)["']/g;
const DYN_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * 抽取一个文件的 import / export-from / 动态 import。
 * @returns {{ spec: string, isTypeOnly: boolean, line: number }[]}
 */
function collectImports(src) {
  const found = [];
  const lineOf = (idx) => {
    let line = 1;
    for (let i = 0; i < idx; i += 1) if (src[i] === "\n") line += 1;
    return line;
  };

  let m;
  STATIC_RE.lastIndex = 0;
  while ((m = STATIC_RE.exec(src)) !== null) {
    const [, keyword, , spec] = m;
    const isTypeOnly = new RegExp(`${keyword}\\s+type\\s`).test(m[0]);
    // 正则的前导 `(?:^|[\n;])` 会把换行符算进匹配起点 ⇒ 行号要回到关键字本身。
    const at = m.index + Math.max(0, m[0].search(/\b(?:import|export)\b/));
    found.push({ spec, isTypeOnly, line: lineOf(at) });
  }
  BARE_RE.lastIndex = 0;
  while ((m = BARE_RE.exec(src)) !== null) {
    const at = m.index + Math.max(0, m[0].search(/\bimport\b/));
    found.push({ spec: m[1], isTypeOnly: false, line: lineOf(at) });
  }
  DYN_RE.lastIndex = 0;
  while ((m = DYN_RE.exec(src)) !== null) {
    found.push({ spec: m[1], isTypeOnly: false, line: lineOf(m.index) });
  }
  return found;
}

/** 相对路径 / `@/` alias → 仓库内绝对路径（带补全）；解析不到返回 null。 */
function resolveSpec(fromRel, spec) {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null;
  const base = spec.startsWith("@/")
    ? join(process.cwd(), SRC_ROOT, spec.slice(2))
    : pathResolve(process.cwd(), dirname(fromRel), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const cand of candidates) {
    const st = statSync(cand, { throwIfNoEntry: false });
    if (st && st.isFile()) return relative(process.cwd(), cand).split(sep).join("/");
  }
  return null;
}

/** Tarjan SCC：返回所有 size>1 的强连通分量（值边图）。 */
function findCycles(graph) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  let counter = 0;

  const strongConnect = (v) => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) sccs.push(comp.sort());
    }
  };

  for (const v of graph.keys()) if (!index.has(v)) strongConnect(v);
  return sccs;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`[layer-scan] ${err.message}\n`);
    process.exit(2);
  }
  if (opts.help) {
    process.stdout.write(readFileSync(new URL(import.meta.url), "utf8").slice(0, 1600));
    process.exit(0);
  }

  const files = collectFiles(join(process.cwd(), SRC_ROOT), []);
  if (files.length === 0) {
    process.stderr.write(`[layer-scan] ${SRC_ROOT}/ 下没有 .ts/.tsx 文件\n`);
    process.exit(2);
  }

  const knownEdges = new Set(KNOWN_EDGES);
  /** @type {any[]} */
  const violations = [];
  /** @type {any[]} */
  const baselined = [];
  const edges = [];
  const unresolved = [];
  const graph = new Map();
  const usedBaselineEdges = new Set();

  for (const file of files) {
    const self = layerOf(file);
    if (!self) continue;
    const src = readFileSync(file, "utf8");

    for (const imp of collectImports(src)) {
      const target = resolveSpec(file, imp.spec);
      if (!target) {
        if (imp.spec.startsWith(".") || imp.spec.startsWith("@/")) {
          unresolved.push({ file, line: imp.line, spec: imp.spec });
        }
        continue;
      }
      const dep = layerOf(target);
      if (!dep) continue;

      const pairKey = `${self.inSrc} -> ${dep.inSrc}`;
      const edgeKey = `${file.replace(`${SRC_ROOT}/`, "")} -> ${dep.inSrc}`;
      const whitelisted = ALLOWED_EDGES.has(pairKey);

      if (!imp.isTypeOnly) {
        if (!graph.has(file)) graph.set(file, new Set());
        graph.get(file).add(target);
      }

      // ---- 违反不变量？----
      let invariant = null;
      if (dep.tier > self.tier) {
        invariant =
          self.name === "domain"
            ? "A1"
            : self.name === "lib"
              ? "A6"
              : self.name === "stores" || self.name === "services"
                ? "A3"
                : "A2";
      } else if (self.name === "components" && dep.name === "features") {
        // 同层（Tier 3）内的语义反向：共享 UI 不得依赖业务页面
        invariant = "A3";
      }

      if (invariant && !whitelisted) {
        const record = {
          invariant,
          rule: INVARIANT_LABEL[invariant],
          file,
          line: imp.line,
          target,
          detail: `${self.name} → ${dep.name}`,
        };
        if (knownEdges.has(edgeKey)) {
          baselined.push(record);
          usedBaselineEdges.add(edgeKey);
        } else {
          violations.push(record);
        }
      } else {
        edges.push({ file, line: imp.line, target });
      }

      // ---- A4：engine / ai 值导入 i18n/messages/* ----
      const isI18nMessages = dep.inSrc.startsWith("i18n/messages/");
      if (
        isI18nMessages &&
        !imp.isTypeOnly &&
        (self.name === "engine" || self.name === "ai") &&
        !whitelisted
      ) {
        violations.push({
          invariant: "A4",
          rule: INVARIANT_LABEL.A4,
          file,
          line: imp.line,
          target,
          detail: `${self.name} 值导入词典`,
        });
      }
    }
  }

  const allCycles = findCycles(graph);
  const knownCycles = new Set(KNOWN_CYCLES);
  const baselineCycles = allCycles.filter((c) => knownCycles.has(c.join(" | ")));
  const newCycles = allCycles.filter((c) => !knownCycles.has(c.join(" | ")));
  const staleCycles = KNOWN_CYCLES.filter(
    (k) => !allCycles.some((c) => c.join(" | ") === k),
  );
  const staleEdges = KNOWN_EDGES.filter((k) => !usedBaselineEdges.has(k));

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          fileCount: files.length,
          violations,
          baselined,
          newCycles,
          baselineCycles,
          staleBaseline: { cycles: staleCycles, edges: staleEdges },
          edges,
          unresolved,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    const lines = [];
    const p = (s = "") => lines.push(s);
    p(`# PLOS 分层边界扫描报告`);
    p();
    p(`- 扫描文件：${files.length} 个（\`${SRC_ROOT}/\`）`);
    p(`- 合规跨层边：${edges.length} 条`);
    p(`- **违规：${violations.length} 条** ｜ **新增环：${newCycles.length} 组**`);
    p(`- 基线豁免：边 ${baselined.length} 条 / 环 ${baselineCycles.length} 组（已登记债务，不计入退出码）`);
    p(`- 解析失败（不参与判定）：${unresolved.length} 条`);
    p();

    p(`## 1. 违规明细（退出码依据）`);
    if (violations.length === 0) {
      p(`无违规。A1–A4 全绿。`);
    } else {
      p(`| # | 不变量 | 文件 | 行 | 目标 | 说明 |`);
      p(`|---|--------|------|----|------|------|`);
      violations.forEach((v, i) => {
        p(`| ${i + 1} | ${v.invariant} | \`${v.file}\` | ${v.line} | \`${v.target}\` | ${v.detail} |`);
      });
      p();
      const byInvariant = new Map();
      for (const v of violations) {
        byInvariant.set(v.invariant, (byInvariant.get(v.invariant) ?? 0) + 1);
      }
      p(`按不变量汇总：`);
      for (const [id, n] of [...byInvariant.entries()].sort()) {
        p(`- **${id}**（${n} 条）— ${INVARIANT_LABEL[id]}`);
      }
    }
    p();

    p(`## 2. 新增环（退出码依据）`);
    if (newCycles.length === 0) p(`无新增环。`);
    else {
      newCycles.forEach((comp, i) => {
        p(`### 新增环 ${i + 1}（${comp.length} 个模块）`);
        for (const f of comp) p(`- \`${f}\``);
      });
    }
    p();

    p(`## 3. 基线豁免（已登记债务，非本批范围）`);
    if (baselined.length === 0 && baselineCycles.length === 0) p(`无。`);
    else {
      for (const b of baselined) {
        p(`- 边：\`${b.file}:${b.line}\` → \`${b.target}\`（${b.invariant}）`);
      }
      for (const c of baselineCycles) {
        p(`- 环：${c.map((f) => `\`${f}\``).join(" ⇄ ")}`);
      }
    }
    p();

    if (staleCycles.length > 0 || staleEdges.length > 0) {
      p(`## 4. ⚠️ 基线已失效（应删除对应条目）`);
      for (const k of staleCycles) p(`- 环基线已不存在：\`${k}\``);
      for (const k of staleEdges) p(`- 边基线已不存在：\`${k}\``);
      p();
    }

    if (unresolved.length > 0) {
      p(`## 5. 解析失败的导入（供排查）`);
      p(`| 文件 | 行 | specifier |`);
      p(`|------|----|-----------|`);
      for (const u of unresolved) p(`| \`${u.file}\` | ${u.line} | \`${u.spec}\` |`);
      p();
    }

    p(`## 已知局限`);
    p(`- 正则抽取 import，非 AST；字符串里出现 import 语法会被误抽（本仓库无此写法）。`);
    p(`- \`import { type A }\` 行内类型限定符按值导入计。`);
    p(`- 只扫 \`src/\`；\`tests/\` 与 \`scripts/\` 不在门禁范围。`);
    p(`- 环检测只看「值」边（\`import type\` 不计）——纯类型互引不构成运行时环。`);
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  if (opts.failOnViolation && (violations.length > 0 || newCycles.length > 0)) {
    process.stderr.write(
      `[layer-scan] 门禁未通过：${violations.length} 条分层违规、${newCycles.length} 组新增环\n`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main();
