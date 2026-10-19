# EPUB 导入（F8 范围 4）技术方案

> 状态：**✅ 已实施（2026-10-19）** —— D1–D8 全部取推荐档（用户 2026-10-19 确认「按推荐方案实施」）；T1–T8 done，**T9 桌面手工验收待用户实跑**
> 日期：2026-10-16（方案）· 2026-10-19（实施）
> 关联：`docs/knowledge-import-design-2026-09.md`（导入层总纲）· `docs/url-import-design-2026-10.md`（同批兄弟特性，范围 5）
> 交付目标：README 双语 `[ ] EPUB parsing` → `[x]`，计数 `42 · 4` → **`43 · 3`**

---

## §0 结论先行

**能做，且是当前开放项里性价比最高的一项。**

关键结论四条：

| 结论 | 依据 |
|---|---|
| **零新增 npm 包** | `jszip@3.10.2` 已在 `node_modules`（`mammoth` 的传递依赖，`npm ls jszip` 实测），提升为直接依赖即可 |
| **零 `src-tauri/**` 改动** | `DocumentFormat` **已含 `"epub"`**（`domain/document.ts:12`），SQLite 存的是字符串，无表结构变更 |
| **输出层已现成** | `html-markdown.ts::htmlNodesToMarkdown(root: HtmlDomNode)` 刚在范围 5 建好，EPUB 正文就是 XHTML，**直接复用零改动** |
| **i18n 也已预留一半** | `formatLabels.epub: "EPUB"` 早已存在（`zh.ts:1477` / `en.ts:1507`） |

真正要写的只有**三层里的两层**（编排 + 归档接触面），输出层白捡。

一句话风险：这件事**不难在技术，难在边界**——EPUB 是「容器格式 + 一整套规范」，坑集中在 DRM、zip bomb、标题缺失三处，方案 §3 专门处理。

---

## §1 背景与目标

### 1.1 为什么是现在

`README` 双语仍有 4 项 `[ ]`（实测 `raw 43/5 − 图例 1/1 = 42/4`）：

| 项 | 判据 |
|---|---|
| OCR fallback for scanned PDFs | 需引入 OCR 引擎（tesseract / wasm），成本高、体积大 |
| **EPUB parsing** | **本方案** |
| Cross-document study unit / learning path | F7-c，领域实体改动，牵扯 `storage/tauri.ts` + `src-tauri/**` |
| Encrypted sync *(pro tier)* | 明确 Pro 层，不在本地优先范围 |

四项里 OCR 与加密同步分别卡在「引擎体积」与「产品定位」，F7-c 卡在「实体层改动波及 SQLite」；**只有 EPUB 是纯前端纯 TS、且刚好吃到范围 5 的输出层红利**。

### 1.2 目标（Done 标准）

1. 用户在「本地文件」Tab 可选中 `.epub`（拖拽与点选均可），类型徽标显示 `EPUB`；
2. 导入后章节标题 = 书里的章标题（spine 项 / 内部标题），不是「第 1 段」这类兜底名；
3. 加密（DRM）书给出**可行动**的报错，不产出乱码正文；
4. 超大书（解压炸弹 / 正文超限）被前置拦下，不是崩在管道中段；
5. `npm run test:epub` 全绿并并入 `test:library` 聚合链；
6. README 双语 + roadmap + `code-gap-review` 三份回扫对齐。

### 1.3 非目标（明确不做）

| 不做 | 理由 |
|---|---|
| DRM 解密 | 法律与伦理红线；且 Adobe ADEPT / Kindle 各有独立算法 |
| 内嵌图片抽出 | 与 DOCX 先例一致（`skippedImages` 只计数、不内联 base64）；图片进正文会撑爆 localStorage |
| 脚注 / 注释双向跳转 | EPUB3 的 `epub:type="noteref"` 是**阅读器**能力，本项目是「导入成学习资料」，不是重排引擎 |
| CSS 样式还原 | 同上；输出目标是 Markdown，样式信息在转换中必然丢失 |
| 漫画 / 固定版式 EPUB（`rendition:layout=pre-paginated`） | 本质是图片集，抽不出文字；走 `epub-no-text` 报错更诚实 |
| MOBI / AZW3 | 不同容器格式，非 EPUB |

---

## §2 现状实测证据

> 全部为**本轮实测**，非记忆引用。

### 2.1 依赖与体积

```
$ npm ls jszip
personal-learning-os@0.1.0
└─┬ mammoth@1.12.3
  └── jszip@3.10.2
```

`jszip` 不是直接依赖，但已在 `node_modules`。`package.json` 的 `dependencies` 里**没有** `jszip`。

⇒ **提升为直接依赖不新增任何一个包**（与范围 5 把 `base64` 提为直接依赖同款机会）。区别在于：`base64` 是 Rust crate（在 `Cargo.lock`），`jszip` 是 npm 包（在 `node_modules`）。

### 2.2 领域层早已预留

```ts
// src/domain/document.ts:7-13
export type DocumentFormat =
  | "pdf" | "markdown" | "txt" | "docx" | "epub" | "web";
```

⇒ 不需改 domain，不需改 `src-tauri/**`。

### 2.3 已有 epub 痕迹（全仓 Grep 结果）

| 落点 | 内容 | 状态 |
|---|---|---|
| `domain/document.ts:12` | `"epub"` 联合成员 | ✅ 可复用 |
| `i18n/messages/{zh,en}.ts` | `formatLabels.epub: "EPUB"` | ✅ 可复用 |
| `features/learn/render/PlainTextRenderer.tsx:2` | 注释「pdf / docx / epub / web … 默认渲染」 | ✅ 渲染侧已按纯文本处理 |
| `renderer-registry.ts:29` | 同上 | ✅ |
| `i18n/messages/*` | 空间描述「Import PDF / Markdown / TXT / EPUB」 | ⚠️ 文案已承诺 EPUB |
| **`import/` 目录** | **无任何 epub 文件** | ❌ **唯一真缺口** |

⚠️ 注意最后两行：**用户可见文案已经承诺了 EPUB 导入，而功能不存在**。这是「文案先行、功能未跟上」的既存不一致，本方案顺带收口。

### 2.4 待改的接入点（逐个实测）

| 文件 | 行 | 现状 | 需改 |
|---|---|---|---|
| `import/types.ts` | 131 | `LocalFileKind = "md" \| "txt" \| "pdf" \| "docx"` | 加 `"epub"` |
| `import/types.ts` | 144-162 | `classifyLocalFile` 不认 `.epub` → `unsupported` | 加分支 |
| `import/types.ts` | 166 | `stripExtension` 正则无 `epub` | 加 |
| `import/local-files.ts` | 40-45 | `FILE_BYTE_LIMITS` 四键 | 加 `epub`（typecheck 强制） |
| `import/local-files.ts` | 26-34 | `LocalFileErrorKind` 八值 | 加三值 |
| `import/local-files.ts` | 96 | `fileToUnit` 无 epub 分支 | 加 |
| `LocalFilePanel.tsx` | 102 | `accept=".md,.markdown,.mdown,.txt,.pdf,.docx"` | 加 `.epub` |
| `LocalFilePanel.tsx` | 145-150 | `kindLabel` 映射字面量 | 加 `epub:` |
| `i18n/messages/{zh,en}.ts` | 1492 / 1505 | `dropTitle` / `errors` | 加 `.epub` 与三键 |

**好消息**：`TYPE_BYTE_LIMITS` 与 `kindLabel` 都是**映射式**写法（`Record<LocalFileKind, …>`），加 `"epub"` 到联合类型后 **typecheck 会强制你补齐每一处**，不会静默漏掉。这是既有设计的红利。

### 2.5 输出层复用面（实测已验证）

`html-markdown.ts` 对外只暴露：

```ts
export interface HtmlDomNode {
  tagName?: string;
  textContent?: string | null;
  children?: ArrayLike<HtmlDomNode>;
}
export interface HtmlMarkdownResult {
  text: string; headings: number; tables: number;
  skippedImages: number; levels: { min: number; max: number };
}
export function htmlNodesToMarkdown(root: HtmlDomNode): HtmlMarkdownResult;
```

内部已处理三个与 EPUB 直接相关的坑：

| 已有处理 | 对 EPUB 的意义 |
|---|---|
| `tagOf` 做 `.toLowerCase()`（:82-84） | `DOMParser` 产出的 `tagName` 是**大写**（`"H1"`），linkedom 是小写 ⇒ 两边都正确 |
| `childArray` 用 `Array.from`（:87-89） | 生产是 `HTMLCollection`（非真数组），安全 |
| 标题层级归一化（:303-312） | 每个 spine 项**独立**归一化 ⇒ 每项首个标题必为 `#`，天然成章 |

### 2.6 链路探针（已跑通，脚本已删）

在仓库内用 `jszip` 手造一个 2 章最小 EPUB，走完整链路：

```
EPUB bytes: 2206
entries: mimetype, META-INF/, META-INF/container.xml, OEBPS/, OEBPS/content.opf, OEBPS/ch1.xhtml, OEBPS/ch2.xhtml
mimetype: "application/epub+zip"
rootfile: OEBPS/content.opf
dc:title: 探针之书
manifest: [{"id":"c1","href":"ch1.xhtml","mt":"application/xhtml+xml"},{"id":"c2",...},{"id":"nav",...,"props":"nav"}]
spine: ["c1","c2"]
--- CH1 MARKDOWN ---
# 第一章 起点

这是第一章的正文段落，用来验证抽取与切分。

## 1.1 小节

小节正文 强调 与 加粗。

- 父项

  - 子项甲

- 第二项

```
line1
  line2
```
headings: 2 tables: 0 imgs: 1 levels: {"min":1,"max":2}
--- CH2 MARKDOWN ---
# 第二章 终局

第二章正文。
startsWithH1: true
```

**结论**：container → OPF → spine → XHTML → Markdown 整链可行，嵌套列表 / 代码块缩进 / 图片计数 / 标题层级全部正确，且**每个 spine 项的输出天然以 `# 章标题` 开头**。

---

## §3 决策点

> 每项给「推荐档」与「备选」。用户确认推荐档即可开工。

### D1 · 归档读取库 → **推荐：提升 `jszip` 为直接依赖**

| 档 | 做法 | 代价 |
|---|---|---|
| **A（推荐）** | `dependencies` 加 `jszip`（版本与 `mammoth` 用的一致） | **零新增包**（已在 `node_modules`） |
| B | 换 `fflate`（更快更小） | 新增 1 个包，且需重写归档读取 |
| C | 自写 ZIP 解析（只读 central directory + STORED/DEFLATE） | 约 300 行 + 需自己接 `DecompressionStream`，**不值得** |

⚠️ A 档要写清版本策略：`jszip` 目前是 `mammoth` 的传递依赖，**提升为直接依赖后两者共享同一份**，不会出现双实例。若未来 mammoth 换库，`jszip` 仍独立可用。

### D2 · 章节边界来源 → **推荐：spine 项驱动 + 逐项归一化**

这是本方案**最核心的产品决策**。

| 档 | 做法 | 后果 |
|---|---|---|
| **A（推荐）** | 按 `spine` 顺序逐项转 Markdown，每项单独调 `htmlNodesToMarkdown`（最浅标题 → `#`），拼接后交 `splitDocument` 按 `#` 切 | 章边界 = 作者给定的阅读单元，最准 |
| B | 所有 XHTML 正文拼成一个大字符串，只调一次输出层 | 归一化按**全书**最浅标题算 ⇒ 一本书里混用 `h1`/`h2` 当章标题时，`h2` 永远成不了 `#`，**整本切不出章** |
| C | 完全不拼，直接把每个 spine 项变成一个 `Chapter`（绕过切分器） | 要新开一条「预切章」通道，动 `pipeline.ts`，**与现有五阶段管道冲突** |

**A 档的两个必要补充**（否则会出问题）：

1. **spine 项可能非常多**。实测有的 EPUB 一个段落一个文件（几百个 spine 项）⇒ 直接拼会切出几百个「章」。缓解：拼接前按 `minBodyCharsPerChapter`（默认 200）**预合并过短项**到前一章。这条复用切分引擎已有的阈值概念，不新造尺子。
2. **spine 项可能没有标题**。`htmlNodesToMarkdown` 返回 `headings === 0` 时该项无 `#`，正文会粘到前一章。缓解见 D3。

### D3 · 无标题项的兜底 → **推荐：`<title>` > toc label > 序号（三级）**

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | 正文 `h1`–`h6` | 最可信；已由输出层产出 |
| 2 | XHTML 的 `<title>` | 几乎总有（EPUB 规范要求） |
| 3 | `nav.xhtml` / `toc.ncx` 的 label | 需要解析 toc，成本略高 |
| 4 | `第 N 部分` | 最终兜底，**必须本地化**（不能硬编码中文进数据层） |

⚠️ **第 4 档涉及仓库红线**：「数据层不塞文案」。所以第 4 档**不在 `epub.ts` 里生成字符串**，而是回传 `headingFromContent: false` 标记，由 UI 用 i18n 渲染。或者更简单：**不生成占位标题**，让该项正文按 D2 的预合并规则并入前一章——我认为后者更干净（宁可少一章，不要造一个「第 7 部分」的假章）。

⇒ **推荐收敛为**：只在 1/2/3 三档都拿不到时**并入前一章**（不造占位）。这样彻底避开 i18n 污染数据层的问题。

### D4 · XHTML 编码 → **推荐：`async("uint8array")` + 复用 `decodeBytes`**

| 档 | 做法 | 后果 |
|---|---|---|
| **A（推荐）** | 读字节 → `decodeBytes`（BOM/UTF-8/GB18030 嗅探链） | 老书（GBK/GB18030）能救；`encoding` 可回报 |
| B | `async("string")`（jszip 默认 UTF-8） | 非 UTF-8 的 XHTML **静默乱码**，且无任何信号 |

EPUB 3 规范要求内容文档是 UTF-8/UTF-16，理论上 B 够用；但**大量 EPUB 2 老书实际是 GBK**，而「静默乱码」是本仓库明令禁止的兜底方式（G4）。A 档零成本（`decodeBytes` 现成），没有理由不选。

### D5 · 加密 / DRM → **推荐：检测即报错，不尝试解密**

检测 `META-INF/encryption.xml`：

| 情况 | 处置 |
|---|---|
| 文件不存在 | 正常流程 |
| 存在，但只列出字体混淆（`encryption.xml` 里 algorithm = `http://www.idpf.org/2008/embedding`） | **不算 DRM**，继续导入 |
| 存在，且含正文文档加密（其余算法） | 报 `epub-drm`，文案引导「请使用无 DRM 版本」 |

⚠️ 细节：字体混淆是**正常现象**（很多正版书只混淆字体，正文不加密）。一刀切按「有 encryption.xml 就拒绝」会误杀大量合法书。判据必须细到「是否含 `application/xhtml+xml` 条目」。

### D6 · 解压体积护栏 → **推荐：双线（单条目 + 总量）**

ZIP 炸弹是真实威胁：5 MB 的 epub 可解压出 GB 级。

| 线 | 值 | 行为 |
|---|---|---|
| `LIMITS.localEpubBytes`（**文件字节线**） | 20 MB | 与 `localDocxBytes` 同级；超限在 `classifyLocalFile` 前置标红 |
| `LIMITS.epubUnzippedBytes`（**解压总量线**） | 80 MB | 逐条目累加，超限立即中断并报 `epub-too-large` |
| `LIMITS.epubMaxChars`（**入库正文线**） | 1_500_000 | 与其他四来源**同一把尺子** |

⚠️ 三把尺子必须分清楚，**不能合并**：

| 尺子 | 目的 | 归属 |
|---|---|---|
| 文件字节 20MB | 用户选错文件 / 拖动卡顿 | `types.ts::LIMITS` |
| 解压总量 80MB | 防 zip bomb 撑爆内存 | `types.ts::LIMITS` |
| 正文 1.5M 字符 | 入库体量（localStorage / SQLite 行大小） | `types.ts::LIMITS` |

`epubUnzippedBytes` 只能是解压总量的约 4 倍（20MB 文件 → 80MB 解压），不能设成 Infinity（仓库红线：`undefined＝线不存在，禁 Infinity`）。

### D7 · 解析器注入 → **推荐：抽 `html-parse.ts` 共享**

`web-page.ts` 现有：

```ts
export type HtmlParser = (html: string) => Document;
export const browserHtmlParser: HtmlParser = (html) =>
  new DOMParser().parseFromString(html, "text/html");
```

消费方只有 `WebPanel.tsx`（2 处 import）。EPUB 也需要同一对东西。

| 档 | 做法 |
|---|---|
| **A（推荐）** | 抽到 `import/html-parse.ts`，两处 `import` 改指向；`web-page.ts` 保留 re-export 以免断裂 |
| B | EPUB 自己再声明一份 | 两份同义类型，将来改一处漏一处（**第 2 处就要声明「待抽」**，趁现在只有 2 处抽掉最便宜） |
| C | 不注入，EPUB 直接 `new DOMParser()` | node 单测直接炸（`DOMParser` 不是全局），失去可测性 |

**A 档的具体形态**：新建 5 行模块 + `web-page.ts` 改成 `export { type HtmlParser, browserHtmlParser } from "./html-parse";`（re-export 保持零破坏）。

⚠️ 解析用 `"text/html"` 而非 `"application/xml"`：EPUB 里的 XHTML 理论上 well-formed，但实测不少书有未闭合标签；`text/html` 容错，且 `html-markdown.ts` 本来就按 HTML 语义写。

### D8 · 标题与元数据 → **推荐：`dc:title` 只作资料标题兜底**

| 用途 | 来源 |
|---|---|
| 资料标题（`ImportUnit.title`） | **文件名优先**（用户认识的是文件名）；`dc:title` 仅当文件名为空/纯数字时兜底 |
| `titleSource` | 文件名派生 ⇒ `"derived"`（AI 可改名） |

理由：`dc:title` 常含系列名 / 副标题 / 版本号（如「某某全集（第 3 版）」），比文件名更不像用户想看到的标题。

---

## §4 总体设计

### 4.1 模块划分

照搬 DOCX 的**三层**（`docx.ts` / `mammoth-reader.ts` / `docx-markdown.ts`）：

```
src/features/learn/import/
├── epub.ts           新建 · 编排层：魔数 → 加密检测 → 归档 → spine 遍历 → 拼接 → 护栏 → 语义化错误
├── epub-archive.ts   新建 · 库接触面：jszip 唯一触碰点（loadAsync / 条目读取 / container+OPF 解析）
├── html-parse.ts     新建 · HtmlParser 类型 + browserHtmlParser（从 web-page.ts 抽出，5 行）
├── html-markdown.ts  复用 · 零改动（输出层）
└── decode.ts         复用 · 零改动（编码嗅探）
```

| 模块 | 职责边界 | 是否 import 第三方 |
|---|---|---|
| `epub-archive.ts` | **唯一** import `jszip` 的地方；返回纯数据（`{ opfPath, title, items, spine }`），不产 Markdown | `jszip` |
| `epub.ts` | 遍历 spine、调输出层、拼字符串、判护栏；不直接碰 `jszip` 的 API | 无（只 import 上面两个） |
| `html-parse.ts` | 5 行 + 一个类型 | 无 |

**为什么这么切**：将来若把 `jszip` 换成 `fflate`，只改 `epub-archive.ts` 一个文件。这是「库接触面隔离」，与 `mammoth-reader.ts` 同思路。

### 4.2 数据流

```
File.arrayBuffer()
   │
   ├─[1] hasZipMagic(bytes)          魔数 50 4B 03 04（PK\x03\x04）
   │        └─ 否 → EpubBadArchiveError
   │
   ├─[2] JSZip.loadAsync(bytes)      （epub-archive）
   │        └─ 抛错 → EpubBadArchiveError
   │
   ├─[3] hasDrm(entries)             读 META-INF/encryption.xml
   │        └─ 含非字体算法的 xhtml 条目 → EpubDrmError
   │
   ├─[4] 读 META-INF/container.xml
   │        └─ 缺 / 无 full-path → EpubBadArchiveError
   │
   ├─[5] 读 <rootfile> → OPF
   │        ├─ dc:title（D8 兜底用）
   │        ├─ manifest: id → { href, mediaType, properties }
   │        └─ spine: [idref…]
   │
   ├─[6] spine 遍历（D2）
   │        for idref in spine:
   │          item = manifest[idref]
   │          item.mediaType ≠ xhtml → 跳过
   │          bytes = await entry.async("uint8array")
   │          解压累计 += bytes.length   ← 超 epubUnzippedBytes → EpubTooLargeError
   │          text = decodeBytes(bytes.buffer).text      ← D4
   │          dom  = parseHtml(text)                      ← D7 注入
   │          md   = htmlNodesToMarkdown(dom.body ?? dom.documentElement)
   │          if md.headings === 0:
   │              title = <title> 或 toc label            ← D3
   │              title ? md.text = `# ${title}\n\n${md.text}` : 标记「并入前一章」
   │          parts.push(md)
   │
   ├─[7] 过短项预合并（D2 补充 1）：累计正文 < 200 字符的项并入前一章
   │
   ├─[8] text = parts.map(p => p.text).join("\n\n")
   │        └─ length > epubMaxChars → EpubTooLargeError
   │
   └─[9] !text.trim() → EpubNoTextError
             │
             ▼
      EpubExtractResult { text, title?, headings, tables, skippedImages, spineCount }
```

### 4.3 返回类型

```ts
export interface EpubExtractResult {
  /** 归一化 Markdown 正文（spine 顺序拼接）。 */
  text: string;
  /** dc:title（可能缺；仅作资料标题兜底，D8）。 */
  bookTitle?: string;
  /** 产出 `#` 标题数（含兜底补的）。 */
  headings: number;
  /** GFM 表格数。 */
  tables: number;
  /** 跳过的图片数（不内联）。 */
  skippedImages: number;
  /** 实际处理的正文章节数（spine 项去重后），供结果卡展示「本书 N 节」。 */
  spineCount: number;
  /** 采用过的非 utf-8 编码（去重后的列表，供 G4 提示）。 */
  encodings?: string[];
}
```

⚠️ `encodings` 是数组：一本 epub 里不同 XHTML 可能声明不同编码（少见但合法）。回传列表比回传字符串诚实。

### 4.4 与共享管道的接法

`local-files.ts::fileToUnit` 加分支（与 docx 同构）：

```ts
if (cls.kind === "epub") {
  const out = await extractEpubMarkdown(await file.arrayBuffer(), { parseHtml });
  return {
    title: title || out.bookTitle || fallbackTitle,   // D8
    format: "epub",                                    // ← domain 已支持
    splitFormat: out.headings > 0 ? "markdown" : "txt", // 与 docx / pdf 同策略
    text: out.text,
    source,
    extract: { headings: out.headings, tables: out.tables },
  };
}
```

⚠️ `format: "epub"` 而非 `"markdown"`：README 已承诺 EPUB 是独立格式，且 `PlainTextRenderer` 已按纯文本处理 `epub`。若这里偷懒写 `"markdown"`，资料卡会显示成 Markdown 类型，与用户的认知不符。

---

## §5 归档层设计（`epub-archive.ts`）

### 5.1 对外接口

```ts
export interface EpubManifestItem {
  id: string;
  href: string;       // 相对 OPF 所在目录
  mediaType?: string;
  properties?: string;
}

export interface EpubPackage {
  /** OPF 在 zip 内的完整路径（已解析相对路径）。 */
  opfPath: string;
  /** 从 OPF 解出的根目录（用于拼 href）。 */
  opfDir: string;
  title?: string;
  manifest: Map<string, EpubManifestItem>;
  spine: string[];               // idref 顺序
  /** 已解包的 zip 句柄（供 epub.ts 逐项读字节）。 */
  zip: JSZip;
}

export async function openEpub(buffer: ArrayBuffer): Promise<EpubPackage>;
export async function readEntryBytes(pkg: EpubPackage, path: string): Promise<Uint8Array | undefined>;
```

### 5.2 关键实现要点

| 要点 | 做法 |
|---|---|
| **魔数** | `50 4B 03 04`（`PK\x03\x04`）；空 zip（`PK\x05\x06`）也拒 |
| **mimetype 校验** | **可选**。很多 epub 的 mimetype 未 STORED（不合规但常见）⇒ **不做硬校验**，只在使用 container.xml 失败时作为辅助提示 |
| **路径规范化** | OPF 里的 `href` 是**相对 OPF 目录**的，且可能含 `../`；用 `posix.join(opfDir, href)` 归一，再 `encodeURIComponent` 解码 |
| **大小写** | zip 条目路径**大小写敏感**，但有些书写作 `OEBPS/` 有些 `oebps/` ⇒ 读取失败时做一次**大小写不敏感回退查找** |
| **XML 解析** | 用正则抽 `<rootfile full-path>` / `<item>` / `<itemref>`，**不引 XML 解析器**。理由：OPF 结构简单且格式固定，引 `xmldom` 是过度设计；但要处理 `/>` 与 `></item>` 两种闭合 |
| **命名空间** | `<dc:title>` 前缀可能是 `dc:` 也可能是默认 ns；正则里同时容忍 `dc:title` 与 `title` |
| **DRM 判定** | 见 D5：`encryption.xml` 里逐 `<EncryptedData>` 看 `CipherReference URI` 是否指向 xhtml，以及 `EncryptionMethod Algorithm` 是否为字体混淆 |

### 5.3 为什么不用 XML 解析器

- `linkedom` 是 **devDependency**，生产不能用；
- webview 的 `DOMParser` 可以解析 XML，但 `epub-archive.ts` 是**纯逻辑层**（要 node 可测），不能依赖全局；
- OPF/container.xml 的所需字段都可用 3 条正则稳定抽取（`full-path` / `<item …>` / `<itemref …>`）；
- 引入 `fast-xml-parser` 是**新增依赖**，与本方案「零新增」目标冲突。

⇒ 正则 + 明确的容错（两种闭合、可选前缀、属性顺序无关）。

---

## §6 编排层设计（`epub.ts`）

### 6.1 对外接口

```ts
export interface EpubLimits {
  epubMaxChars: number;
  epubUnzippedBytes: number;
  /** 过短 spine 项预合并阈值（默认 200，与切分引擎 minBodyCharsPerChapter 同值）。 */
  minItemChars?: number;
}

export interface EpubDeps {
  parseHtml: HtmlParser;
}

export async function extractEpubMarkdown(
  buffer: ArrayBuffer,
  deps: EpubDeps,
  limits?: Partial<EpubLimits>,
): Promise<EpubExtractResult>;
```

`limits` 可注入（测试用小值验证护栏），默认取 `LIMITS.*`——与 `web-page.ts::buildWebUnit(deps, limits)` 同款签名风格。

### 6.2 错误类型（语义化 class，不携带用户文案）

```ts
export class EpubDrmError extends Error {}         // 加密保护
export class EpubBadArchiveError extends Error {}  // 非 zip / 缺 container / 缺 OPF
export class EpubNoTextError extends Error {}      // 抽不到正文
export class EpubTooLargeError extends Error {}    // 解压总量 / 正文字符超限
```

对齐 `docx.ts` 的 `name` 模式；`local-files.ts` 用 `instanceof` 映射为 kind。

### 6.3 DRM 判定细则（D5 落地）

```
encryption.xml 存在？
├─ 否 → 正常
└─ 是 → 逐 <EncryptedData>
         ├─ Algorithm = idpf.org/2008/embedding（字体混淆）→ 忽略这条
         └─ CipherReference URI 以 .xhtml/.html/.htm 结尾
              → EpubDrmError
```

无 `EncryptedData` 的 `encryption.xml`（空容器）⇒ 忽略。

---

## §7 UI 接入

### 7.1 `LocalFilePanel.tsx`

| 位置 | 改动 |
|---|---|
| :102 `accept` | `.md,.markdown,.mdown,.txt,.pdf,.docx,.epub` |
| :145-150 `kindLabel` 映射 | 加 `epub: fmt.local.kindEpub` |
| :2 文件头注释 | 「.md / .txt / .pdf / .docx / .epub」 |

### 7.2 i18n（zh / en 成对）

| 键 | zh | en |
|---|---|---|
| `learn.import.local.kindEpub` | `EPUB` | `EPUB` |
| `learn.import.local.dropTitle` | 追加 `/ .epub` | 追加 `/ .epub` |
| `learn.import.local.errors.epub-drm` | `这本书有加密保护（DRM），请换无 DRM 的版本` | `This book is DRM-protected; please use a DRM-free copy` |
| `learn.import.local.errors.epub-bad-zip` | `文件损坏或不是有效的 EPUB` | `Corrupted or not a valid EPUB` |
| `learn.import.local.errors.epub-no-text` | `未能从这本书提取到正文（可能是纯图片排版）` | `No text could be extracted (possibly an image-only layout)` |
| `learn.import.local.errors.unsupported` | 现值需追加 `.epub` | 同 |

⚠️ `errors` 是 `Record<LocalFileErrorKind, string>` ⇒ 加三个 kind 后 **typecheck 强制两语都补齐**。

### 7.3 结果卡

无需改：`extract.headings` / `tables` 已由结果卡渲染。

---

## §8 测试策略

新建 `tests/import-epub.test.ts`，`npm run test:epub`，并**并入 `test:library` 聚合链**（31 → 32 套件）。

### 8.1 fixture 生成方式

**不落二进制文件**：测试内用 `jszip` 现场造 epub（与探针同法），参数化构造不同形态。

```ts
function makeEpub(opts: { chapters: number; title?: string; drm?: boolean; ... }): Promise<ArrayBuffer>
```

理由：二进制 fixture 进 git 会膨胀且不可读；现场构造让每个用例的意图一眼可见。

⚠️ 测试里 `jszip` 需是**直接依赖**才 `import` 得干净（D1 的另一好处）。

### 8.2 用例分组

| 组 | 覆盖 | 数量 |
|---|---|---|
| **A 归档解析** | container → rootfile；缺 container；缺 OPF；大小写回退；`../` 相对路径 | 5 |
| **B spine 编排** | 2 章顺序；跳过非 xhtml 条目；spine 为空；spine 项重复 idref | 4 |
| **C 标题** | 正文有 `h1` → 用正文；只 `h2` → 归一化为 `#`；无标题有 `<title>` → 补；两者都无 → 并入前章 | 4 |
| **D 编码** | UTF-8 BOM；GB18030（无声明，靠嗅探）；`encodings` 回报 | 3 |
| **E 错误** | DRM（xhtml 加密）→ `epub-drm`；字体混淆 → **不**报错；空正文 → `epub-no-text`；非 zip → `epub-bad-zip` | 4 |
| **F 护栏** | 解压总量超限；正文字符超限；文件字节超限（走 `classifyLocalFile`） | 3 |
| **G 契约** | `format === "epub"`；`splitFormat` 随 headings 切换；结果走 `runUnitImport` | 3 |
| **H 卫生** | `epub-archive.ts` 是唯一 import jszip 的文件（源码断言）；`epub.ts` 不 import jszip | 2 |

合计约 **28 项**。

### 8.3 关键守卫

- **H 组**锁死「库接触面隔离」，防止将来有人图省事在 `epub.ts` 里直接 `import JSZip`；
- **E 组**的「字体混淆不报错」是 D5 的回归防线（这条最容易被后来者「简化」成一刀切）；
- **C 组**的「两者都无 → 并入前章」锁住 D3 的收敛结论（不造占位标题）。

---

## §9 影响面盘点

| 类别 | 文件 | 改动量 |
|---|---|---|
| **新建** | `import/epub.ts` | ~180 行 |
| | `import/epub-archive.ts` | ~200 行 |
| | `import/html-parse.ts` | ~10 行 |
| | `tests/import-epub.test.ts` | ~380 行 |
| **修改** | `package.json` | deps `jszip` + `test:epub` + 并入 `test:library` |
| | `import/types.ts` | `LocalFileKind` + 3 常量 + `classifyLocalFile` + `stripExtension` |
| | `import/local-files.ts` | 错误 kind 3 值 + 字节线 + 分支 |
| | `import/web-page.ts` | 2 处改 re-export |
| | `LocalFilePanel.tsx` | accept + 徽标映射 |
| | `i18n/messages/{zh,en}.ts` | `kindEpub` + 3 个 error + dropTitle |
| **不动** | `src-tauri/**` | 零（`DocumentFormat` 已含 epub） |
| | `html-markdown.ts` | 零复用 |
| | `pipeline.ts` | 零（走同一入口） |

---

## §10 任务拆解预告

确认后建 `docs/epub-import-task-runbook-2026-10.md`，预计 T1–T12：

| 任务 | 内容 | 可独立提交 |
|---|---|---|
| T1 | `html-parse.ts` 抽取 + `web-page.ts` re-export | ✅ |
| T2 | `LIMITS` 三常量 + `LocalFileKind` + `classifyLocalFile` + `stripExtension` | ✅ |
| T3 | `epub-archive.ts`（归档层） | ✅ |
| T4 | `epub.ts`（编排层） | ✅ |
| T5 | `local-files.ts` 接线 | ✅ |
| T6 | `tests/import-epub.test.ts`（28 项）+ `test:epub` | ✅ |
| T7 | `package.json` 并入 `test:library` | ✅ |
| T8 | i18n 四键（zh/en） | ✅ |
| T9 | `LocalFilePanel` accept + 徽标 | ✅ |
| T10 | README 双语 `[x]` + 计数 43/3 | ✅ |
| T11 | roadmap / code-gap-review / knowledge-import 回扫 | ✅ |
| T12 | 桌面手工验收（用户实跑） | — |

提交分组原则：i18n 早于 UI；每提交 `typecheck` 必绿（`Record` 约束会强制同批补齐）。

---

## §11 风险与缓解

| 风险 | 概率 | 缓解 |
|---|---|---|
| 真实 epub 形态远比 fixture 复杂（嵌套目录、`../` 引用、`%20` 编码 href） | **高** | A 组专项用例 + 大小时写回退 + `posix.normalize`；**T12 必须用真实书验收** |
| spine 项极多（几百）导致切出几百章 | 中 | D2 的预合并阈值（200 字） |
| 字体混淆被误判成 DRM | 中 | D5 细则 + E 组回归用例 |
| `jszip` 提升为直接依赖后与 mammoth 版本分裂 | 低 | 用同一 semver 范围；`npm ls jszip` 复核单实例 |
| `text/html` 解析 XHTML 时命名空间标签（`<epub:switch>`）被当未知元素 | 低 | `html-markdown.ts` 的 `walk` 对未知标签走默认分支（递归子节点），不会丢内容 |
| 正文尺子 1.5M 对整本书偏小 | **中** | 一本 30 万字中文书 ≈ 30 万字符，1.5M 足够；但含大量重复页眉的书可能超 ⇒ 超限报错文案需说明「请拆分后导入」 |

---

## §12 实施偏差记录（方案 vs 落地）

> 只记**与方案不同**的地方。结论未被推翻的不记。

| # | 方案怎么写 | 实际怎么落地 | 为什么 |
|---|---|---|---|
| 1 | D2 补充 1 说「按 `minBodyCharsPerChapter`（200）**预合并过短项**」 | `minItemChars` 只用于**无正文标题**的项：有 `h*` 标题的项**再短也保留**，只把「无标题且过短」的并入前章 | 标题本身就是结构信号。按字数一刀切会把「序」「上卷」这类真章并掉，反而丢了作者给的结构 |
| 2 | §4.4 伪代码 `extractEpubMarkdown(buf, { parseHtml })` 没说 `parseHtml` 从哪来 | `fileToUnit(file, deps?)` 加**可选第二参** `LocalFileDeps`，生产缺省 `browserHtmlParser` | node 下没有 `DOMParser` 全局；不给注入点就没法单测 epub 分支（`fileToUnit` 是端到端入口） |
| 3 | 未预见 | **必须改 `mammoth-reader.ts`**：`jszip` 的 d.ts 把 `@types/node` 的 `Buffer` 带进编译作用域，`mammoth` 的 `Input` 随之收紧 ⇒ `mammothInput` 的 node 分支要 `as unknown as` | 引入 `jszip` 的连带影响。原注释「本仓未引入 `@types/node` 全局」是**依赖「没人 import 带 node 类型的包」**的隐式假设，被本方案推翻；运行时行为零变化（`test:docx` 22/22 守护） |
| 4 | §8.1 说 fixture 用 jszip 现场造 | ✅ 照做；但测试适配器 `parseHtml` 必须取 `parseHTML(html).document` | `linkedom` 的 `parseHTML` 返回 `{ document, window, … }` 而非 `Document`；直接 cast 整个对象会让 `dom.body` 恒 `undefined`，**全部用例都报 `no-text`**（踩过一次） |
| 5 | §5.1 接口只列 `openEpub` / `readEntryBytes` | 另导出 `entryPath` / `hasZipMagic` / `detectTextDrm` / `decodeXmlEntities` | 前三个被 `epub.ts` 与单测直接使用；`decodeXmlEntities` 导出是为了避免 `epub.ts` 再写一份 `<title>` 实体解码 |
| 6 | §5.1 `EpubPackage` 未列 `opfDir` | 加 `opfDir` 字段 | 拼接 spine 条目 href 必需（`href` 是相对 OPF 目录的） |
| 7 | §8.2 F 组 3 项含「文件字节超限（走 `classifyLocalFile`）」 | `File.size` 由内容决定、**无法伪造** ⇒ 文件字节线只测 `classifyLocalFile`；`fileToUnit` 侧改测「坏包 → `epub-bad-zip`」 | 造 20MB+1 的真 `File` 只为测一个常量比较，不值得；后者能覆盖「错误 kind 映射」这个更有价值的路径 |
| 8 | §3 D3 第 4 档曾设想「`第 N 部分`」兜底 | **实现里没有第 4 档** —— 三档都拿不到就并入前章 | 方案 §3 D3 已自行收敛到此结论（造占位标题等于把文案塞进数据层），实现比方案正文更彻底 |

---

## §13 变更记录

| 日期 | 内容 |
|---|---|
| 2026-10-16 | 初版。D1–D8 全部给推荐档；链路探针（jszip → container → OPF → spine → html-markdown）已跑通，脚本已删 |
| 2026-10-19 | **实施完成**（T1–T8）。实施偏差 8 条见 §12；门禁结果见 runbook「本轮门禁结果」。新增 `html-parse.ts`（从 `web-page.ts` 抽出，re-export 零破坏）· `epub-archive.ts`（jszip 唯一接触面）· `epub.ts`（编排）· `tests/import-epub.test.ts`（28 项）。⚠️ 连带修改 `mammoth-reader.ts`（偏差 #3） |
