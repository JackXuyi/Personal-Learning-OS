# 资料详情页「概览」Tab 实施 Runbook（2026-09）

| 字段 | 内容 |
|------|------|
| 状态 | 已完成（2026-09-10） |
| 关联方案 | `docs/library-detail-page-overview-tab-design-2026-09.md` |
| 执行顺序 | 批次一 T1/T2/T3 → 批次二 T4/T5/T6 → 批次三 T7/T8/T9 → 批次四 T10/T11 |

## 任务清单

| ID | 任务 | 文件 | 状态 | outcome |
|----|------|------|------|---------|
| T1 | `OverviewMode` + `DocumentOverview` + `SourceDocument.overview?` + `isOverviewStale` | `src/domain/document.ts` | done | 纯谓词「无概览 → false」，不制造过期焦虑；可选字段零迁移 |
| T2 | `isRecord` / `str` 改 export | `src/ai/pipelines.ts` | done | 仅加 `export` 与 2 行注释（净增 2 行），不新增管道逻辑 |
| T3 | `OVERVIEW_LIMITS` + `planOverviewBlocks` | `src/ai/overview-pipeline.ts` | done | 章边界优先 → 章内 `\n\n` 二次切 → 超限放大块尺寸 → 算术均分兜底；末块 `end === len` |
| T4 | 3 个 system prompt + 3 个 builder + `parseChunkDigest` / `parseOverviewDraft` | `src/ai/overview-pipeline.ts` | done | 归并提示词明写「sections 必须明显少于摘要条数」，防小模型逐条搬运 |
| T5 | `summarizeDocumentWithAi`（双路 + 跳过计数） | `src/ai/overview-pipeline.ts` | done | 单块失败跳过不阻断；全失败抛错；归并不合规抛错 → 不落半成品 |
| T6 | `generateOverviewNow` + 职责边界注释补第 ④ 项 | `src/features/learn/analyze-service.ts` | done | **不校验 no-chapters**（概览只依赖正文）；写库仅在成功后执行 |
| T7 | `OverviewTab`（四态 + 统计面板 + 入口按钮） | `src/features/learn/detail/OverviewTab.tsx` | done | 统计面板始终渲染、与 AI 状态解耦；唯一写动作是 `generateOverviewNow` |
| T8 | Tab 前插 overview + 默认 overview + 白名单校验 | `src/features/learn/DocumentDetailPage.tsx` | done | 顺带修掉「`?tab=foo` 致全部 Panel 不渲染（白屏）」的既有缺陷 |
| T9 | i18n zh/en 成对补齐 | `src/i18n/messages/{zh,en}.ts` | done | `tabs.overview` + `detail.overview` 26 键；与组件同批落地（避免中途 typecheck 缺键） |
| T10 | `tests/library-overview.test.ts` + scripts | `tests/`、`package.json` | done | 24 项断言；`test:overview` 挂载、`test:library` 串联为五组 |
| T11 | 全量验证 + 文档回填 + 分组提交 | — | done | typecheck 本任务文件 0 error / i18n 8-8 / library 58-58 / 回归 scope 3-3 · import 20-20 · eta 全通过 |

## 与方案的两处偏差（均有理由，已记入方案变更记录）

1. **`onProgress` 追加第 4 个参数 `phase`**（`OverviewPhase = "single" | "map" | "merge"`）。
   方案 §4.3.2 的回调只有 `(i, n, label)`，而 §7.2 已为「正在成稿…／正在归纳 i/n／正在归并成稿…」
   三种文案分别设计 —— 不给 phase，UI 只能在 map 文案里硬套。追加可选参数不影响任何既有调用方。

2. **无章节时的块 label 改为空串**（方案 §4.3.4 步骤 6 原为 `第 N 段`）。
   该 label 会经 `onProgress` **直接进 UI 进度行**，硬编码中文会漏到英文界面。
   章标题属数据可以透出；`第 N 段` 属文案。序号提示由提示词自身给出（`第 i/n 段`），信息不丢。

## 已知遗留（不在本次范围）

- `src/ai/pipelines.ts` 仍 767 行，超出仓库 ≤700 行上限（方案登记 R4）。本次**未新增任何管道**，
  仅加 `export`，未扩大超限；建议另开任务按能力拆分为 `pipelines/` 目录 + index 重导出。
- `AnalyzeServiceError` 的 message 仍为中文（既有约定，`analyzeChaptersNow` 等三个函数同款）。
  概览路径上这两条（未配置 / 无正文）已被 UI 的按钮禁用前置拦截，实际不可达。
- `GraphView` 硬编码 `slate-*` / `indigo-*` 配色（v2 登记的 R3），未动。

## 验证命令

```
npm run typecheck     # 本任务文件 0 error（并行会话的 storage/import 文件报错不属本任务）
npm run test:i18n     # 8/8
npm run test:library  # anchor 7 · advice 9 · keypoint 8 · preview 10 · overview 24 = 58/58
npm run test:scope    # ALL PASS
npm run test:import   # 20/20
```

## 视觉验收（SC-1~SC-6，留给用户目视）

| 编号 | 验收点 |
|------|--------|
| SC-1 | 进详情页默认落在「概览」，Tab 栏首位，主色下划线在概览上 |
| SC-2 | 5 个 Tab 等分铺满整行，960px 窗口不溢出、不换行 |
| SC-3 | 未生成时：空态卡 + 按钮可用/禁用正确（AI 未配置时给「去配置 AI 模型 →」） |
| SC-4 | 生成中：进度行逐块递进；重新生成时旧内容不闪空 |
| SC-5 | 已生成：四个区块渲染正常，AI 文本中的 `**加粗**` 正确渲染（不显示字面星号） |
| SC-6 | 统计面板数字与其余 Tab 一致（章数 / 概念数与关键知识点 Tab 相同） |
