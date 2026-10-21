# UI 设计系统整改 · 实施 runbook

## Goal

按 `docs/ui-design-system-remediation-design-2026-10.md` 的推荐档（**D1–D7 全部取推荐项**），
把 436 处硬编码调色板色收敛到语义 token，并补齐「空态原语 / 三档容器 / 主次层级 / 检索口径」四块地基。

- **D1-B** 按域分 5 批收敛，逐批独立提交 + 基线递减（非一次性全量）
- **D2-A** 新增状态语义三件套 `*-soft` / `*-border` / `*-ink`（mastered/weak/failed/learning）
- **D3-A** 新增 `--text-badge`(10px) / `--text-meta`(11px)，全量替换（**像素不变，只换名字**）
- **D4-A** `ActionCard` 左侧 3px primary 竖条 + `shadow-md`
- **D5-B** `PageContainer` 升三档：`default`(1024) / `wide`(1600) / `focus`(768)
- **D6-B** 保留两个搜索入口，统一 `CONTENT_SEARCH` 口径 + 形态区分
- **D7-A** 阅读页右栏 300 → 380px，「问这一章 / 讲给我听」收敛为右栏内分区切换

**Done 的定义**：`typecheck` / `layer:check` / `ui:check`（含 palette 闸）/ `copy:check` /
`test:i18n` / `test:library` 全绿；palette 命中数归 **0**；裸字号 `text-[Npx]` 归 **0**；
空态自写容器归 **0**。

## Context

- 方案：`docs/ui-design-system-remediation-design-2026-10.md`（12 章 / 749 行，D1–D7 已确认按推荐档）
- 上游评审：`docs/ui-design-system-remediation` 的产物即为该方案（评审数据见本文件「开工前基线」）
- 相关约定：`skills/ui-impl-tokens/SKILL.md`、`rules/dropdown-select.mdc`、`rules/react.mdc §Styling`
  （sticky 禁 backdrop-filter）、`rules/no-headless-browser-validation.mdc`（禁止起浏览器取证）
- 与即时反馈层的关系：`src/features/learn/reader/qa-shared.tsx` 已抽出共用渲染件，T4 空态收口直接复用

### 开工前基线（实测，勿凭记忆）

| 项 | 实测值（2026-10-21 开工前） | 命令 |
|---|---|---|
| palette 硬编码计数 | **436** 处 / 19 文件 | `node scripts/ui-consistency-scan.mjs` |
| 扫描文件总数 | 292 | 同上 |
| `tests/*.test.ts` 数量 | **55** | `ls tests/*.test.ts \| wc -l` |
| local ahead of origin/main | 23 | `git rev-list --count origin/main..HEAD` |

**基线递减表（T1 起效，逐批下调）**

| 批次 | 收敛命中 | 基线应设为 |
|------|---------|-----------|
| T1 后（初始） | — | 436 |
| T5 后（quiz −149） | 287 | 287 |
| T6 后（study+assessment −103） | 184 | 184 |
| T7 后（settings −87） | 97 | 97 |
| T8 后（剩余 −97） | 0 | **0** |

> 合计校验：149 + 103 + 87 + 97 = **436** ✓
> ⚠️ 基线必须最终归零 —— 停在非零值＝恒红门禁（`settings-copy-scan` 已有前车之鉴）。

---

## 实施前的事实校正（相对方案正文）

| # | 方案原文 | 仓库实际 | 处理 |
|---|---|---|---|
| 1 | §8.1 `@theme` 里直接写状态三件套 hex | 本仓约定「颜色值只允许出现在 `:root` 的 `--plos-*`」，`@theme` 只做 `var()` 桥接 | 按仓库约定：hex 写进 `:root`，`@theme` 桥接。**视觉值不变** |
| 2 | §8.1 新增 `--plos-ring-alpha: 0.5` | focus 环实际是 Tailwind 透明度修饰符 `ring-ring/25`，不读 CSS 变量 ⇒ 该 token 会零消费 | **不加该 token**（禁引入零消费定义），直接在 6 个 ui 文件把 `/25` `/40` 改为 `/50` |
| 3 | §8.10 `--palette-baseline` 默认 0 | 与既有 `--fail-on-*` 开关一致，默认 0 合理 | 采纳；`ui:check` 显式传值 |

---

## Tasks

| ID | 任务 | 依赖 | 状态 | 提交 |
|----|------|------|------|------|
| **T1** | token 扩展（字号 2 / 状态三件套 12）+ 6 个 ui 文件 focus 环统一 /50 + 扫描器 `--fail-on-palette` + 基线 436 | — | ✅ | 本批 |
| **T2** | `primitives` 新增 `EmptyState` / `ErrorState`（`action: ReactNode`，零文案） | T1 | ☐ | |
| **T3** | 徽标 token 化（`bandStyles` / `DeltaBadge` / `chapter-badge` / `chapter-action`） | T1 | ☐ | |
| **T4** | 空态容器收口（12 处自写容器 + 20 处 dashed 空态卡） | T2 | ☐ | |
| **T5** | quiz 域收敛（answer/grading/report/new）+ 容器改 `focus`；基线 → 287 | T1,T2 | ☐ | |
| **T6** | study + assessment 域收敛；基线 → 184 | T1 | ☐ | |
| **T7** | settings 域收敛；基线 → 97 | T1 | ☐ | |
| **T8** | knowledge + learn + 首页/计划 剩余收敛；基线 → 0 | T1,T3 | ☐ | |
| **T9** | 字号全量替换（170 处 / 47 文件 → `text-meta` / `text-badge`） | T1 | ☐ | |
| **T10** | `ActionCard` 差异化 + `Card` 降级约定 | T1 | ☐ | |
| **T11** | `PageContainer` 三档 + 5 个绕过页面收口 | T1 | ☐ | |
| **T12** | 检索口径统一 + 搜索框形态区分 + 阅读页右栏分区 | T1,T11 | ☐ | |

### T1 — token 扩展 + focus 环统一 + 扫描器基线闸

- **Scope**：`src/styles/main.css` · `src/components/ui/{select,input,textarea,tabs,checkbox,dialog}.tsx`
  · `scripts/ui-consistency-scan.mjs` · `package.json`
- **Done**：`ui:check` 在基线 436 下通过；`ringDistribution` 只剩 `/50`；`typecheck` 绿
- **Status**：✅
- **Outcome**：`main.css` 的 `:root` 加状态三件套 12 个、`@theme` 桥接 14 个（12 状态 + `--text-badge` /
  `--text-meta`）；6 个 ui 文件的 focus 环 `/25` `/40` → `/50`（分布只剩 `/50` 共 9 处）；
  扫描器新增 `--fail-on-palette` / `--palette-baseline` 并在第 2 类报告里打印「基线 / 差值」；
  `package.json` 的 `ui:check` 加参数并设基线 436。
- **Notes**：① 三件套 hex 落在 `:root`、`@theme` 只做 `var()` 桥接（贴合「颜色值只出现在
  `:root`」约定）—— 相对方案 §8.1 的实现偏差 1。② **不加** `--plos-ring-alpha`：
  focus 环实际走 Tailwind 透明度修饰符 `ring-ring/NN`，不读 CSS 变量 ⇒ 该 token 会零消费
  （偏差 2）。③ ⚠️ 参数必须写成 `--palette-baseline=436`（**等号**）—— 空格形式会被
  `parseArgs` 当成独立参数报「无法识别的参数：436」（与既有 `--top=25` 风格一致）。
  ④ 反向自检：基线 435 → exit 1、436 → exit 0 ⇒ 闸门非恒绿。

### T2 — 空态原语

- **Scope**：`src/components/primitives.tsx`
- **Done**：`EmptyState` / `ErrorState` 导出；`data-testid` 齐；零文案（不提供 `retryLabel`）
- **Status**：☐
- **Outcome**：
- **Notes**：

### T3 — 徽标 token 化

- **Scope**：`bandStyles` / `DeltaBadge` / `src/features/learn/chapter-badge.ts` /
  `src/features/plan/chapter-action.ts`
- **Done**：`test:card` 绿；四档颜色值与改前逐一相同（肉眼抽查由用户执行）
- **Status**：☐
- **Outcome**：
- **Notes**：

### T4 — 空态容器收口

- **Scope**：12 处 `mx-auto max-w-3xl px-8 py-16 text-center` + 20 处 dashed 空态卡
- **Done**：`grep -c "mx-auto max-w-3xl px-8 py-16 text-center"` = **0**（改前 12）
- **Status**：☐
- **Outcome**：
- **Notes**：`border-dashed` 另有 3 处属渲染器占位，**不在收敛范围**

### T5 — quiz 域收敛（基线 → 287）

- **Scope**：`QuizAnswerPage` / `QuizGradingPage` / `QuizReportPage` / `NewQuizPage`
- **Done**：−149 命中；容器改 `size="focus"`；`test:quiz` 绿
- **Status**：☐
- **Outcome**：
- **Notes**：⚠️ `text-slate-300`（×4）须人工判定语义（禁用占位 → `text-ink-3` + `opacity-*`；分隔线 → `border-line`）

### T6 — study + assessment 域收敛（基线 → 184）

- **Scope**：`ReviewSession` / `AssessmentSession` / `AssessmentPage`
- **Done**：−103 命中；`test:rating` / `test:capability` 绿
- **Status**：☐
- **Outcome**：
- **Notes**：`ReviewSession` 63 处为全站最多

### T7 — settings 域收敛（基线 → 97）

- **Scope**：`BuiltinModelsPanel` / `ApiModelsTab`
- **Done**：−87 命中；`copy:check` 仍全绿（设置页文案不受影响）
- **Status**：☐
- **Outcome**：
- **Notes**：

### T8 — 剩余域收敛（基线 → 0）

- **Scope**：knowledge + learn + 首页/计划 剩余 10 文件
- **Done**：−97 命中；**基线归零**；`test:library` 全绿
- **Status**：☐
- **Outcome**：
- **Notes**：⚠️ `text-amber-700`（PlanPage:1 / SplitTab:1）须人工判定（落后警示 → `text-state-weak`；徽标字 → `text-weak-ink`）

### T9 — 字号全量替换

- **Scope**：170 处 / 47 文件
- **Done**：`grep -c "text-\[1[0-9]px\]"` = **0**；`text-[11px]` → `text-meta`，`text-[10px]` → `text-badge`
- **Status**：☐
- **Outcome**：
- **Notes**：剩余 15 处（15/13/12/14px）逐处判定后归入最近档位

### T10 — ActionCard 差异化

- **Scope**：`src/components/primitives.tsx`
- **Done**：`ActionCard` 左侧 3px primary 竖条 + `shadow-md`；`Card` 保持原样（降级约定写入注释）
- **Status**：☐
- **Outcome**：
- **Notes**：

### T11 — PageContainer 三档 + 页面收口

- **Scope**：`src/components/layout/AppShell.tsx` + 5 个绕过页面
- **Done**：`grep -rn "mx-auto max-w" src/features` 仅剩 AppShell 内的三档定义
- **Status**：☐
- **Outcome**：
- **Notes**：答题/判卷/报告的 768 是**有意设计**，升为 `focus` 档而非并回 default

### T12 — 检索口径 + 搜索框形态 + 阅读页右栏

- **Scope**：`CONTENT_SEARCH` 常量 · `LibraryPage` 搜索框 · `ChapterReaderPage` 右栏
- **Done**：`hybridSearch` 两处（limit 8 vs 5）走同一常量；右栏 380px + 分区切换
- **Status**：☐
- **Outcome**：
- **Notes**：⚠️ `chapter-context.ts:71/:89` 也调 `hybridSearch`，但属「章内问答上下文召回」，**不是搜索入口，T12 不得动它**（D6 边界）
- **Notes2**：⚠️ 阅读页右栏分区切换**必须两个面板都挂载**（`hidden` 切可见性），用三元表达式会丢用户输入草稿 + 让 `useAiTask` 进行中任务失去订阅者

---

## 门禁记录（每批后现跑）

| 批次 | typecheck | layer:check | ui:check | copy:check | test:i18n | test:library | palette 计数 |
|------|-----------|-------------|----------|------------|-----------|--------------|--------------|
| 开工前 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **436** |
| T1 | | | | | | | 436 |
| T2–T4 | | | | | | | 436 |
| T5 | | | | | | | 287 |
| T6 | | | | | | | 184 |
| T7 | | | | | | | 97 |
| T8 | | | | | | | **0** |
| T9 | | | | | | | 0 |
| T10–T12 | | | | | | | 0 |

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-10-21 | 建 runbook；用户确认「按推荐档走完 T1–T12」；开工前基线实测 palette 436 / 19 文件 / 292 扫描文件 / tests 55 / local ahead 23 |
