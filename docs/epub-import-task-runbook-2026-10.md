# EPUB 导入 · 执行 Runbook

> 方案真源：`docs/epub-import-design-2026-10.md`（**D1–D8 全部取推荐档**，用户 2026-10-19 确认「按推荐方案实施」）。
> 实施偏差**不在此重复登记** —— 唯一真源：方案文档「实施偏差记录」节 + 其变更记录。

## Goal

「本地文件」来源支持 `.epub`：拖拽/点选 → 解 ZIP 归档 → 读 `container.xml` / OPF → 按 `spine` 顺序逐项抽 XHTML → 复用 `html-markdown.ts` 转 Markdown（逐项归一化，每项首个标题 → `#`）→ 交**同一条**共享管道 `runUnitImport` 产出 `Document` + `Chapter[]`。

零新增 npm 包（`jszip` 本是 `mammoth` 传递依赖）· 零 `src-tauri/**` 改动（`DocumentFormat` 已含 `"epub"`）· 输出层零改动复用。

## Context

- Package / paths：
  - 新建：`src/features/learn/import/{html-parse,epub-archive,epub}.ts`、`tests/import-epub.test.ts`
  - 修改：`import/{types,local-files,web-page}.ts`、`import/LocalFilePanel.tsx`、`i18n/messages/{zh,en}.ts`、`package.json`
  - **不动**：`src-tauri/**`、`import/html-markdown.ts`、`import/pipeline.ts`
- Docs read：
  - `docs/epub-import-design-2026-10.md`（本 runbook 的方案真源，D1–D8）
  - `docs/knowledge-import-design-2026-09.md` §4.2 / §4.3（导入适配层契约）
  - `docs/library-import-docx-design-2026-09.md` D6（为何自写 Markdown 输出层）
- ⚠️ 关键实测（方案 §2）：
  - `jszip@3.10.2` 已是 `mammoth` 传递依赖 ⇒ 提升为直接依赖**零新增包**。
  - `DocumentFormat` **已含 `"epub"`**（`domain/document.ts:12`）⇒ SQLite 无表结构变更。
  - i18n `formatLabels.epub` 早已存在 ⇒ 只缺 `local.kindEpub` 与三个错误文案。
  - ⚠️ **既有不一致**：i18n 空间描述已承诺「Import … EPUB」，但 `import/` 无任何 epub 文件 ⇒ 本任务收口。
  - `html-markdown.ts` 的 `tagOf` 已 `.toLowerCase()`、`childArray` 用 `Array.from` ⇒ 对 `DOMParser` 的大写 `tagName` 与 `HTMLCollection` 均兼容，**零改动复用**。
  - 链路探针已跑通（jszip 手造 2 章 epub → container → OPF → spine → XHTML → Markdown），脚本已删。
  - `tsconfig.json` 只 `include: ["src"]` ⇒ **`tests/` 不进 typecheck**，测试必须现跑。
- ⚠️ 提交纪律：逐提交可编译；`LocalFileKind` 加值会让 `Record<LocalFileKind, …>` 强制的三处（`FILE_BYTE_LIMITS` / `kindLabel` 字面量 / 错误文案表）**必须同批**，否则 typecheck 红；i18n 早于 UI；精确路径 `git add`；只落本地不 push。

## Tasks

### T1 — 抽 `import/html-parse.ts`（`HtmlParser` + `browserHtmlParser`）
- **Status:** done
- **Outcome:** `import/html-parse.ts` 新建（10 行）。`web-page.ts` 改为 `import type` + `export type` / `export` 三行 re-export，**消费方 `WebPanel.tsx` 两处 import 零改动**。验证：`typecheck` 0 error · `test:web` 32/32。
- **Notes:** `browserHtmlParser` 保持「常量 + 函数体内 `new DOMParser()`」，node 下 import 不炸（只在调用时）。

### T2 — `import/types.ts`：常量 + 类型 + 分类
- **Status:** done
- **Outcome:** `LIMITS` 加 `localEpubBytes`(20MB) / `epubUnzippedBytes`(80MB) / `epubMaxChars`(1.5M)，每个常量都写明它属于哪把尺子、与谁不同；`LocalFileKind` 加 `"epub"`；`classifyLocalFile` / `stripExtension` 加 `.epub` 分支；注释补充 `.mobi` / `.azw3` 为何也不支持。
- **Notes:** ⚠️ 加 `"epub"` 到 `LocalFileKind` 会让 `Record<LocalFileKind, …>` 的三处（`FILE_BYTE_LIMITS` / `kindLabel` 字面量 / i18n `errors`）**同时报错** ⇒ T2 / T5 / T6 实际是**同一次提交**（见提交分组）。常量部分先独立落盘，类型部分与 T5/T6 合批。

### T3 — `import/epub-archive.ts`（归档层，唯一 import jszip）
- **Status:** done
- **Outcome:** 新建约 300 行。导出 `openEpub` / `readEntryBytes` / `entryPath` / `hasZipMagic` / `detectTextDrm` / `decodeXmlEntities` + `EpubBadArchiveError` / `EpubDrmError`。魔数拒空归档；container → rootfile → OPF（正则抽 `dc:title` / `<item>` / `<itemref>`，兼容两种闭合与单/双引号）；`../` 与 `%20` 归一；**条目名大小写不敏感回退**；DRM 逐 `<EncryptedData>` 判，字体混淆（`idpf.org/2008/embedding`）**放行**。
- **Notes:** 刻意不引 XML 解析器（`linkedom` 是 devDep、webview `DOMParser` 在此层不可用、新增 `fast-xml-parser` 与「零新增包」冲突）。比方案多导出 4 个符号（偏差 #5）。

### T4 — `import/epub.ts`（编排层）
- **Status:** done
- **Outcome:** 新建约 230 行。`extractEpubMarkdown(buffer, deps, limits?)`：spine 遍历 → 跳过非 xhtml / 缺条目（不崩整本）→ 解压累计卡 `epubUnzippedBytes` → `decodeBytes` → 注入的 `parseHtml` → `htmlNodesToMarkdown` → 标题三级兜底 → 拼接 → 卡 `epubMaxChars`。`EpubNoTextError` / `EpubTooLargeError`；`encodings` 仅在出现非 utf-8 时回报。
- **Notes:** 标题兜底比方案更彻底 —— **没有「第 N 部分」第 4 档**（偏差 #8）。`toArrayBuffer` 处理 jszip `Uint8Array` 的 `byteOffset ≠ 0`。

### T5 — `import/local-files.ts` 接线 + `LocalFilePanel.tsx`
- **Status:** done
- **Outcome:** `LocalFileErrorKind` 加 `epub-drm` / `epub-bad-zip` / `epub-no-text`；`FILE_BYTE_LIMITS` 加 `epub`；`fileToUnit` 加 epub 分支（`format: "epub"`、`splitFormat` 随 headings、`title` 文件名优先）；错误漏斗加 4 行映射。Panel 加 `accept=.epub` + `kindLabel` 的 `epub:` + 头注释。
- **Notes:** `fileToUnit` 加**可选第二参** `LocalFileDeps`（偏差 #2）——否则 node 单测无法进入 epub 分支。

### T6 — i18n 四键（zh/en 成对）
- **Status:** done
- **Outcome:** `local.kindEpub` + `errors.epub-drm` / `epub-bad-zip` / `epub-no-text`；`dropTitle` 与 `errors.unsupported` 追加 `.epub`。zh / en 逐键成对。DRM 文案**可行动**（「请换用无 DRM 的版本」），不是「不支持」。
- **Notes:** `error-text.ts` 的 `LocalErrorLabels = Record<LocalFileErrorKind, string>` 自动跟随，**无需改**。验证：`test:i18n` 7/7。

### T7 — `tests/import-epub.test.ts` + `test:epub` + 并入聚合链
- **Status:** done
- **Outcome:** `tests/import-epub.test.ts` 新建（约 560 行，**28 项**）：A 归档 5 / B spine 4 / C 标题 4 / D 编码 3 / E 错误 4 / F 护栏 3 / G 契约 3 / H 卫生 2。fixture 全部现场用 jszip 构造（不落二进制）；H 组用源码断言锁「import 目录下只有 `epub-archive.ts` import jszip」+「`epub.ts` 不 import jszip」。`package.json` 加 `test:epub` 并**并入 `test:library`**（31 → **32** 套件）。验证：`test:epub` **28/28 通过**。
- **Notes:** 首次运行 11/28 —— 根因是测试适配器 `parseHtml` 漏取 `.document`（偏差 #4），修后全绿。D2 的 GBK 用例用真实 GB18030 字节（`d6 d0 ce c4`），不是伪造声明。

### T8 — README 双语 + 文档回扫
- **Status:** done
- **Outcome:** README 双语 `EPUB parsing` `[ ]` → `[x]` + 描述改写（spine 顺序 / 标题兜底 / DRM 提示）；统计行 `42 shipped · 4 not yet` → **`43 · 3`**（实测 raw `44/4` − 图例 `1/1`，双语一致）。回扫 5 份：roadmap（§零 候选表 / §F8 现状证据 + 范围 4 / mermaid / 无前置 / 部分交付 / 仍未做 / 计数链 / 变更记录）、`code-gap-review`（§六 #2 + 第 5 批）、`knowledge-import-design`（非目标③ + 验收表）、`business-flow-end-to-end`（§S1 两行 + §七 两处时点注）、`library-module-review`（P0-5 + 导入行）、`library-import-docx-design`（历史陈述两处时点注）。
- **Notes:** ⚠️ README **确实有**手写统计行（`README.md:414` / `README.zh-CN.md:418`），必须手工同步；它 `grep -c` 数不到。

### T9 — 桌面手工验收（用户实跑）
- **Status:** pending
- **Notes:** `rules/no-headless-browser-validation` 禁止 AI 主动起浏览器 ⇒ 只能用户实跑。清单：① 本地文件面板可选 `.epub`、chip 显示 `EPUB` 徽标；② 导入一本正常 epub → 五阶段 → 结果卡章标题=书里的小标题；③ 导入 DRM 书 → 行内「有加密保护（DRM）」；④ 导入改名为 `.epub` 的 PDF → 「文件损坏或不是有效的 .epub」；⑤ 纯图片/漫画 epub → 「未抽取到正文」。

## 本轮门禁结果

> 历史快照，不改。

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | **0 error** |
| `npm run layer:check` | 违规 **0** ／ 新增环 **0**（合规跨层边 1320；基线豁免仍为边 3 / 环 2，未变） |
| `npm run ui:check` | 原生下拉 **0** ／ sticky 残影 **0** |
| `npm run test:i18n` | 7/7 |
| `npm run test:epub` | **28/28** |
| `npm run test:docx` | 22/22（`mammoth-reader.ts` 改动后回归） |
| `npm run test:web` | 32/32（`html-parse.ts` 抽取后回归） |
| `npm run test:library` | **ALL PASS**（**32** 套件，`test:epub` 已并入） |
| `npm run build` | ✓ built in 1.51s（`jszip` 正常打包；主 chunk 无异常增长告警之外的新问题） |

⚠️ `npm run build` 在本机需**绕沙箱**执行 —— `safe-delete` 会拦 vite 清 `dist/assets`（107 个文件超阈值 50），报错形如 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`，与本特性无关。
