/**
 * 渲染层 · Mermaid 围栏单测（docs/library-mermaid-render-design-2026-09.md §11/§12）。
 *
 * 运行（Node 22 + 类型剥离直跑）：
 *   npm run test:render
 *
 * 两条原则：
 * 1. **只 import `.ts`**：Node 的类型剥离不支持 JSX，`.tsx` 无法被单测加载
 *    → 组件级行为改用「读源码文本做静态断言」（先例：`tests/rag-wiring.test.ts`）。
 * 2. 不触网络、不触 DOM、不加载 mermaid：断言对象全是构造出来的 hast 结构与字符串。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_MERMAID_SOURCE_CHARS,
  MERMAID_LANGS,
  fenceLang,
  hastText,
  mermaidSourceTooLarge,
  normalizeMermaidSource,
  readCodeFence,
  sanitizeSvgId,
  stripMermaidDirectives,
} from "../src/features/learn/render/mermaid-source.ts";
import type { HastNode } from "../src/features/learn/render/mermaid-source.ts";
import { MERMAID_BASE_CONFIG, readThemeVariables } from "../src/features/learn/render/mermaid-theme.ts";

const results: string[] = [];
let failures = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    results.push(`✓ ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 源码文件读取（静态断言用）。 */
const read = (relPath: string): string =>
  readFileSync(new URL(`../${relPath}`, import.meta.url), "utf8");

/**
 * 过滤掉整行注释后逐行返回。
 * 必要性：本组断言的对照组是**代码**，而文件头的中文注释里会原样引用
 * `from "mermaid"` / `throw` 这类被禁写法（用来解释「为什么禁止」）——
 * 不剔除注释就会把自己的说明文字当成违规。
 */
function codeLines(src: string): string[] {
  return src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    })
    .map((line) => line.replace(/\s*\/\/.*$/, ""));
}

/* ---------------- hast 构造工具 ---------------- */

/** 造一个 `<code>` 节点：内容可拆成多个 text 子节点。 */
function codeNode(lang: string, ...texts: string[]): HastNode {
  return {
    tagName: "code",
    properties: { className: [`language-${lang}`] },
    children: texts.map((value) => ({ type: "text", value })),
  };
}

/** 造一个 `<pre>` 节点（含单个 code 子节点）。 */
function preNode(code: HastNode): HastNode {
  return { tagName: "pre", children: [code] };
}

/* ---------------- UC-01 围栏识别与取文 ---------------- */

check("TC-UC01-01 fenceLang 从 className 取语言名", () => {
  assert.equal(fenceLang(codeNode("mermaid")), "mermaid");
  assert.equal(fenceLang({ tagName: "code" }), undefined, "无 className → undefined");
});

check("TC-UC01-02 readCodeFence 取到 pre 内 code 的语言与正文", () => {
  assert.deepEqual(readCodeFence(preNode(codeNode("mermaid", "flowchart TD\n A-->B"))), {
    lang: "mermaid",
    value: "flowchart TD\n A-->B",
  });
  // 非 code 子节点 → 不认作围栏（按普通 pre 渲染）
  assert.equal(readCodeFence({ tagName: "pre", children: [{ tagName: "span" }] }), undefined);
});

check("TC-UC01-03 hastText 拼接被拆散的多个 text 节点", () => {
  const code = codeNode("mermaid", "flowchart ", "TD\n", "A-->B");
  assert.equal(hastText(code), "flowchart TD\nA-->B");
  assert.equal(readCodeFence(preNode(code))?.value, "flowchart TD\nA-->B");
});

check("TC-UC01-04 normalizeMermaidSource 去指令 + 去首尾空行", () => {
  assert.equal(
    normalizeMermaidSource("  \n%%{init:{}}%%\nflowchart TD\nA-->B\n\n"),
    "flowchart TD\nA-->B",
  );
});

/* ---------------- UC-02 图内指令剥离 ---------------- */

check("TC-UC02-01 frontmatter（title/config）被剥离", () => {
  const src = ["---", "title: 架构图", "config:", "  theme: dark", "---", "flowchart TD", "A-->B"].join(
    "\n",
  );
  assert.equal(stripMermaidDirectives(src), "flowchart TD\nA-->B");
});

check("TC-UC02-02 正文中部的 --- 不得误当 frontmatter", () => {
  const src = ["flowchart TD", "A-->B", "---", "C-->D"].join("\n");
  assert.equal(stripMermaidDirectives(src), src, "非首行的分隔线必须原样保留");
  // 首行是 --- 但找不到闭合 → 同样不剥离
  const dangling = ["---", "flowchart TD"].join("\n");
  assert.equal(stripMermaidDirectives(dangling), dangling);
});

check("TC-EDGE-05 普通 %% 注释保留，仅 %%{ 指令被剥（含跨行）", () => {
  const src = ["%% 这是一条注释", "flowchart TD", "%%{init: {", "  'theme': 'dark'", "}}%%", "A-->B"].join(
    "\n",
  );
  assert.equal(stripMermaidDirectives(src), "%% 这是一条注释\nflowchart TD\nA-->B");
});

/* ---------------- UC-03 超限 ---------------- */

check("TC-UC03-01/02 超限判定的边界（含等号）", () => {
  assert.equal(MAX_MERMAID_SOURCE_CHARS, 30_000);
  assert.equal(mermaidSourceTooLarge("x".repeat(30_001)), true);
  assert.equal(mermaidSourceTooLarge("x".repeat(30_000)), false, "恰好等于上限视为可渲染");
});

/* ---------------- UC-04 id 净化 ---------------- */

check("TC-UC04-01/02 sanitizeSvgId 产出可作 CSS 选择器的 id", () => {
  const LEGAL = /^[A-Za-z0-9_-]+$/;
  for (const seed of [":r3:", "«r0»", ":r0:", "_r_0_", "a b/c"]) {
    const id = sanitizeSvgId(seed);
    assert.ok(LEGAL.test(id), `id 含非法选择器字符：${id}`);
    assert.ok(id.startsWith("plos-mm-"), `缺少前缀：${id}`);
  }
  // 唯一性来自 React useId 在同一渲染树内的唯一性，净化本身**不保证单射**
  // （`:r0:` 与 `«r0»` 都会落到 `plos-mm--r0-`）。这里只锁定真实场景：
  // 同一 React 版本连续产出的一串 id，净化后仍两两不同。
  const r19 = ["_r_0_", "_r_1_", "_r_2_"].map(sanitizeSvgId);
  const r18 = [":r0:", ":r1:", ":r2:"].map(sanitizeSvgId);
  assert.equal(new Set(r19).size, 3, `React 19 序列发生碰撞：${r19.join(",")}`);
  assert.equal(new Set(r18).size, 3, `React 18 序列发生碰撞：${r18.join(",")}`);
});

/* ---------------- UC-06 主题变量映射 ---------------- */

check("TC-UC06-01 readThemeVariables 只产出有值的键", () => {
  const fake: Record<string, string> = {
    "--plos-surface": " white ",
    "--plos-line": "gray",
    "--plos-ink-1": "black",
    "--plos-ink-3": "gray-3",
    "--plos-subtle": "off-white",
    "--font-sans": "Inter",
  };
  const vars = readThemeVariables((name) => fake[name] ?? "");
  // 6 个源变量 → 16 个 mermaid 主题键（同一变量可映射到多个键，如 --plos-surface → 4 个）
  assert.equal(Object.keys(vars).length, 16);
  assert.ok(Object.values(vars).every((v) => typeof v === "string" && v.length > 0));
  assert.equal(vars.background, "white", "值需 trim");
  assert.equal(vars.fontFamily, "Inter");
});

check("TC-UC06-02 全部读不到 → 返回空对象（不硬编码颜色）", () => {
  assert.deepEqual(readThemeVariables(() => ""), {});
});

check("TC-EDGE-09 安全基线四项显式声明（不依赖 mermaid 默认值）", () => {
  assert.equal(MERMAID_BASE_CONFIG.securityLevel, "strict");
  assert.equal(MERMAID_BASE_CONFIG.startOnLoad, false);
  assert.equal(MERMAID_BASE_CONFIG.suppressErrorRendering, true, "否则错误图会插进 document.body");
  assert.equal(MERMAID_BASE_CONFIG.htmlLabels, false, "关闭 foreignObject HTML 注入面");
});

/* ---------------- EDGE：围栏别名的正反例 ---------------- */

check("TC-EDGE-01/02/03 围栏识别：别名命中、其它语言不命中", () => {
  assert.ok(MERMAID_LANGS.has("mermaid"));
  assert.ok(MERMAID_LANGS.has("mmd"), "mmd 别名需与 mermaid 等价");
  assert.equal(MERMAID_LANGS.size, 2, "别名集合只允许这两个");
  assert.equal(fenceLang(codeNode("Mermaid")), "mermaid", "大写需转小写");
  const ts = readCodeFence(preNode(codeNode("ts", "const a = 1")));
  assert.equal(ts?.lang, "ts");
  assert.ok(!MERMAID_LANGS.has(ts!.lang), "ts 不得被当作图表");
  // 无语言的围栏同样不进图分支
  const bare = readCodeFence(preNode({ tagName: "code", children: [{ value: "x" }] }));
  assert.equal(bare?.lang, "");
  assert.ok(!MERMAID_LANGS.has(bare!.lang));
});

check("TC-EDGE-04 空围栏 → 规范化为空串（不创建图表块）", () => {
  assert.equal(normalizeMermaidSource("\n\n"), "");
  assert.equal(normalizeMermaidSource(""), "");
});

check("TC-EDGE-06 未闭合围栏（截断产物）仍能取到内容，交给组件降级", () => {
  const fence = readCodeFence(preNode(codeNode("mermaid", "flowchart TD\n  A -->")));
  assert.ok(fence && MERMAID_LANGS.has(fence.lang));
  assert.equal(normalizeMermaidSource(fence.value), "flowchart TD\n  A -->");
});

/* ---------------- EDGE：源码静态断言（组件在 .tsx，只能读文本） ---------------- */

const MB = "src/features/learn/render/MermaidBlock.tsx";
const MT = "src/features/learn/render/mermaid-theme.ts";
const MS = "src/features/learn/render/mermaid-source.ts";
const MC = "src/features/learn/render/markdown-core.tsx";

check("TC-EDGE-08 mermaid 只能动态加载，不得值导入（否则主包被撑大）", () => {
  const src = read(MB);
  assert.ok(src.includes('import("mermaid")'), "缺少动态 import");
  assert.ok(
    src.includes('type MermaidApi = typeof import("mermaid")["default"]'),
    "缺少模块类型声明",
  );
  for (const code of codeLines(src)) {
    if (/\bfrom\s+["']mermaid["']/.test(code)) {
      assert.ok(/^\s*import\s+type\b/.test(code), `MermaidBlock 出现值导入：${code.trim()}`);
    }
  }
});

check("TC-EDGE-10 三个新文件零 hex 色值（rules/react.mdc：颜色只在 main.css）", () => {
  const HEX = /#[0-9a-fA-F]{3,8}\b/;
  for (const file of [MS, MT, MB]) {
    for (const [i, line] of codeLines(read(file)).entries()) {
      const found = HEX.exec(line);
      assert.ok(!found, `${file} 第 ${i + 1} 行出现 hex 色值 ${found?.[0]}`);
    }
  }
});

check("TC-EDGE-11 接线：markdown-core 的 pre 分派 + 行内覆写 pre", () => {
  const src = read(MC);
  assert.ok(src.includes('from "./MermaidBlock"'), "pre 分支未引用 MermaidBlock");
  assert.ok(src.includes("MERMAID_LANGS.has(fence.lang)"), "缺少围栏语言判定");
  assert.ok(src.includes("readCodeFence(node"), "未从 hast node 取围栏");
  // 行内表必须显式把 pre 覆写回纯代码块（否则 12px 要点里会出图）
  const inline = src.slice(src.indexOf("export const inlineMarkdownComponents"));
  assert.ok(/\n\s{2}pre:\s*PlainPre,/.test(inline), "inlineMarkdownComponents 未覆写 pre");
  // 未命中围栏时必须回落到原来的代码块
  assert.ok(src.includes("return <PlainPre>{children}</PlainPre>"), "缺少 PlainPre 回落");
});

check("TC-EDGE-12/13 既有渲染契约与其它渲染器零改动", () => {
  for (const file of [
    "src/features/learn/render/renderer-registry.ts",
    "src/features/learn/render/MarkdownRenderer.tsx",
    "src/features/learn/render/PlainTextRenderer.tsx",
    "src/features/learn/render/CodeRenderer.tsx",
    "src/features/learn/render/ImageNoticeRenderer.tsx",
    "src/features/learn/render/RenderErrorBoundary.tsx",
  ]) {
    const src = read(file);
    assert.ok(!/mermaid/i.test(src), `${file} 不应感知 mermaid`);
  }
  // 分派契约不变：markdown 仍走 MarkdownRenderer
  const registry = read("src/features/learn/render/renderer-registry.ts");
  assert.ok(/MarkdownRenderer/.test(registry));
});

check("TC-EDGE-14 MermaidBlock 自带错误捕获（不得外抛触发整篇降级）", () => {
  const src = read(MB);
  assert.ok(src.includes("catch"), "缺少 catch");
  assert.ok(
    !codeLines(src).some((line) => /\bthrow\b/.test(line)),
    "组件内不得 throw：会冒泡到 RenderErrorBoundary 把整篇正文降级",
  );
  // 源码容器常驻 DOM（仅切 hidden），保证 highlightRange 偏移守恒
  assert.ok(src.includes("data-mermaid-source"), "缺少源码容器标记");
  assert.ok(src.includes("hidden"), "源码容器需用 hidden 切换而非条件渲染");
  assert.ok(src.includes("cancelled"), "缺少卸载守卫");
});

console.log(results.join("\n"));
console.log(`\nrender-mermaid: ${results.length - failures}/${results.length} passed`);
if (failures > 0) process.exit(1);
