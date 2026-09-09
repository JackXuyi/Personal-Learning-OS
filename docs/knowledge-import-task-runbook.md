# 知识库多来源导入 Task Runbook

## Goal
将资料库（`/learn`）导入能力从「仅粘贴正文」扩展为三来源：本地 `.md`、本地文本型 PDF（pdf.js 抽取文本）、GitHub 公开仓库（整库/子目录/单文件 md 合并导入）。全部归一化为 `ImportUnit` 后走现有「保存→切分→AI 精修→建章」管道；UI 弹窗升级为三 Tab 向导。依据 `docs/knowledge-import-design-2026-09.md`（用户已确认，默认「仓库合并为一份资料」）。

## Context
- 区域：`src/features/learn/`（UI + 新适配层）
- 方案文档：`docs/knowledge-import-design-2026-09.md`
- 依赖文档：`docs/ui-workbench-plan-2026-09.md`（U5 阶段进度/结果卡）、`rules/layer-import-boundaries.mdc`
- 不变：`src/engine`、`src/domain`、`src/storage`、`src-tauri`、`src/ai` 核心管线
- 决策：整库导入为主 · 仅公开仓库 · 文本型 PDF · 桌面 WebView 与浏览器预览同一条代码路径（PDF/文件/网络全走前端标准能力）

## Progress（2026-09-09 13:05 快照）

- ✅ T1 pdfjs-dist 依赖已入 package.json；✅ T2 `import/types.ts` 落地
- ✅ T3–T6 适配层编码均已落地（github.ts 13:02 / pdf.ts 12:46 / local-files.ts 12:46 / pipeline.ts 12:47）——**均未跑 typecheck 验证**
- ⏳ T7 ImportModal 容器化起为 UI 阶段；单测与全部门禁在 T10 收口
- 注：文件在并行轨道实时落地中，明细状态以其更新为准

## Tasks

### T1 — 安装 pdfjs-dist 依赖
- **Status:** completed
- **Outcome:** package.json dependencies 增加 `pdfjs-dist@^4.10.38`（已含 `^4.10.38`，lock 同步）
- **Notes:** 2026-09-09 落地；版本对齐 design §8.11。

### T2 — 定义 import 层类型与护栏（types.ts）
- **Status:** completed
- **Outcome:** `src/features/learn/import/types.ts` 落地（ImportTab/ImportUnit/UnitResult/ImportSummary/LocalFileKind + LIMITS 护栏 + classifyLocalFile/stripExtension/formatBytes 纯函数，对齐 design §4.2/§4.3/§8.1）
- **Notes:** 2026-09-09 按 design §10「先落类型」完成编码；typecheck 归 T10 门禁统一验证。

### T3 — GitHub 适配器（github.ts：URL 解析 / 文件树 / raw 拉取 / 合并）
- **Status:** in_progress
- **Outcome:** `src/features/learn/import/github.ts` 已创建（13:02，编码完成未验证）
- **Notes:** 单测（parseGithubUrl 4 类链接形态 / buildRepoMarkdown）归 T10。

### T4 — PDF 文本抽取（pdf.ts：pdfjs-dist 逐页抽取）
- **Status:** in_progress
- **Outcome:** `src/features/learn/import/pdf.ts` 已创建（12:46，编码完成未验证）
- **Notes:** 中文文本型 PDF 抽取需桌面/浏览器手工验证（§11.2）。

### T5 — 本地文件 → ImportUnit（local-files.ts）
- **Status:** in_progress
- **Outcome:** `src/features/learn/import/local-files.ts` 已创建（12:46，编码完成未验证）
- **Notes:** md 走 File.text()；pdf 委托 pdf.ts（design §8.3）。

### T6 — 共享导入管道（pipeline.ts：单份 + 批量执行器）
- **Status:** in_progress
- **Outcome:** `src/features/learn/import/pipeline.ts` 已创建（12:47，编码完成未验证）
- **Notes:** 粘贴路径行为等价（回归关键项）待手工回归确认。

### T7 — ImportModal 容器化 + 三来源 Tab + 批量结果卡
- **Status:** pending
- **Outcome:**
- **Notes:**

### T8 — LocalFilePanel / GithubPanel 面板
- **Status:** pending
- **Outcome:**
- **Notes:**

### T9 — i18n 双语文案（zh/en）
- **Status:** pending
- **Outcome:**
- **Notes:**

### T10 — 单测 + typecheck + test:i18n + build
- **Status:** pending
- **Outcome:**
- **Notes:**

## Verification checklist
- [ ] 粘贴路径行为与改造前一致（回归）
- [ ] 本地 .md 导入 → 资料出现于 /learn 并可读
- [ ] 本地文本型 PDF 导入 → 抽取文本成章
- [ ] GitHub 公开仓库 URL → 预览 → 合并导入成资料
- [ ] `npm run typecheck` 0 error；`npm run test:i18n`；新增 `npm run test:import`
