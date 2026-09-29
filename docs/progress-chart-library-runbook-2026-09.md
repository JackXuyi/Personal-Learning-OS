# /progress 图表换库 执行 runbook

## Goal

按 `docs/progress-chart-library-design-2026-09.md`（v3）把 `/progress` 三块可视化改由第三方包渲染：
热力图 → `react-activity-calendar`，趋势 / 时间线折线 → `recharts`；补齐悬停 tooltip。
**契约冻结**：三组件 props 形态 + 3 个 `data-testid` 不变 ⇒ `analytics.ts` 与页面载荷零改动。
色值单一真源仍是 `src/styles/main.css`（零 JS 读值、零新增 hex）。

## Context

- 方案：`docs/progress-chart-library-design-2026-09.md`（任务表 §9、回滚 §10.2、回扫清单 §10.3）
- 涉及文件：`src/features/progress/{charts.tsx,chart-adapters.ts,ProgressPage.tsx}`、`src/styles/main.css`、`package.json`、`tests/progress-chart-adapters.test.ts`
- 必守规则：`no-headless-browser-validation`（禁浏览器自检）、`react.mdc`（禁手写浮层）、`engineering-code-style.mdc`（i18n 双语成对）
- 判据命令：`npm run typecheck | layer:check | ui:check | test:progress | test:chart | test:library | build`

## 实施决策（相对方案的偏离，登记于此）

| # | 位置 | 方案原文 | 实施 | 理由 |
|---|------|----------|------|------|
| P1 | §8.3a 热力图配置 | `showMonthLabels`（保留 + 中文化 12 个月名） | **`showMonthLabels={false}`** | ① 保住「三导出签名不变」的契约冻结承诺（保留需新增 `monthLabels` prop）；② 规避 R9（12 个新 i18n 键 + zh/en 成对风险）；③ 现状本就无月份标签，最贴近 D4=A 的「最小变化」；④ 方案 §7.4 变化 7 已列此规避路径。**这不是删能力**，日后要加是独立小改动（`labels.months` + 可选 prop） |
| P2 | §8.3a 图例 | 库的 `showColorLegend` + `renderColorLegend` 注入 className | **`showColorLegend={false}` + 保留现自绘 12 行图例** | ① 库图例的 rect 是 `<svg>` 包 `<rect>` 且内联 stroke 无法经 renderColorLegend 清除（cloneElement 只能改外层 svg）→ 格子无描边而图例有，视觉不一致；② 省 5 条 legend CSS 与一个 render prop；③ 位置/观感与现状一致；④ §7.4 变化 8 已列此规避路径。**代价**：多维护现状已有的 12 行（非新增） |
| P3 | §10.2 分层提交 | 折线 / 热力图 / 色阶 CSS 各自成提交 | **C3 一揽子**（`charts.tsx` + `main.css` 一条提交） | `charts.tsx` 是整体重写，构造「折线已换、热力图未换」的中间 blob 成本 > 收益；且分层回滚的触发前提（T6 不顺）未发生 —— 替换已全量验证通过。**代价**：回滚粒度从「单块 revert」退化为「三块整条 revert」 |
| P4 | §8.3(b) 折线点 | `<Line dot={...}>` 由 Line 统一画点 | **`dot={false}` + 逐点 `<ReferenceDot>`** | 时间线的点色需按 `readiness >= 1` 逐点分档，`dot` 对象形式无法逐点着色（函数形式签名依赖库内部细节，风险高）；两块统一用 `ReferenceDot`（与 ReferenceLine 同一套 className + currentColor 机制）。**代价**：无 hover 放大点（activeDot），D5 的游标反馈由 Tooltip 的十字 cursor 承担 |

## Tasks

### T0 — 确认 D6、方案状态改「已确认」
- **Status:** done
- **Outcome:** 方案头部状态改为「D1–D6 全部已确认（2026-09-29）· 执行中」；§3.4 D6 行状态由 🔸 建议改为 ✅ 已确认（随「按方案实施」）。本 runbook 建立。

### T1 — 安装 2 个依赖 + 实测体积登记
- **Status:** done
- **Outcome:**
  - `npm install recharts react-activity-calendar` → 解析为 **recharts@3.10.1** + **react-activity-calendar@3.2.1**，写入 `dependencies`（`^` 前缀）。
  - 包数（`npm ls --all --parseable | wc -l`）：**322 → 341（+19）**。无 ERESOLVE（`react-is@19.3.0` 作为 recharts peer 被 npm 自动装上）。
  - `node_modules`：**503M → 551M（+48M）**。
  - 传递依赖实测：`victory-vendor@37.3.6`（recharts）、`@floating-ui/react@0.27.20`（热力图）；⚠️ **`date-fns@4.4.0` 不是新增** —— 已由既存 `@base-ui/react` 引入，此处 deduped。
  - `dist` 增量待 T8（`build` 后）登记。
- **Notes:** 未采信 `--dry-run` 的「99 packages」（G27 已证明掺入既有依赖的平台变体）。

### T2 — 接缝 spike（gate）· 改为静态源码核实
- **Status:** done
- **Outcome:** 仓库禁起浏览器（`no-headless-browser-validation`）⇒ 五问五答全部由**读 `node_modules` 源码 + 类型声明**作答，**全部通过，无需启用 D3 后备档（读计算值传实色）**：

| # | 问题 | 结论 | 证据（行号实测） |
|---|------|------|------------------|
| ① | recharts `<Line className>` + `stroke="currentColor"` 吃到 token | ✅ 可行，**但必须显式传 `stroke`** | `Line.js:132` 默认 `stroke: '#3182bd'`（不传即蓝色）；`:267` `stroke` 经 `svgPropertiesAndEvents(others)` 透传至 Curve；`:393,404` className 挂 `<g class="recharts-layer recharts-line {className}">` ⇒ `currentColor` 从该 `<g>` 的 `color` 继承 |
| ② | `<ReferenceLine className>` + `stroke="currentColor"` | ✅ 可行，同样**必须显式传** | `ReferenceLine.js:216` 默认 `stroke: '#ccc'`；`:202` className 挂外层 `<Layer>`(= `<g>`)；`:62` 内层 `<line>` 类名被覆盖为 `recharts-reference-line-line`，`stroke` 随 props 透传 |
| ③ | `<Tooltip contentStyle>` 里的 `var()` | ✅ 生效 | `DefaultTooltipContent.js:129` contentStyle 合并进 `finalStyle` ⇒ React style 对象 ⇒ 落 DOM `style` 属性 = **CSS 声明路径**，`var()` 100% 生效 |
| ④ | 热力图 CSS 能否覆盖库的 `fill` | ✅ 能 | `ActivityCalendar.tsx:295-310` 渲 `<rect fill={色值} data-date data-level style={{stroke}}>`；`fill` 是 **presentation attribute**（优先级最低）且 `styles.rect` **只含 stroke**（`styles.ts:25-28`）⇒ CSS `fill: var(--color-*)` 必胜 |
| ⑤ | `renderBlock` 清描边 | ✅ 能 | `cloneElement(block, { className, style: {} })` —— React cloneElement 对 props 浅合并 ⇒ `style` 键整体替换为空，`fill` / `data-level` 保留 |

- **Notes:** ⚠️ **三条新增硬约束（方案未记，已核对源码）**：
  1. **data 必须按日期升序** —— `calendar.ts:70-76` 的 `fillHoles` 取 `activities[0]` 与末条作区间端点，`eachDayOfInterval(start > end)`（date-fns）**会 throw**。适配器按 `weeks` 逐列遍历天然升序，须在注释与单测里锁住该不变量。
  2. `minLevel >= maxLevel` 也 throw（`ActivityCalendar.tsx:229-233`）—— 用固定 0/4 安全。
  3. 图例 rect **无 `data-level`**（`:379-386`）⇒ 只能靠 `renderColorLegend` 注入 className 定色（G25 确认）。
  4. props 默认值实测复核：`weekStart=0`（周日）、`showMonthLabels=true`、`showTotalCount=true`、`showColorLegend=true`、`showWeekdayLabels=false`、`blockSize=12`/`blockMargin=4`/`blockRadius=2`（`:199-221`）。

### T3 — 新增 `chart-adapters.ts` + 单测 + 并入 `test:library`
- **Status:** done
- **Outcome:**
  - 新增 `src/features/progress/chart-adapters.ts`（纯函数 / 零 React / 零 IO / **零第三方依赖** —— 自持 `ActivityCell` 类型，不 import 两库，故 node 单测可直接跑）。
    导出：`HEAT_MAX_LEVEL`、`ActivityCell`、`clampHeatLevel`、`toActivityCells`、`LineSeries`、`toLineSeries`（含 `opts.extendRightTo`，供时间线纳入 `now`/deadline）、`RefLine`、`toReferenceLines`。
  - 新增 `tests/progress-chart-adapters.test.ts`：**16 条**用例（TC-CELL-01..06 / TC-LINE-01..07 / TC-REF-01..03），覆盖方案 §12 的 TC-UC01-01/02/03、TC-UC02-01/02、TC-EDGE-01 + T2 新增的「升序不变量」。
  - `package.json`：新增 `test:chart`；**手工并入** `test:library` 长链（插在 `test:progress` 之后）。
  - 验证：`npm run test:chart` → **16/16 ALL PASS**；`npm run typecheck` → exit 0。
- **Notes:** ⚠️ 首跑 1 条红（`clampHeatLevel(+Infinity)` 期望上限、实得 0）。**判为实现的错**（`Number.isFinite` 把 `Infinity` 也归零，违背 clamp 语义）→ 改为只特判 `NaN`，`±Infinity` 自然被边界夹住；补 `-Infinity → 0` 断言。测试文件里 `TC-CELL-02` 的档位覆盖与 `heatLevel` 的 5 档语义逐一对齐。

### T4 — 替换 `TrendChart`（recharts + Tooltip + 网格 + 无动画）
- **Status:** done
- **Outcome:** `charts.tsx` 折线共用层抽为内部 `LineCanvas`（网格 / 双轴 / Tooltip / 参考线配置只写一次，PLOS 同款结构两处消费）。关键实现点（全部经库源码核实）：
  - `<Line type="linear" dot={false} isAnimationActive={false}>`（P4：点由 ReferenceDot 画）；
  - `XAxis`/`YAxis` **必须显式传 `stroke="currentColor"`**（库把 `stroke` 当刻度文字的 `fill`，默认 `#666`）；
  - `CartesianGrid` **不合并 className**（库源码硬写）→ 色走 `stroke="currentColor"` + 外层 div 的 `text-line`；
  - Tooltip：`labelFormatter` 出日期、`formatter` 返回 `[值, null]`（name 为 null 时库不渲染名称分隔符）；`contentStyle` 用 `var(--color-*)`（inline style 路径，var() 必生效）；
  - 单点给 x 域 ±1ms 边距（零宽域会让点贴轴端）。
- **验证**：`typecheck` exit 0。

### T5 — 替换 `TimelineChart`（保 G4 的 x 域右端 + 截止竖线 + readiness 点色）
- **Status:** done
- **Outcome:** 复用 `LineCanvas`；x 域右端 = `toLineSeries(pts, { extendRightTo: max(now, deadline, 最后判卷) })`（G4 刻意口径保留）；截止竖线 = `<ReferenceLine x={deadlineAt} className="text-state-failed" stroke="currentColor" label={{ value: deadlineLabel, position: "insideTopRight", fill: "currentColor" }} />`；点色逐点 `pts[i].readiness >= 1 ? "text-state-mastered" : "text-primary"`（P4）。
- **验证**：与 T4 同批 typecheck。

### T6 — 替换 `DiscoveryHeatmap`（`ActivityCalendar`，复杂度 L）
- **Status:** done
- **Outcome:** 按 §8.3a 清单逐条落实：`weekStart={1}`（G18）/ `colorScheme="light"`（G20）/ 空数组早返回 `<div data-testid="progress-heatmap" />`（G19）/ `showTotalCount={false}`（与页面 caption 重复）/ `showMonthLabels={false}`（P1）/ **保留自绘图例**（P2）/ `blockSize=11` `blockMargin=2`（复刻现状 CELL/GAP）。
- **色阶分工（防「两把尺子」）**：**fill（token）走 `main.css` 的 `.plos-heat[data-level]`**；**fill-opacity（档位语义）仍由 `HEAT_OPACITY` 经 `renderBlock` 注入** —— 各只有一份真源。
- **`renderBlock`**：`cloneElement(block, { className: "plos-heat", fillOpacity: HEAT_OPACITY[level], style: {} })` —— `style: {}` 整体替换清掉库的内联描边，`data-level` / `data-date` 保留。
- **验证**：typecheck + `build` 成功；热力图 Tooltip 的 lazy chunk 正常分包（`dist/assets/Tooltip-*.js`）。

### T7 — `main.css` 色阶规则 + i18n 接缝
- **Status:** done
- **Outcome:** `main.css` 末尾追加 `.plos-heat`（fill: primary）与 `.plos-heat[data-level="0"]`（fill: line）**共 2 条**（opacity 由 TS 注入，见 T6 分工）；**i18n 零改动**（P1 关月份标签 + P2 留自绘图例 ⇒ 无新键）；`ProgressPage.tsx` **零改动**（契约冻结成立）。

### T8 — 门禁全跑 + 体积记录
- **Status:** done
- **Outcome:**
  - `typecheck` / `layer:check` / `ui:check` 全部 exit 0；
  - `test:chart` **16/16**、`test:progress` **35/35**、`test:library` **全链 ALL PASS**（新链含 `test:chart`）；
  - `npm run build` 成功（1.66s）；**dist：8.7M → 9.1M（+0.4M）**；主 chunk `index-*.js` = 2314.32 kB / gzip 704.24 kB；
  - ⚠️ 源码级断言（§11.3 第 4 条）6 项全过：3 个 testid 存在；自写坐标映射归零（grep 命中的 1 处 `viewBox` 是注释）；charts.tsx 无硬编码 hex（命中的 1 处 `#666` 是注释里说明库默认值）；三导出签名未变；`weekStart={1}` / `colorScheme="light"` / 空数组早返回源码可见；`tone` 仍是 Tailwind 类名。
- **Notes:** ⚠️ T1 未先记录主 chunk 基线 → **装依赖前后的 index chunk 精确增量不可回溯**（诚实登记，不予估算）；方案要求的判据是 `du -sh dist` 增量（+0.4M），已达成。recharts 进了主包未单独分包 —— 方案非目标未含 chunk 优化，桌面 Tauri 首屏影响有限（R1 已评估），不追加。

### T9 — 文档回扫（§10.3 共 9 处）+ 头注改写
- **Status:** done
- **Outcome:**
  - #1 `charts.tsx` 头注：已改写为终态（三块全走库 + **保留被推翻结论的原文与时点**，不静默删除）；
  - #2 design:61 §1.3、#3 :76 §2 非目标④、#4 :97 G10、#5 :128 §3.3、#6 :154 mermaid、#7 :826 §8.3 伪代码 —— 六处全部加时点更正 / 标注推翻（伪代码块**保留为历史快照**，标注「仅存档勿按此实施」）；
  - #8 旧 runbook：**追加「追记（2026-09-29 · 渲染层换库）」一节**，历史 T4 记录保留不删；
  - #9 待核项：**实测不存在** —— 旧 runbook 全文仅 102 行，方案所记「:481-483 testid 表」无此内容（方案误记），无处置需要；
  - **全仓重扫**：`不引图表库|零可视化依赖|无图表库` 仅剩换库方案自身引用（回扫清单/G 事实表）+ 两处刻意保留的时点标注。**其它模块源码注与用户可见文案：零命中**。

### T10 — 用户目测确认（`npm run dev` → localhost:1420）
- **Status:** pending
- **Outcome:** —
- **Notes:** 重点看 §7.4 的 8 条变化；**禁自动化截图**

## 提交分组（§10.2 分层回滚）

| # | 提交 | 内容 |
|---|------|------|
| C1 | `chore(deps)` | recharts + react-activity-calendar（`package.json` 依赖 hunk + `package-lock.json`） |
| C2 | `test(progress)` | 适配器 + 单测 + `test:chart` 并入 `test:library`（`chart-adapters.ts` / `tests/` / `package.json` scripts hunk） |
| C3 | `feat(progress)` | 三块渲染层换库（`charts.tsx` + `main.css`，一揽子 —— 偏离 P3） |
| C4 | `docs(progress)` | 回扫 9 处 + 方案状态 + 本 runbook + 旧 runbook 追记 |

## 执行记录

| 时间 | 事件 |
|------|------|
| 2026-09-29 | T0 完成；runbook 建立，待 T1 |
| 2026-09-29 | T1 安装完成（+19 包 / +48M）；T2 五问全部通过（零 JS 读色值路径成立），并新增 3 条方案未记的库约束（升序 / min<max / 图例无 data-level） |
| 2026-09-29 | T3 适配器 + 16 条单测全绿（首跑 1 红，判为实现错：`isFinite` 误伤 `Infinity`，改为只特判 NaN）；T4/T5 折线换 recharts；T6 热力图换 react-activity-calendar；T7 CSS 2 条 + i18n 零改动 |
| 2026-09-29 | T8 全门禁绿（typecheck/layer/ui + test:chart 16 + test:progress 35 + test:library 全链 + build 1.66s）；dist 8.7M→9.1M |
| 2026-09-29 | T9 回扫完成（8 处处置 + 1 处待核实测不存在 + 全仓重扫零残留）；待 C1–C4 提交与 T10 用户目测 |
| 2026-09-29 | **T10 反馈第 1 轮落地**（`3275bc2`）：① 热力图铺满卡片 —— ResizeObserver 实测外层宽度反算 blockSize（变化 5 就此关闭，退路 R3 不再触发）；② 折线 linear→monotone + strokeLinecap round（用户拍板，推翻「不用 monotone」注释）。门禁全绿（typecheck/ui/layer + test:progress 35/35 + build 1.68s） |

### T10 — 用户目测确认（`npm run dev` → localhost:1420）
- **Status:** blocked
- **Outcome:** —
- **Notes:** blocked on：用户按 §7.4 的 8 条变化逐项目测（禁自动化截图，`no-headless-browser-validation`）。~~① 热力图不再铺满卡片宽度~~（**已修**：ResizeObserver 反算 blockSize）；② 折线多出水平网格线；③ 两处 tooltip 的文案与配色；④ 系统切暗色后热力图不变色（G20 对策）。折线平滑度用户已拍板 monotone。
