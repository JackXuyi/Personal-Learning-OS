# 复盘与趋势（Progress Analytics）任务 runbook

> 方案：`docs/progress-analytics-design-2026-09.md`（12 章，D1–D4 已定案）。
> 流程依据：`skills/docs-task-runbook/SKILL.md`。

## Goal

新增 `/progress` 页，把「已建未用」的证据流变成四块可看的成长轨迹：**学习活动热力图**、
**掌握度趋势曲线**、**弱点排行（三因子）**、**目标进度时间线**。全部为**纯只读派生** ——
不写任何状态、不新增 storage 方法、不改 domain 类型。唯一的存储改动是 `memory.ts` 的
evidence 上限常量 500 → 5000。

**Done 标准**（方案 §2 成功标准）：

1. 有数据时四块都渲染且数字可指到 domain 字段；
2. 空数据 / 单条数据有明确空态，**不出现分不清的空白图表**；
3. 新增纯函数有单测（含边界与回归）；
4. `npm run typecheck` 仅余 3 条既存 `AIModelsSection` 错误；
5. `src-tauri/**`、`src/storage/tauri.ts`、`src/storage/local.ts` **零改动**（仅 `memory.ts` 改一个常量）；
6. 全部测试套件全绿。

## Context

- **新增**：`src/features/progress/analytics.ts` · `charts.tsx` · `ProgressPage.tsx` · `tests/progress-analytics.test.ts`
- **修改**：`src/storage/memory.ts` · `src/components/layout/nav-items.ts` · `src/App.tsx` · `src/features/learner/LearnerPage.tsx` · `src/i18n/messages/{zh,en}.ts` · `package.json` · README 双语 · roadmap · 方案文档
- **零改动区**：`src-tauri/**` · `src/storage/tauri.ts` · `src/storage/local.ts` · `src/domain/**` · `src/stores/**`
- **已读文档**：方案 §3（现状取证）· §4（架构）· §7（线框）· §8（伪代码）· §9–§12（任务/步骤/测试）
- **已读代码**：`memory.ts` · `learner/aggregate.ts` · `LearnerPage.tsx` · `primitives.tsx` · `nav-items.ts` · `App.tsx` · `goal-util.ts` · `domain/{evidence,quiz,learner,goal}.ts` · `i18n/{index,types}.ts` · `tests/{plan-quota,i18n-alignment}.test.ts`

## Tasks

### T1 — `memory.ts`：上限常量 500 → 5000 并导出
- **Status:** done
- **Outcome:** `src/storage/memory.ts` 新增 `export const EVIDENCE_LOG_MAX = 5000`（含容量核算注释）+ `appendEvidence` 改用常量（不再硬编码 500）。验证：`npm run test:storage` **28/28 passed**；Grep 全 `src/` 确认无第二处硬编码上限（唯一命中都在 `memory.ts`）。
- **Notes:** 唯一存储改动。`EVIDENCE_LOG_MAX` 供 `analytics.ts` 导入（口径唯一来源）。

### T2 — `features/progress/analytics.ts`：四个 build* 纯函数
- **Status:** done
- **Outcome:** 新增 `src/features/progress/analytics.ts`（约 400 行）：8 个导出类型 + `HEATMAP_WEEKS` / `MISCONCEPTION_CAP` / `WEAKNESS_WEIGHTS` 常量 + `heatLevel` / `mondayIndex`（供单测直接断言）+ `buildHeatmap` / `buildTrend` / `buildWeakness` / `buildTimeline`。零 IO / 零 React / 零 i18n。验证：`npm run typecheck` 仅 3 条既存 `AIModelsSection` 错误，无新增。
- **Notes:** 核心模块。两处实施期对方案伪代码的**有意收敛**：① `TimelineGoal` 章范围字段沿用 domain 的 `requiredChapterIds`（伪代码简写为 `chapterIds`，避免调用点做字段映射）；② `unit.misconceptions` 为 domain 必填字段，故不写 `?? []`。均待 T9 回写方案 §14。

### T3 — `tests/progress-analytics.test.ts` + `test:progress` 脚本
- **Status:** done
- **Outcome:** 新增 `tests/progress-analytics.test.ts`（**35 条断言全绿**）；`package.json` 新增 `test:progress` 并挂到 `test:library` 链尾。验证：`npm run test:progress` → **ALL PASS**（目标 ≥24）。
- **Notes:** 实施期修掉一处**测试自身的**过头断言：TC-REG-02 原同时断言 `buildTrend.chapters` 不含脏 key，但趋势读的是**试卷历史**（章删了历史仍在 → 用 id 兜底），脏 key 过滤只属弱点榜（读 `byUnit`）。已修正并用 TC-UC02-05 显式锁定两种口径的差别。⚠️ **2026-09-21 修正**：其中「用 id 兜底」的说法**已被推翻** —— 「历史序列保留」是对的，但 `title` 回落成 `id` 是显示层缺陷（真实库实测 `/progress` 下拉渲染出 `chp-1e79433b`）。序列照旧保留、`title` 改为可选留空，文案由 UI 兜底。详见 `docs/raw-id-label-fix-2026-09.md`。

### T4 — `features/progress/charts.tsx`：三个手写 SVG 组件
- **Status:** done
- **Outcome:** 新增 `src/features/progress/charts.tsx`（313 行）：`DiscoveryHeatmap`（26×7 网格 + 色阶图例 + 格内 `<title>` tooltip）、`TrendChart`（y 轴固定 0..1 + 语义参考线 + 单点退化不画线）、`TimelineChart`（readiness 折线 + 截止竖线）。折线共用一份坐标映射（`xAt` / `yAt` / `YAxis` / `XAxis`）。
- **Notes:** 零取数、零 `Date.now()`、零 i18n（日期与 tooltip 文案由页面注入）。三个 `data-testid`：`progress-heatmap` / `progress-trend` / `progress-timeline`。⚠️ `TimelineChart` 的 x 轴右端取 `max(最后判卷, now, deadline)` —— **把截止日纳入范围**（方案伪代码注释只取前两者，未来截止日会被一律裁到右端 → 退化为装饰），属有意偏离，待 T9 登记。

### T5 — `features/progress/ProgressPage.tsx`：加载 + 编排 + 空态 + 弱点榜
- **Status:** done
- **Outcome:** 新增 `src/features/progress/ProgressPage.tsx`（280 行）：`Promise.all` 一次加载 5 项 → `applyForgetting` 得衰减视图 → 四块编排（时间线 / 热力图 / 趋势含章节下钻 / 弱点榜）+ 全空态卡 + 各块独立空态 + 弱点行跳 `/learn/:chapterId`。
- **Notes:** `now` **mount 时取一次**并透传给四个 build* 与两个图表（时间基准唯一）；无第二个 `Date.now()`。零写入。

### T6 — `App.tsx` 路由 + `nav-items.ts` 导航项
- **Status:** done
- **Outcome:** `src/App.tsx` 加 `ProgressPage` import + `<Route path="progress">`（插在 `learner` 之后、`study` 之前）；`src/components/layout/nav-items.ts` 加 `TrendingUp` 图标 + `/progress` 导航项（插在 `learner` 之后），并同步 nav-items 头注的「学习闭环」顺序说明。
- **Notes:** `navKey: "progress"` 受 `NavKey` 约束，T8 之前编译不过（符合方案 §9 的预期）。

### T7 — `LearnerPage.tsx` 入口卡
- **Status:** done
- **Outcome:** `src/features/learner/LearnerPage.tsx` 在 LEARNING PATTERNS 块之后、`ResumeImportDialog` 之前插入一张 `Card` + `Link to="/progress"`（`data-testid="learner-progress-entry"`）。
- **Notes:** 只加入口卡，既有 5 块零改动。

### T8 — i18n 双语（`nav.progress` + `progress` 整段 + `learner` 2 键）
- **Status:** done
- **Outcome:** `zh.ts` / `en.ts` 严格成对新增：`nav.progress` 1 键 + `learner.progressEntry{Title,Desc}` 2 键 + `progress` 整段 **34 键** = 共 **37 键**（方案 §8.9 估「约 26 键」，实测 37）。
- **Notes:** 两处对方案 §8.9 的有意调整：① `heatmapCaption` 参数由「天」改为**「周」**（对齐 §7.1 线框的「近 26 周」，避免渲染「近 182 天」）；② `weaknessGo` 文案含箭头。均待 T9 登记。验证：`npm run test:i18n` **8/8**（含 zh/en 递归结构一致 + 叶子非空）。

### T9 — 文档同步：README 双语 + 方案 §13 + roadmap §F3 + 本 runbook 收尾
- **Status:** done
- **Outcome:**
  - **README 双语**：F3 条目 `[ ]` → `[x]` 并补交付描述（四块 + 「纯只读派生」）；**顶部统计行手工同步** `31/14` → `**32/13**`。实测两版一致：`[x]`=32 · `[ ]`=13 · `###`=29。
  - **roadmap §F3**：标题与总表 → ✅「已实施 2026-09-16」；范围 4 条改「已交付」、Done 标准改「→ 验收」；mermaid 依赖图节点 / 推进理由行 / 依赖汇总三行同步；§F6 的「趋势展示仍待 F3」改为「F3 已实施，但能力报告尚未消费趋势数据（后续增量）」。
  - **方案文档**：表头状态 → ✅；新增 **§13 实施结果**（交付物 / 六项验收 / **4 处伪代码偏离登记** / 待人工核对项）；变更记录补一行；§9 T9 引用的「方案 §14」更正为 **§13**（本文实际只有 12 章 + §13）。
- **Notes:** ⚠️ 本次又一次踩中 **BSD grep `\|` 交替静默失效**（`grep -n "项。\|not yet"` 返回空 → 一度误判统计行不存在），改用 Grep 工具后立即命中。规则再强化：**多模式核验一律用 Grep 工具**。

## 提交分组（逐提交可编译）

| 组 | 内容 | 文件 | 备注 |
|----|------|------|------|
| ① | T1 + T2 + T3 | `memory.ts` · `analytics.ts` · `tests/progress-analytics.test.ts` · `package.json` | 无 UI 依赖，独立可编译 |
| ② | T8（i18n） | `zh.ts` · `en.ts` | **必须先于 ③** —— ③ 引用新键 |
| ③ | T4 + T5 + T6 + T7 | `charts.tsx` · `ProgressPage.tsx` · `App.tsx` · `nav-items.ts` · `LearnerPage.tsx` | 依赖 ② 的 `nav.progress`（`NavKey` 约束） |
| ④ | T9 | `README.md` · `README.zh-CN.md` · `roadmap-*.md` · 方案 · 本 runbook | 文档同步 |

> 提交纪律（沿用项目约定）：按精确路径 `git add`，与 `git commit` 同条命令串联；每组前后核对 `git diff --cached --name-only`；只落本地不 push。

## 收尾状态

| 项 | 结果 |
|----|------|
| T1–T9 | 全部 **done** |
| `npm run typecheck` | 仅 3 条既存 `AIModelsSection.tsx:56-58` |
| `npm run test:progress` | **35/35 ALL PASS** |
| `npm run test:storage` | 28/28 |
| `npm run test:i18n` | 8/8 |
| `npm run test:library` | 全链 ALL PASS |
| 零改动区 | `src-tauri/**` · `src/storage/tauri.ts` · `src/storage/local.ts` · `src/domain/**` · `src/stores/**` 实测 `git status` 为空 |
| 造浏览器校验 | 未执行（`rules/no-headless-browser-validation.mdc`）→ 已登记 4 项待人工核对（方案 §13.5） |
