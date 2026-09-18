# 学习者记忆（F9）实施 runbook

> **状态：✅ 已完成（2026-09-18）**。任务定义与验收口径的唯一真源：
> `docs/learner-memory-design-2026-09.md`（§9 任务清单 / §10 实施步骤 / §11 通过标准 / §12 测试用例）。
> 本文只记录**执行状态、outcome 与实施期发现**，不复制方案内容。
>
> **本轮实施口径**：用户在 Agent Mode 下指示「按照推荐方案实施」→
> **D5–D12 全部按方案推荐档落地**（D5-A 双通道 / D6-A 手动触发 / D7-A 声明优先 /
> D8′-A 两个新 key / D9-A 固定 6 类 / D10-A 三处注入 / D11-A 否决回传 + 代码层过滤 /
> D12-A 落盘 `.md`），**D13 亦按推荐档 B**（清库时清系统条目、保留用户手写与改过的行）。
>
> ⚠️ **本表初版在开工时预填为全 done（作为目标态）；下面是收口时按实测回填的真实状态。**

## Goal

把 `docs/learner-memory-design-2026-09.md`（v2，markdown 文档为真源）落到代码：
`/memory` 页 + 行级三态合并器 + 双通道整理 + 三处 AI 注入 + 磁盘镜像；
兑现 §11.3 的 8 条通过标准（含两条最关键硬断言：**用户改过的行 5 轮不变**、
**用户删掉的行 5 轮不复活**）。

## Context

- 方案（唯一真源）：`docs/learner-memory-design-2026-09.md`
- 涉及路径：`src/domain/memory.ts`（新）、`src/lib/hash.ts`（新）、`src/storage/*`、
  `src/features/memory/*`（新）、`src/ai/{learner-context,pipelines,chapter-qa,restatement,memory-pipeline}.ts`、
  `src/stores/useLoopStore.ts`、`src/App.tsx`、`src/components/layout/nav-items.ts`、
  `src/i18n/messages/{zh,en}.ts`、`src-tauri/src/{memory_doc.rs,lib.rs}`、`tests/`、`README{,.zh-CN}.md`
- 已读规范：`AGENTS.md`、`rules/*`、`skills/{tiered-change-workflow,docs-task-runbook}`
- 约束：**禁起浏览器**（`no-headless-browser-validation`）；零新增 npm 依赖 / 零新增 crate；
  `ai/` 与 `engine/` 不得 import `features/`；`storage/` 不得 import `features/`
  （→ `MemoryDocMeta` / `GeneratedEntry` 必须落 `domain/`）；被单测覆盖的纯逻辑必须 `.ts`

## Tasks

| ID | 任务 | 依赖 | 状态 | Outcome 摘要 |
|----|------|------|------|--------------|
| T0 | `src/lib/hash.ts` + 三处换源 | — | done | 抽第四份 djb2；三处私有 `hashId` 改为 import，**输入拼接格式逐字保留**；`test:flashcard/test:annotation/test:capability` 全绿 → 既有 id 未变（TC-UC12-02/03） |
| T1 | `domain/memory.ts` | T0 | done | 6 类枚举 + `MEMORY_LIMITS` + `MEMORY_FACT_MIN_SAMPLES` + `parseMemoryDoc`（唯一解析器，绝不抛错）+ `emptyMemoryDoc` + `pruneMemoryDocForClear`（D13-B） |
| T2 | `storage/{types,memory,local}` 四方法 + 两 key | T1 | done | `getMemoryDoc` / `saveMemoryDoc` / `getMemoryMeta` / `saveMemoryMeta`；两 key 补进 `local.ts::ALL_KEYS`（否则 F4 的 `clearAll` 后记忆残留）；导出白名单**不含**记忆。**`storage/tauri.ts` 零改动**（记忆由 `LocalStorageAdapter` 基类承载） |
| T5 | `memory-doc-merge.ts`（承重墙，刻意提前） | T1 | done | 五态判定 + 5 条结构性护栏；**实施期修 2 处**（见下 D1、D2） |
| T3 | `memory-signals.ts` | T1 | done | 六源并发读；`now` / `chapterCount` 由调用方注入（本模块不取 `Date.now()`） |
| T4 | `memory-facts.ts`（通道 A） | T3 | done | 四条派生规则各自独立判门槛；**实施期修 1 处**（D4 cadence 窗口并列取点） |
| T6 | `memory-service.ts` | T2,T4,T5 | done | 唯一读写入口；**成对落库**（doc + meta）；**实施期修 1 处**（D3 `restoreDismissed`） |
| T9 | `ai/learner-context.ts` 记忆块 | T1 | done | `buildMemoryContextBlock`（手写行排前、带类别前缀、≤600 字、防注入）；既有 `buildLearnerContextBlock` **一字未改** |
| T10 | 三条管道 `memory?` | T9 | done | 尾部可选参数 → **不传时提示词逐字节不变**（TC-UC12-05/06/07 零回归硬断言）；`ai/capability.ts` 4 处刻意不动 |
| T11 | 三个调用侧注入 | T2,T10 | done | `paper-flow` / `chapter-qa-service` / `restatement-service`；空数组时不带键（`...(memory.length > 0 ? { memory } : {})`） |
| T7 | `ai/memory-pipeline.ts` | T1 | done | 尺寸常量**从 `domain` 引入**（不重写 → 两把尺子）；`parseMemoryDraft` 四层过滤；**实施期修 1 处**（D5 黑名单「岁」） |
| T8 | `memory-samples.ts` + `memory-import.ts` | T6,T7 | done | 掩码 → 时间倒序 → 批内去重 → 裁剪；`runMemoryAi` **零写入**（连 `store` 参数都没有 → 结构性成立） |
| T12 | `useLoopStore` 六个动作 | T2,T6 | done | 六动作全部「委托服务层 → **回读** syncMemory」（不拼装 → 不实现第二遍合并）；一律**不调 `refresh()`**（D2） |
| T13 | UI 五件套 | T5,T6,T8,T12 | done | `MemoryPage` / `MemoryDocView` / `MemoryDocEditor` / `MemoryDiffNotice` / `MemoryAiDialog` + `memory-texts.ts`（i18n→服务层契约的单一映射）。**实施期修 1 处**（D6 前缀尾随空格） |
| T14 | 路由 + 导航项 + `/learner` 入口卡 | T13 | done | `App.tsx` 加 `<Route path="memory">`；`nav-items.ts` 加 `BrainCircuit` 项（`NavKey` 类型约束保证 i18n 先到位）；`LearnerPage` 两张同形态入口卡 |
| T15 | i18n 双语 | T13 | done | `nav.memory` + `learner.memoryEntry*` + `memory.*` 整命名空间（含**会写进用户文档**的 `headings` / `intro` / `manualHeading` 与通道 A 句子模板）；**实施期修 1 处**（D7 `emptyNeed` 泛化 + 2 个标签键） |
| T16 | `tests/learner-memory.test.ts` + 脚本 | T4~T8,T10 | done | **59/59 passed**（§12 全部用例 + §11 硬断言）；`test:memory` 串入 `test:library` |
| T17 | 零回归 + 不变式硬断言 | T10,T11 | done | 见「验证录像」；零回归用 `git worktree` 取 HEAD 黄金快照逐字节比对 |
| T18 | 磁盘镜像（Rust + 薄封装 + 页头按钮） | T13 | done | `memory_doc.rs` 4 条命令（无任何前端传入的路径/文件名 → 穿越面**结构上不存在**）+ `desktop-memory-doc.ts` + 页头三按钮；`cargo test --lib` **55 passed**（含新增 5 例） |
| T19 | 文档收口（方案/README/roadmap/本节） | T17 | done | 方案置「已实施」+ §2.1 补「实施口径」列 + 3 处实施更正；README 双语 `[x]` 36 · `[ ]` 10（实测）+ 顶部统计行手工同步；roadmap **后补 §F9**（原八候选无此 feature） |
| **D13-B** | 清库时保留用户手写与改过的行（记忆侧清理入口） | T5 | done | `pruneMemoryDocForClear`：系统原文未动 = 可再生（清掉）、改过 / 手写 = 不可再生（保留）；`clearAll` 先裁剪再走父类，**失败不降级** |

## 实施期发现

### A. 真实缺陷（源码层级，已修）

| # | 缺陷 | 位置 | 后果（若不修） | 修复 |
|---|------|------|----------------|------|
| D1 | 当前文本 === `lastWritten` 但 generated 文本**未变**时仍重写行并计 `updated` | `memory-doc-merge.ts` | 每次打开 `/memory` 都报「已更新 N 条」且用户看到的内容一字未变 → 报告失真 + 每开页写一次 localStorage（违背 TC-UC02-08 的 `updated === 0`） | 文本相同时既不重写也不计数；**顺带好处**：用户把列表符号 `-` 改成 `*` 不会被系统改回去 |
| D2 | 「文档里没有该键」的两种成因混为一谈 | `memory-doc-merge.ts` | 用户**只删了行尾标记**（降级为手写行）被误判成「删掉了整行」→ 用户看到「我没删它，它却再也不更新了」（TC-UC03-02 / TC-UC04-01） | 建索引时收集 `manualTexts`（无键行文本集合）：句文本仍在文档里 ⇒ 当**新条目**追加；确实找不到 ⇒ 才进 `dismissed` |
| D3 | `restoreDismissed` 只清 `dismissed`、未清 `lastWritten` | `memory-service.ts` | 清除墓碑后，「文档里没有该行 + `lastWritten` 里还有该键」正是合并器判定「用户删掉了」的形态 → 下一轮立刻重新葬回，按钮看起来**毫无作用**（违背 TC-UC04-03） | 同时 `delete lastWritten[dismissed 各 key]`（该键变回「全新条目」）；`useSystemVersion` 的两种入口（行在 / 行已删）分开处理 `lastWritten` |
| D4 | `deriveCadence` 众数并列时取错窗口 | `memory-facts.ts` | 事件集中在 22 点时得出 `20:00–23:00` 而正确是 `22:00–01:00`（跨零点窗口）→ 页面上一条**明显错误**的自我描述，且它还会进提示词 | 3 小时窗口并列时优先取「起点 = 峰值小时」的窗口；峰值小时并列取最早者（TC-UC02-01） |
| D5 | `forbiddenTopics` 黑名单缺单字「岁」 | `ai/memory-pipeline.ts` | 模型写「今年 35 岁」（不含「年龄」二字）绕过黑名单 → 把**可精确计算且会过期**的年龄写进长期记忆（TC-UC06-04） | 黑名单补单字「岁」 |
| D6 | 「最后整理」前缀多一个尾随空格 | `MemoryAiDialog.tsx`（页面侧注入） | 弹窗落库产出的行是「最后整理： 2026-09-17 09:12」，与自动整理路径的「最后整理：2026-09-17 09:12」差一个空格 → 用户改一次就可见的裂缝 | 前缀收进 `memory-texts.ts::lastMergedPrefixOf`（`trim()`，单一来源）；新增测试断言两种语言都无尾随空格 |
| D7 | 空态「还差什么」只能显示一行、且阈值不能复用 | `i18n` `emptyNeed` | 无法表达 §7.3 要求的**两行量化引导**（学习记录 / 笔记·复述）；若在页面里重写阈值常量就是「两把尺子」（页头显示 8 天而门槛按 7 天判，用户无法理解为何不达标） | `emptyNeed(label, need, current)` 泛化 + `needLabelEvidence` / `needLabelSamples`；`spanDays` 从 `memory-facts` 导出给页头复用 |

### B. 口径偏差（方案 → 实施，已记录理由）

| # | 偏差 | 理由 |
|---|------|------|
| P1 | **UC-11「自动发现磁盘文件被外部改动」未实现** | 它需要文件 mtime，而 §8.20 的四条命令契约里**没有** mtime（`memory_doc_read` 按契约仅返回正文，且文件不存在须返回 `Ok("")`）。本轮实现为**用户显式「从文件载入」**（两次点击 + 明确告知会覆盖 App 内的行）。若要自动探测，需新增第 5 条命令或让 `read` 返回 `(正文, mtime)` —— **待确认后再做**，且不写 `meta.lastSavedAt`（其唯一消费者就是这个未实现的探测，写入即死数据） |
| P2 | §5.1 说「零变化不显示动作条」，而 §8.19 的键表里有 `none` | 取「**显示** `reportNone`」：用户重进页面需要知道系统跑过了；只显示一张永远静默的页头更让人困惑。`dismissedNow` / `trimmed` **没有独立文案**（T15 把 `report` 折成单函数时丢失），本轮只让它们参与「是否有变化」的判断，数字由折叠区的计数承担 —— 若要逐项文字，需补两个键 |
| P3 | §8.15 伪代码里的 `MemoryEmptyCard` / `ModeToggle` / `UsageNote` / `DismissedFold` / `ClearAllButton` 未拆成独立组件 | 实测 `MemoryPage.tsx` **490 行**（`wc -l`），**低于 700 行上限**（`rules/code-structure-and-dependencies`），且这些片段各自只出现一次 → 拆出去只会增加跨文件跳转。「同一模式跨 ≥3 个文件重复才必抽」的判据未命中。⚠️ 它是本 feature 最大的文件，后续若继续加功能（如 UC-11 自动探测）需重新评估 |
| P4 | §7.3 空态第二条门槛写「笔记 / 复述 ≥ 5 条」 | 实测门槛是 `MEMORY_AI_MIN_SAMPLES = 3`（笔记+复述合计）。**按代码取 3**（文档是示意值）；页头两行门槛一律从 `MEMORY_FACT_MIN_SAMPLES` / `MEMORY_AI_MIN_SAMPLES` 取，不写字面量 |
| P5 | `MemoryDocView` 未用 `react-markdown`，全自绘 | 徽标必须贴在**行**上，markdown 渲染后原文行结构已丢失。自绘覆盖标题 / 抬头引用块 / 列表行 / 段落四类（满足 §7.1 观感），且**不需要**新依赖 |
| P6 | `LastMergedPrefix` 的 i18n 取值经 `trim()` 归一 | 见 D6 —— 这是「三处拼装漂移」的根治，不是风格偏好 |

## 验证录像（命令与结果）

| 命令 | 结果 |
|------|------|
| `npm run typecheck` | **仅 3 条既存债**（`settings/AIModelsSection.tsx` banner* 未使用），零新增 error |
| `npm run test:memory` | **59/59 passed**（§12 全部用例 + §11 硬断言 + T13 前缀口径） |
| `npm run test:library` | exit=0（含 `test:memory`，末位 `test:portability`） |
| `npm run test:rag` / `test:ai` / `test:graph` / `test:i18n` / `test:progress` | 全 exit=0 |
| `npm run test:chunk` / `test:retrieval` / `test:embed` / `test:render` / `test:storage` / `test:flow` / `test:prereq` / `test:aitask` | 全 exit=0 |
| `~/.cargo/bin/cargo test --lib`（`src-tauri/`） | **55 passed; 0 failed**（含新增 `memory_doc::tests` 5 例） |
| `git worktree add /tmp/plos-head HEAD` 黄金快照逐字节比对 | 三条管道**不传记忆**时提示词逐字节不变；`hashId` / `annotationId` / `capabilityItemId` / `deriveChapterCards` 的 id 全部未变（TC-UC12-02/03/05/06/07） |
| README 计数实测 | EN `[x]` 36 / `[ ]` 10、`###` 29；ZH 同值；顶部统计行手工同步为 36/10 |
| 链路核查（§11.3-5） | `getMemoryDoc` → `memory-service`(3) + `LearnerPage`；`buildMemoryContextBlock` → `pipelines` / `chapter-qa` / `restatement`；`memoryDiffs` → `MemoryPage`；`loadMemoryEntries` → 三个调用侧 |

## 未做 / 待确认

| 项 | 说明 |
|---|---|
| UC-11 自动探测外部改动 | 见 P1；需先确认是否扩展 Rust 命令契约 |
| `report` 的 `dismissedNow` / `trimmed` 独立文案 | 见 P2；需补 2 个 i18n 键 |
| §13.2 R12「`MemoryPage` 接近 700 行」 | 实测 **490 行**，未触及上限，无需再拆 |
