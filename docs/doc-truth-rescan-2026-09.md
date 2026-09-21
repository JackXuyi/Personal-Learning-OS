# 文档与实测不一致回扫 · 2026-09-21

> **一句话**：把「**已经交付/已经修好，但文档与长期记忆仍按未做叙述**」的条目逐条**实测**回扫，改回与代码一致的状态。
>
> **为什么值得单独做一轮**：本轮开工时被 `roadmap` §F8 的过时「现状证据」带偏了一次（以为 0 字符检测没做，实测早已实现），
> 顺着这条线索查下去，发现 `business-flow-end-to-end-2026-09.md` 的**缺口清单里有 7/11 条已交付**、长期记忆里的遗留 ①② **也早已修好**。
> 这类过时**比缺陷本身更贵**：它会让人**重复排期**，或者**按已推翻的理由去改别处代码**（本轮实测抓到 3 处源码注释 + 2 条用户可见文案属于后者）。
>
> **范围**：`docs/business-flow-end-to-end-2026-09.md`、`docs/roadmap-next-features-plan-2026-09.md`（§F8 + **§9 聚合视图**）、
> `docs/learn-flashcard-design-2026-09.md`、`docs/learn-flashcard-task-runbook-2026-09.md`、
> 3 处源码头注释、2 条 ×2 语言的用户可见文案、`.workbuddy/memory/MEMORY.md`。
>
> **不在范围**：README（故障/事实更正**不动 README**）；roadmap 的其它候选（见 §8）。

---

## 1. 取证口径：只认实测，不认叙述

**判据只有一条**：该条目声称的「未接线 / 不存在 / 不参与」是否仍成立 —— 回到**生产代码的真实调用点**核。

| 手法 | 用于 | 说明 |
|---|---|---|
| 找**消费方**而非定义处 | 「零调用点」「无 UI」类 | 定义存在 ≠ 已接线；反过来，只 grep 到定义处才是「未接线」（本轮全部改判为「已接线」） |
| 读**函数体**而非注释 | 「X 移动了 Y」类 | 注释会被改档留在原地（本轮 3 处）；函数体才是事实 |
| 扫**全仓引用** | 「零消费」类 | `cognitiveLevel` 必须用 Grep 工具全仓扫（本仓库禁止裸 `grep` 拼 `\|`，BSD grep 交替会**静默零命中**） |
| 看 **i18n 值** 而非键名 | 用户可见文案类 | i18n 测试只查 zh/en **结构对齐**，查不出**内容已经被推翻** |

---

## 2. business-flow-end-to-end：缺口清单逐项实测

| # | 原文判定 | 实测结论 | 决定性证据 |
|---|---|---|---|
| §零 S1 / P1 #6 | 扫描件 PDF 解析为 0 字符，走进「仅保存文档不写章节」 | ✅ **已交付** | `import/pdf.ts:83` `if (!text) throw new PdfNoTextError()` → `local-files.ts:74` 映射 `pdf-no-text` → `zh.ts:777` 文案提示。**0 字符 PDF 到不了** `pipeline.ts:124` 那个分支（该分支现只对「有文本但切不出章」成立） |
| §零 S2 / P1 #4 | 人工微调原语已实现但**零 UI 调用点** | ✅ **已交付（F7-a）** | `detail/SplitTab.tsx:39` import `applyChapterEdit`；`:177` `kind:'reorder'`、`:187` `kind:'rename'`、`:195` `kind:'merge'`（带确认框）。⚠️ `mergeChapters` 已更名 `mergeChapterRange` 并迁至 `engine/chapter-edit-engine.ts` |
| §零 S7 / P0 #3 / S7.3 | `submitAnswer` 调 `applyRating`，破双证据原则 | ✅ **已修（2026-09-20）** | `stores/useLoopStore.ts` rating 分支现调 `applyKeyPointRating`（源码级断言 `TC-RATE-06` 锁「零 `applyRating(`」） |
| §零 E2 / E2-b / P0 #1 | 画像无任何输入字段，`LearnerPage` 纯只读 | ✅ **已交付（F1）** | `profile/LearnerProfileCard.tsx:43,97` 走 `useLoopStore.saveProfile`（唯一写路径）；`learner/LearnerPage.tsx:125` 渲染该卡 |
| §零 E3 / P1 #5 | `deadlineAt` 不参与任何排程计算 | ✅ **已交付（F2）** | `plan/plan-quota.ts:63` 收 `deadlineAt`；`:93` `daysLeft`、`:97` `dueTodayMin`、`:94` `overdue`；`HomePage.tsx:29` / `PlanPage.tsx:39` 消费 |
| §零 E5 / P1 #7 | 达标后无任何收口动作 | ⚠️ **部分交付** | 已有：`HomePage.tsx:550` / `PlanPage.tsx:250` 的 `allDoneTitle` 🎉 卡 +「去测评巩固」；`GoalDetailPage.tsx:310,342` 的能力摘要卡与入口。**仍开放**：能力证书 / 可复用产出、下一目标引导、达标总结页 |
| P1 #8 / P2 #9 | planner 注释与代码矛盾，归责 `:9-11` | ✅ **已修（2026-09-20）** | `learning-planner.ts:162-165` 已写明「本行在 2026-09-20 前**写反**……以本行为准」。⚠️ 原归责**与实测相反**：写反的是 `:161`，`:9-10` 一直是对的 |
| P2 #10 | 章级与概念层两套 planner 并行 | **仍开放** | `createLearningPlanner().buildPlan`（概念层）与 `buildChapterPlan`（章级）并存，本轮回扫**未做功能改动** |
| P2 #11 | 难度只看 mastery，不看 `cognitiveLevel` | **仍开放** | `quiz-engine.ts::bandOfMastery` 只吃 `mastery`；Grep 全仓：`cognitiveLevel` **仅被写入（`learner-model.ts:117,191`）与聚合（`resplit-mastery.ts`）+ 赋给题目**，**零作为输入被消费** |

**结论**：11 条 → **7 条已交付 / 1 条部分 / 3 条仍开放**（P2 #10、#11，以及 #7 的剩余部分）。

---

## 3. roadmap §F8：现状证据更正

原文称：扫描件 PDF 返回 0 字符后会「走进"仅保存文档不写章节"分支（`pipeline.ts:124`），用户看到"导入成功但没有章节"」。

实测：**该路径不可达** —— 空文本在 `import/pdf.ts:83` 就抛 `PdfNoTextError`，UI 明确提示「疑似扫描件，请改用粘贴文本」；
`profile` 侧的简历导入走同一 kind（`resume-import.ts:76` 按 `err.name` 判定，避免把 pdfjs 拖进单测进程）。

→ 已把 F8 的「范围 1」标为 ✅ **已实现**、更正现状证据；**F8 其余两条实测为真**（`import/` 目录只有 md/txt/pdf/github 四路；`package.json` 无 mammoth / epub / readability 类依赖），F8 仍作为整体保留在规划里（范围 2–5 未做）。

---

## 4. 改档漏掉的两类残留（本轮的重点）

`401d5b2`（2026-09-20）把 `submitAnswer` 的自评分支改走 `applyKeyPointRating` 时，**回扫只覆盖了 `useLoopStore` / `DeltaBadge` 与部分文档**，漏了两类：

### 4.1 其它模块源码注里的「禁用入口理由」（3 处）

三处都写「卡片评分绝不经过 `submitAnswer`，**因为它的 `applyRating` 会移动 mastery**」——
**结论仍然对，理由已被推翻**。已换成**调度层级**：

> 卡片写**卡级** `CardState`（每张卡自己的 `nextReviewAt`），而该入口写**章级** `byUnit[chapterId]` 的 `confidence` / `nextReviewAt`
> 并触发整轮闭环重算 —— 走它会用「同一张卡的第 N 次评分」冒充「这一章复习了一次」。

| 文件 | 原表述 |
|---|---|
| `features/learn/flashcard-service.ts`（头注释） | 理由句（`useLoopStore.submitAnswer` … `applyRating` … 会移动 mastery） |
| `features/study/ReviewSession.tsx`（头注释） | 与 `snapshot` / 并列列为「碰不到」的入口 |
| `features/study/CardSession.tsx`（头注释） | 同上 |

⚠️ 改写时**不能**触碰 `TC-REG-01`（`flashcard.test.ts` 用**未剥注释**的原文断言该文件零 `applyRating\s*\(` 与零 `saveLearnerState\s*\(`）——
新措辞一律用**反引号包裹 + 后接空格**，不出现 `applyRating(` 字面形态。

### 4.2 用户可见文案（2 条 × 2 语言）

| 键 | 原值（已被推翻） | 新值 |
|---|---|---|
| `review.conceptDoneSubtitle`（zh/en） | 「自评即该概念的掌握度证据」/ "self-rating **is** the mastery evidence" | 「自评只影响复习调度与置信度，掌握度仍由测评决定」/ "self-rating **only affects** review scheduling and confidence; mastery still comes from assessments" |
| `knowledge.chapterGraph.hint`（zh/en） | 「自评复习即掌握度证据（概念层无卷面）」 | 「自评只刷新复习调度（概念层无卷面，掌握度由测评决定）」 |

**事实依据**：`applyKeyPointRating` 只写 `confidence` / `lastReviewedAt` / `nextReviewAt`（`learner-model.ts:225-245`）；
概念单元的 `mastery` 现在**只由** `applyEvaluation` 写（`learner-model.ts:105`，走 `/assessment` 的 `{correct}` 分支）。
→ 用户可见文案是**产品措辞**，已按"改文案"决策落地（不动代码、不动键名）。

---

## 5. 代码改动

| 文件 | 改动 | 性质 |
|---|---|---|
| `src/features/learn/flashcard-service.ts` | 头注释：禁用理由换成调度层级 + 保留 2026-09-20 更正说明 | 注释 |
| `src/features/study/ReviewSession.tsx` | 同上（去掉「`applyRating` 碰不到」的旧理由） | 注释 |
| `src/features/study/CardSession.tsx` | 同上 | 注释 |
| `src/i18n/messages/zh.ts` | `review.conceptDoneSubtitle`、`knowledge.chapterGraph.hint` 文案更正 | 文案（键名不变） |
| `src/i18n/messages/en.ts` | 同上（en 同步） | 文案 |
| `tests/session-rating.test.ts` | 新增 `TC-RATE-10`（3 处注释不得再出现旧短语）与 `TC-RATE-11`（2 条文案不得再称「自评即掌握度证据」）；补 `en` import；头注释补 ③④ 两层 | 测试 |

**零生产逻辑改动**：本轮的代码侧改动**全是注释与文案**，无函数体、无类型、无存储改动。

> ⚠️ **提交归属事故（2026-09-21 实测，值得记一笔）**：本轮的两处 i18n 文案（2 键 × zh/en 共 4 行）
> **已被并行会话的 `72ccfff feat(i18n): 社区知识包文案` 裹带提交** —— 同一工作树并行时，
> 对方的 `git add src/i18n/messages/zh.ts src/i18n/messages/en.ts` 会把我**尚未提交**的编辑一起收走
> （已核实：内容完整在 HEAD 树上、我的 5 条提交均在祖先链、无丢失）。
> **未回滚、未改写对方提交**（改写共享历史比让归属错位更糟）。教训：**改完尽快提交**，
> 别把未提交的编辑长时间暴露在同一工作树里。

### 5.1 源码级断言设计

- **只锁旧短语，不锁新措辞** —— 断言新写法会在正常重构时误伤（本仓库既有教训）；故 `TC-RATE-10` 用两条**旧形态**正则。
- **必须先证反** —— 用 `git show HEAD:<file>` 拿改前原文跑同一正则：`flashcard-service.ts` 命中形态 ①、`ReviewSession.tsx` 与 `CardSession.tsx` 命中形态 ②（**各 1 条，无一条全命中** —— 这正是首版单正则只抓到 1/3 的原因）；改后工作树**零命中**。
- **正则需展平注释符与换行**再匹配（旧句子跨了两行）。

---

## 6. 文档回扫

| 文件 | 改动 |
|---|---|
| `docs/business-flow-end-to-end-2026-09.md` | 版本行 → v1.1（注明 2026-09-21 回扫）+ 表头加回扫说明；**§零 完成度总览** S1/S2/S7/E2/E3/E5 六行更正；§S1 异常分支与已知局限；§S2 🔴 缺口；§S7.2 写入点 + §S7.3 标题与结论；§E2-b 整节（含原「建议最小实现」留档）；§E3 缺口；§E5 缺口；§五 路由表 `/learner` 行；**§六 缺口清单**（11 条逐条标注，**已交付项保留原文不删**）；§七 诊断补一段 |
| `docs/roadmap-next-features-plan-2026-09.md` | **仅 §F8**：现状证据更正（三条各标实测结论）+ 范围 1 标 ✅ 已实现 |
| `docs/learn-flashcard-design-2026-09.md` | §3.1「⚠️ 已知不一致 ①」行、§13 **D6** 选项表与定案段（补「后续已修」但**结论不变**的说明） |
| `docs/learn-flashcard-task-runbook-2026-09.md` | 开工三条硬约束之 3：理由换成调度层级 |
| `.workbuddy/memory/MEMORY.md` | 遗留 ①② 标 ✅ 已修（附提交）+ 新增 ⑧ 回扫记录；「改档后全量回扫」清单补**最易漏的两类**；「规划文档」条补「据规划排期前先实测」 |

**风格跟随既有先例**：`~~删除线~~ + ✅ 已交付(日期) + 保留原证据与更正说明` —— 与 `roadmap` §四 既有写法一致，
好处是**当时的判断也能被后人看到**（否则会有人以为"这条从来没出过问题"）。

---

## 7. 验收

| 项 | 结果 |
|---|---|
| `npm run test:rating` | 全绿（含新增 `TC-RATE-10` / `TC-RATE-11`） |
| `TC-RATE-10` 证反 | HEAD 版三文件各命中对应旧形态；改后零命中 |
| `npm run test:flashcard` | 全绿（`TC-REG-01` 未被新注释触雷） |
| `npm run typecheck` | 0 新增（仅 `AIModelsSection.tsx` 3 条既存债） |
| `test:library` 全链 | 见提交前复跑记录 |

---

## 8. 仍开放 / 未做（登记不修）

1. **`roadmap` 其余候选未逐项回扫** —— 首轮（§1–§8）只查了 §F8。
   > ⚠️ **2026-09-21 补充**：当日第二轮已把该文档的**聚合视图**（§零 / §一 / §三 / §五 / §附）逐条实测回扫，见 **§9**；
   > 仍未实测的是 **F5 两处可见性（D1-C / D5-C）与 F7 范围 2–4 的「现状证据」**，以及其它文档（如 `learning-system-v2-design`）的同类叙述 ——
   > 按 §1 的口径**引用前请自行复测**。
2. **P2 #10**（章级与概念层两套 planner 并行）与 **P2 #11**（`cognitiveLevel` 零消费）—— 属**功能改动**，不在本轮回扫范围。
3. **E5 剩余收口**：能力证书 / 可复用产出清单、下一目标引导、达标总结页。
4. **`plos.evidence` 的悬空 `sourceId` 与 `learner.byUnit` 孤儿键**仍走 append-only（见 `docs/raw-id-label-fix-2026-09.md` §8）。
5. **本轮回扫的方法论**（「只锁旧短语、先证反、展平后匹配」）已回填到 `skills/root-cause-fix-workflow`（若下一轮出现同类问题可复用）。

---

## 9. roadmap 的「聚合视图」回扫（同日第二轮）

### 9.1 触发：明细节修了，聚合视图没修

§2/§3 修的是 roadmap 的**明细节**（§F8）。这份文档还有一层**聚合视图** ——
§零「三条判断 / 候选表 / 推进顺序」· §一「先排除」表 · §三 mermaid · §五 一句话总结 · §附「本轮复核的关键事实」。

它是**被最先读到的部分**（结论先行），但**每次 feature 落地时改动都发生在明细节里，汇总节没人回头改**。
实测结果：**聚合视图里的过时条目比明细节更多**。最贵的一条是 §零.2：

> 「用户在整个"学习"环节**没有任何主动加工动作** —— 不能划线、不能记笔记、不能提问、不能复述。**这是当前最大的产品空白**，而不是评测。」

照这句话排期，下一个人会**再去做一遍 F5**（实际上四项已于 2026-09-14～09-16 全部落地）。
**与 §3 被 §F8 带偏是同一个失败模式** —— 只是这次过时的不是某一节，而是"哪件事还没做"的**全局判断**。

### 9.2 逐条实测

| # | 位置 | 原文断言 | 实测 | 决定性证据 |
|---|---|---|---|---|
| 1 | §零.2 判断 2 + 表 | 「学习」只有读原文 / 要点卡 / 图谱，「**没有任何主动加工动作**」，是当前最大空白 | ❌ **已推翻** | 五项主动加工全落地并接线：`ChapterReaderPage.tsx:383` `SelectionToolbar`（划线）+ `:512` `ChapterAnnotationsPanel`（第 7 区「我的划线」）+ `:248` 证据写入；`chapter-qa-service.ts` · `restatement-service.ts` · `flashcard-service.ts` 各自服务层齐备 |
| 2 | §零 候选表 F5 行 | 「提问 + 费曼复述 + 自测卡已实施；**仅笔记未做**」 | ❌ **已推翻** | 笔记即 §F5 范围 2，该节自身写「✅ **2026-09-16 已落地**」——**同一文档内明细与汇总互相矛盾** |
| 3 | §零 候选表 F7 行 | `P2`（无状态标记），一个字面未提范围 1 | ⚠️ **不完整** | F7 范围 1（重命名 / 合并 / 拖拽排序）已落地（`SplitTab.tsx`），该节自带「实施进度（2026-09-14）」块 |
| 4 | §零 候选表 F8 行 | `P2`，未提 0 字符检测 | ⚠️ **不完整** | §3 已实测范围 1 交付 |
| 5 | §零 推进顺序 + 理由 | 「F7 章节编辑（快赢，1~2 天）」作为**待做**的第二步 | ⚠️ **已过时** | 同 §3 行 |
| 6 | §一 先排除表 · Provider | `buildActiveProvider` **6 处**消费点 | ❌ **已过期** | 实测 **17 个文件**（原 6 处 + `SplitTab` · `OverviewTab` · `KnowledgeTab` · `auto-enrich` · `capability-service` · `CapabilityPage` · `chapter-qa-service` · `restatement-service` · `ResumeImportDialog` · `MemoryAiDialog` · `MemoryPage`） |
| 7 | §一 先排除表 · 证据流 | 写入 **3 处**、读取 **2 处**；接口只列三个方法 | ❌ **已过期** | 写入实测 **7 处**（+ `restatement-service` · `flashcard-service` · `capability-service` · `import-service`）、读取 **5 处**（+ `ProgressPage` · `memory-signals` · `SettingsPage`）；接口另增**原子方法** `appendEvidenceUnless` |
| 8 | §一 先排除表 · 混合检索 | 消费点 **2 处**；`hybrid-search.ts:63` | ⚠️ **计数过期 + 行号漂移** | 实测 **3 处**（+ `chapter-context.ts:71,89`）；定义行现为 `hybrid-search.ts:77` |
| 9 | §三 mermaid 节点 | `F1` 无 ✅；`F5 (P1 · 大)`、`F7 (P2 · 小)`、`F8 (P2 · 增量)` 均无状态 | ⚠️ **不完整** | 与 §零 表同源 |
| 10 | §三 说明行 | 「无前置、可立即开工：F5 · F7 · F8」 | ⚠️ **已过时** | 三者都已有交付部分 |
| 11 | §五 一句话总结 | 「让你在学习时**能动手**（F5 ◐ —— 提问 / 费曼复述 / 自测卡已做，**笔记未做**）」 | ❌ **已推翻** | 同 #2；且「仍未做」只列了 F8，漏了 F7 范围 2–4 与 F5 两处可见性 |
| 12 | §附 关键事实 · 「已完成」项 | `EvidenceEntry` **3 写 2 读**、`hybridSearch` **2 处**、`buildActiveProvider` **6 处** | ❌ **计数全过期** | 同 #6/#7/#8 |
| 13 | §附 关键事实 · 「未实现」项 | `LearnerProfile` 不存在、`StorageAdapter` 无导出方法、全仓无 trend/heatmap/streak | ❌ **三条未标注已交付** | F1（`LearnerProfileCard.tsx` + `saveProfile`）、F4（`export-service.ts`）、F3（`analytics.ts:204 buildHeatmap` / `:284 buildTrend`）。同批的另外两条（`deadlineAt` 零消费、章节编辑零 UI）**此前已标注**，正是"标注做了一半"的现场 |
| 14 | §五 变更记录 | 无 §F8 更正行 | ⚠️ **漏登** | 该更正发生于 §3，但当日未入变更记录 |

**关于「streak」的精确结论**（避免下一轮再判错）：F3 落地了 **trend** 与 **heatmap**，**没有**「学习连续天数」口径的 streak。
`AssessmentSession.tsx:247` 的 `a.streakUp` 是**答题连续答对 → 升难度**，与"连续学习天数"**无关** —— 两者不可互相引用。

### 9.3 roadmap 改动表

| 位置 | 改动 |
|---|---|
| 版本行 | 加注「**聚合视图 2026-09-21 按实测回扫**，见 §变更记录」 |
| §零.2 判断 2 | 表行「学习」现状与成熟度改档（⭐⭐ → ⭐⭐⭐ 主动工具齐备）；原「没有任何主动加工动作」段**整体划线** + ⚠️ 实测更正注（含 4 项逐条不成立的证据与"当时为什么把 F5 排前"的留档理由） |
| §零 候选表 | F5 → `✅`（`~~仅笔记未做~~ → 四项全落地`）；F7 / F8 → `◐`（各注已交付范围 + 待做范围） |
| §零 推进顺序 | 图内 F7 / F5 / F8 三处补状态；「理由」里 F7 的「快赢」句划线 + 注明已落地 |
| §一 先排除表 | Provider（6 → **17 个文件**，补齐名单）；证据流（3 写 2 读 → **7 写 5 读**，补 `appendEvidenceUnless`）；混合检索（2 → **3 处**，去漂移行号，改用 `::hybridSearch`） |
| §三 mermaid + 说明 | `F1` 补 ✅；`F5` 补 ✅；`F7` / `F8` 改 `◐范围N已落地/已实现`；「无前置」行三者划线注状态；新增「**部分交付**」汇总行 |
| §五 一句话总结 | F5 `◐` → `✅`（四项全落地）；「仍未做」由 1 项扩为 3 项（F8 剩余四项 / F7 范围 2–4 / F5 两处可见性） |
| §F5 节标题 | 补 `✅ **已实施（2026-09-14～09-16，四项全落地）**` + 状态块，并把 D1-C / D5-C 明确登记为后续候选 |
| §附 关键事实 | 「已完成」三条计数全部重测并划线注新值；「未实现」三条（`LearnerProfile` / `StorageAdapter` 导出 / trend-heatmap-streak）补 ✅ 已交付与证据，并写明 streak 的精确口径 |
| §五 变更记录 | 补两行：§F8 更正**补登**（当日漏进本表）+ 本轮聚合视图回扫 |

**风格**：仍跟随 §6 的先例 —— `~~删除线~~ + ✅ 已交付(日期) + 保留原证据`。
**零生产代码改动**：本轮只动这一份 Markdown。

### 9.4 可复用的一条（已并入 skill 的判断）

聚合视图（"结论先行"节、状态表、mermaid、关键事实清单）**不会随明细节自动更新**，
而它恰恰是**被最先、最常读**的部分，也因此是**过时后最容易误导排期**的部分。

> **判据**：改一份「结论先行 / 状态总览」型文档的**任何一个明细节**时，**同批**回扫它的汇总节。若汇总节里有**计数**（N 处消费点 / N 写 N 读），
> 一律**当场重测**，或改写成**不随提交漂移的口径**（如"以实测为准"）—— 计数是最先腐烂的那类断言。

### 9.5 验收

| 项 | 结果 |
|---|---|
| `npm run typecheck` | **3 errors = 基线**（仅 `AIModelsSection.tsx` 既存债） |
| `npm run test:i18n` | 全绿 |
| `npm run test:library` 全链 | **EXIT=0 / FAILED=0**（26 组，末位 `test:pack`） |
| 改动面 | **仅 1 份 Markdown + 1 份 skill** —— 零生产代码改动 |
| README | **未动**（事实/文档更正不动 README，沿用第一节口径） |
