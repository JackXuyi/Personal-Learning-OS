# 资料库模块实施 Runbook

## Goal

按 `docs/library-module-design-2026-09.md`（v2：切分=代码不重试｜分析=AI 可重跑）把「资料」升格为一等管理对象：`/learn` 列表页（卡片）+ `/learn/doc/:docId` 详情页（4 Tab）+ 资料级 CRUD + 代码切分/AI 分析分离 + 重新切分同源保留掌握度。

## Context

- 方案：`docs/library-module-design-2026-09.md`（12 章，含伪代码与测试方案）
- 关联：`docs/knowledge-import-design-2026-09.md`（导入管道，**零改动**）；`docs/ui-workbench-plan-2026-09.md` §11/U5（收尾同步）
- 硬约束：Rust 零改动；导入管道零改动；`split-service` 不得 import `ai/*`；`analyze-service` 不得 import `splitter-engine`；UI 文案 zh/en 成对；组件不直碰 localStorage；校验走 typecheck + node 单测（禁浏览器）

## Tasks

### T1 — Domain + Storage 契约扩展
- **Status:** done
- **Outcome:** `domain/document.ts` 增加可选 `analysis`（chaptersAt/conceptsAt/model）；`storage/types.ts` 契约新增 `getDocument` / `deletePaper`；`memory.ts` 实现（deletePaper 级联清草稿+结果）；`local.ts` override `deletePaper` 落盘。

### T2 —
- **Status:** in_progress
- **Outcome:** overlapRatio（min 分母）/ matchResplit（0.6 贪心）/ remapLearnerStateOnResplit（max 分数、sum 计数、max 时间、Bloom 取高、误解并集 cap 8）已落地，纯函数无 IO
- **Notes:** overlapRatio / matchResplit（阈值 0.6 贪心）/ remapLearnerStateOnResplit（max/sum/max/并集）

### T3 —
- **Status:** done
- **Outcome:** splitDocumentNow 落地：先算后写；SplitServiceError no-body/no-chapters；签名无 provider、无重试
- **Notes:** splitDocumentNow；签名无 provider；先算后写；类型化错误 no-body / no-chapters

### T3b —
- **Status:** done
- **Outcome:** analyzeChaptersNow / analyzeConceptsNow 落地：抛错版管道；replaceChapterConcepts 按 oldUnitIds 签名适配；写 doc.analysis；TC-EDGE-12 已修正为「不 import splitDocument」
- **Notes:** analyzeChaptersNow / analyzeConceptsNow；抛错版管道；写 doc.analysis；不改 chapter.id/区间

### T5 —
- **Status:** done
- **Outcome:** deleteDocumentCascade / previewDeleteCascade / renameDocument / updateDocumentMeta / replaceDocumentBody（三阶段事件）/ appendDocumentBody（1.5M 护栏）落地，store 可注入
- **Notes:** deleteDocumentCascade / previewDeleteCascade / renameDocument / updateDocumentMeta / replaceDocumentBody / appendDocumentBody（替换/追加后清空 analysis）

### T6 —
- **Status:** done
- **Outcome:** ui/tabs.tsx + ui/dropdown-menu.tsx 落地（Base UI 底层，data-slot + 语义 token，destructive item）
- **Notes:** Base UI 底层，shadcn 同构

### T7 —
- **Status:** done
- **Outcome:** primitives.tsx 追加 SegmentedTabs（role=tablist，testIdPrefix 透传）

### T8 —
- **Status:** done
- **Outcome:** ArticleBody.tsx 抽取；ChapterReaderPage 改用共享组件；typecheck 0 error
- **Notes:** 阅读页行为不变

### T9 — DocumentCard.tsx + DocActionsMenu.tsx
- **Status:** pending
- **Outcome:**

### T10 — 弹窗组（rename / meta / replace / append / delete）
- **Status:** pending
- **Outcome:**

### T11 — LibraryPage.tsx 列表页
- **Status:** pending
- **Outcome:**

### T12 — DocumentDetailPage.tsx 骨架
- **Status:** pending
- **Outcome:**
- **Notes:** Tab 状态 URL 化 ?tab=

### T13 — 4 个 Tab
- **Status:** pending
- **Outcome:**
- **Notes:** SplitTab 切分+分析双行；KnowledgeTab AI 概念分析；PapersTab 试卷列表

### T14 — 路由重构 + 旧链接重定向 + 9 处链接更新 + 删除 ChapterCatalogPage
- **Status:** pending
- **Outcome:**
- **Notes:** 一次提交完成；grep `/learn/` 无残留旧形态

### T15 — i18n：learn.library.* / learn.detail.*（zh/en），清理 learn.catalog.*
- **Status:** pending
- **Outcome:**

### T16 — 单测 4 件 + typecheck + test:i18n + test:import 回归
- **Status:** pending
- **Outcome:**
- **Notes:** library-resplit / library-split / library-analyze（假 provider）/ library-cascade

## 收尾

- [ ] 最小化更新 `docs/ui-workbench-plan-2026-09.md` §11/U5
- [ ] 方案状态改「已完成」
- [ ] 按 commit-conventions 分组提交
