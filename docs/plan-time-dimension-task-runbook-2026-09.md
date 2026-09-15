# F2 计划的时间维度 — 实施 Runbook

## Goal

按 `docs/plan-time-dimension-design-2026-09.md`（D1–D4 全部确认）落地「我今天要做多少」：**设了截止日期的目标**，打开计划页/首页即可看到「今天建议 N 分钟 · M 项」，执行队列按时间切成**今天必做 / 本周完成 / 之后**；落后时显式提示。**无截止日期的目标逐字节不变**（D3），**零持久化**（不改 storage / `src-tauri/**` / store）。

Done = §12 全部用例通过 + `npm run typecheck` 零新增错误 + `npm run test:quota` 全绿 + `/plan` 与首页可访问（用户人工核对视觉）。

## Context

- **方案**：`docs/plan-time-dimension-design-2026-09.md`（12 章 + §0 决策点）
- **路径**：C（新建 2 文件 / 修改 6 文件）
- **定盘星（D3）**：整个特性的启用条件是**单一开关** `goal.deadlineAt !== undefined` —— 无 deadline → 不计算配额、不分组、无警示条 → 回归面收敛为两条 `TC-REG-01/02`
- **关键约束**：不改 `src/storage/**`；不改 `src-tauri/**`；单测不 import `.tsx`；不启动浏览器；`engine/` 不得 import `features/`（故新模块落 `features/plan/`）
- **唯一真源**：耗时公式一律复用 `estimateEtaMin`；节奏判定一律复用 `estimatePlanEta`（**不重写**）
- **禁止事项**：不新增 localStorage key；不改 `useLoopStore`；不改 `buildChapterPlan` 的六级优先级语义（时间维度是**分组**，不是重排）

## Tasks

### T1 — 配额纯函数：`features/plan/plan-quota.ts` + `weeklyMinutesOf` 导出
- **Status:** done
- **Outcome:** 新增 `src/features/plan/plan-quota.ts`（160 行）：`PlanQuotaInput` / `PlanQuota` / `planQuota()`（纯函数）+ 私有 `packByTime()`（按 `dueTodayMin` / `weekBudget` 贪心装填，`today` 为空时**必然放 1 项**）+ `sumMin()`。`chapter-action.ts`（179 → 182 行）的私有 `weeklyOf` 改名导出为 `weeklyMinutesOf`，`estimatePlanEta` 内唯一调用点同步 —— 「每周预算是否有效」从此只有一份判据。
- **Notes:** ⚠️ **偏差 1（真实缺陷修复，重要）**：方案 §8.1 的 `packByTime` / `sumMin` 调 `estimateEtaMin(a, chapter)` 用**默认 pace**（`DEFAULT_PACE = 350`），而 `totalMinutes` 来自 `estimatePlanEta`（内部用 `paceOf(profile)`，按画像 level 取 **300/350/400/450**）→ **同一份输出里混了两把尺子**：「今天建议 N 分钟」与「今天组的实际时长」会对不上（`advanced` 用户偏差 1.28 倍）。修正：模块内统一 `const pace = paceOf(profile)` 并透传给装填与求和。新增 `TC-EDGE-09` 锁死（advanced + 4500 字 → 10 分钟；若误用 350 得 13）。
  ⚠️ **偏差 2**：`PlanQuota` 新增 `overdueDays` 字段 —— 方案 §8.3 让 UI 用 `Date.now()` 重算逾期天数，那是**第二个时刻**（跨零点会与模块内的 `now` 互相矛盾）。改为模块内一次算清（`ceil` 口径、下限 1）。
  ⚠️ **偏差 3**：队列为空时 `groups` 与 `todayMinutes` **一并缺失**（对齐方案 §4.3 接口注释「队列为空 → undefined」），而非返回三个空数组 —— UI 侧 `hasQuota` 因此同时兼任「空态」判据。
  验证：`npm run typecheck` → 仅剩既存 3 条 `AIModelsSection.tsx:56-58`。
- **依赖:** —

### T2 — 计划页：三段分组 + 配额行
- **Status:** done
- **Outcome:** `src/features/plan/PlanPage.tsx`（263 → 299 行）：计算 `quota`；`groups` 存在 → **三段**（今天必做 / 本周完成 / 之后），否则**逐字节退回两段**（`NEXT_LIMIT = 3` + UP NEXT）。抽两个局部渲染函数 `renderCard(action, i)`（ActionCard 详版，带 CTA）与 `renderRow(action)`（KnowledgeRow 压缩行），三段/两段共用（守「同模式跨 ≥3 处必抽取」）。配额行插在就绪度卡内、ETA 行之后（`data-testid="plan-quota"`）；逾期用**琥珀色** `text-amber-700`（与「缺口」红色区分，且**不阻断**任何操作）。
- **Notes:** ⚠️ **偏差 1（类型干净化）**：为让两个渲染函数不必对 `plan` 做非空断言，把 `learner.byUnit` 与 `docTitleOf` 提为**带类型标注的局部常量**（`LearnerState["byUnit"]` / `Record<string, string>`）—— 渲染函数内零 `!`。
  ⚠️ **偏差 2**：无 deadline 路径的取值改为 `groups?.today ?? actions.slice(0, NEXT_LIMIT)` —— 与直接 slice 语义等价（`TC-REG-01` 断言 `groups === undefined` → 走 slice 分支）。
  验证：`typecheck` 仅剩既存 3 条。
- **依赖:** T1

### T3 — 首页：配额标题 + 落后警示
- **Status:** done
- **Outcome:** `src/features/home/HomePage.tsx`（558 → 582 行，距 700 行上限仍宽裕）`TodayView`：新增 `planQuota(...)` + `itemsMinutes`（清单项时长和）+ `showQuota`；就绪度 `Bar` **之下**新增落后警示条（`data-testid="home-behind-warning"`，**仅** `pace.behind === true` 时渲染，超前/无预算不出现）；今日清单标题在有截止日时切到 `m.home.quotaTitle(items.length, itemsMinutes)`，否则仍走 `m.home.todayTitle(items.length)`。
- **Notes:** ⚠️ **偏差 1（同屏矛盾修复）**：方案 §8.4 伪代码把 `quota.todayMinutes`（=「今天必做」**配额组**总时长，**含**主行动 NBA）与 `items.length`（= NBA **之外**的清单行数）拼在同一行 —— 当配额组只有 1 项时会打印「今日 3 项 · 建议 12 分钟」，而那 12 分钟其实是**首项**的时长，同屏自相矛盾。修正：标题的分钟数取**清单口径**（`items` 的 `estimateEtaMin` 累加），与「N 项」严格同口径。
  代价与取舍：首页与 `/plan` 的分钟数语义**不同**（前者「这 N 项要多久」、后者「今天整体建议量」）—— 这是有意的：**同屏自洽优先于跨页同数**（两页不同屏出现，无直接对照）。
  ⚠️ **偏差 2**：`chapterOf` 直接用 `TodayView` 已有的 `useChapterIndex()`（`index.get`），未按方案 §8.4 另写 `chapterIndexOf`（方案顾虑的「额外依赖」并不存在）。
  验证：`typecheck` 仅剩既存 3 条。
- **依赖:** T1

### T4 — i18n：双语成对新增 9 键
- **Status:** done
- **Outcome:** `src/i18n/messages/zh.ts` / `en.ts` 各 +9 键：`plan.quotaToday(min, n)` / `quotaDaysLeft(d)` / `quotaOverdue(d)` / `groupToday` / `groupWeek` / `groupLater`；`home.quotaTitle(n, min)` / `behindWarning(days)`。**旧键全部保留**（`plan.next` / `plan.upNext` / `home.todayTitle` —— 无 deadline 路径仍在用）。`npm run test:i18n` **8/8**（含 zh/en 递归结构一致性 → 证明严格成对）。
- **Notes:** 文案只陈述数字，不含「加油」「落后了」之类评判词（守 README 产品原则 #5 数字诚实）；警示条文案刻意沿用 F1 的「预计晚 N 天」口径，不引入第二套数字。
- **依赖:** —

### T5 — 单测：`tests/plan-quota.test.ts` + `test:quota` 脚本
- **Status:** done
- **Outcome:** 新增 `tests/plan-quota.test.ts`（367 行，**25 条断言**）：TC-UC01-01~06（配额公式 / 装填 / 并集不乱序 / 天数口径）、UC02-01~03（无预算 D2，含 `weeklyMinutes=20 < 下限 30` 视为未声明）、UC03-01~02（无 deadline 零回归）、UC04-01~02（节奏判定，首页警示的依据）、EDGE-01~09（已过期 / 临界 / 空队列 / 单项超配额 / `dueTodayMin=1` / 整除无 off-by-one / `profile` 缺省 / 全 `retake-quiz` / **pace 口径统一**）、REG-01/02/04（无 deadline 的 UI 判据）。`package.json` +`test:quota` 并挂进 `test:library` 串联链尾。
- **Notes:** ⚠️ **偏差 1（方案用例不自洽）**：方案 `TC-UC01-03` 给的「队列 `[12, 8, 40, 20]` 且 `dueTodayMin = 30`」算不出来（80 分钟 ÷ 3 天 = 27，而非 30）。改为队列 `[12, 8, 40, 30]`（总 90 ÷ 3 天 = **30**），**保留原期望结论**（`today` 只装前 2 项、`todayMinutes = 20`、第 3 项 40 分钟装不下）。
  ⚠️ **偏差 2**：新增方案外的 `TC-EDGE-09`（锁死偏差 1 的 pace 口径修复），并在 `TC-EDGE-01` 追加 `overdueDays === 3` 断言、`TC-EDGE-02` 追加「临界时 `overdueDays` 缺失」。
  ⚠️ **偏差 3**：所有断言**显式注入 `now = 0`**（并据此按整天构造 `deadlineAt`），`daysLeft` 因此完全确定 —— 杜绝 `Date.now()` 引入的抖动。用例工厂 `queue(mins)` 借 `chars = 350 × min` 让 `learn-chapter` 恰好产出指定分钟（`min ∈ [5, 40]`）。
  验证：`npm run test:quota` → **25/25 ALL PASS**。
- **依赖:** T1

### T6 — 文档同步：方案 / README / roadmap / 本 runbook
- **Status:** done
- **Outcome:** ① 本 runbook 新建；② 方案 `docs/plan-time-dimension-design-2026-09.md` 状态行改为**已实施** + 新增 **§14 实施结果**（交付清单 / 3 处实现期缺陷 / 偏差 / 验收证据）+ 变更记录；③ README 双语「计划的时间维度」`[ ]` → `[x]`，并**手工同步顶部硬编码统计行 30/15 → 31/14**（两版一致，`###` 小节数 29 = 29）；④ `docs/roadmap-next-features-plan-2026-09.md` §F2 标 **✅ 已实施（2026-09-15）**：候选表 / §F2 节状态块 + 范围交付 + Done 验收 / mermaid 节点 / 「有前置」行 / §五总结 / §附「未实现」清单中已过期两条加注 / 变更记录。
- **Notes:** ⚠️ README 顶部统计行是**硬编码文字**，`grep -c '^- \[x\] '` 只数 checkbox、抓不到它 —— 每次动复选框必须手工同步这行（本项目 2026-09-15 已踩过一次）。本次已实测复核：`done=31 todo=14`（zh/en 相同）。
- **依赖:** T1–T5

## 实施偏差汇总

| # | 偏差 | 性质 | 处置 |
|---|---|---|---|
| 1 | `packByTime` 用默认 pace、`totalMinutes` 用画像 pace → **两把尺子** | **真实缺陷**（方案 §8.1 与 §4.3 口径不一致） | 模块内统一 `paceOf(profile)` 并透传；新增 `TC-EDGE-09` 锁死 |
| 2 | UI 重算逾期天数会引入第二个 `Date.now()` | 设计不严谨 | `PlanQuota` 直接给 `overdueDays` |
| 3 | 首页标题混用「配额组时长」与「清单项数」→ 同屏矛盾 | **真实缺陷**（方案 §8.4 伪代码） | 统一到清单口径（`items.length` + `itemsMinutes`） |
| 4 | 方案 `TC-UC01-03` 的队列与 `dueTodayMin` 不自洽 | 文档瑕疵 | 改队列凑整除，保留原期望结论 |
| 5 | 空队列时 `groups` 返回空数组 vs `undefined` 表述不一 | 文档瑕疵 | 按 §4.3 注释取 `undefined` |
| 6 | `chapterOf` 需另写 `chapterIndexOf`（方案 §8.4 顾虑） | 冗余顾虑 | 直接复用 TodayView 已有的 `useChapterIndex()` |
| 7 | README 顶部统计行不会被 `grep -c` 捕获 | 项目既有坑 | 手工同步并在 runbook 记录 |

## 收工清单（验证证据）

- [x] `npm run typecheck` → 仅剩 **3 条既存** `AIModelsSection.tsx:56-58`（非本任务引入，未顺手改）
- [x] `npm run test:quota` → **25/25 ALL PASS**
- [x] `npm run test:eta` / `test:i18n` / `test:library` → 全绿（`test:eta` 为 `weeklyMinutesOf` 改名的回归证据）
- [x] **全量 35 套测试全绿**（i18n … aitask）
- [x] `git status --short -- src-tauri src/storage` → **空**（零改动约束达成；未新增 storage key、未改 store）
- [x] README 双语 `done=31 todo=14` 一致，`###` 小节数 29 = 29
- [ ] **用户人工核对** `/plan` 与首页视觉（受 `rules/no-headless-browser-validation.mdc` 约束未启动浏览器）

## 回滚策略

无持久化副作用、无数据迁移 → **revert 提交即可**。UI 层只要不传 `deadlineAt` 就立即退回现状（即 D3 路径），灰度成本为零。

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-15 | 新建：T1–T6 全部 done + 实施偏差汇总 + 收工清单 | Agent |
