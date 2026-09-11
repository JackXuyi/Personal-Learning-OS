# 资料库「导入 / 提取」功能现状与缺失核查（2026-09-11）

> **结论先行**：导入（ingest）链路已**完整接线并全绿**——三来源归一化 → 五阶段管道 →
> chapters + chunks 落库 → 后台向量化 → `/learn` 混合检索，自动门禁实测全过。
> 但存在 **1 处高危接线缺口**：**替换正文 / 追加正文 / 手动重切分后，向量只被删除、不被重算**
> （设计与实现相悖，见 G1），另有 1 处 i18n 层缺口（G2/G3）与 3 处提取质量层面的能力空白（G4–G6）。

- 核查方式：读源码 + `grep` 全仓核对调用方 + 实测门禁（**未做浏览器/E2E 校验**，遵守 `rules/no-headless-browser-validation`）
- 核查基线：`main` 分支，工作区干净（`git status` 无输出）
- 相关文档：`docs/knowledge-import-design-2026-09.md`（导入设计）、
  `docs/knowledge-import-task-runbook.md`（T1–T10 done）、
  `docs/rag-wiring-design-2026-09.md`（RAG 接线）、`docs/rag-wiring-task-runbook.md`（T1–T20 done）

---

## 1. 现状总览

### 1.1 入口

| 项 | 事实 | 位置 |
|---|---|---|
| 唯一导入入口 | 全局单例 `ImportModal`，由 `AppShell` 挂载，`openImportModal()` 事件式唤起 | `src/components/layout/AppShell.tsx:22,212` |
| 唤起点（6 处） | 首页（×2）、计划页（×2）、测验中心、新建测验、目标表单、资料库（×2）、命令面板 | `HomePage:480,512` · `PlanPage:105,156` · `QuizCenterPage:197` · `NewQuizPage:196` · `GoalFormPage:300` · `LibraryPage:245,348` · `CommandPalette:235` |

### 1.2 三来源 × 提取实现

| 来源 Tab | 支持形态 | 提取（Extraction）实现 | 护栏 | 失败语义 |
|---|---|---|---|---|
| **粘贴** `paste` | markdown / note / web / txt 四种格式 + 「仅保存资料」（不切分） | 直取 textarea 正文，不做解析 | 无体积校验 | 空正文 → 主按钮禁用 |
| **本地文件** `local`（批量） | `.md/.markdown/.mdown`、`.pdf`；**拖拽已实现**（超前于设计 P1） | md：`File.text()`（**恒 UTF-8**）；pdf：`extractPdfText` 逐页 `getTextContent`，`hasEOL` 拼行 → `\n{3,}` 折叠 | md ≤1MB · pdf ≤30MB · ≤500 页 | 不支持类型/超限**预校验**标红；扫描件/读取失败**导入期**计入批量 failed |
| **GitHub** `github` | `repo` / `tree` 子目录 / `blob` 单文件 | `api.github.com` 取元信息 + `git/trees?recursive=1` → 过滤 md（排除 node_modules/.git/dist 等）→ `raw.githubusercontent.com` **并发 4** 拉取 → `buildRepoMarkdown` 合并（每文件前插 `# <相对路径>`，根 README 置首） | ≤60 md · 单文件 ≤1MB · 合并 ≤1.5M 字符 | 404 → unavailable（不区分私有/不存在）；403 且 `x-ratelimit-remaining:0` → rate-limit；无 md → empty |

关键文件：`src/features/learn/import/{types,local-files,pdf,github,pipeline}.ts` + `{LocalFilePanel,GithubPanel}.tsx`
（纯函数与 fetch/IO 分离，fetch 可注入 → node 单测可 mock，不依赖真实网络）

### 1.3 共享管道（五阶段）

`runUnitImport`（`pipeline.ts:55`）——三来源归一化为 `ImportUnit` 后走同一条路径：

| 阶段 | 动作 | 实现 | 失败策略 |
|---|---|---|---|
| `read` | 落 `SourceDocument`（**全文存进 `textPreview`**，`status:"ready"`） | `storage.saveDocument` | 向上抛，不写半成品 |
| `detect` | 启发式切分 `splitDocument`（md 标题 / 段落聚类，target 1600 字符 · ≥3 段） | `engine/splitter-engine` | 确定性纯函数 |
| — | **0 章短路**：仍保存资料，返回空 chapterIds（UI 显示「仅保存」） | `pipeline.ts:88-93` | 非错误 |
| `refine` | `refineSplitResult`（AI 精修标题/要点/过碎合并） | 仅在 provider 就绪时执行，失败/未配置**静默回退** | 永不抛错 |
| `create` | 写 chapters | `storage.saveChapters` | 向上抛 |
| `link` | **chunks 落库** `rebuildChunks` | `index-chunks.ts:36` | 向上抛 |
| 收尾 | **后台向量化入队** `autoIndexAfterImport()`（`onlyMissing`，静默） | `index-service.ts:184` | 能力不足直接 return；失败 `.catch(()=>{})` |

`rebuildChunks` 幂等顺序：**先查旧 chunk → 清旧向量 → 删旧 chunk（含 FTS/关联表）→ 写新 chunk**
（`index-chunks.ts:42-54`，方案原伪代码为先删后查，此处已按实际语义修正）

### 1.4 下游消费

| 环节 | 事实 | 位置 |
|---|---|---|
| 检索 | `/learn` 搜索框 300ms 防抖 → `hybridSearch`：FTS(top20) + 向量(top20) → RRF 融合 → 补 docTitle/chapterTitle/semantic | `LibraryPage.tsx:118` · `ai/retrieval/hybrid-search.ts:59` |
| 降级 | 未配模型 / 库内无向量 / embedding 异常 → 只跑 FTS，`mode="fulltext"`（UI 显示「仅全文检索 ⓘ」） | `hybrid-search.ts:78-96,114` |
| 索引管理 | 设置 → AI 模型中心 → 向量索引卡：模型名、覆盖率、重建 / 仅补齐缺失 | `features/settings/VectorIndexCard.tsx:80` |
| 存储后端 | Tauri→SQLite（RAG 五类实体）· 浏览器→localStorage（**持久化时剥离向量本体**，刷新后向量检索自动降级 FTS）· 无 localStorage→memory | `storage/index.ts:34-45` · `storage/local.ts:100-102` |

### 1.5 旁支入库路径一致性

| 路径 | 是否重建 chunks | 是否触发向量化 | 位置 |
|---|---|---|---|
| 导入（粘贴/本地/GitHub） | ✅ | ✅ `autoIndexAfterImport` | `ImportModal.tsx:131,156` |
| 替换正文 | ✅ | ❌ **无** | `library/dialogs.tsx:276` → `library-actions.ts:134` |
| 追加正文 | ✅ | ❌ **无** | `library/dialogs.tsx:432` → `library-actions.ts:170` |
| 手动重切分（详情页 SplitTab） | ✅ | ❌ **无** | `detail/SplitTab.tsx:63` |
| 手动重切分（列表页） | ✅ | ❌ **无** | `LibraryPage.tsx:193` |
| 删除资料 | 级联清 chunk + 向量 ✅ | 不适用 | `library-actions.ts:60`（步骤 0） |

### 1.6 门禁实测（2026-09-11）

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | ✅ **0 error** |
| `npm run test:import` | ✅ 20/20 |
| `npm run test:chunk` | ✅ 12/12 |
| `npm run test:retrieval` | ✅ 21/21 |
| `npm run test:rag` | ✅ 8/8 |
| `npm run test:i18n` | ✅ 8/8 |

> 未做：浏览器 / E2E / 截图级校验（`rules/no-headless-browser-validation`）。
> 「真实 PDF 中文抽取质量」「GitHub 整库端到端」两项在 runbook 中仍为**手工待验项**，本次亦未做。

---

## 2. 数据流

```
粘贴正文 ─┐
.md 文件 ─┼─→ ImportUnit ─→ runUnitImport ─→ [read] saveDocument(textPreview=全文)
.pdf 文件 ─┤   (归一化)        (五阶段)      → [detect] splitDocument(纯代码)
GitHub ───┘                                  → [refine] AI 精修(可选，静默回退)
                                             → [create] saveChapters
                                             → [link]   rebuildChunks ──→ chunks + chunks_fts
                                                                          (旧向量一并失效)
                                             └─→ autoIndexAfterImport() ──→ embeddings(SQLite BLOB)
                                                                              ▲
替换 / 追加 / 重切分 ─→ splitDocumentNow ─→ rebuildChunks（清旧向量、写新 chunk）  │
                                            ✗ 到此为止，无重算 ─────────────────┘  ← G1 缺口

/learn 搜索框 ─→ hybridSearch ─→ FTS + 向量 ─→ RRF ─→ 正文命中段（无向量则降级 fulltext）
```

---

## 3. 功能缺失清单

| ID | 严重度 | 缺失内容 | 证据 | 影响 | 修复面 |
|---|---|---|---|---|---|
| **G1** | 🔴 高 | **替换 / 追加正文、手动重切分后，向量只失效不重算** | `autoIndexAfterImport` 全仓仅 2 处调用，均在 `ImportModal.tsx:131,156`；`replaceDocumentBody`/`appendDocumentBody`/`splitDocumentNow` 只调 `rebuildChunks`；`rebuildIndex` 的调用方只有 `VectorIndexCard.tsx:80` | 正文变更后该资料**向量索引清零**且无任何提示 → `hybridSearch` 静默退化为纯 FTS；向量索引卡覆盖率掉到 0 但用户看不到原因 | 4 处路径补一次 `autoIndexAfterImport()`（约 1 行/处）；更妥的做法是在 chunks 变更处挂统一「chunks-changed → 入队」钩子 |
| **G2** | 🟠 中 | **导入层用户可见错误文案硬编码中文，绕过 i18n** | `github.ts:101,104,109,188,234,342,352,370,386,430,447,453`；`local-files.ts:27,31,46`；`pdf.ts:23,32` 全部为硬编码中文字符串 | **英文界面用户看到中文报错**（限流 / 私有仓库 / 超大文件 / 扫描件 / 读取失败） | 错误类型改为携带 `kind`，文案由 UI 层按 `kind` 取 i18n（`GhErrorKind` / `LocalFileErrorKind` 已现成） |
| **G3** | 🟠 中 | **i18n 存在 9 个导入模块死键**（0 引用） | `local.kindMd`/`kindPdf`/`scanningNoText`/`readFailed`、`github.fileTooMany`、`progressDone`、`refinedBadge`、`previewHead`、`stepPreview`（`zh.ts:868-873,885,910,922` 及 en 对称） | 与 G2 互为因果：键写了但代码没走它；也说明「扫描件 / 读取失败」的**预校验提示实际未展示** | 随 G2 一并消费；确认无用的键删除（`test:i18n` 只校验结构对齐，不校验死键） |
| **G4** | 🟠 中 | **本地 md 只按 UTF-8 解码，无编码嗅探** | `local-files.ts:37` `await file.text()`；依赖中无 `jschardet`/`iconv-lite` | GBK/GB18030 编码的中文 `.md`（Windows 导出笔记的高频场景）**整体乱码**，且无任何提示 | 读 ArrayBuffer → BOM/启发式嗅探 → 按编码 `TextDecoder`；失败时明确提示而非静默乱码 |
| **G5** | 🟠 中 | **PDF 抽取无版式后处理** | `pdf.ts:38-46` 仅用 `item.str` + `item.hasEOL`，**忽略 pdf.js 提供的 `transform` 坐标** | 双栏论文阅读顺序错乱、行内硬换行造成句子被截断；且 PDF 固定走 `splitFormat:"txt"` → 只能按段落聚类，PDF 里若有「第 X 章」结构**不会被识别为章节** | 按 y 聚类 + x 分栏重排；行尾连字符/中英文粘接修复；页眉页脚去噪。或对 PDF 抽取结果做「疑似标题行」规则识别后按 md 切分 |
| **G6** | 🟡 低-中 | **提取结果质量无任何反馈** | 导入结果卡只显示「N 章 / N 条要点 / 结构修正」，无「抽取了 N 字符 / 每页平均 N 字符 / 疑似扫描件页」 | 用户无法判断 PDF 抽取是否**抽全**（最常见的静默失败：抽出一半内容照样切章成功） | 结果卡加「抽取字符数 + 页数」；`extractPdfText` 返回 per-page 非空页数，空白页占比过高时给黄色提示 |
| **G7** | 🟡 低 | **索引状态在导入结果卡不可见** | 单份/批量结果卡无索引字段（`ImportModal.tsx:367-450`） | 用户导完不知道向量化是否入队/成功，只能去设置页看覆盖率 | 结果卡追加「已入队向量化 / 未配置模型 → 仅全文检索」一行（复用 `useIndexStore`） |
| **G8** | 🟡 低 | **`AIProvider.extractKnowledge` 是空实现 stub，与真实实现双轨** | `ai/builtin.ts:133`、`ai/openai-compatible.ts:250`、`ai/registry.ts:39` 三处均抛 `not-implemented`；实际概念抽取走 `pipelines.extractChapterConceptsWithAi`（`analyze-service.ts:169`） | 接口方法零调用方，但**任何后续按接口调用都会直接抛错**（隐性坑）；「提取」语义在 AI 层有两套入口 | 要么删除该接口方法，要么让其委托 `extractChapterConceptsWithAi`（消除双轨） |
| **G9** | 🟡 低 | **浏览器后端（local）向量不可持久** | `storage/local.ts:100-102` 持久化时剥离 `vector` | 非桌面环境下「向量索引覆盖率」显示与检索能力**不一致**（覆盖率会算上元数据但 `listEmbeddingVectors` 返回空） | 已属 D1-A 既定权衡；建议覆盖率文案在 local 后端显式标注「浏览器预览不支持向量检索」，避免误解 |
| **G10** | ⚪ 信息 | **`SourceDocument.path` / `uri` 字段仍空置** | 设计 §2 已列 P2 | 无本地文件路径持久化 → 无法做「原文件变更重读」 | 非缺陷，随 P2 演进 |

---

## 4. 设计 vs 实现 偏离对照

| 设计原话 | 实现事实 | 判定 |
|---|---|---|
| `rag-wiring-design §5.2`：「替换 / 追加正文 → 正文变更 → chapters 重切 → chunk 重建 → **向量失效重算**」+「索引状态刷新」 | 失效 ✅ / 重算 ❌ / 状态刷新 ❌ | **未实现（G1）** |
| `rag-wiring-design §4.3` 副作用触发 ④「删除 / 替换正文 → 级联清理」 | 删除级联 ✅；替换仅清不重算 | 部分实现 |
| `rag-wiring-design §2` 非目标①「Section 三层结构，`sections` 表本期留空」 | `saveSection(s)` **仅存在于三个存储适配器，全仓零业务调用方**；chunk 恒不带 `sectionId` | ✅ 与设计一致（**声明的边界，不是漏做**） |
| `knowledge-import-design §2` 非目标⑦「拖拽上传（列入 P1）」 | `LocalFilePanel.onDrop` **已实现** | ✅ 超前完成 |
| `knowledge-import-design §2` 非目标①–⑤：OCR / 私有仓库 / docx·epub·html / 图片·代码 / 增量同步 | 均未实现，且失败路径均有明确提示 | ✅ 与设计一致 |
| `knowledge-import-design §2` 非目标⑥：Rust 原生文件对话框 / 路径持久化（P2） | 未实现 | ✅ 与设计一致 |
| `knowledge-import-design` 未声明 → i18n 完备性 | 导入层错误文案硬编码中文 | ⚠️ 设计空白（G2/G3） |
| `knowledge-import-design` 未声明 → 抽取质量门槛 | 无字符数反馈、无版式后处理 | ⚠️ 设计空白（G4/G5/G6） |

---

## 5. 建议修复顺序

| 里程碑 | 内容 | 对应缺口 | 性质 |
|---|---|---|---|
| **M-1** | 替换 / 追加 / 重切后补触发向量化（4 处调用点或统一钩子） | G1 | 接线缺口，最小改动、收益最高 |
| **M-2** | 导入层错误文案走 i18n（按 `kind` 映射）+ 清理 9 个死键 | G2、G3 | 文案/结构 |
| **M-3** | 本地文件编码嗅探（BOM + GBK 兜底） | G4 | 中文场景刚需 |
| **M-4** | 导入结果卡补「抽取字符数 / 页数」与「索引入队状态」 | G6、G7 | 可观测性 |
| **M-5** | PDF 版式后处理（分栏重排 + 标题识别） | G5 | 提取质量，工作量最大，建议先加规则型最小版 |
| **M-6** | 消除 `extractKnowledge` 双轨接口 | G8 | 技术债清理 |

> 前置建议：M-1 落地前**先补一条单测**（「替换正文后该资料向量条数恢复为 chunk 数」），
> 现有 `tests/rag-wiring.test.ts`（8 例）覆盖了「重切幂等」但**未覆盖「重切后向量重算」**，
> 这正是缺口能长期存活的原因。

---

## 6. 修复状态（2026-09-11 实施完毕）

> 实施与验证记录见 `docs/library-import-extraction-fix-runbook.md`；设计侧回写见
> `docs/knowledge-import-design-2026-09.md §13`。

| 缺口 | 状态 | 落地位置 |
|---|---|---|
| **G1** 向量只失效不重算 | ✅ 已修 | `library/dialogs.tsx`（替换 / 追加）、`detail/SplitTab.tsx`、`LibraryPage.tsx` 共 4 条路径补 `autoIndexAfterImport()`；新增 `isAutoIndexCapable()` 统一能力判定 |
| **G2** 错误文案硬编码中文 | ✅ 已修 | 导入层只出 `kind` + 语言中立 `detail`；新增 `import/error-text.ts` 唯一映射；`GhErrorKind` 增 `fetch-failed` |
| **G3** 9 个 i18n 死键 | ✅ 已清 | 删 `progressDone`/`refinedBadge`/`previewHead`/`stepPreview`/`github.fileTooMany`；4 个 `local.*` 归并入 `local.errors`；`kindMd/kindPdf` 已消费 |
| **G4** 本地 md 恒 UTF-8 | ✅ 已修 | 新增 `import/decode.ts`（BOM → 严格 UTF-8 → GB18030，零依赖）；编码名入 `ImportUnit.extract.encoding` 并在结果卡明示 |
| **G5** PDF 无版式后处理 | ✅ 已修 | 新增 `import/pdf-layout.ts`（y 聚类 + 分栏重排 + 间距补空格 + 跨页去噪 + 折行/连字符修复 + 疑似标题提升）；`extractPdfText` 接入并返回页数 |
| **G6** 无抽取量反馈 | ✅ 已修 | 结果卡显示「抽取 N 字符 · M/N 页有文本」；空白页占比高时黄字提示 |
| **G7** 结果卡无索引态 | ✅ 已修 | 结果卡末行：进行中 `i/n` / 已入队 / 未配置模型·仅全文检索 |
| **G8** `extractKnowledge` 双轨 | ✅ 已修 | 从 `AIProvider` 接口与 5 处实现/声明删除（types/active/registry/builtin/openai-compatible），4 处测试 mock 同步清理 |
| **G9** local 后端向量不可持久 | ⚪ 维持 | D1-A 既定权衡（覆盖率文案提示未做，见下） |
| **G10** `path`/`uri` 空置 | ⚪ 维持 | 设计 §2 已列 P2 |

**验证证据**（`typecheck` 0 error）：`test:import` 20/20 · `test:extract` 13/13（新增）·
`test:chunk` 12/12 · `test:retrieval` 21/21 · `test:rag` 10/10（8→10，新增 G1 回归与静态接线断言）·
`test:i18n` 8/8 · `test:storage` 28/28 · `test:library` 全绿。

**本次未做（如实留档）**：

- 浏览器 / E2E / 截图级校验（遵守 `rules/no-headless-browser-validation`）；
- 「真实中文 PDF 抽取质量」与「GitHub 整库端到端」仍为手工待验项；
- G9 的覆盖率文案提示（「浏览器预览不支持向量检索」）未落地；
- `SourceDocument.source` 里的 `本地文件 · <文件名>` 属**写入态数据标签**（非错误文案），
  英文界面下仍显中文；要本地化需改为存「来源类型 + 文件名」再在 UI 拼装（数据模型改动，未做）。

## 7. 关联缺陷：AI 分析（概念/要点/概览）在 builtin 本地模型上全失败（2026-09-11 补）

> 审计后用户报障「AI 分析资料提取 summary 不成功」，排查确认与导入链路无关，
> 根因在 **builtin 本地模型的生成参数于 JS→Rust 边界整段丢失**。完整方案见
> `docs/ai-analysis-summary-fix-design-2026-09.md`，实施记录见
> `docs/ai-analysis-summary-fix-runbook.md`。

| # | 断点 | 位置 | 事实 |
|---|------|------|------|
| 1 | 温度丢弃 | `src/ai/builtin.ts`（`chat()`） | request 只组 `{model, messages}`，`input.temperature` 从未进入；管道设的 0.1/0.2/0.3 全部作废 |
| 2 | 输出上限写死 | `src-tauri/src/llm/commands.rs` | `max_tokens.unwrap_or(2048)`；TS 侧 `LlmGenerateRequest.maxTokens` 零调用方 → 恒 2048，概念抽取长 JSON（单章 6~14 条 × 150~250 token）恰好在此被截断 |
| 3 | 采样恒用问答预设 | `commands.rs` + `llm/models.rs` | 恒取 `qwen35_summary()`（temp 0.5 / presence 0.3），而 JSON 适用的 `tight_structured()`（temp 0.1 / presence 0）标着 `#[allow(dead_code)]` 零调用 |
| 4 | 解析零容错 | `src/ai/pipelines.ts` `extractJson` | 截断的不闭合 JSON 直接抛错，无补救 |
| 5 | UI 不报原因 | `detail/KnowledgeTab.tsx` | 概念分析 catch 只 `console.error`；`analyze-service` 已逐章采集的 `failed[].reason` 被 UI 丢弃 |

**修复（2026-09-11 落地，见 runbook）**：① Rust `resolve_sampling()` 纯函数统一采样优先级（tight 预设 → 显式温度覆盖）+ `GenerateRequest` 增 `temperature`/`samplingPreset`；② 输出上限兜底 2048→4096（`DEFAULT_MAX_TOKENS` / `BUILTIN_MAX_TOKENS`）；③ 新增 `src/ai/json-repair.ts` 截断抢救（只保留完整元素、绝不伪造半条），`extractJson` 在 parse 失败后接入；④ `KnowledgeTab` 失败列表渲染 `标题：原因` + 总体原因，i18n 双语键 `failedItem`/`failedUnknown`。API 档（openai-compatible）零改动。
