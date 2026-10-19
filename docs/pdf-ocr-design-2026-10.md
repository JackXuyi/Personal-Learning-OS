# 扫描件 PDF 的 OCR 兜底（F8 范围 2）技术方案

| 项 | 内容 |
|---|---|
| 状态 | **已实施**（2026-10-19，T1–T8 完成；用户「按照推荐实现」确认 D1–D10 全取推荐档）<br>⚠️ 实施偏差见 §12 |
| 日期 | 2026-10-19 |
| 关联需求 | `docs/roadmap-next-features-plan-2026-09.md` §F8 范围 2（「OCR 兜底：Tauri 侧接本地 OCR（如系统 Vision / tesseract）」）；README `[ ] OCR fallback for scanned PDFs` |
| 前置交付 | 范围 1（0 字符检测 2026-09-21）· 范围 3（DOCX 2026-09-23）· 范围 4（EPUB 2026-10-19）· 范围 5（URL 抓取 2026-10-16） |

---

## §0 结论先行

**做。这是 F8 的最后一块，也是唯一还有用户可见落差的一项** —— 面板提示词至今写着「扫描版 PDF 暂不支持」，失败文案只说「可能为扫描件」而不给出路。

三条关键实测结论决定了方案形状：

| 结论 | 实测证据 | 影响 |
|---|---|---|
| **不必引入 tesseract** | macOS 自带 Vision 框架，`zh-Hans` 文字识别免模型、免下载、离线 | 零模型分发，打包体积不变 |
| **Rust 侧可以只做「图片 → 文字」** | `pdfjs-dist@4.10.38` 的 `page.render()` 可用，栅格化留前端更省事 | Rust 面 ~130 行（单命令）；页循环/进度/上限全在 TS，可单测 |
| **一个新 crate，且不重** | `objc2@0.6.4` / `objc2-foundation@0.3.2` 已在 `Cargo.lock`（tauri 传递依赖）；只有 `objc2-vision@0.3` 是新增（`cargo add --dry-run` 实测可解析） | 新增下载 ~百 KB 级，不引入模型 |

推荐档一句话：**显式开关 + 仅整篇无文本时兜底 + 50 页硬上限 + 不静默截断**。

---

## §1 背景与目标

### 1.1 现状（用户看到什么）

| 环节 | 现状 | 出处 |
|---|---|---|
| 抽取 | `extractPdfText` 逐页 `getTextContent`，全篇为空则抛 `PdfNoTextError` | `import/pdf.ts:71-103` |
| 错误映射 | `fileToUnit` 把 `PdfNoTextError` 映射为 `pdf-no-text` | `import/local-files.ts` |
| 用户文案 | 「未抽取到文本（可能为扫描件）」 | `i18n/messages/zh.ts:1508` |
| 面板提示 | 「支持批量选择多个文件；扫描版 PDF 暂不支持（文本型 PDF 可导入）」 | `i18n/messages/zh.ts:1493` |
| 出路 | 无。用户只能自己找工具转文字再粘贴 | —— |

**扫描件是最典型的「第一分钟摩擦」**：GMP 法规、培训材料、扫描书大量是纯图片 PDF。当前实现是「识别出这是扫描件，然后拒绝」。

### 1.2 目标（Done 标准）

1. 本地文件面板出现**显式开关**「扫描件用 OCR 识别」；桌面端可用、浏览器预览禁用并说明原因。
2. 勾选后导入纯图片 PDF：逐页识别 → 走**同一条** `runUnitImport` 管线 → 结果卡能看见章（章标题来自 OCR 文本里的「第一章 / 1. 目的」等行，经既有 `promotePdfHeadings`）。
3. 识别过程有**页级进度**（「正在识别扫描件 3/30 页…」），不是干等。
4. 不勾选时行为**逐字节不变**（既有 30 项 `test:import` 零回归）。
5. 页数超上限 → **明确报错并给可行动文案**，绝不静默只识别前 N 页。
6. 非 macOS / 系统过旧 → 明确 kind，不崩、不静默失败。

### 1.3 非目标（明确不做）

| 不做 | 原因 |
|---|---|
| 图片文件（.png/.jpg）直接导入 | 是另一个入口（图片资料），与「PDF 兜底」不是同一件事 |
| 混合文档的**逐页补齐**（有文字的页保留、图片页 OCR） | 合并顺序/去重规则是独立设计；本方案只在「整篇 0 字符」时兜底 |
| 版面还原（分栏、表格、公式） | Vision 只给文本行；表格/公式识别是另一个量级 |
| 手写体 / 竖排 | Vision 支持有限，不做承诺 |
| Windows / Linux 的等价实现 | 本仓桌面端只有 macOS（tray/vault 同） |
| 云端 OCR | 违反 local-first；法规类文档不该出本机 |

---

## §2 现状实测证据

### 2.1 PDF 侧没有渲染路径（必须新建）

```
$ grep -nE 'getTextContent|render|canvas|Canvas|getViewport' src/features/learn/import/pdf.ts
4:  * 基于 pdfjs-dist 在前端逐页 getTextContent 抽取
81:        const content = await page.getTextContent();
82:        const pageWidth = page.getViewport({ scale: 1 }).width;
```

`getViewport` 只用于版式重排取页宽，**没有任何 `render` / canvas**。pdfjs 已在依赖里（4.10.38），渲染能力是白捡的，只是此前没用。

### 2.2 Rust 依赖：一个新 crate，其余已在图里

| crate | 状态 | 证据 |
|---|---|---|
| `tauri` 2.11.5 | 已是唯一直接依赖 | `src-tauri/Cargo.toml` |
| `base64` 0.22 | **已提为直接依赖**（URL 抓取那轮） | 同上 |
| `objc2` 0.6.4 | 在 `Cargo.lock`（tauri → wry/tao 传递） | `Cargo.lock:2326` |
| `objc2-foundation` 0.3.2 | 同上 | `Cargo.lock:2441` |
| `objc2-vision` 0.3 | **新增**（本地 cargo 缓存无，但可联网取） | `cargo add objc2-vision@0.3 --dry-run` → `Adding objc2-vision v0.3` |

### 2.3 Vision API 面（已核对 docs.rs，不是凭记忆）

```rust
// 请求
let req = VNRecognizeTextRequest::new();                       // -> Retained<Self>
req.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
req.setRecognitionLanguages(&NSArray<NSString>);               // 取 &NSArray<NSString>
req.setUsesLanguageCorrection(true);
req.results() -> Option<Retained<NSArray<VNRecognizedTextObservation>>>;  // 需 VNObservation feature

// 执行
let handler = VNImageRequestHandler::initWithData_options(
    VNImageRequestHandler::alloc(), &ns_data, &NSDictionary<VNImageOption, AnyObject>,
);                                                              // 安全方法，无 unsafe
handler.performRequests_error(&NSArray<VNRequest>) -> Result<(), Retained<NSError>>;  // 需 VNRequest feature
```

`VNRequestTextRecognitionLevel` 是 `#[repr(transparent)]` 包装，常量 `Accurate` / `Fast`。

### 2.4 最低系统版本：配置里没写

`src-tauri/tauri.conf.json` **无 `minimumSystemVersion`**（tauri 2 默认 10.15）。Vision 的文字识别类在 10.15 存在，但 **`zh-Hans` 语言支持从 macOS 11 起**。

⇒ 必须**运行时**探测：类是否存在（`VNRecognizeTextRequest`）+ 语言是否被支持（`supportedRecognitionLanguagesForTextRecognitionLevel:revision:error:`），不能在编译期假定。

### 2.5 两个入口，同一个转换函数

```
src/features/learn/ImportModal.tsx:317      const out = await fileToUnit(file);     // 新建资料（批量）
src/features/learn/library/dialogs.tsx:260  const out = await fileToUnit(files[0]); // 替换已有资料正文（单份）
```

`fileToUnit` 已有可选第二参 `LocalFileDeps`（EPUB 那轮为注入 `parseHtml` 加的）⇒ OCR 依赖**沿用同一注入点**，不新增签名形态。

---

## §3 决策点

### D1 · OCR 引擎 → **推荐：macOS Vision（`objc2-vision`）**

| 方案 | 体积 | 中文 | 离线 | 结论 |
|---|---|---|---|---|
| **Vision** | 0（系统框架） | 原生 `zh-Hans` | ✅ | **选它** |
| tesseract.js | ~15MB wasm + 15–30MB traineddata | 需额外 `chi_sim` 模型 | 需随包分发或首次下载 | 体积与首启代价都不可接受 |
| 云端 OCR | 0 | 好 | ❌ | 违反 local-first；法规文档不应出本机 |

### D2 · 栅格化放哪一侧 → **推荐：留前端（pdfjs `page.render`），Rust 只收图片字节**

- **前端的理由**：pdfjs 已在依赖里且处理加密/异常 PDF 更稳；页循环、页上限、进度回调都落在 TS ⇒ 能在 node 单测里用假渲染器覆盖（`test:ocr` 可跑）。
- 备选（Rust 用 CoreGraphics 渲染）：IPC 只有一次、payload 小，但要在 Rust 里手写 `CGPDFDocument` + `CGBitmapContext` 一大段 unsafe，且**完全无法自动测试**。本仓已有 `net.rs` 这种「Rust 只做一件事」的先例，保持同构。
- 代价：每页一次 IPC（JPEG 质量 0.85、长边 ≤2400px ⇒ 约 300–500KB/页，base64 后 <700KB），50 页合计 <35MB，可接受。

### D3 · 触发方式 → **推荐：显式开关，默认关**

三个选项：

| 方案 | 行为 | 问题 |
|---|---|---|
| A 静默自动兜底 | 0 字符就 OCR | 用户以为卡死（30 页 ≈ 30s+），且每份扫描件都要付这个代价 |
| **B 显式开关（推荐）** | 面板上一个 checkbox，勾了才兜底 | 用户需主动勾 —— 但失败文案会明确提示「勾选后重试」 |
| C 失败后行内重试 | 汇总卡上对失败项出现「尝试 OCR」 | UX 最好，但要把 `File` 对象留到汇总卡、并支持单文件重跑管线，状态机明显变复杂 |

**选 B**：状态机零新增（一个布尔），批量导入天然支持，且「勾选 = 用户已接受等待」这件事本身就是最好的进度预期管理。

### D4 · 兜底条件 → **推荐：仅「整篇 0 字符」时兜底**

混合文档（前 3 页有文字、后面全是扫描图）**不做逐页补齐**：那需要「哪些页用 OCR / 如何拼接 / 页眉去噪跨来源」一整套规则，属于独立设计。当前兜底口径与 `PdfNoTextError` 的触发条件**完全一致**，不需要新判据。

### D5 · 页数上限 → **推荐：`ocrMaxPages = 50`，超限报错不截断**

- 50 页 ≈ 25–50s（Vision Accurate 约 0.5–1s/页），是「愿意等」的上限。
- **绝不静默截断**：给用户一本只有前 50 页的书，比明确拒绝坏得多（数据层无从察觉）。超限 → `pdf-ocr-too-many-pages`，文案指向「先拆分 PDF」这个具体动作。
- ⚠️ 与 `pdfMaxPages`（500，pdfjs 解析护栏）是**两把尺子**，常量注释必须写清。

### D6 · 渲染参数 → **推荐：长边 ≤2400px，JPEG q0.85**

- 2400px ≈ 200 DPI 的 A4，Vision 在 150–300 DPI 区间精度已饱和；再高只是涨 payload。
- `scale = min(2.0, 2400 / max(w, h))`：小页面不会被过度放大，巨幅海报也不会爆内存。
- JPEG 而非 PNG：扫描件 PNG 常 1–3MB/页，JPEG 约 1/5，OCR 精度无可测差异。

### D7 · 识别语言 → **推荐：`["zh-Hans", "en-US"]`，先查支持列表再设置**

- 本仓用户场景以中文资料为主（GMP / 培训），中英混排是常态。
- 若系统不支持 `zh-Hans`（macOS 10.15）：**查 `supportedRecognitionLanguages` 过滤后再设**；过滤后为空 → `unsupported-language` 令牌，UI 走可行动文案，而不是抛 Vision 的原始错误。

### D8 · 进度反馈 → **推荐：`onProgress(done, total)` 注入，面板下方单行显示**

`fileToUnit` 新增依赖项 `onOcrProgress`；`ImportModal` 把它接到一个 state，渲染在面板下方（「正在识别扫描件 3/30 页…」）。
不做全局进度条：预转换阶段没有现成的进度容器，单行文案已经足够表达「在动、还要多久」。

### D9 · 失败分类 → **推荐：4 个新 kind，全部落到 `LocalFileErrorKind`**

| kind | 触发 | 文案要点（可行动） |
|---|---|---|
| `pdf-ocr-unavailable` | 非桌面端，或系统无 Vision 文字识别 | 说明「仅桌面端可用」 |
| `pdf-ocr-too-many-pages` | 页数 > 50 | 「先拆分 PDF 再导入」 |
| `pdf-ocr-failed` | Vision 返回错误 / IPC 失败 | 「可改用粘贴文本」 |
| `pdf-ocr-no-text` | 识别完仍为空 | 「可能整页是图表或不清晰」 |

`i18n` 的 `errors` 是 `Record<LocalFileErrorKind, string>` ⇒ typecheck 强制 zh/en 成对，漏一处必红（与 EPUB 那轮同）。

### D10 · 文档与元数据 → **推荐：`extract.ocr = true` + 改两条旧文案**

- 结果卡「抽取质量」行多一个 `OCR` 标记，用户能分辨「文字是识别来的」。
- 改文案两处：`local.dropHint`（删掉「暂不支持」，改为指向开关）、`errors["pdf-no-text"]`（补「可勾选扫描件 OCR 重试」）。
- **两处入口**（新建资料 / 替换正文）共用同一个 `LocalFilePanel`，开关状态由父级持有并传给 `fileToUnit` ⇒ 两处行为一致，不做「只在一边能用」的半成品。

---

## §4 总体设计

### 4.1 模块划分

```
┌─ 前端（webview） ─────────────────────────────────────────────┐
│ LocalFilePanel.tsx   ← 开关（checkbox）+ 进度行                 │
│        │ ocrEnabled                                             │
│        ▼                                                       │
│ ImportModal / library.dialogs  ──fileToUnit(file, deps)──┐     │
│                                                          ▼     │
│ local-files.ts  ──(pdf)──▶  pdf.ts::extractPdfText(buf, {ocr}) │
│                                    │ 0 字符 + 开关开            │
│                                    ▼                           │
│                             pdf-ocr.ts（页循环 / 上限 / 拼接）  │
│                              ├── pdf-render.ts（pdfjs→JPEG）   │
│                              └── desktop-ocr.ts（invoke 桥）   │
└────────────────────────────────────────────────────────────────┘
                                     │ ocr_image(base64)
┌─ Rust ─────────────────────────────▼───────────────────────────┐
│ ocr.rs::ocr_image   NSData → VNImageRequestHandler → 文本行     │
│ （无 PDF 知识、无文件 IO、无网络）                               │
└────────────────────────────────────────────────────────────────┘
```

### 4.2 数据流（一次扫描件导入）

```
用户勾选「扫描件 OCR」→ 选 3 份 PDF → 主按钮
  → 逐份 fileToUnit
      → extractPdfText：getTextContent 全空 → PdfNoTextError 条件成立
      → 开关开？→ ocrPdf(buf, pageCount, deps)
          for each page (≤50):
              render → canvas.toBlob(jpeg,0.85) → Uint8Array
              → invoke("ocr_image", { bytesBase64 }) → 文本行
              → onProgress(i, total)
      → 拼接（页间空行）→ promotePdfHeadings → unit { format:"pdf", splitFormat: promoted>0 ? "markdown":"txt", extract:{ocr:true} }
  → findConflicts → runUnitImport（与文本型 PDF 完全同一条）
```

---

## §5 Rust 侧（`src-tauri/src/ocr.rs`）

### 5.1 对外接口

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrText { text: String, line_count: usize }

#[tauri::command]
pub async fn ocr_image(bytes_base64: String) -> Result<OcrText, String>;
```

- 走 `tauri::async_runtime::spawn_blocking`：Vision 是同步阻塞调用，直接在 async 上下文跑会占住 worker 线程。
- 返回 `Result<T, String>`，字符串是**机器令牌**（`rules/rust.mdc`）：`bad-base64` / `empty-image` / `unsupported-os` / `unsupported-language` / `vision-failed` / `no-text`。**不含任何用户文案**。

### 5.2 实现要点

1. `base64` 解码（已直接依赖）→ 空字节直接 `empty-image`。
2. 运行时能力探测：
   - `objc2::runtime::AnyClass::get(c"VNRecognizeTextRequest")` 为 `None` → `unsupported-os`；
   - `supportedRecognitionLanguagesForTextRecognitionLevel_revision_error` 过滤 `["zh-Hans","en-US"]`；结果空 → `unsupported-language`。
3. `NSData::with_bytes` → `VNImageRequestHandler::initWithData_options(alloc, &data, &NSDictionary::new())`。
4. `performRequests_error(&NSArray<VNRequest>)`（需把 `VNRecognizeTextRequest` 以 `&VNRequest` 传入）；`Err` → `vision-failed`。
5. 遍历 `results()`：每个 `VNRecognizedTextObservation` 取 `topCandidates(1)` 首个候选的 `string()`，按行收集；空 → `no-text`。
6. 不做任何文本规整（去页眉、合并断行）—— 那是 TS 侧 `promotePdfHeadings` 与切分器的职责，Rust 只回原始行。

### 5.3 为什么不放 base64 解码在 TS

WebView 侧 `btoa` 处理 500KB 二进制要手写分块（`String.fromCharCode.apply` 会爆栈），而 `base64` crate 已在依赖里、`net.rs` 已用它做反向（编码）—— 同一个 crate 复用，零新增。

### 5.4 单元测试（`cargo test --lib`，不依赖图片）

只测纯函数：令牌集合稳定、`join_candidates` 的去空行/去首尾空白、`is_text_line`（长度 > 0）判定。**真正的识别精度不做自动断言**（需要一张带已知文字的图片；伪造这种 fixture 的成本高于它的价值），靠 §9 手工验收。

---

## §6 前端设计

### 6.1 `import/pdf-render.ts`（新建，唯一接触 canvas 的地方）

```ts
export interface RenderedPage { page: number; bytes: Uint8Array }

/** 逐页渲染为 JPEG 字节（长边 ≤2400px）。生产实现；单测不调用。 */
export async function renderPdfPages(
  buffer: ArrayBuffer,
  pages: number[],
  opts?: { maxEdge?: number },
): Promise<RenderedPage[]>;
```

- 复用 `pdf.ts::loadPdfjs()` 的按需加载与 worker 配置（导出该函数即可，避免第二份 worker URL）。
- `document.createElement("canvas")` + `page.render({ canvasContext, viewport }).promise` + `canvas.toBlob("image/jpeg", 0.85)`。
- 逐页 `page.cleanup()`，不保留 canvas 引用（浏览器 GC 回收）。

### 6.2 `import/pdf-ocr.ts`（新建，纯编排，可单测）

```ts
export interface PdfOcrDeps {
  renderPages: (buffer: ArrayBuffer, pages: number[]) => Promise<RenderedPage[]>;
  recognize: (bytes: Uint8Array) => Promise<string>;
  onProgress?: (done: number, total: number) => void;
}

export async function ocrPdf(
  buffer: ArrayBuffer, pageCount: number, deps: PdfOcrDeps, limits = LIMITS,
): Promise<{ text: string; ocrPages: number }>;
```

- 页数 > `limits.ocrMaxPages` → `PdfOcrTooManyPagesError`。
- 逐页 `recognize`，`onProgress(i+1, total)`；单页失败**不中断整篇**（跳过并计数），全篇空才 `PdfOcrNoTextError`。
- 页间用 `\n\n` 连接，`\n{3,}` 折叠为 `\n\n`（与 `pdf.ts` 同一规整口径）。
- 累计字符 > `limits.pdfOcrMaxChars` → 停止并 `PdfOcrTooLargeError`（复用「入库正文体量」这把尺子，1.5M）。

### 6.3 `import/desktop-ocr.ts`（新建，薄桥）

照 `desktop-fetch.ts` 同构：`isOcrAvailable() = isTauri()`；`recognizeImage(bytes)` → `invoke("ocr_image", { bytesBase64 })` → 令牌转译成 `WebImportError` 风格的 `OcrError`。

### 6.4 `pdf.ts` 改动（最小）

```ts
export async function extractPdfText(
  buffer: ArrayBuffer,
  opts?: { ocr?: PdfOcrDeps },
): Promise<PdfExtractResult>;
```

在 `doc.destroy()` **之前**：文本为空且 `opts?.ocr` 存在 → `ocrPdf(...)`；成功则用 OCR 文本继续（`nonEmptyPages = ocrPages`），失败则原样抛 `PdfNoTextError` 的对应子类。

⚠️ `PdfExtractResult` 加 `ocr?: boolean`；`extract` 字段由调用方组装，保持既有形状。

### 6.5 `local-files.ts` 改动

- `LocalFileErrorKind` +4 值；错误漏斗 +4 行映射。
- `LocalFileDeps` 加 `ocr?: PdfOcrDeps`（已有 `parseHtml?`），PDF 分支透传。
- 无 OCR 依赖时行为**逐字节不变**。

### 6.6 UI

- `LocalFilePanel.tsx`：新增 `ocrEnabled` / `onOcrEnabledChange` 受控 props；checkbox 用 UI Kit 的 `Checkbox`；非桌面端 `disabled` + 一行说明（与 `WebPanel` 的 `desktop-only` 处理同构）。
- `ImportModal.tsx`：持有 `ocrEnabled`；预转换循环里组装 `{ ocr: ocrEnabled && isOcrAvailable() ? {...} : undefined }`；进度 state 渲染在面板下方。
- `library/dialogs.tsx`：同样持有开关并透传（两处一致）。
- i18n：`local.ocrToggle` / `local.ocrHint` / `local.ocrProgress(done,total)` + 4 个 `errors.*` + 改 2 条旧文案。

---

## §7 常量（`import/types.ts`）

```ts
/** OCR 页数上限（50 页 ≈ 25–50s）。⚠️ 与 pdfMaxPages(500) 是两把尺子。 */
ocrMaxPages: 50,
/** OCR 入库正文字符护栏。⚠️ 与 pasteMaxChars 等同属「入库正文体量」这把尺子。 */
pdfOcrMaxChars: 1_500_000,
/** OCR 渲染长边上限（像素）。 */
ocrMaxEdge: 2400,
```

---

## §8 测试计划

### 8.1 `tests/import-ocr.test.ts`（新建，约 6 组 20 项）

| 组 | 内容 | 项数 |
|---|---|---|
| A 页数护栏 | 50 页通过 / 51 页 `too-many-pages` / 0 页 `no-text` | 3 |
| B 编排 | 页序正确 / 页间空行 / 单页失败跳过其余继续 / 进度回调序列 | 4 |
| C 失败分类 | 全篇空 → `no-text` / 字符超限 → `too-large` / 桥令牌 `unsupported-language` → `unavailable` / 未知令牌不崩 | 4 |
| D `fileToUnit` 接线 | 勾选 + 空文本 → 调用 OCR 且 `extract.ocr === true` / 未勾选 → **不调用** OCR（假渲染器断言零调用） / OCR 文本走 `promotePdfHeadings` | 3 |
| E 常量与文案 | `ocrMaxPages` > `pdfMaxPages` 为假（是两把尺子）/ zh/en 键成对 / `dropHint` 不再出现「暂不支持」 | 3 |
| F 卫生 | `pdf-ocr.ts` / `pdf-render.ts` 不 import `.tsx` / 只有 `desktop-ocr.ts` 调 `invoke` | 2 |

`package.json` 加 `test:ocr` 并**并入 `test:library`** 聚合链（32 → 33 套件）。

### 8.2 Rust

`cargo test --lib` 新增 3 项纯函数用例（§5.4）。**不回退**：既有 74 项必须仍绿。

### 8.3 手工验收（T9，用户实跑；`rules/no-headless-browser-validation`）

① 桌面端勾选开关 → 导入一份真实扫描版 PDF → 进度行递增 → 结果卡出现章节（不是「0 章」）
② 不勾选导入同一份 → 行内「未抽取到文本（可能为扫描件）」且文案提到可勾选 OCR
③ 浏览器预览（`npm run dev`）→ 开关禁用 + 一行说明
④ 51 页扫描件 → 「页数超过 OCR 上限（50 页），请先拆分 PDF」
⑤ 纯图片无文字 PDF（如扫描图册）→ 「OCR 未识别出文字…」

---

## §9 门禁

`typecheck` · `layer:check`（违规 0 / 新增环 0）· `ui:check`（原生下拉 0 / sticky 0）· `test:i18n` · `test:ocr`（新）· `test:import` 30/30 · `test:pdf`（若有）· `test:library` 33 套件 · `cargo test --lib`（74 + 3）· `npm run build`（需绕沙箱：`safe-delete` 拦 vite 清 dist）。

---

## §10 风险与未知

| 风险 | 说明 | 应对 |
|---|---|---|
| **Vision 在 WKWebView 进程里调用是否需额外授权** | Vision 是本地库、不涉其它 App，理论无需 TCC | T9 ① 直接验；若失败回退方案是「Rust 侧 CG 栅格化」但**不预先实现** |
| 单页识别时间不确定 | 复杂版面可能 2–3s/页 | 50 页上限 + 进度行；不做超时中断（Vision 无取消 API，强杀线程不可行） |
| `objc2-vision` API 与 docs.rs 有出入 | 生成代码可能要求显式 feature | 编译期即暴露；先跑 `cargo check` 再写 TS |
| 大页扫描件内存 | 2400px JPEG 单页 ~10MB 位图 | 逐页渲染 + `cleanup`，不并发 |
| 识别质量参差 | 倾斜/低对比扫描件会掉字 | 文案明确「OCR 结果可能有误」，不做质量承诺 |

---

## §11 落点与任务分解（进 runbook 后执行）

| # | 任务 | 文件 |
|---|---|---|
| T1 | `ocr.rs`：命令 + 能力探测 + 令牌 + 3 项纯函数单测 | `src-tauri/src/ocr.rs`（新）、`Cargo.toml`、`lib.rs` |
| T2 | 常量三把尺子 | `import/types.ts` |
| T3 | 渲染层 | `import/pdf-render.ts`（新）、`import/pdf.ts`（导出 `loadPdfjs`） |
| T4 | 编排层 + 桌面桥 | `import/pdf-ocr.ts`（新）、`import/desktop-ocr.ts`（新） |
| T5 | 接线（kind / 漏斗 / deps） | `import/local-files.ts`、`import/pdf.ts` |
| T6 | i18n（6 新键 + 2 改） | `i18n/messages/{zh,en}.ts` |
| T7 | UI（开关 + 进度 + 两处父级） | `LocalFilePanel.tsx`、`ImportModal.tsx`、`library/dialogs.tsx` |
| T8 | 单测 + `test:ocr` + 聚合链 | `tests/import-ocr.test.ts`（新）、`package.json` |
| T9 | 桌面手工验收（用户） | —— |
| T10 | 文档回扫（README 双语 43/3 → **44/2**、roadmap §F8 收口、design/runbook） | README ×2、`docs/*.md` |

预计改动：**新建 5 文件**（含 ~330 行测试）、**改 8 文件**、**新增 1 个 crate**（`objc2-vision`）。

---

---

## §12 实施偏差记录（方案 vs 落地）

> 只记**与方案不同**的地方。结论未被推翻的不记。

| # | 方案怎么写 | 实际怎么落地 | 为什么 |
|---|---|---|---|
| 1 | §6.1 `renderPdfPages(...) => Promise<RenderedPage[]>`（一次返回全部页） | 改成 **async generator**：`renderPdfPages(...) => AsyncGenerator<RenderedPage>`，`PdfOcrDeps.renderPages` 同为 `AsyncIterable` | 返回数组意味着「50 页全部渲染完才开始识别」：50 × 2400px 位图的峰值内存与「渲染阶段零进度」两个问题同时出现。交错迭代后任一时刻只有一页位图存活，进度天然跟着页走 |
| 2 | §6.4 说 OCR 在 `doc.destroy()` **之前**调 | **之后** —— 先 `destroy` 解析器，再 `ocrPdf` | `pdf-render.ts` 会为渲染重新 `getDocument`。Destroy 之前调会让**两份 PDF doc 同时打开**，30MB 的 PDF 峰值内存直接翻倍 |
| 3 | §6.2 说「单页失败不中断整篇（跳过并计数）」 | 加一条例外：**`OcrError` 且 `kind === "unavailable"` 立即中止并原样抛出** | 「这台机器不支持中文识别」是**系统性**失败：重试下一页不会有不同结果，被吞成「整篇没识别出文字」还会让用户以为自己文件有问题 |
| 4 | §6.3 只说「令牌转译成 WebImportError 风格的 OcrError」，未说放哪 | 新抽 `import/ocr-error.ts`（`OcrErrorKind = "unavailable" \| "failed"` + `ocrErrorKindOf`） | 与 `web-error.ts` 同构、同理由：`pdf-ocr.ts`（纯逻辑，单测直接 import）若反过来依赖 `desktop-ocr.ts`，会把 `@tauri-apps/api/core` 拖进纯逻辑层 |
| 5 | §6.2 `ocrPdf(..., limits = LIMITS)` | 改成只含两条线的 `PdfOcrLimits`（`ocrMaxPages` / `pdfOcrMaxChars`） | 整个 `LIMITS` 是 `as const`，`= LIMITS` 会让形参类型被推断成字面量 `50` / `1500000`（TS2345）；且测试传小值造边界时不该被迫构造 1.5M 字符 |
| 6 | §2.3 用类方法 `supportedRecognitionLanguagesForTextRecognitionLevel:revision:error:` | 用**实例方法** `supportedRecognitionLanguagesAndReturnError`（对 `&self` 调用） | 类方法在 objc2 里标了 `#[deprecated]`；实例方法是同一份数据的现行入口，且能直接问「这个 request 当前配置支持哪些语言」 |
| 7 | §5.1 `ocr_image` 的能力探测只提「类是否存在 + 支持语言过滤」 | 照做，但语言过滤**必须先拿到一个 request 实例**再问 | 见 #6：能力探测挂在 request 上，所以顺序是 `new()` → 问支持列表 → 过滤 → `setRecognitionLanguages` |
| 8 | §2.2 说「新增 1 个 crate（`objc2-vision@0.3`）」 | 实际**新增 1 个 crate、但先被拖进 8 个**：默认 features 全开会带上 `objc2-av-foundation` / `core-audio` / `core-media` / `core-ml` / `core-video` / `image-io` 等 | 显式 `default-features = false`，只开 `std` / `VNRecognizeTextRequest` / `VNRequest` / `VNRequestHandler` / `VNObservation`。本命令只用到文字识别这一小块，没有理由把整个 Vision 家族编进来 |
| 9 | §5 未提平台限定 | `objc2` 三件套放在 `[target.'cfg(target_os = "macos")'.dependencies]`，非 macOS 走 `#[cfg(not(...))]` 分支直接回 `unsupported-os` | Vision 只在 macOS 存在。放通用依赖会让 Windows/Linux 编译期就失败（本仓桌面端确实只有 macOS，但没理由让它编译不过） |
| 10 | §5.4 「新增 3 项纯函数用例」 | 实际 **4 项**（令牌集合稳定性 1 + `join_candidates` / `is_text_line` 3） | 令牌那组用循环覆盖六个值，拆成三组反而更碎 |
| 11 | §6.6 只说面板加 checkbox + 进度行 | 另外在 `ImportModal` 的 `primaryDisabled` 加一条 **`ocrProgress !== null`** | 预转换阶段（`fileToUnit` 循环）`busy` 还是 false。OCR 让这段从毫秒级变成 30s+，不挡就会重复触发同一份的识别。用进度 state 当闸门比改 `busy` 状态机安全（后者牵扯冲突面板 / cancel 分支） |
| 12 | §6.6 未说结果卡怎么展示 | 单份结果卡的「抽取量」行加一个 `OCR` 徽标（`data-testid="result-ocr-tag"`），数据来自 `extract.ocr` | 与 `extract.pages` / `extract.encoding` 同一行的既有模式；D10 要求「用户能分辨文字是识别来的」 |
| 13 | §8.1 D 组「勾选 + 空文本 → 调用 OCR」「未勾选 → 不调用（假渲染器断言零调用）」 | 改成 **D1：传了 OCR 依赖但导入 .md ⇒ 零调用** + **D2/D3 源码断言**（兜底条件 `!text && opts?.ocr`、`deps?.ocr` 才透传） | `fileToUnit` 的 pdf 分支会真的调 pdfjs，而 node 下 `pdfjs-dist` 需要 `DOMMatrix` 等浏览器全局 ⇒ 跑不了。用「md 分支行为 + 源码判定」组合锁住同一件事，且不用为测试在生产代码开注入洞 |

---

## §13 变更记录

| 日期 | 内容 |
|---|---|
| 2026-10-19 | 初版。D1–D10 全部给推荐档；技术前提全部实测（pdfjs 4.10.38 有 render / `objc2` 已在 lock / `objc2-vision` 可联网解析 / 无 `minimumSystemVersion` / Vision API 面核对 docs.rs）；**未写任何生产代码** |
| 2026-10-19 | **实施完成**（T1–T8）。实施偏差 13 条见 §12；门禁结果见 runbook「本轮门禁结果」。新增 `src-tauri/src/ocr.rs` · `import/{pdf-render,pdf-ocr,desktop-ocr,ocr-error}.ts` · `tests/import-ocr.test.ts`（21 项）；新增 crate `objc2-vision`（+ 显式收敛 features）；`pdf.ts::extractPdfText` 加可选 `opts.ocr` 并导出 `loadPdfjs` |
