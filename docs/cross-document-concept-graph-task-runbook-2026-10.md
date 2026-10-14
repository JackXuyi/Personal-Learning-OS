# 跨文档概念图谱视图页 · 执行 Runbook

> 方案真源：`docs/cross-document-concept-graph-design-2026-10.md`（D1–D5/D7 已确认，**D6 按推荐档 A 落地**）。
> 实施偏差**不在此重复登记** —— 唯一真源：方案文档「实施偏差记录」节 + 其变更记录。

## Goal

新增 `/graph` 页，把**全库概念**渲染成一张可探索的图（按资料筛选 / 单击聚焦一跳邻域 / 双击回到来源资料 / 发起概念复习），并把侧栏「图谱 · 即将上线」占位项（`NAV_COMING`，`navKey: "graph"`，badge `N5`）激活为真实入口。

**零持久化变更、零新依赖、`src-tauri/**` 零改动。**

## Context

- Package / paths：`src/features/knowledge/`（新增 2 文件 / 改 1）、`src/features/units.ts`、`src/components/layout/`、`src/App.tsx`、`src/i18n/messages/{zh,en}.ts`、`tests/cross-doc-graph.test.ts`、`package.json`
- Docs read：
  - `docs/cross-document-concept-graph-design-2026-10.md`（本 runbook 的方案真源）
  - `docs/knowledge-graph-react-flow-design-2026-09.md`（GraphView / layout / UnitNode 真源；D1「图是读的不是画的」）
  - `docs/nav-sidebar-redesign-design-2026-09.md` §D3（占位项来龙去脉，原文「N5 上线时再补」）
  - `rules/no-headless-browser-validation.mdc`（禁主动起浏览器 ⇒ 可测面积全部压进纯函数）
  - `rules/dropdown-select.mdc`（筛选走 Button chip，规避原生 `<select>` 与手写浮层两个禁区）
- ⚠️ 关键实测（方案 §3.3.1）：`KnowledgeUnit.sourceDocumentId` 在真实数据里**恒为 `undefined`** ⇒ 归属解析走三级回退；`GraphView` 的双击 / 「查看原文」必须注入归属解析，否则在本页双双失效。
- ⚠️ 布局硬上限：`features/knowledge/layout.ts` 自述「≤ 50 节点」，斥力 O(n²) ⇒ `CORE_LIMIT = 40`，并写守卫断言。

## Tasks

### T1 — 新增 `cross-doc-graph-model.ts`（纯函数）
- **Status:** done
- **Outcome:** `src/features/knowledge/cross-doc-graph-model.ts` 新建（约 175 行）。导出 `UNLINKED_KEY` / `CORE_LIMIT` / `DocRef` / `CorePick` + 4 纯函数（`unitOwnerIndex` / `ownerCounts` / `unitIdsOfDocuments` / `coreSubgraphOf`）。零 React / 零 DOM / 不接触 storage。
- **Notes:** 4 个纯函数（`unitOwnerIndex` / `ownerCounts` / `unitIdsOfDocuments` / `coreSubgraphOf`）+ 2 常量（`UNLINKED_KEY` / `CORE_LIMIT`）+ `DocRef` / `CorePick` 类型。无 React、无 DOM。

### T2 — 新增 `tests/cross-doc-graph.test.ts`（A–F 六组）+ `package.json::test:xdoc`
- **Status:** in_progress
- **Outcome:** 测试文件已落（**37 项**：A 组 9 / B 组 5 / C 组 10 / D 组 3 / E 组 8 / F 组 2）；`test:xdoc` 已加入 `package.json`（与 `test:flow` 同级，**不进** `test:library`）。当前 **36/37 通过** —— 唯一失败的 `TC-FILE-02`（行数上限）因 `CrossDocGraphPage.tsx` 尚未创建（T4）而 ENOENT，T4 后转绿。
- **Notes:** 方案 §12 实列 35 项 + F 组 2 项源文件卫生守卫 = 37 项（方案 §11.3 写的「30 项」是估算，实施期实测更正，已登记方案偏差表）。实施中发现并修正 1 处**测试自身**的错：`TC-UC03-01` 初版未传 `unitIds` ⇒ 池＝全图 41 个单元、「池外」实为池内，守卫形同虚设（已改传 `unitIds` 并补 `total === 40` 断言）。

### T3 — `unitAlias()` + `GraphView` 加 `documentIdOf` + D6-A 修正
- **Status:** done
- **Outcome:** `features/units.ts` 加 `unitAlias()`（未知返回 `undefined`，**不回落 id**）；`unitTitle` 原样保留。`GraphView.tsx`：新增可选 prop `documentIdOf` + `ownerDocIdOf` 取值口（先问宿主、再回落 `sourceDocumentId`）；双击与侧栏「查看原文」改走它；侧栏副标题改用 `focusAlias`（未知则**整段省略**）；关系清单目标名改用 `other.title`（与画布节点标签同源）。`unitTitle` 在本文件已无引用。验证：`typecheck` 0 error；`test:flow` 18/18（模型层未动）。
- **Notes:** 向后兼容——`ChapterGraphPage` / `KnowledgeTab` 不传 `documentIdOf` ⇒ 严格回落到 `sourceDocumentId`，与改造前一致；唯一行为变化是 D6-A 的副标题/关系名（修正，非回归）。

### T4 — 新增 `CrossDocGraphPage.tsx`
- **Status:** done
- **Outcome:** 新建（约 260 行）。读取（`listChapters` 用 `Promise.all` 并发）/ 资料 chip 多选筛选 / 四态渲染（**错误 → 加载 → 空 → 未选中 → 正常**）/ 双击跳 `/learn/doc/:docId` / 复习走 GraphView 默认回退。`data-testid` 全部按方案 §7.3 落在**外层 `div`**（`Card` 不透传 rest props）。验证：`typecheck` 0 error；`test:xdoc` **37/37**；`ui:check` 原生下拉 0 / sticky 残影 0。
- **Notes:** 两处相对方案的实现收敛：① `?doc=` 改为 `useState(() => params.get("doc"))` 只取一次（方案原文直接读 `params` 并配 `[nonce]` 依赖，会触发 exhaustive-deps 告警；改用一次性 state 既忠实「只读一次」决策又无告警）；② 统计行与截断提示均走 `pick?.`，避免加载期为 `undefined` 时抛错。均已登记偏差表。

### T5 — i18n zh/en（`nav.graph.hint` 改写 + `knowledge.crossDoc` 键）
- **Status:** done
- **Outcome:** `nav.graph.hint`：zh「概念关系 · 即将上线」→「跨资料的概念关系」；en「Concept relations · soon」→「Concept relations across documents」。`knowledge.crossDoc` 整块 zh/en 成对（**实测 18 键**：含 `stats` / `filterChip` / `truncated` 三个函数值）。验证：`test:i18n` 通过；`typecheck` 0 error。
- **Notes:** 方案 §8.8 写「13 键」，实列 18 项 —— 实施按实列 18 键落地，计数更正已登记偏差表。

### T6 — 导航与路由接线（`nav-items.ts` / `NavSidebar.tsx` / `App.tsx`）
- **Status:** done
- **Outcome:** `nav-items.ts`：`/graph` 并入 `NAV_ITEMS`（插在 `/learn` 之后），删除 `NavComingSpec` / `NAV_COMING` 两个导出；顺序注释补「图谱」一环。`NavSidebar.tsx`：删占位块与 `ComingIcon` / `comingEntry`，`NAV_COMING` 导入移除，「8 项固定」→「9 项固定」。`App.tsx`：`graph` 路由挂在 `learn/:legacyId/graph` 之后。验证：`typecheck` 0 error；`layer:check` 违规 0 / 新增环 0；全仓 Grep 确认 `src/` 与 `tests/` 下 `NAV_COMING` / `NavComingSpec` / `nav-graph-placeholder` **零残留**（仅剩 docs 内的历史记录与方案对照，属应保留项）。
- **Notes:** 派生的 README/文档回扫见 T8（含 `ui-design-system-skill-design` 里失效的 testid 示例）。

### T7 — 门禁全跑
- **Status:** done
- **Outcome:** 全部现跑 —— `typecheck` **0 error** · `layer:check` **违规 0 / 新增环 0**（基线豁免仍为边 3 条 / 环 2 组）· `ui:check` **原生下拉 0 / sticky 残影 0**（新页面未出现在颜色漂移表 ⇒ 零新增色值）· `test:i18n` 通过 · `test:xdoc` **37/37** · `test:flow` **18/18** · `test:library` **exit 0 / ALL PASS**（30 套件）。
- **Notes:** 另完成 `TC-EDGE-05` 的**真实手工实证**：把 `CORE_LIMIT` 临时改为 `51` → `TC-EDGE-04` 按预期变红（提示语正确）+ `TC-EDGE-05` 同时变红 → 改回 `40` 复跑 37/37。证明越界守卫真的会拦。

### T8 — README 双语 + docs 回扫
- **Status:** done
- **Outcome:** README 双语 `Cross-document concept graph` / `跨文档概念图谱` 由 `[ ]` → `[x]` + 描述改写为已交付能力；顶部统计行 `40 · 6` → **`41 · 5`**（实测 `[x]` 41 · `[ ]` 5，h2 11 / h3 29 双语对齐）。docs 回扫 **7 份**：`roadmap`（§五「仍未做」删该条 + §附 计数链追加 41/5 + §附 2026-10-09 补测 ① 时点注 + 变更记录）、`code-gap-review`（§零.4 时点注 / §六 表头第二段时点注 + #7 标 ✅ / §七 第 5 批）、`business-flow`（§S3「概念图谱」行 + §五 路由表 + §七 2026-10-14 追加）、`nav-sidebar-redesign`（§D3 时点注 + 变更记录）、`knowledge-graph-react-flow-design`（§8.7 时点注 + 变更记录）、`ui-design-system-skill-design`（失效 testid 示例 `nav-graph-placeholder` → `crossdoc-graph-page`）、方案文档自身（状态字段 → 已实施 + 实施偏差节 + 变更记录）。
- **Notes:** 8 份中 1 份是本次新建的方案文档本身。反向检查：全仓 Grep 确认 `src/` 与 `tests/` 下三个待删符号**零残留**。

### T9 — 桌面端手工验收
- **Status:** pending
- **Outcome:**
- **Notes:** 需用户实跑：`?doc=` 深链预选 / 双击回原文 / 侧栏「查看原文」在**未关联**节点下不渲染 / 复习跳转 / 截断提示条 / 资料 chip 取消到 0 时的空态 / 侧栏「图谱」项高亮。`rules/no-headless-browser-validation` 禁止主动起浏览器，故留给用户。

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-10-14 | 建 runbook（T1–T9）。D6 采纳方案推荐档 A（新增不回落 id 的 `unitAlias()`，边界只改 `GraphView` 两行） |
| 2026-10-14 | T1–T8 全部 done（T9 待用户桌面实跑）。门禁全绿；实施偏差 10 条 + 1 条测试自身缺陷登记于方案文档「实施偏差记录」节 |
