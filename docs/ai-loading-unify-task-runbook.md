# AI 交互 Loading 状态统一 — 任务 Runbook

## Goal

统一 11 处 AI 交互的 loading：按钮触发即 loading 至任务终结；切页/切 Tab 再回来从全局 store 恢复 loading 与进度；后台完成/失败后回页可见终态。方案见 `docs/ai-loading-unify-design-2026-09.md`（D1–D4 已按推荐项确认）。

## Context

- 方案：`docs/ai-loading-unify-design-2026-09.md`
- Docs read：`rules/layer-import-boundaries.mdc`、`rules/engineering-code-style.mdc`、`skills/plos-ui-system`、`skills/ui-impl-tokens`
- 约束：管道层签名零改动；不持久化；AbortSignal/任务中心/keep-alive 为非目标。

## Tasks

### T1 — 基建：ai-task-types + useAiTaskStore（store/hook/执行器）
- **Status:** done
- **Outcome:** `src/stores/ai-task-types.ts` + `src/stores/useAiTaskStore.ts`（store + useAiTask + runAiTask 三合一；run finally 补 finish("done") 静默回退语义；迟到 setPhase/finish 忽略；skipIfFinished 供幂等重入）。
- **Notes:** 终态保留至下次 start；typecheck 仅剩他人提交 a230655 遗留的 AIModelsSection.tsx 3 个 TS6133（非本任务引入，不修）。

### T2 — 基建：ui/Spinner + ui/Button loading prop
- **Status:** done
- **Outcome:** `src/components/ui/spinner.tsx` 新增；`button.tsx` 加 `loading` prop（disabled 或逻辑 + aria-busy + 前置 Spinner）。

### T3 — i18n：`aiTask.*` 双语 key
- **Status:** done
- **Outcome:** zh/en 均加 `aiTask.{running,fallbackDone,failed,alreadyRunning}`。

### T4 — 桥接 detail 三 Tab（OverviewTab / SplitTab / KnowledgeTab）
- **Status:** done
- **Outcome:** 三 Tab busy state 全部迁入 useAiTaskStore；OverviewTab（overview:{docId}，进度文案进 store）、SplitTab（refine:{docId}，重新切分保留组件内 splitting）、KnowledgeTab（keypoints/concepts:{docId} 双任务互斥，进度文案 + done 终态摘要进 store）。
- **Notes:** store run 的 fn 增加 done(message) 回调以支持「done 终态带结果文案」；SplitTab/KnowledgeTab 重挂后从 task.message 恢复终态提示。

### T5 — 桥接出卷三入口（NewQuizPage / PapersTab / AssessmentPage）+ UC-04 修复
- **Status:** done
- **Outcome:** 三入口统一 taskId `paper:{docId}`（同 id 共享互斥）。NewQuizPage 原生 button 换 ui/Button、loading、自动路径幂等 skipIfFinished、失败/回退终态落页面（新增 np.localFallback/errInvalidMode/errNoChapters）；PapersTab busyKey 降级为按钮指示、终态摘要 done(message) 进 store；AssessmentPage 行数动态 → 订阅 tasks map + runAiTask 执行器。
- **Notes:** NewQuizPage 回退文案在导航后经 store 持久，返回向导仍可见；失败停留在本页展示。

### T6 — 桥接批改两页（QuizGradingPage / QuizReportPage）
- **Status:** done
- **Outcome:** 两页共享 grade:{paperId}。判卷页 AI 批改段经 task.run（失败终态进 store，客观计分流程不中断），loading 视图与 aiFailedTail 由 task.running/status 派生；undo 时 task.clear() 支持重新批改。报告页重试按钮 loading + Spinner、终态消息从 store 恢复。
- **Notes:** gradedFor ref 保留（整段 run 的导航守卫）——store 的 done 终态会持久保留，若用它替代会把「回访判卷页重定向/重判」正常流程也拦掉；skipIfFinished 只守 AI 批改段的幂等重入。

### T7 — 桥接 ChapterGraphPage + spinner 收敛（ImportModal / ApiModelsTab / library/dialogs）
- **Status:** done
- **Outcome:** ChapterGraphPage 换 ui/Button + graph-extract:{docId}:{chapterId}（成功/失败终态从 store 读回，本地 error 仅存预检失败）；ImportModal busy 镜像注册 `import` 任务（runSingle/runBatch 包裹）；4 处内联 spinner 全部收敛为 `<Spinner />`（grep animate-spin 于 src/ 仅剩 spinner.tsx）。
- **Notes:** 连接测试（ApiModelsTab）不进注册表（D2 范围）。

### T8 — 单测 tests/ai-task.test.ts + 挂 npm script
- **Status:** done
- **Outcome:** `tests/ai-task.test.ts` 10/10 通过（TC-UC01~04、TC-EDGE-01/02、clear）；`npm run test:aitask` 已挂 script。

### T9 — 收尾：typecheck 0 error + 全量 test 回归 + 文档同步
- **Status:** done
- **Outcome:** 全量 23 个既有 test:*（含 test:library 七组、test:rag、test:ai）零回归；4 处内联 spinner 清零；typecheck 本任务改动 0 error —— 仅剩他人提交 a230655 遗留的 AIModelsSection.tsx 3 个 TS6133（按纪律不修他人文件，需该提交所属会话处理）。
- **Notes:** 管道层签名零改动；各页可单独 revert 回滚。
