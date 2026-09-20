# 学习者记忆（F9）实施 runbook

> **状态：✅ 已完成（2026-09-18）；补充轮 ✅ 已完成（2026-09-20，T20/T21）**。
> 任务定义与验收口径的唯一真源：
> `docs/learner-memory-design-2026-09.md`（§9 任务清单 / §10 实施步骤 / §11 通过标准 / §12 测试用例）。
> 本文只记录**执行状态、outcome 与实施期发现**，不复制方案内容。
>
> **第一轮实施口径**：用户在 Agent Mode 下指示「按照推荐方案实施」→
> **D5–D12 全部按方案推荐档落地**（D5-A 双通道 / D6-A 手动触发 / D7-A 声明优先 /
> D8′-A 两个新 key / D9-A 固定 6 类 / D10-A 三处注入 / D11-A 否决回传 + 代码层过滤 /
> D12-A 落盘 `.md`），**D13 亦按推荐档 B**（清库时清系统条目、保留用户手写与改过的行）。
>
> **补充轮口径（2026-09-20）**：用户指示「实现未作的 runbook」→ 把下表「未做 / 待确认」里的
> 两项补上：**T20 = UC-11 磁盘外部改动探测**、**T21 = 页头动作报告逐项文案**。
> 两项都不改算法与护栏，只补能力与文案。
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
| **T20** | **UC-11 磁盘外部改动探测**（补 P1） | T18 | done | Rust **第 5 条只读命令** `memory_doc_mtime`（`Ok(None)` = 无副本）+ `desktop-memory-doc.ts::memoryDocMtime()` + `memory-service.ts::{markFileSaved, externalChangeAt}` + store 第七动作 `markMemoryFileSaved` + 页头可关闭提示（含「忽略」，只对本次改动静默）；**不改** `memory_doc_read` 的返回形态（见下 P7 说明）；`cargo test --lib` **57 passed** |
| **T21** | **页头动作报告逐项文案**（补 P2） | T13 | done | 新增 `reportDismissedNow(n)` / `reportTrimmed(n)`（中英）；选取规则收进 `memory-texts.ts::reportLinesOf` → **只列真正发生过的动作**（「更新 0 条」不再可能被打印）；`report` 主句同步改为只列非零项 |
| **D13-B** | 清库时保留用户手写与改过的行（记忆侧清理入口） | T5 | done | `pruneMemoryDocForClear`：系统原文未动 = 可再生（清掉）、改过 / 手写 = 不可再生（保留）；`clearAll` 先裁剪再走父类，**失败不降级** |

## 实施期发现

### A. 真实缺陷与设计坑（已处理）

> D1–D7 是**源码层级的真实缺陷**（靠单测逼出来，已修）；D8 / D9 是补充轮**写新代码时主动避开的坑**
> （不是「先错后修」，但同样属于「不处理就会被用户看见」的那一类）—— 一并留档，避免后人重蹈。

| # | 缺陷 | 位置 | 后果（若不修） | 修复 |
|---|------|------|----------------|------|
| D1 | 当前文本 === `lastWritten` 但 generated 文本**未变**时仍重写行并计 `updated` | `memory-doc-merge.ts` | 每次打开 `/memory` 都报「已更新 N 条」且用户看到的内容一字未变 → 报告失真 + 每开页写一次 localStorage（违背 TC-UC02-08 的 `updated === 0`） | 文本相同时既不重写也不计数；**顺带好处**：用户把列表符号 `-` 改成 `*` 不会被系统改回去 |
| D2 | 「文档里没有该键」的两种成因混为一谈 | `memory-doc-merge.ts` | 用户**只删了行尾标记**（降级为手写行）被误判成「删掉了整行」→ 用户看到「我没删它，它却再也不更新了」（TC-UC03-02 / TC-UC04-01） | 建索引时收集 `manualTexts`（无键行文本集合）：句文本仍在文档里 ⇒ 当**新条目**追加；确实找不到 ⇒ 才进 `dismissed` |
| D3 | `restoreDismissed` 只清 `dismissed`、未清 `lastWritten` | `memory-service.ts` | 清除墓碑后，「文档里没有该行 + `lastWritten` 里还有该键」正是合并器判定「用户删掉了」的形态 → 下一轮立刻重新葬回，按钮看起来**毫无作用**（违背 TC-UC04-03） | 同时 `delete lastWritten[dismissed 各 key]`（该键变回「全新条目」）；`useSystemVersion` 的两种入口（行在 / 行已删）分开处理 `lastWritten` |
| D4 | `deriveCadence` 众数并列时取错窗口 | `memory-facts.ts` | 事件集中在 22 点时得出 `20:00–23:00` 而正确是 `22:00–01:00`（跨零点窗口）→ 页面上一条**明显错误**的自我描述，且它还会进提示词 | 3 小时窗口并列时优先取「起点 = 峰值小时」的窗口；峰值小时并列取最早者（TC-UC02-01） |
| D5 | `forbiddenTopics` 黑名单缺单字「岁」 | `ai/memory-pipeline.ts` | 模型写「今年 35 岁」（不含「年龄」二字）绕过黑名单 → 把**可精确计算且会过期**的年龄写进长期记忆（TC-UC06-04） | 黑名单补单字「岁」 |
| D6 | 「最后整理」前缀多一个尾随空格 | `MemoryAiDialog.tsx`（页面侧注入） | 弹窗落库产出的行是「最后整理： 2026-09-17 09:12」，与自动整理路径的「最后整理：2026-09-17 09:12」差一个空格 → 用户改一次就可见的裂缝 | 前缀收进 `memory-texts.ts::lastMergedPrefixOf`（`trim()`，单一来源）；新增测试断言两种语言都无尾随空格 |
| D7 | 空态「还差什么」只能显示一行、且阈值不能复用 | `i18n` `emptyNeed` | 无法表达 §7.3 要求的**两行量化引导**（学习记录 / 笔记·复述）；若在页面里重写阈值常量就是「两把尺子」（页头显示 8 天而门槛按 7 天判，用户无法理解为何不达标） | `emptyNeed(label, need, current)` 泛化 + `needLabelEvidence` / `needLabelSamples`；`spanDays` 从 `memory-facts` 导出给页头复用 |
| D8 | 基线若用**本地时钟**写，刚保存完就可能立刻误报「外部改动」 | `MemoryPage.saveToFile` / `loadFromFile`（T20，写新代码时主动避开） | 文件系统时间戳与 `Date.now()` 有亚秒级偏差（且两者可能分属不同时间源）→ 用户点完「保存到文件」，下次打开页面就弹一条**凭空的**提示。一次误报就足以让用户永久忽略这个提示 —— 而它正是本功能唯一的用处 | 基线取**磁盘 mtime**（`memoryDocMtime() ?? Date.now()`，fallback 只兜住读不到 mtime 的降级路径）；判定要求**严格大于**（相等 = 我们自己刚写的那份） |
| D9 | 动作报告会把零项一并打印（「更新 0 条 · 新增 0 条 · 保留你改写的 1 条」） | `i18n` `report`（T21） | 用户每开一次页面就读到一串零 —— 「零」是噪声，它掩盖了真正发生的那一件事 | `report` 与选取规则一并改为**只列非零项**；「殡葬 / 满额淘汰」两类动作各自成句（`reportDismissedNow` / `reportTrimmed`）；规则收进 `memory-texts.ts::reportLinesOf` 以便单测（页面是 `.tsx`，strip-types 测不了） |

### B. 口径偏差（方案 → 实施，已记录理由）

| # | 偏差 | 理由 |
|---|------|------|
| P1 | **UC-11「自动发现磁盘文件被外部改动」** | ✅ **已补齐（T20，2026-09-20）**。第一轮的偏差是：它需要文件 mtime，而 §8.20 的四条命令契约里没有。补充轮选择**新增第 5 条只读命令** `memory_doc_mtime` 而**不是**让 `read` 返回 `(正文, mtime)` —— 理由有二：① `read` 的「不存在 → `Ok("")`」契约由 TC-UC11-02 锁死，改形态会迫使既有调用方全改；② **两种失败语义相反**：探测失败应当静默降级（少一条提示），而 `read` 失败是要让用户看见的。同时新写 `meta.lastSavedAt` 作为**基线**（只在用户落盘成功后写下；无基线时**不猜**，故首次打开不会凭空提示） |
| P2 | §5.1 说「零变化不显示动作条」，而 §8.19 的键表里有 `none` | 取「**显示** `reportNone`」：用户重进页面需要知道系统跑过了；只显示一张永远静默的页头更让人困惑。✅ **`dismissedNow` / `trimmed` 的独立文案已补齐（T21，2026-09-20）**：两者与「更新 / 新增」不同类（殡葬 vs 满额淘汰），故各自成句；选取规则收进 `memory-texts.ts::reportLinesOf`（可单测），页面只渲染 |
| P3 | §8.15 伪代码里的 `MemoryEmptyCard` / `ModeToggle` / `UsageNote` / `DismissedFold` / `ClearAllButton` 未拆成独立组件 | 实测 `MemoryPage.tsx` **584 行**（补充轮后 `wc -l`），**低于 700 行上限**（`rules/code-structure-and-dependencies`），且这些片段各自只出现一次 → 拆出去只会增加跨文件跳转。「同一模式跨 ≥3 个文件重复才必抽」的判据未命中 |
| P4 | §7.3 空态第二条门槛写「笔记 / 复述 ≥ 5 条」 | 实测门槛是 `MEMORY_AI_MIN_SAMPLES = 3`（笔记+复述合计）。**按代码取 3**（文档是示意值）；页头两行门槛一律从 `MEMORY_FACT_MIN_SAMPLES` / `MEMORY_AI_MIN_SAMPLES` 取，不写字面量 |
| P5 | `MemoryDocView` 未用 `react-markdown`，全自绘 | 徽标必须贴在**行**上，markdown 渲染后原文行结构已丢失。自绘覆盖标题 / 抬头引用块 / 列表行 / 段落四类（满足 §7.1 观感），且**不需要**新依赖 |
| P6 | `LastMergedPrefix` 的 i18n 取值经 `trim()` 归一 | 见 D6 —— 这是「三处拼装漂移」的根治，不是风格偏好 |
| P7 | §4.3.8 说写盘是「每次整理/编辑落库之后（防抖 1s）」，实施为**用户显式点「保存到文件」** | **刻意不改回自动**（2026-09-20 定稿并写入方案 §4.3.8 的实施口径更正）。自动写盘会让 App 在用户**用外部编辑器改完之后**（回到页面 → 自动整理 → 自动写盘）**静默覆盖**那些改动 —— 本 feature 的核心承诺是「用户写下的字不被覆盖」，这条承诺在**文件这一层同样成立**，所以两个方向都交给用户显式触发。代价（磁盘副本可能落后于 App）是**可见**的：mtime 落后于基线时**不**提示，如实代表「磁盘上没有更新」 |

## 验证录像（命令与结果）

| 命令 | 结果 |
|------|------|
| `npm run typecheck` | **仅 3 条既存债**（`settings/AIModelsSection.tsx` banner* 未使用），零新增 error（补充轮后复测一致） |
| `npm run test:memory` | **64/64 passed**（第一轮 59 + 补充轮 5：TC-UC11-03/04/05/06 与 T21；§12 全部用例 + §11 硬断言 + T13 前缀口径） |
| `npm run test:library` | exit=0（含 `test:memory`，末位 `test:portability`） |
| `npm run test:rag` / `test:ai` / `test:graph` / `test:i18n` / `test:progress` | 全 exit=0（`test:i18n` 覆盖新增 6 键的中英成对性） |
| `npm run test:chunk` / `test:retrieval` / `test:embed` / `test:render` / `test:storage` / `test:flow` / `test:prereq` / `test:aitask` | 全 exit=0 |
| `~/.cargo/bin/cargo test --lib`（`src-tauri/`） | **57 passed; 0 failed**（第一轮 55 + 补充轮 2：`mtime_of_missing_file_is_none` / `mtime_exists_after_save_and_never_moves_backwards`） |
| `git worktree add /tmp/plos-head HEAD` 黄金快照逐字节比对 | 三条管道**不传记忆**时提示词逐字节不变；`hashId` / `annotationId` / `capabilityItemId` / `deriveChapterCards` 的 id 全部未变（TC-UC12-02/03/05/06/07） |
| README 计数实测 | EN `[x]` 36 / `[ ]` 10、`###` 29；ZH 同值；顶部统计行手工同步为 36/10（补充轮不动 README：非新 feature） |
| 链路核查（§11.3-5） | 第一轮：`getMemoryDoc` → `memory-service`(3) + `LearnerPage`；`buildMemoryContextBlock` → `pipelines` / `chapter-qa` / `restatement`；`memoryDiffs` → `MemoryPage`；`loadMemoryEntries` → 三个调用侧。**补充轮**：`memoryDocMtime` → `MemoryPage`（探测 + 两次基线对齐）；`markFileSaved` → `useLoopStore::markMemoryFileSaved` → `MemoryPage`；`externalChangeAt` → `MemoryPage`；`reportLinesOf` → `MemoryPage`（全仓各只有这一处调用 —— 无死代码） |

## 未做 / 待确认

> **2026-09-20 补充轮后**：原两项（UC-11 自动探测、报告逐项文案）**均已落地**（T20 / T21）。

| 项 | 说明 |
|---|---|
| 「忽略」不跨会话 | 用户点「忽略」后，**刷新页面会重新提示**同一个改动（`ignoredAhead` 是页面 state，没有落库）。方案与 UC-11 都只要求「可关闭」，未要求持久化；要持久化需在 meta 上加一个 `ignoredMtime` 字段 —— **待确认后再做**（它会让 meta 多一条只服务 UI 的字段，收益不明显） |
| `fileStale(at)` 键（键表里的初稿项） | 实施未采用：**磁盘落后于 App 时不给提示**。理由见 P7 —— 磁盘副本落后是「常态且无害」（用户没点保存而已），提示它只会制造噪声。若将来做自动写盘，这个键才有意义 |
| §13.2 R12「`MemoryPage` 接近 700 行」 | 补充轮后 **584 行**（`wc -l` 实测），仍低于 700；再往上加功能前需重新评估 |
