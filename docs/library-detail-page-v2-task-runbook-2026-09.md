# 资料详情页 v2 优化 —— 实施 runbook

| 字段 | 内容 |
|------|------|
| 日期 | 2026-09-10 |
| 关联方案 | `docs/library-detail-page-v2-design-2026-09.md`（已确认，D1=A / D2=A / D3=A） |
| 目标 | ①Tab 选中态可见 ②章节正文正确渲染 ③知识点文本正确渲染 ④Tab 铺满整行 ⑤资料链路自适应 |
| 范围 | 纯 UI/渲染层；不碰 domain/engine/ai/storage；无迁移；不引新依赖 |
| 交付 | 5 批次 / T1–T11；每批 typecheck 归零再进下一批；本地 commit 不 push |

## 批次与任务

### 批次一：T1 → T2（Tab 栏 + 页面骨架）

| ID | 任务 | 文件 | Status | Outcome |
|----|------|------|--------|---------|
| T1 | Indicator 绑定 `--active-tab-left/-width`；List `w-full`、Tab `flex-1` | `src/components/ui/tabs.tsx` | done | done | Indicator 绑定经 Base UI 源码实证的 `--active-tab-left/-width`（值自带 px）；Tab 去掉 border-b-2，选中态单一来源 
| T2 | `PageContainer` 加 `size="wide"`；详情页切 wide + URL 合并式更新 + 顶部响应式 | `src/components/layout/AppShell.tsx`、`src/features/learn/DocumentDetailPage.tsx` | done | done | `PageContainer` default 分支逐字保留、新增 wide；`selectTab` 改合并式更新（保留 `at`） 

验证：`npm run typecheck` 0 error；自审 Indicator className 含 `left-[var(--active-tab-left)]` 与 `w-[var(--active-tab-width)]`。

### 批次二：T3 → T4（渲染层收敛 + 阅读页换装）

| ID | 任务 | 文件 | Status | Outcome |
|----|------|------|--------|---------|
| T3 | 新增 `markdown-core.tsx`（safeUrl / markdownComponents / inlineMarkdownComponents / MarkdownBlock / MarkdownInline）；`MarkdownRenderer` 改薄包装 | `src/features/learn/render/markdown-core.tsx`(新)、`MarkdownRenderer.tsx` | pending | done | `markdown-core` 为全仓唯一 markdown 映射表；块级 / 行内两套 components；`MarkdownRenderer` 退化为薄包装，registry 契约零变化 
| T4 | 阅读页正文换 `pickRenderer` + `RenderErrorBoundary`；删除 `ArticleBody.tsx`；容器/底栏响应式 | `src/features/learn/ChapterReaderPage.tsx`、`src/features/learn/ArticleBody.tsx`(删) | pending | done | 阅读页正文走 `pickRenderer` + `RenderErrorBoundary`（与「资料内容」Tab 同源）；`ArticleBody.tsx` 已删除，`grep` 仅剩 2 处历史注释 

验证：`grep -rn "ArticleBody" src` 为空；`npm run typecheck` 0 error。

### 批次三：T5 → T6（章行展开 + 知识点文本）

| ID | 任务 | 文件 | Status | Outcome |
|----|------|------|--------|---------|
| T5 | `chapter-preview.ts` 纯函数；`ChapterRow` 可展开正文；`SplitTab` 传 `doc` + 统计口径统一 | `src/features/learn/chapter-preview.ts`(新)、`detail/ChapterRow.tsx`、`detail/SplitTab.tsx` | pending | done | `chapter-preview.ts` 纯函数（夹取越界 / 空行断开 / 上限 1200）；ChapterRow 容器+标题 Link+展开按钮；SplitTab 统计口径统一 
| T6 | 要点 / 引用 / 回退 `keyPoints` 走 `MarkdownInline` | `src/features/learn/detail/KnowledgeTab.tsx` | pending | done | 要点 / 原文引用 / 回退 keyPoints 三处走 `MarkdownInline`（字号继承父级） 

验证：`npm run typecheck` 0 error；`chapter-preview` 可被 node 直跑。

### 批次四：T7 → T8（图谱 + 断点收尾）

| ID | 任务 | 文件 | Status | Outcome |
|----|------|------|--------|---------|
| T7 | 聚焦侧栏 `summary` 走 `MarkdownBlock` + 响应式（窄屏堆叠、画布高度分档） | `src/features/knowledge/GraphView.tsx` | pending | done | 摘要走 `MarkdownBlock`；根容器 `flex-col lg:flex-row`、画布高度 320/440/560 分档、侧栏 `w-full lg:w-72`。**配色未动**（R3 另议） 
| T8 | `SplitTab` 工具条窄屏分行；`PapersTab` 三处 `ml-auto` → `sm:ml-auto`；`ChapterRow` 进度条 `hidden sm:flex` | 上述三文件 | pending | done | PapersTab 三处 `ml-auto` → `sm:ml-auto`；SplitTab 工具条按钮区窄屏整行占满、ChapterRow 进度条 `hidden sm:flex` 已在批次三随 T5 完成 

验证：`npm run typecheck` 0 error；逐文件核对断点类名。

### 批次五：T9 → T10 → T11（文案 / 单测 / 收尾）

| ID | 任务 | 文件 | Status | Outcome |
|----|------|------|--------|---------|
| T9 | i18n zh/en 成对新增 4 键（expand / collapse / openFull / previewEmpty） | `src/i18n/messages/zh.ts`、`en.ts` | pending | done | **提前至批次三**（避免中途 typecheck 因缺键失败）：zh/en 成对新增 expand/collapse/openFull/previewEmpty 
| T10 | `tests/library-chapter-preview.test.ts` + `test:preview` 脚本 | `tests/`、`package.json` | pending | done | `tests/library-chapter-preview.test.ts` 10 项断言全绿；`test:preview` 挂载、`test:library` 串联为四组 
| T11 | 验证与收尾：typecheck / test:i18n / test:library / 回归 / 文档同步 / 提交 | — | pending | done | typecheck 0 error / test:i18n 8-8 / test:library 34-34 / 回归 scope 3-3 · eta · import 20-20 全通过；文档同步；分 5 条提交（本地） 

验证：`test:i18n` 通过；`test:library` 全绿；方案状态置「已完成」。

## 收尾清单

- [x] `npm run typecheck` 0 error
- [x] `npm run test:i18n` 通过
- [x] `npm run test:library` 全绿（含新增 preview 组）
- [x] 回归：`test:scope` / `test:eta` / `test:import`
- [x] 静态边界：`chapter-preview.ts` 不含 React / storage 导入
- [x] 代码自审：无硬编码中文、无一次性 hex、断点类名齐全
- [x] 方案状态改「已完成」；本 runbook 状态全量回填
- [x] 按 `rules/commit-conventions` 分组提交（**仅本地，不 push**），用 `git commit -- <pathspec>` 隔离并行会话改动
- [x] 追加 `.workbuddy/memory/2026-09-10.md` 日志

## 风险与回滚

- 本次纯 UI 改动、零数据写入 → 逐批次独立提交，任一批次异常直接 `git revert <sha>`。
- 工作树常有并行会话改动 → 提交严格用 pathspec 隔离，不裸 `git commit -a`。
