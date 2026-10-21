/**
 * 用户可见文案门禁（docs/copy-terminology-2026-10.md §4 / docs/copy-optimization-design-2026-10.md §5.4 T-P2-2）。
 *
 * 由 `settings-copy-scan.mjs` 演进而来（那一版只扫 settings 子树）。三类检查：
 *
 *   1. 技术词      —— 按术语表 §2 的「替换表」扫全部 24 个命名空间的**叶子值**
 *   2. Markdown 残迹 —— 值里出现 `**` / 反引号（纯文本 UI 不该渲染出标记）
 *   3. 硬编码中文  —— 源码里绕过 i18n 的中文 UI 字面量
 *
 * ⛔ 三条纪律（缺一条门禁就退化成假门禁）：
 *   - **只扫值**，不扫键名与注释：`localStorageNote` / `errSqliteBlocked` 这类标识符
 *     会永久命中，让门禁永远红着（上一轮 `sed | grep` 写法的教训）。
 *   - **黑名单只含术语表里真会改的词**：`Markdown` / `OCR` / `Base URL` / `本地优先`
 *     刻意不在列（格式名 / 外部参数 / 核心卖点）。
 *   - **排除 `src/ai/**`**：那里的中文是 prompt，改它等于改 AI 行为。
 *
 * 用法：`npm run copy:check`（命中即退出码 1）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BAD_ZH =
  /localStorage|SQLite|Tauri|Keychain|npm run|向量|Embedding|embedding|Pre-MVP|Workbench|MVP 里程碑|领域模型|本地数据库|提示词|src\/|提示模型/;
const BAD_EN =
  /localStorage|SQLite|Tauri|Keychain|npm run|\bvector\b|\bembedding\b|Pre-MVP|Workbench|MVP milestone|domain model|the local database|\bprompt constraint|src\//i;

/** markdown 标记：纯文本 UI 渲染出来就是残迹。 */
const MD_MARK = /\*\*|`/;

/**
 * 逐键豁免（每条都要能说清理由，否则就是给恒红开后门）。
 * 按**键路径**豁免 ⇒ 只放过该键，不影响其他键的同词检出。
 */
const KEY_EXEMPT = [
  // 上一轮定案：备份清点要精确指代「清掉了什么」，改词反而失真（settings-left-menu §9.5）
  /^settings\.storage\.data\.countLabels\./,
  // 「向量化」在这里只是举例的章节名，不是要向用户解释的概念
  /^learn\.import\.bodyPlaceholder$/,
  // 错误原因必须说清是本机哪一层失败，否则用户无法判断下一步该做什么
  /^settings\.storage\.data\.errSqliteBlocked$/,
];

/** 该键是否豁免。 */
const exempt = (path) => KEY_EXEMPT.some((re) => re.test(path));

const { zh } = await import("../src/i18n/messages/zh.ts");
const { en } = await import("../src/i18n/messages/en.ts");

/** 摊平所有叶子值（字符串 / 无参插值函数 / 数组项）。 */
function leaves(node, path = "", out = []) {
  for (const [k, v] of Object.entries(node)) {
    const p = path ? `${path}.${k}` : k;
    if (typeof v === "string") out.push([p, v]);
    else if (typeof v === "function") {
      let s = "";
      try {
        s = String(v(1, 1, "x", "x", "x", "x"));
      } catch {
        s = "";
      }
      out.push([p, s]);
    } else if (Array.isArray(v)) {
      v.forEach((it, i) => {
        if (typeof it === "string") out.push([`${p}[${i}]`, it]);
        else if (it && typeof it === "object") leaves(it, `${p}[${i}]`, out);
      });
    } else if (v && typeof v === "object") leaves(v, p, out);
  }
  return out;
}

let failed = 0;

// ── 1 + 2：全量叶子值扫描 ──────────────────────────────────────────
for (const [name, dict, bad] of [
  ["zh", zh, BAD_ZH],
  ["en", en, BAD_EN],
]) {
  const all = leaves(dict);
  const tech = all.filter(([p, s]) => !exempt(p) && bad.test(s));
  const md = all.filter(([p, s]) => !exempt(p) && MD_MARK.test(s));

  if (tech.length === 0) {
    console.log(`✅ ${name}：${all.length} 个用户可见值无技术术语（0 命中）`);
  } else {
    failed += tech.length;
    console.log(`❌ ${name}：${tech.length} 处技术术语`);
    for (const [p, s] of tech) console.log(`   ${p} = ${s.slice(0, 100)}`);
  }

  if (md.length === 0) {
    console.log(`✅ ${name}：无 markdown 残迹（0 命中）`);
  } else {
    failed += md.length;
    console.log(`❌ ${name}：${md.length} 处 markdown 残迹`);
    for (const [p, s] of md) console.log(`   ${p} = ${s.slice(0, 100)}`);
  }
}

// ── 3：绕过 i18n 的硬编码中文（FORMAT_OPTIONS 那类） ────────────────
/**
 * 只看 `src/features/**` 与 `src/components/**`（用户界面所在层）。
 * 排除：注释行、`src/ai/**`（prompt）、以及 i18n 字典本身。
 */
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const UI_DIRS = ["src/features", "src/components"];
/**
 * 已知豁免：这些文件里的中文不是「界面文案」，而是拼进用户可编辑文档 / 正则模板的内容。
 *  - `memory-import.ts`：F9 记忆文档的统计行（进 md 正文，受 F9 合并器 lastWritten 契约约束，
 *    改动会波及记忆文档结构与既有测试）⇒ 本轮登记为遗留，不在文案门禁范围。
 */
const KNOWN_EXEMPT = new Set(["src/features/memory/memory-import.ts"]);
const hardcoded = [];
for (const dir of UI_DIRS) {
  let files = [];
  try {
    files = walk(dir);
  } catch {
    continue; // 目录不存在时跳过，不让门禁崩在环境差异上
  }
  for (const f of files) {
    if (KNOWN_EXEMPT.has(f)) continue;
      const text = readFileSync(f, "utf8");
      text.split("\n").forEach((line, i) => {
        const t = line.trim();
        // 注释行 / import 行一律跳过（含 JSX 里的 {/* … */}）
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) return;
        if (t.includes("/*") && t.trimStart().startsWith("{")) return;
        if (t.startsWith("import ")) return;
        // console.* 是开发者日志，不是用户可见文案（错误文案统一走 i18n 或错误 kind）
        if (/^console\./.test(t)) return;
        // 只看字符串字面量里的中文
        const m = t.match(/["'`]([^"'`]*[\u4e00-\u9fa5][^"'`]*)["'`]/g);
        if (!m) return;
        for (const lit of m) {
          // 纯中文的短标签（如 aria 装饰）不在此列；只报「看起来像文案」的整句
          const inner = lit.slice(1, -1);
          // 已知的技术常量/日期格式（组件内部判据，非用户文案）
          if (/^[\u4e00-\u9fa5\d·：:\s（）()年月日]+$/.test(inner)) continue;
          // 模板插值型日期/文件名（`${weekday} · 3月5日` / `本地文件 · ${name}`）
          if (/^`[^`]*\$\{[^}]+\}[^`]*`$/.test(lit)) continue;
          // 正则替换模板（pii-mask 的 "$1年" 之类）
          if (/^\$[0-9]/.test(inner)) continue;
          hardcoded.push([`${f}:${i + 1}`, lit]);
        }
      });
    }
}

if (hardcoded.length === 0) {
  console.log("✅ 界面层：无绕过 i18n 的中文 UI 字面量（0 命中）");
} else {
  failed += hardcoded.length;
  console.log(`❌ 界面层：${hardcoded.length} 处疑似硬编码中文（确认是否为用户可见文案）`);
  for (const [p, lit] of hardcoded.slice(0, 20)) console.log(`   ${p} = ${lit.slice(0, 90)}`);
}

if (failed > 0) {
  console.log(`\n口径见 docs/copy-terminology-2026-10.md；E/F 类词（格式名 / 外部参数 / 核心卖点）刻意不在黑名单。`);
  process.exit(1);
}
