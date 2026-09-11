# 组件台账：现有资产 + 抽取候选

> 数据来自 `node scripts/ui-consistency-scan.mjs --top=30 --min-files=4`（2026-09-11，扫描 157 个文件）。
> **台账是活表**：每次抽取后重跑扫描器，把该行的命中数更新掉，并在 PR 里贴 diff。

## 1. 现有可复用资产（动手前先查这里）

### L1 UI Kit　`src/components/ui/`（禁 `useI18n` / store，纯展示）

| 组件 | 用于 | 备注 |
|---|---|---|
| `button.tsx` | 所有按钮。variants：default / secondary / **outline** / ghost / link / destructive；size：default / sm / lg / icon | 导出 `buttonVariants`，`<Link>` 要按钮样就用它拼 className（Button 不支持 asChild） |
| `badge.tsx` | 徽标、标签、计数 | |
| `input.tsx` / `textarea.tsx` / `label.tsx` | 表单 | 已有标准 focus 环，不要手写 input |
| `select.tsx` / `checkbox.tsx` / `tabs.tsx` / `separator.tsx` | 表单与结构 | |
| `dialog.tsx` / `alert-dialog.tsx` / `confirm-dialog.tsx` | 浮层 | 导出 `overlayBase` / `contentBase`，自建浮层请复用 |
| `dropdown-menu.tsx` | 下拉菜单 | |

### L2 领域原语　`src/components/primitives.tsx`（可含业务语义）

`Card` · `Section` · `SectionTitle` · `Bar` · `Stat` · `KnowledgeRow` · `EvidenceRow` · `ActionCard` · `BandBadge` · `SegmentedTabs` · `StatusTone`

### 壳层　`src/components/layout/`

`AppShell`（含 `PageContainer` 导出）· `NavSidebar` · `nav-items.ts` — 详见 `shell-and-layout.md`

### 游离资产（命名位置不统一，待归位）

`src/components/CommandPalette.tsx` · `src/components/DeltaBadge.tsx` — 既不在 ui/ 也不在 primitives。
**新组件不要学它们的位置**：能纯展示的去 `ui/`，含业务语义的去 `primitives.tsx`。

---

## 2. 抽取台账（命中数 ≥ 4 文件的模式，共 30 条）

状态图例：**待抽** = 无对应组件需新建 · **待治理** = 组件已有，调用方没用 · **待定案** = 牵涉 §4 未决项

> 台账内的 30 条均不涉及状态色；治理到 `chapter-badge.ts` / `DeltaBadge.tsx` 的整块状态底色时，另按 `tokens.md §4` 处理。

| # | 模式串 | 命中 | 证据文件（前 3） | 目标组件 / 处置 | 落点 | 状态 |
|---|--------|------|------------------|-----------------|------|------|
| 1 | `px-4 py-2 text-sm font-medium` | 11 | `plan/PlanPage`、`home/HomePage`、`quiz/NewQuizPage` | `<Button variant="outline">`（Link 用 `buttonVariants`） | 已有 | 待治理 |
| 2 | `flex flex-wrap items-center justify-between` | 10 | `assessment/AssessmentPage`、`knowledge/ChapterGraphPage` | `RowHeader`（左标题 + 右操作） | L2 | 待抽 |
| 3 | `flex flex-wrap items-center gap-2` | 8 | `goals/GoalDetailPage`、`learn/detail/PapersTab` | `ActionsRow` | L2 | 待抽 |
| 4 | `border-line bg-subtle px-1.5 py-0.5` | 7 | `CommandPalette`、`layout/NavSidebar`、`goals/GoalDetailPage` | `<Badge variant="outline">` | 已有 | 待治理 |
| 5 | `font-medium uppercase tracking-wide text-ink-3` | 7 | `primitives`、`goals/GoalsPage` | `SectionTitle` 内的 caption 变体 | 已有 | 待治理 |
| 6 | `rounded-lg border-line bg-surface p-3` | 7 | `goals/GoalDetailPage`、`learn/LibraryPage` | `<Card>` | 已有 | 待治理 |
| 7 | `border-line bg-surface p-6 text-center` | 6 | `learn/detail/ContentTab`、`learn/detail/OverviewTab` | `EmptyState`（panel 变体） | L2 | 待抽 |
| 8 | `flex items-center justify-between gap-3` | 6 | `primitives`、`learner/LearnerPage` | `RowHeader` / `EvidenceRow` | 已有 | 待治理 |
| 9 | `font-semibold text-white shadow-sm hover:bg-indigo-700` | 6 | `assessment/AssessmentSession`、`quiz/NewQuizPage` | `<Button variant="default">` | 已有 | 待治理 |
| 10 | `text-sm font-semibold text-white shadow-sm` | 6 | 同上 | 同 #9 | 已有 | 待治理 |
| 11 | `text-xs font-medium uppercase tracking-wide` | 6 | `primitives`、`knowledge/GraphView` | `SectionTitle` caption | 已有 | 待治理 |
| 12 | `border-dashed border-line bg-surface p-6` | 5 | `learn/detail/{Knowledge,Overview,Papers}Tab` | `EmptyState`（dashed 变体） | L2 | 待抽 |
| 13 | `flex items-center justify-between gap-4` | 5 | `learn/ChapterReaderPage`、`quiz/QuizAnswerPage` | `RowHeader` | L2 | 待抽 |
| 14 | `flex-wrap items-center justify-between gap-3` | 5 | `assessment/AssessmentSession`、`knowledge/ChapterGraphPage` | `RowHeader` | L2 | 待抽 |
| 15 | `max-w-3xl px-8 py-16 text-center` | 5 | `knowledge/ChapterGraphPage`、`quiz/QuizAnswerPage` | `EmptyState`（居中变体） | L2 | 待抽 |
| 16 | `mx-auto max-w-3xl px-8 py-16` | 5 | 同上 | 同 #15 | L2 | 待抽 |
| 17 | `outline-none transition-colors placeholder:text-ink-3 focus:border-primary` | 5 | `goals/GoalFormPage`、`learn/ImportModal` | `<Input>` / `<Textarea>` | 已有 | 待治理 |
| 18 | `px-2 py-0.5 text-xs font-medium` | 5 | `learn/detail/ChapterRow`、`learn/ChapterReaderPage` | `<Badge size="sm">` | 已有 | 待治理 |
| 19 | `px-3 py-1.5 text-xs font-medium` | 5 | `assessment/AssessmentSession`、`quiz/QuizAnswerPage` | `<Button size="sm">` | 已有 | 待治理 |
| 20 | `rounded-lg border-dashed border-line bg-surface` | 5 | `learn/detail/*` | `EmptyState`（dashed） | L2 | 待抽 |
| 21 | `text-ink-1 outline-none transition-colors placeholder:text-ink-3` | 5 | `goals/GoalFormPage`、`learn/LibraryPage` | `<Input>` | 已有 | 待治理 |
| 22 | `text-xs font-semibold tracking-wide text-ink-2` | 5 | `primitives`、`goals/GoalFormPage` | `SectionTitle` caption | 已有 | 待治理 |
| 23 | `bg-indigo-600 px-4 py-2 text-sm` | 4 | `knowledge/ChapterGraphPage`、`quiz/QuizAnswerPage` | `<Button variant="default">` | 已有 | 待治理 |
| 24 | `bg-indigo-600 px-5 py-2 text-sm` | 4 | `quiz/*` | `<Button variant="default">`（px-5 需定 size） | 已有 | 待治理 |
| 25 | `bg-subtle px-1.5 py-0.5 text-[10px]` | 4 | `goals/*`、`learn/library/DocumentCard` | `<Badge>` + `text-[10px]`（仅 UI Kit 内允许） | 已有 | 待治理 |
| 26 | `bg-surface px-4 py-2 text-sm` | 4 | `plan/PlanPage`、`home/HomePage` | `<Button variant="outline">` | 已有 | 待治理 |
| 27 | `bg-white px-4 py-2 text-sm` | 4 | `quiz/QuizAnswerPage`、`settings/ApiModelsTab` | 同 #26（`bg-white` → `bg-surface`） | 已有 | 待治理 |
| 28 | `border-line bg-app-bg px-3 py-2` | 4 | `learn/ImportModal`、`learn/import/GithubPanel` | `<Input>` | 已有 | 待治理 |
| 29 | `border-line bg-subtle px-2 py-0.5` | 4 | `goals/GoalsPage`、`learn/detail/*` | `<Badge variant="outline">` | 已有 | 待治理 |
| 30 | `border-line bg-surface px-4 py-2` | 4 | `goals/GoalFormPage`、`home/HomePage` | `<Button variant="outline">` | 已有 | 待治理 |

## 3. 归类结论（这张表说明什么）

- **30 条里 22 条是「组件已有但没人用」**，不是缺组件。首要动作是**替换调用点**，不是新建组件。
- **真正需要新建的只有 2 个**：`RowHeader`（#2/#3/#8/#13/#14 合并）与 `EmptyState`（#7/#12/#15/#16/#20 合并）。二者都落 **L2 `primitives.tsx`**。
- `#17/#21/#28` 三条全是手写 input —— `ui/input.tsx` 早就有标准 focus 环，属于最该先治的一类：**零风险、纯删除**。

## 4. 重跑与更新

```bash
node scripts/ui-consistency-scan.mjs --top=30 --min-files=4   # 重生成候选清单
node scripts/ui-consistency-scan.mjs --fail-on=3              # 当门禁；当前必然失败（84 条）
```

抽出某个组件后，把该模式行的「命中」列更新为复跑值；降到 ≤2 才可以把状态改成 `已抽取`。
