# URL 抓取网页导入 · 执行 Runbook

> 方案真源：`docs/url-import-design-2026-10.md`（**D1–D9 全部取推荐档**，用户 2026-10-16 确认「按推荐方案实施」）。
> 实施偏差**不在此重复登记** —— 唯一真源：方案文档「实施偏差记录」节 + 其变更记录。

## Goal

导入弹窗新增第四个来源 Tab「网页」：粘贴 http(s) 链接 → Rust 侧抓取原始字节 → TS 侧判编码 + Readability 提正文 → DOM→Markdown 输出层（含标题层级归一化）→ 交**同一条**共享管道 `runUnitImport` 产出 `Document` + `Chapter[]`，与 GitHub 导入同口径（一次快照、可重导入、走查重、后台向量化/整理自动生效）。

**这是本仓库首次在 `src-tauri/**` 开一道口**（方案 §8.1–§8.2），边界严格限定为 1 个新文件 + 2 行（`Cargo.toml` 依赖 / `lib.rs` 注册）；零新 crate（`reqwest` / `futures-util` / `base64` 均已在依赖图）；零存储改动（无新 key、无迁移、F4 导出白名单不动）。

## Context

- Package / paths：
  - Rust：`src-tauri/src/net.rs`（新增）、`src-tauri/Cargo.toml`、`src-tauri/src/lib.rs`
  - TS 纯逻辑：`src/features/learn/import/{web-error,desktop-fetch,html-markdown,web-page}.ts`（新增）
  - TS 类型 / 文案：`src/features/learn/import/{types,error-text}.ts`
  - UI：`src/features/learn/import/WebPanel.tsx`（新增）、`src/features/learn/ImportModal.tsx`
  - i18n：`src/i18n/messages/{zh,en}.ts`
  - 测试：`tests/import-web.test.ts`（新增）、`package.json`
- Docs read：
  - `docs/url-import-design-2026-10.md`（本 runbook 的方案真源，D1–D9）
  - `docs/knowledge-import-design-2026-09.md` §4.2 / §4.3（导入适配层契约）、§7.3 / §8.7（来源面板职责）
  - `docs/library-import-docx-design-2026-09.md` D6（为何自写 Markdown 输出层）
  - `skills/tauri-ipc/SKILL.md`（命令落点 → `lib.rs` 注册 → `src/**` 薄封装）
  - `rules/rust.mdc`（`Result<T,String>` 字面约定）、`rules/layer-import-boundaries.mdc`、`rules/no-headless-browser-validation.mdc`、`rules/dropdown-select.mdc`
- ⚠️ 关键实测（方案 §3.3）：
  - **CORS 挡死 webview 直抓** ⇒ 唯一可行路径是 Rust 发请求（GitHub 能行是对方主动发 ACAO）。
  - `base64` 0.22.1 / `encoding_rs` 已在 `Cargo.lock` ⇒ 提升为直接依赖 = 零新增 crate。
  - `reqwest` features 无 `charset` ⇒ 编码判定**必须**留 TS（复用 `decode.ts`），否则 GBK 页乱码。
  - `@mozilla/readability@0.6.0`：零运行时依赖、自带 `index.d.ts`、可被 node ESM import。
  - `linkedom` 片段解析 **`body` 为空**，内容在 `documentElement.children` ⇒ DOM→Markdown 入口必须自带 `<body>` 包裹。
  - Readability 小文档下 **`nav` 会残留**、且会把 `h1` 降级 `h2` ⇒ 输出层必须自己跳噪声 + 做层级归一化。
  - `tsconfig.json` 只 `include: ["src"]` ⇒ **`tests/` 不进 typecheck**，测试必须现跑。
- ⚠️ 提交纪律：`tsconfig` 不含 `tests/`；逐提交可编译；i18n 键先于 UI；精确路径 `git add`；只落本地不 push。

## Tasks

### T1 — `src-tauri/src/net.rs`（命令 + 纯函数单测）
- **Status:** done
- **Outcome:** `src-tauri/src/net.rs` 新建（约 215 行）。`fetch_url(url) -> Result<FetchedPage, String>`；`MAX_FETCH_BYTES = 5MiB` / `TIMEOUT_SECS = 20` / `MAX_REDIRECTS = 5` / 固定 UA；流式累积卡上限（超限立即中断连接）；错误全部走 `token()` 机器令牌。`#[cfg(test)]` 两组 5 项纯函数用例（`scheme_allowed` 正反两面 / `token` 格式契约），**不联网**。验证：`~/.cargo/bin/cargo test --lib` → **74 passed / 0 failed**（其中新增 5 项）。
- **Notes:** 非 2xx 在流式读取**之前**返回 ⇒ 不白读大响应体。`bytes_stream()` 消费 `res`，故终址与 Content-Type 必须先取出。

### T2 — `Cargo.toml` + `lib.rs` 注册
- **Status:** done
- **Outcome:** `src-tauri/Cargo.toml` 加 `base64 = "0.22"`（0.22.1 本就是 reqwest 传递依赖 ⇒ 零新增 crate，`Cargo.lock` 未变）。`src-tauri/src/lib.rs`：`mod net;` 插在 `memory_doc` / `tray` 之间；`generate_handler![…]` 在 `db_clear_library` 之后追加 `net::fetch_url,`。验证：同上 cargo 编译 + 单测通过。
- **Notes:** 本仓库**首次**在 `src-tauri/**` 开网络口；未动 `capabilities/`（自定义命令默认可达，与 `vault_*` / `backup_*` 同）。

### T3 — `import/html-markdown.ts`（DOM → Markdown 输出层）
- **Status:** done
- **Outcome:** 新建（约 300 行）。导出 `HtmlDomNode` / `HtmlMarkdownResult` / `htmlNodesToMarkdown(root)`。跳噪声标签整棵（16 个标签，**不依赖 Readability 清干净**）；`pre` 走 `rawText`（完全保留缩进）；`a` 只取文字（D7）；`img` 跳过 + 计数；列表含嵌套（缩进一层）；GFM 表格（穿透 thead/tbody/tfoot）；D6-A 标题层级归一化在**渲染期**做。
- **Notes:** 相对方案伪代码 3 处实现修正（已登记方案偏差表）：① 用**结构化 Block 条目**而非「拼字符串 + `shiftHeading` 正则位移」（代码块内容同样可能行首 `#`，正则位移会误改）；② `rawText` **完全保留行内缩进**（原伪代码的 `^[ \t]+|[ \t]+$/gm` 会把代码块缩进剥光）；③ 块间以 `\n\n` 连接、空块过滤，取代 `tidy` 的全文本 `\n{3,}` 归并（前者不会动代码块内部空白）。另加 `pushList` 嵌套支持（`depth` 参数）。

### T4 — `import/web-page.ts`（URL/编码/提取/编排）
- **Status:** done
- **Outcome:** 新建（约 200 行）。导出 `HtmlParser` / `browserHtmlParser` / `WebUnitLimits` / `parseWebUrl` / `htmlCharsetOf` / `decodeHtml` / `isBinaryContentType` / `WebUnitDeps` / `buildWebUnit`。`fetchPage` 注入 ⇒ 不联网可测。`FetchedPage` **仅 `import type`**（运行时零依赖桌面桥）。验证：`typecheck` 0 error；`test:web` 32/32。
- **Notes:** `format: "web"` 直接可用（`DocumentFormat` 早已含该成员 ⇒ domain 零改动）。正文超 `webMaxChars` 抛 `too-large`、不静默截断。

### T5 — `import/web-error.ts` + `import/desktop-fetch.ts`
- **Status:** done
- **Outcome:** `web-error.ts`（约 90 行）：`WebErrorKind` 七类 + `WebImportError` + `webErrorKindOf(token)`（令牌 → 类别唯一解析点；未知令牌归 `network` 不崩）。`desktop-fetch.ts`（约 60 行）：`FetchedPage` 镜像 + `isWebImportAvailable()` + `fetchUrl()`（`isTauri()` 守卫 + 令牌转译）。验证：`test:web` 中 TC-UC03-01 / TC-EDGE-04 / 05 / 21 全绿。
- **Notes:** 独立成模块破环（`web-page` ⇄ `desktop-fetch`）——`TC-EDGE-18` 锁住纯逻辑层零 Tauri 依赖。

### T6 — `import/types.ts` + `import/error-text.ts`
- **Status:** done
- **Outcome:** `ImportTab` 加 `"web"`；`LIMITS.webMaxChars = 1_500_000`（注释写明与 `pasteMaxChars` / `githubTotalChars` / `docxMaxChars` **同一把尺子**，与 Rust `MAX_FETCH_BYTES` 的传输护栏**目的不同**）；`WebErrorLabels` + `webErrorText()`。同步更正两处过时注释：`format` 列出 `web`、`extract` 由「仅本地文件来源填充」改为「本地文件来源与网页来源填充」。验证：`typecheck` 0 error；`test:web` 的 TC-EDGE-19/20 全绿。
- **Notes:** `Record<WebErrorKind, string>` ⇒ 新增 kind 时 typecheck 强制 zh/en 同时补齐（既有 G2 机制自动生效）。

### T7 — i18n zh/en（`sourceTab.web` + `learn.import.web.*`）
- **Status:** done
- **Outcome:** `sourceTab` 加 `web`（zh「网页」/ en「Web page」）；新增 `learn.import.web` 整块（label / placeholder / fetch / fetching / hint / emptyPreview / desktopOnly / previewStat / errors 共 9 项，其中 errors 7 键与 `WebErrorKind` 一一对应）。顺带更新对话框副标题（增加「网页链接」这一路）与 `sourceTab` 的「三来源 → 四来源」注释。验证：`npm run test:i18n` **7/7 通过**。
- **Notes:** 先于 UI 落地（仓库纪律「新增键可先于 UI」）。

### T8 — `import/WebPanel.tsx`
- **Status:** done
- **Outcome:** 新建（约 165 行）。四态渲染（非桌面端说明 → 空态 / 抓取中 / 预览卡）+ 行内错误；URL 变化即清空预览与错误；`Enter` 触发抓取；用 UI Kit 的 `Button` / `Input`；`data-testid` 五个（`web-panel` / `web-url-input` / `web-fetch-btn` / `web-preview` / `web-desktop-only`）。验证：`typecheck` 0 error；`ui:check` 原生控件 0 / sticky 残影 0。
- **Notes:** 相对方案 §7.2 线框描述的一处取舍：非桌面端**输入框保持可输入**（只禁用「抓取」按钮），依据是 UC-03 的验收描述「输入框可输入但抓取与主按钮均禁用」——完全禁用输入框会让用户无法先粘好链接。已登记偏差表。

### T9 — `import/ImportModal.tsx` 接线
- **Status:** done
- **Outcome:** 四来源 Tab 行加 `["web", fmt.sourceTab.web]`；新增 `webUnit` state；`renderSourceArea` 加 web 分支；`runTabAction` 加 web 分支（**与 github 分支同构走 `findConflicts`**，查重面板零新增代码）；`primaryDisabled` 加 `tab === "web" && !webUnit`。文件头补 V5 变更说明。验证：`typecheck` 0 error；`ui:check` 通过。
- **Notes:** **发现并修复一处会被第四个来源触发的既有隐患**：原 `if (ghPreview)` 判断**与 Tab 无关**，而 `ghPreview` 在切走 Tab 后不清空 ⇒ 「先在 GitHub Tab 解析成功、再切到网页 Tab 抓取、然后点主按钮」会导入 github 的内容。改为 `if (tab === "github" && ghPreview)`。已登记偏差表。

### T10 — `tests/import-web.test.ts` + `package.json`
- **Status:** done
- **Outcome:** 新建测试文件（约 430 行，**32 项**：A URL 3 / B 编码 4 / C 输出层 9 / D 编排 7 / E 契约 3 / F 卫生与常量 3 / G 端到端 2）。依赖：`@mozilla/readability@0.6`（prod）+ `linkedom@0.18`（dev）。`package.json` 加 `test:web` 并**并入 `test:library` 聚合链**（紧跟 `test:docx`）。验证：`npm run test:web` → **32/32 通过**。
- **Notes:** 首跑 30/32，两条失败均为**真实缺陷/错误断言**，已各自修正并留注释防止复发 —— ① `liOwnText` 原用 `children` 过滤嵌套列表，而 `children` **不含文本节点** ⇒ `<li>父项<ul>…</ul></li>` 把「父项」整段丢掉（改为从 `textContent` 减去子列表文本）；② 用例把 `https:///only-path` 当成「无 host」，实测 WHATWG URL 会把它解析成 host=`only-path`（合法 URL）⇒ 断言本身写错，改用 `https://:8080/x`。两条都已登记偏差表。

### T11 — 门禁全跑
- **Status:** done
- **Outcome:** 全部现跑 —— `typecheck` **0 error** · `layer:check` **无违规 / 无新增边与环**（基线豁免仍为边 3 条 + 环 2 组，一字未增）· `ui:check` **原生下拉 0 / sticky 残影 0** · `test:i18n` **7/7** · `test:web` **32/32** · `test:import` **30/30** · `test:extract` **13/13** · `test:docx` **22/22** · `test:library` **ALL PASS**（**31 套件**，含新并入的 `test:web`）· `cargo test --lib` **74 passed / 0 failed**（含新增 5 项）。
- **Notes:** 逐条按提交分组隔离实测（`git stash` 法），保证每组提交单独 checkout 时都能编译且相关套件绿。

### T12 — README 双语 + 文档回扫
- **Status:** done
- **Outcome:** README 双语 `Fetch a web page by URL` / `通过 URL 抓取网页` 由 `[ ]` → `[x]` + 描述改写为已交付能力；顶部统计行 `41 · 5` → **`42 · 4`**（实测 `[x]` 42 · `[ ]` 4，双语一致；h3 29 / 29 对齐）。docs 回扫 **5 份 + 2 份本轮新建**：`roadmap`（§零 候选表 F8 行 / §F8 现状证据两条时点注 / §F8 范围 5 标 ✅ 并更正两处原设想 / §零 推进顺序 / §三 mermaid F8 节点 / §三 两行 / §五 总结 / §附 计数链 → 42-4 / §附 ② ④ 时点注 / 变更记录）、`code-gap-review`（§零.4 时点注 / §六 标题与 #3 标 ✅ + 第三条时点注 / §七 第 5 批追加）、`knowledge-import-design`（头部加「后续演进」注，指向 DOCX 与网页两份方案）、`business-flow-end-to-end`（§S1 输入来源 + 格式支持两行改四来源 / §七 追加 2026-10-16 一段 / 10-10 段加时点注）、`AGENTS.md`（目录地图 `src-tauri/src` 行补 `net.rs` 等）。本轮新建：本 runbook + 方案文档自身（状态改「已实施」+ **实施偏差记录** 11 条）。
- **Notes:** `tech-debt-closeout` §6.3 未列本项 ⇒ **不改**（不做无关改写）。反向检查：全仓 Grep 确认新增符号在 `src/` 与 `tests/` 下无残留旧写法。

### T13 — 桌面端手工验收
- **Status:** pending
- **Outcome:**
- **Notes:** `rules/no-headless-browser-validation` 禁止主动起浏览器 ⇒ 只能由用户实跑。清单：① 桌面端导入弹窗第 4 个 Tab「网页」可见；② 粘贴一篇静态博客链接 → 「抓取」→ 预览卡（标题 / 终址 / 字符数 / 标题数）；③ 点主按钮 → 五阶段进度 → 结果卡章标题 = 文章小标题；④ 同一链接再导入一次 → 弹查重面板；⑤ 浏览器预览（`npm run dev`）下 Tab 可见、「抓取」禁用 + 一行说明；⑥ 一个需 JS 渲染的站点（如 SPA）→ 行内「未能提取正文」且主按钮保持禁用；⑦ 一个 `.pdf` 直链 → 「该链接不是网页」。

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-10-16 | 建 runbook（T1–T13）。D1–D9 全部取方案推荐档（用户确认「按推荐方案实施」） |
| 2026-10-16 | T1–T12 全部 done（T13 待用户桌面实跑）。门禁全绿；实施偏差 11 条登记于方案文档「实施偏差记录」节 |
