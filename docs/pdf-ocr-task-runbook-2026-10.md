# 扫描件 PDF 的 OCR 兜底 · 执行 Runbook

> 方案真源：`docs/pdf-ocr-design-2026-10.md`（**D1–D10 全部取推荐档**，用户 2026-10-19 确认「按照推荐实现」）。
> 实施偏差**不在此重复登记** —— 唯一真源：方案文档「实施偏差记录」节 + 其变更记录。

## Goal

「本地文件」来源支持扫描件 PDF：勾选面板上的**显式开关** → `extractPdfText` 抽取为空时逐页用 pdfjs 渲染成 JPEG → Rust `ocr_image` 调 macOS Vision 识别 → 交**同一条**共享管道 `runUnitImport` 产出 `Document` + `Chapter[]`。

仅 macOS 桌面端 · 仅「整篇 0 字符」时兜底 · 50 页硬上限且**不静默截断** · 新增 1 个 crate（`objc2-vision`）零模型分发。

## Context

- Package / paths：
  - 新建：`src-tauri/src/ocr.rs`、`src/features/learn/import/{pdf-render,pdf-ocr,desktop-ocr}.ts`、`tests/import-ocr.test.ts`
  - 修改：`src-tauri/{Cargo.toml,src/lib.rs}`、`import/{types,pdf,local-files}.ts`、`import/LocalFilePanel.tsx`、`i18n/messages/{zh,en}.ts`、`features/learn/ImportModal.tsx`、`features/learn/library/dialogs.tsx`、`package.json`
- Docs read：
  - `docs/pdf-ocr-design-2026-10.md`（D1–D10，本 runbook 的方案真源）
  - `rules/rust.mdc`（`Result<T, String>` 且字符串是**机器令牌**，绝不带用户文案）
  - `docs/knowledge-import-design-2026-09.md` §3.3（范围护栏；G2 适配层只产 kind）
- ⚠️ 关键实测（方案 §2）：
  - `pdf.ts` **无任何 render/canvas 路径**（只有 `getTextContent`）⇒ 栅格化能力新建，`loadPdfjs()` 需导出。
  - `objc2@0.6.4` / `objc2-foundation@0.3.2` 已在 `Cargo.lock`（tauri 传递），**只有 `objc2-vision@0.3` 是新增**；`cargo add --dry-run` 实测可解析。
  - `tauri.conf.json` **无 `minimumSystemVersion`** ⇒ Vision 的 `zh-Hans` 需 macOS 11+，必须**运行时探测**（类存在 + `supportedRecognitionLanguages` 过滤）。
  - `fileToUnit` 已有可选第二参 `LocalFileDeps`（EPUB 那轮加的）⇒ OCR 依赖**沿用同一注入点**。
  - 两处入口共用 `fileToUnit`（`ImportModal.tsx` / `library/dialogs.tsx`）⇒ 开关由父级持有、两处一致。
  - `tsconfig.json` 只 `include: ["src"]` ⇒ **`tests/` 不进 typecheck**，测试必须现跑。
- ⚠️ 提交纪律：逐提交可编译；`LocalFileErrorKind` 加值会让 i18n `errors: Record<LocalFileErrorKind, string>` **同批报错** ⇒ 新增 kind 必须与文案同批；精确路径 `git add`；只落本地不 push。
- ⚠️ 本机 `npm run build` 需绕沙箱（`safe-delete` 拦 vite 清 `dist/assets`）。

## Tasks

### T1 — Rust `ocr.rs`：命令 + 能力探测 + 令牌 + 纯函数单测
- **Status:** done
- **Outcome:** `src-tauri/src/ocr.rs` 新建（约 200 行）。`ocr_image(bytes_base64) -> Result<OcrText, String>` 走 `tauri::async_runtime::spawn_blocking`（Vision 是同步阻塞调用，直接在 async 上下文跑会占住 worker 线程）。能力探测两层：`AnyClass::get(c"VNRecognizeTextRequest")` → `unsupported-os`；`supportedRecognitionLanguagesAndReturnError` 过滤 `["zh-Hans","en-US"]` 为空 → `unsupported-language`。`cargo test --lib` **78 passed**（74 + 4）。`Cargo.toml` 加 `[target.'cfg(target_os = "macos")'.dependencies]` 三件套，`objc2-vision` 用 `default-features = false` 只开 5 个 feature。
- **Notes:** ⚠️ 默认 features 全开会把 `objc2-av-foundation` / `core-audio` / `core-media` / `core-ml` / `core-video` / `image-io` 一起拖进来（8 个包）—— 本命令只用文字识别，必须显式收敛（偏差 #8）。编译期还发现两处 API 面与 docs.rs 记法不同：`AnyObject` 在 `objc2::runtime` 而非 `objc2_foundation`；`alloc()` 需要 `objc2::AnyThread` trait 在作用域。

### T2 — `import/types.ts`：三把尺子
- **Status:** done
- **Outcome:** `LIMITS` 加 `ocrMaxPages: 50` / `pdfOcrMaxChars: 1_500_000` / `ocrMaxEdge: 2400`；每条注释写明它属于哪把尺子、与谁不同（尤其 `ocrMaxPages` vs `pdfMaxPages` 差一个数量级是刻意的）。`ImportUnit.extract` 加可选 `ocr?: boolean`。
- **Notes:** ⚠️ `LIMITS` 是 `as const` ⇒ 任何 `= LIMITS` 的默认参数会被推断成字面量类型（`50` / `1500000`），`PdfOcrTooManyPagesError` 的构造参数必须显式标 `number`（偏差 #5）。

### T3 — 渲染层 `import/pdf-render.ts` + `pdf.ts` 导出 `loadPdfjs`
- **Status:** done
- **Outcome:** `pdf-render.ts` 新建（约 80 行）。`renderPdfPages(buffer, pages, opts?)` 是 **async generator**（偏差 #1）；`scale = min(2, maxEdge / max(w,h))`，长边为 0 时兜底 1；JPEG q0.85；逐页 `page.cleanup()` + `canvas.width/height = 0` 主动释放位图。`pdf.ts::loadPdfjs` 改为导出（避免第二份 worker URL）。
- **Notes:** 全仓唯一接触 `<canvas>` 的地方，故**不进单测**（`document.createElement` 在 node 下不存在）；编排层通过依赖注入绕开它。

### T4 — 编排层 `import/pdf-ocr.ts` + 桌面桥 `import/desktop-ocr.ts` + `ocr-error.ts`
- **Status:** done
- **Outcome:** 三个新文件。`pdf-ocr.ts`（约 130 行）：`ocrPdf(buffer, pageCount, deps, limits)` 先判页数（超限**一页都不渲染**）→ `for await` 交错渲染/识别 → 逐页累加字符卡上限 → 页间 `\n\n` 分段。`desktop-ocr.ts`（约 70 行）：`isOcrAvailable()` + `recognizeImage()` + `bytesToBase64()`（32KB 分块，避免 `String.fromCharCode(...)` 爆栈）；`no-text` 令牌返回空串（空页是**正常结果**不是失败）。`ocr-error.ts`（约 50 行）：`OcrErrorKind = "unavailable" | "failed"` + `ocrErrorKindOf`（未知令牌归 `failed` 不崩）。
- **Notes:** `unavailable` 类错误**穿透** `ocrPdf`（立即中止）—— 系统性失败重试下一页没有意义（偏差 #3）。`ocr-error.ts` 独立成模块是为了让纯逻辑层不依赖 `@tauri-apps/api/core`（偏差 #4）。

### T5 — `pdf.ts` / `local-files.ts` 接线
- **Status:** done
- **Outcome:** `extractPdfText(buffer, opts?)` 重构为「try 内抽文本 → finally destroy → 出 try 后判空兜底」，`PdfExtractResult` 加 `ocr?: boolean`；`LocalFileErrorKind` 加 4 值（`pdf-ocr-unavailable` / `pdf-ocr-too-many-pages` / `pdf-ocr-failed` / `pdf-ocr-no-text`）、错误漏斗加 4 行映射、`LocalFileDeps` 加 `ocr?: PdfOcrDeps`、`extract` 里 `...(out.ocr ? { ocr: true } : {})`。
- **Notes:** ⚠️ 兜底放在 `doc.destroy()` **之后**（方案 §6.4 写的是之前）—— 两份 PDF doc 并存会让 30MB 文档峰值内存翻倍（偏差 #2）。`PdfOcrTooLargeError` 映射到既有的 `too-large`（方案 §8.1 C 组的口径），不新增第五个 kind。

### T6 — i18n（6 新键 + 2 改）
- **Status:** done
- **Outcome:** `local.ocrToggle` / `ocrHint` / `ocrDesktopOnly` / `ocrProgress(done,total)` / `ocrTag` + 4 个 `errors.pdf-ocr-*`，zh/en 逐键成对；`dropHint` 改写（删「扫描版 PDF 暂不支持」）；`errors["pdf-no-text"]` 补「可勾选 OCR 重试」。
- **Notes:** 四条错误文案都指向**具体动作**（拆 PDF / 改用粘贴 / 检查页面上是否有字），不是「不支持」。`error-text.ts` 的 `LocalErrorLabels = Record<LocalFileErrorKind, string>` 自动跟随，**无需改**。验证：`test:i18n` 7/7。

### T7 — UI（开关 + 进度 + 两处父级）
- **Status:** done
- **Outcome:** `LocalFilePanel` 加 4 个受控 props（`ocrEnabled` / `onOcrEnabledChange` / `ocrAvailable` / `ocrProgress`），UI Kit `Checkbox` + 说明行 + `aria-live="polite"` 进度行（`data-testid="local-ocr-progress"`）；`ImportModal` 与 `library/dialogs` 各持一份 state 并组装 `LocalFileDeps`；单份结果卡「抽取量」行加 `OCR` 徽标。
- **Notes:** ⚠️ `ImportModal` 的 `primaryDisabled` 多一条 `ocrProgress !== null` —— 预转换阶段 `busy` 还是 false，OCR 让这段从毫秒级变成 30s+，不挡会重复识别（偏差 #11）。`ocrAvailable={isOcrAvailable()}` 在浏览器预览下为 false ⇒ 开关禁用 + 一行说明（不许出现「点了没反应的死按钮」）。

### T8 — `tests/import-ocr.test.ts` + `test:ocr` + 聚合链
- **Status:** done
- **Outcome:** `tests/import-ocr.test.ts` 新建（约 340 行，**21 项**）：A 页数护栏 3 / B 编排 4 / C 失败分类 4 / D 接线 3 / E 常量与文案 3 / F 卫生 4（含 `bytesToBase64` 跨块边界 + Rust 令牌集合与 TS 解析端一致性）。`package.json` 加 `test:ocr` 并**并入 `test:library`**（32 → **33** 套件）。验证：`test:ocr` **21/21**。
- **Notes:** 零真实 OCR、零真实 PDF —— 假渲染器/假识别器注入。⚠️ D 组没用「勾选就调 OCR」的真跑法：`fileToUnit` 的 pdf 分支会真的调 pdfjs，而 node 下 `pdfjs-dist` 需要 `DOMMatrix` 等浏览器全局 ⇒ 改为「md 分支零调用行为 + 源码断言」（偏差 #13）。

### T9 — 桌面手工验收（用户实跑）
- **Status:** pending
- **Notes:** `rules/no-headless-browser-validation` 禁止 AI 主动起浏览器 ⇒ 只能用户实跑。清单：① 本地文件面板出现「扫描版 PDF 用 OCR 识别文字」开关，默认**未勾**；② 勾选后导入一份真实扫描件 PDF → 进度行「正在识别扫描件 3/30 页…」递增 → 结果卡出现章节且带 `OCR` 徽标；③ 不勾选导入同一份 → 行内「未抽取到文本（可能为扫描件）—— 可勾选上方「OCR 识别」重试」；④ 浏览器预览（`npm run dev`）→ 开关置灰 + 一行「仅桌面端可用」；⑤ 51 页扫描件 → 「页数超过 OCR 上限（50 页），请先把 PDF 拆成几份再导入」；⑥ 纯图片无文字 PDF → 「OCR 未识别出文字…」；⑦ 识别途中主按钮保持禁用（不可重复触发）。

### T10 — 文档回扫
- **Status:** done
- **Outcome:** README 双语 `OCR fallback for scanned PDFs` `[ ]` → `[x]` + 描述改写；统计行 **43/3 → 44/2**（实测 raw 45/3 − 图例 1/1，双语一致）。回扫 5 份：roadmap（§零 候选表 / §F8 现状证据时点注 / 范围 2 标 ✅ + 三处取舍 / mermaid / 无前置 / 部分交付 / 仍未做 / 变更记录）、`code-gap-review`（§六 #1 标 ✅ + 时点注 + 第 5 批收窄为一项）、`knowledge-import-design`（决策依据时点注 + 后续演进 + 验收表 PDF 行）、`business-flow-end-to-end`（§零 S1 已知局限 / §S1 格式支持 / §七 第 6 行 / 两处时点注）、`AGENTS.md`（目录地图补 `ocr.rs`）。另改写 `pdf.ts` 头部「不做 OCR」注释。
- **Notes:** ⚠️ 最易漏的是**源码注释里的旧理由** —— `pdf.ts:22` 原写「扫描件抛 `PdfNoTextError`，由 UI 提示，**不做 OCR**」，是 `code-gap-review` #1 的「代码证据」。不改就会让后来者按旧理由改别处。

## 本轮门禁结果

> 历史快照，不改。

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | **0 error** |
| `npm run layer:check` | 违规 **0** ／ 新增环 **0** |
| `npm run ui:check` | 原生下拉 **0** ／ sticky 残影 **0** |
| `npm run test:i18n` | 7/7 |
| `npm run test:ocr` | **21/21** |
| `npm run test:import` | 30/30 |
| `npm run test:library` | **ALL PASS**（`test:ocr` 已并入聚合链） |
| `cargo test --lib` | **78 passed**（74 既有 + 4 新增） |
| `npm run build` | ✓ built in 2.13s（`pdf` chunk 329.84 kB，pdfjs 仍独立拆分） |

⚠️ `npm run build` 在本机需**绕沙箱**执行 —— `safe-delete` 会拦 vite 清 `dist/assets`，与本特性无关。
