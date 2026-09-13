# AI 交互 loading 统一 · 第二轮修复 runbook（2026-09-13）

> 来源：第一轮实施后的交互审查（结论见会话记录）。
> 方案基线：`docs/ai-loading-unify-design-2026-09.md`；第一轮 runbook：`docs/ai-loading-unify-task-runbook.md`（T1–T9 全 done）。

## 意图与 Done 标准

- 修复交互审查发现的 2 个 🔴 bug：R1（陈旧 done 终态拦截「去测本章」自动出卷）、R2（跨页面终态消息串台）。
- 落地第二批收敛：抽 `AiTaskStatusLine` 统一「running 进度行 + 终态消息卡」模式（现重复 ≥4 处），内建新鲜度门 + dismiss。
- 顺带：Button loading 文案统一（保留原标签）；AssessmentPage 重挂后 busy 指示从任务记录派生。
- Done：`npm run typecheck` 本任务 0 error；`test:aitask` 含新鲜度用例全过；既有 `test:*` 零回归；工作树干净、按域分组提交。

## 任务清单

### F1 — R1：NewQuizPage 自动路径守卫改为仅挡 running
- **Status:** done
- **Outcome:** 自动路径守卫 `task.skipIfFinished` → `task.running`；done 拦截回归 `autoDone` flag。注释说明与 PapersTab 共享 id 的串扰根因。
- **Notes:** `task.skipIfFinished`（running‖done）换成 `task.running`；done 拦截交给既有 `autoDone` flag。`paper:{docId}` 与 PapersTab 共享 id，PapersTab 出过卷后 done 记录不得拦掉 `/quiz/new?mode=unit-test` 自动建卷。

### F2 — R2：终态新鲜度门（纯函数 + TTL）
- **Status:** done
- **Outcome:** `ai-task-types.ts` 新增 `AI_TASK_TERMINAL_TTL_MS = 90_000` + `isTerminalFresh`（status 放宽为可选，兼容 hook 返回子集）；`useAiTask` 返回值补 `endedAt`；单测 F2-01~04（14/14 过）。
- **Notes:** `ai-task-types.ts` 新增 `AI_TASK_TERMINAL_TTL_MS = 90_000` 与 `isTerminalFresh(rec, now?, ttl?)`（running 恒 fresh；终态按 `endedAt` 判窗口）。跨页面/跨天陈旧终态不再渲染。`useAiTask` 返回值补 `endedAt`。单测补 4 例。

### F3 — 收敛：新增 `components/ai-task-status-line.tsx`
- **Status:** done
- **Outcome:** 新增 `src/components/ai-task-status-line.tsx`（AiTaskView 子集 props；running 行 aria-live / 终态卡 freshness 门 + dismiss；error 前缀 `aiTask.failed` + formatError 映射）。i18n 新增 `aiTask.dismiss` 双语。
- **Notes:** 单一组件承载「running → phase 文案（aria-live）；终态 → 新鲜度门内渲染消息卡 + dismiss（`task.clear`）」。props：`task`（视图子集）/ `runningFallback` / `formatError?` / `onDismiss?`。错误前缀与 dismiss 文案走 `aiTask.failed` / 新增 `aiTask.dismiss`（双语成对）。

### F4 — 桥接页接入 AiTaskStatusLine + Button 文案统一
- **Status:** done
- **Outcome:** OverviewTab / SplitTab / KnowledgeTab（statusTask 择一：running 优先 → endedAt 更近）/ NewQuizPage（含 taskErrorText）接入状态行；ChapterGraphPage 保持 pill 形态仅内联 freshness 门；三处 Button 去掉 running 换字（统一保留原标签）。
- **Notes:** OverviewTab / SplitTab / KnowledgeTab（双任务择一展示）/ NewQuizPage（含 `taskErrorText` 映射）替换既有散装状态块；ChapterGraphPage 为工具栏 pill 形态，仅内联加新鲜度门，不换组件。Button loading 时保留原标签（OverviewTab / NewQuizPage / ChapterGraphPage 去掉 running 换字）。

### F5 — AssessmentPage 重挂 busy 指示派生
- **Status:** done
- **Outcome:** AssessmentPage 测试按钮文案双源：`busyChapter === c.id || isPaperRunning(doc.id)`，重挂后不再出现「禁用但无指示」盲区。
- **Notes:** `busyChapter === c.id || isPaperRunning(doc.id)` → 显示「测一章」；修掉重挂后按钮禁用但无指示的盲区。

### F6 — 收尾：typecheck 0 error + test:aitask 扩展 + 回归 + 分组提交
- **Status:** done
- **Outcome:** typecheck 本任务 0 error（仅剩他人 a230655 遗留 AIModelsSection 3 个 TS6133）；test:aitask 14/14；test:i18n / test:library / test:ai / test:flow 零回归。
