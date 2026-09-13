# 资料导入优化实施 runbook（O1~O4，2026-09-13）

> 依据：`docs/library-import-optimization-plan-2026-09.md`。
> 已确认决策：实施 **O1~O4**；**D1 = 弹窗询问**；D2（自动分析=结果卡勾选）留档，O5 后续另开。
> 纪律：提交只按路径、只落本地不 push；不做浏览器校验。

## 任务清单

| ID | 内容 | 验收 |
|---|---|---|
| **T1** | O1 质量门下沉：新建 `src/lib/text-quality.ts`（`hasMeaningfulText`），`chapter-map-reduce.ts` 改 re-export；`splitter-engine.ts` 的 `cleanRefinedKeyPoints` 与 `applyChapterRefine` 合并拼接处过滤纯符号要点 | `test:aimap` / `test:library` 全绿；新增「精修要点含纯符号被过滤」单测 |
| **T2** | O3 粘贴护栏：`LIMITS.pasteMaxChars = 1_500_000`；ImportModal 粘贴 Tab 超限前置拦截（按钮禁用 + 提示），`runTabAction` / `saveDocOnly` 双保险 | `test:import` 全绿（LIMITS 断言）；i18n 成对 |
| **T3** | O4 清洗扩展：`stripMarkdownNoise` 增三类规则——纯 badge 行整行删、引用式图片保 alt + 定义行删、HTML 注释删 | `test:import` 新增用例全绿 |
| **T4** | O2 去重（D1 弹窗询问）：`RunUnitOptions.onDuplicate`（skip / overwrite / create，缺省 create 保持现状）+ `UnitResult.skippedAsDuplicate` + `ImportSummary.skipped`；ImportModal 导入前按 `source` 查重 → 冲突面板逐份选择 → 覆盖走 `deleteDocumentCascade`；结果卡补 skipped 区 | `test:import` 新增 skip/overwrite/create 三态单测；i18n 成对 |
| **T5** | 全量验证 + 文档同步：typecheck / `test:import` / `test:aimap` / `test:library` / `test:i18n`；优化方案文档置「已实施」 | 0 新增 error |
| **T6** | 提交（按 feature 分组） | 工作树干净 |

## 执行记录

### T1 状态：done

- **Outcome:** 新增 `src/lib/text-quality.ts`（`hasMeaningfulText`：剔除符号后 Unicode 字母/数字 ≥2，含 CJK）。`chapter-map-reduce.ts` 删除本地实现、改 import（对外 re-export 保留，`tests/ai-map-reduce.test.ts` 既有引用零改动）；`splitter-engine.ts` 的 `cleanRefinedKeyPoints` 过滤条件补 `hasMeaningfulText`，`applyChapterRefine` 的 `mergeIntoPrevious` 合并拼接处同样过滤（80 字截断前先滤，避免「截断后剩符号」漏网）。新增单测「导入精修路径同样过滤纯符号 keyPoints（O1，engine.applyChapterRefine）」。
- **验收:** `test:aimap` 28/28、`test:library` exit 0 ✅

### T2 状态：done

- **Outcome:** `LIMITS.pasteMaxChars = 1_500_000`（与 `githubTotalChars` 同口径）；ImportModal 三层拦截：①正文超限时主按钮禁用 + Tab 内红字提示（实时）②`runTabAction` 粘贴分支前置拦截 ③`saveDocOnly` 同样拦截。i18n 新增 `pasteTooLong`（zh/en 成对）。
- **验收:** `test:import` 全绿（LIMITS 断言）、`test:i18n` exit 0 ✅

### T3 状态：done（含 1 处实施偏差）

- **Outcome:** `stripMarkdownNoise` 由 4 条规则扩到 7 条：HTML 注释整段删、纯 badge 行整行删、`<img>` 删、行内图片保 alt、**引用式图片 `![alt][id]` 保 alt + 定义行 `[id]: url` 整行删**、行内链接保文字、空 bullet 行整行删。
- **偏差:** badge 行规则**收窄为仅匹配空 alt 的图片/徽章**——初版对带 alt 的整行图片也整行删，被用例 `![覆盖说明](local/path.png)` → `覆盖说明` 抓出：带 alt 的图片是可读内容不是装饰物。代价：alt 文字的徽章栏会退化为一行 alt 词（可接受，质量门与 AI 管道可消化）。
- **验收:** `test:import` 30/30 ✅

### T4 状态：done

- **Outcome:** ①`types.ts` 新增 `DuplicateAction`（skip/overwrite/create，缺省 create = 既有行为）、`UnitResult.skippedAsDuplicate`、`ImportSummary.skipped`；②`pipeline.ts::runUnitImport` 带 source 先查重：skip → 不写任何数据直接返回（docId 指向旧资料）、overwrite → 复用与「删除资料」同一条级联链路（`document-cascade.ts`：chunk/向量/试卷/概念/本体）后照常导入；`runBatchImport` 把 skip 的份归入 `summary.skipped` 不进 ok；③为避免 `pipeline → library-actions`（拖入 zustand store、破坏 node 单测）的依赖方向问题，删除级联抽为纯编排模块 `src/features/learn/document-cascade.ts`（store 必传），`library-actions.ts` 改为薄委托（对外导出与签名不变，15+/63-）；④ImportModal 导入前按 `source` 查重 → 冲突面板逐份 `Select`（跳过/覆盖/新建，缺省跳过）→ 确认后按原意图（单份/批量）继续；批量汇总卡补 skipped 区。i18n 新增 `duplicate.*` 5 键（zh/en 成对）。
- **验收:** `test:import` 30/30（含 skip/overwrite/create 三态 + 「缺省 create 现状不回归」用例）✅

### T5 状态：done

- **Outcome:** `npm run typecheck`：全仓 3 条 error 均为 `AIModelsSection.tsx` HEAD 既存 TS6133（本任务 0 新增）；`test:import` 30/30、`test:aimap` 28/28、`test:keypoint` / `test:ai` / `test:render` / `test:graph` / `test:prereq` / `test:i18n` / `test:library`（7 组串联）全部 exit 0。方案文档状态置「已实施（O1~O4）」。

### T6 状态：done

- **Outcome:** 按 feature 分两条提交：`feat(learn)`（O1~O4 实现 + 测试）、`docs(learn)`（方案 + runbook）。详见 git log；提交只落本地不 push。

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-13 | 建立 runbook（T1~T6），决策 D1=弹窗询问 / D2 留档 | Agent |
