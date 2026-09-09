# 知识库多来源导入 Task Runbook

## Goal
将资料库（`/learn`）导入能力从「仅粘贴正文」扩展为三来源：本地 `.md`、本地文本型 PDF（pdf.js 抽取文本）、GitHub 公开仓库（整库/子目录/单文件 md 合并导入）。全部归一化为 `ImportUnit` 后走现有「保存→切分→AI 精修→建章」管道；UI 弹窗升级为三来源 Tab 向导。依据 `docs/knowledge-import-design-2026-09.md`（用户已确认，默认「仓库合并为一份资料」）。

## Context
- 区域：`src/features/learn/`（UI + 新适配层）
- 方案文档：`docs/knowledge-import-design-2026-09.md`
- 依赖文档：`docs/ui-workbench-plan-2026-09.md`（U5 阶段进度/结果卡）、`rules/layer-import-boundaries.mdc`
- 不变：`src/engine`、`src/domain`、`src/storage`、`src-tauri`、`src/ai` 核心管线
- 决策：整库导入为主 · 仅公开仓库 · 文本型 PDF · 桌面 WebView 与浏览器预览同一条代码路径（PDF/文件/网络全走前端标准能力）

## Progress（2026-09-09 13:40 收官快照）

- ✅ T1–T10 全部完成；自动门禁实测全绿：typecheck 0 error / test:i18n 8/8 / test:import 20/20 / vite build ✓（pdf.worker chunk 正常分离）
- ⏳ 剩余为手工验证项（见 Verification checklist）：粘贴回归、PDF 中文抽取、GitHub 整库端到端需 dev server 目检
- 代码提交：`<fill-after-commit>`；UI 数据-testid 与手工走查归入后续验收

## Tasks

### T1 — 安装 pdfjs-dist 依赖
- **Status:** completed
- **Outcome:** package.json dependencies 增加 `pdfjs-dist@^4.10.38`（已含 `^4.10.38`，lock 同步）
- **Notes:** 2026-09-09 落地；版本对齐 design §8.11。

### T2 — 定义 import 层类型与护栏（types.ts）
- **Status:** completed
- **Outcome:** `src/features/learn/import/types.ts` 落地（ImportTab/ImportUnit/UnitResult/ImportSummary/LocalFileKind + LIMITS 护栏 + classifyLocalFile/stripExtension/formatBytes 纯函数，对齐 design §4.2/§4.3/§8.1）
- **Notes:** 2026-09-09 按 design §10「先落类型」完成编码；门禁由 T10 统一实测通过。

### T3 — GitHub 适配器（github.ts：URL 解析 / 文件树 / raw 拉取 / 合并）
- **Status:** completed
- **Outcome:** `src/features/learn/import/github.ts`（parseGithubUrl/fetchRepoMeta/pickMarkdownEntries/listMarkdownFiles/fetchRawText/fetchMdContents/buildRepoMarkdown + UI 高层 resolveGithubUrl/buildGithubUnit）
- **Notes:** 纯函数 + 可注入 fetch；单测覆盖 4 类链接形态/合并顺序/护栏（import-core 20/20）。

### T4 — PDF 文本抽取（pdf.ts：pdfjs-dist 逐页抽取）
- **Status:** completed
- **Outcome:** `src/features/learn/import/pdf.ts` 落地（pdfjs worker 运行时解析，build 产物含 pdf.worker chunk）
- **Notes:** 中文文本型 PDF 抽取质量需桌面/浏览器手工验证（§11.2）。

### T5 — 本地文件 → ImportUnit（local-files.ts）
- **Status:** completed
- **Outcome:** `src/features/learn/import/local-files.ts` 落地（md 走 File.text()；pdf 委托 pdf.ts）
- **Notes:** classifyLocalFile 护栏单测覆盖（超限/不支持类型）。

### T6 — 共享导入管道（pipeline.ts：单份 + 批量执行器）
- **Status:** completed
- **Outcome:** `src/features/learn/import/pipeline.ts` 落地（runUnitImport/runBatchImport，单份失败不阻断批量）
- **Notes:** 内存后端单测 5 项（切章/0 章/空标题回退/批量容错）；粘贴路径行为等价回归属手工项。

### T7 — LocalFilePanel / GithubPanel 面板
- **Status:** completed
- **Outcome:** `import/LocalFilePanel.tsx` + `import/GithubPanel.tsx` 落地（拖拽/多选预检/仓库解析预览）
- **Notes:** UI 走查归手工验证清单。

### T8 — ImportModal 容器化 + 三来源 Tab + 批量结果卡
- **Status:** completed
- **Outcome:** `src/features/learn/ImportModal.tsx` 容器化改造（paste/local/github 三 Tab + 批量进度/汇总结果卡）
- **Notes:** 门禁实测通过；交互手感待 dev server 走查。

### T9 — i18n 双语文案（zh/en）
- **Status:** completed
- **Outcome:** `src/i18n/messages/{zh,en}.ts` 新增 sourceTab/local/github/batch 文案（zh/en 同构）
- **Notes:** test:i18n 8/8 通过（结构对齐 + 引擎默认中文）。

### T10 — 单测 + typecheck + test:i18n + build
- **Status:** completed
- **Outcome:** `tests/import-core.test.ts`（20 用例）+ package.json `test:import` 脚本；实测：typecheck 0 error / test:i18n 8/8 / test:import 20/20 / vite build ✓
- **Notes:** 自动门禁全部通过后提交（feat commit）；剩余手工回归不阻塞提交。

## Verification checklist
- [ ] 粘贴路径行为与改造前一致（回归）——**手工**（pipeline 行为等价由 T6 单测覆盖，UI 走查待办）
- [x] 本地 .md 导入 → 资料出现于 /learn 并可读（T6 单测 runUnitImport 覆盖落库；UI 走查待办）
- [ ] 本地文本型 PDF 导入 → 抽取文本成章——**手工**（真实文本 PDF 目检）
- [ ] GitHub 公开仓库 URL → 预览 → 合并导入成资料——**手工**（真实仓库端到端）
- [x] `npm run typecheck` 0 error；`npm run test:i18n` 8/8；`npm run test:import` 20/20；`vite build` ✓
