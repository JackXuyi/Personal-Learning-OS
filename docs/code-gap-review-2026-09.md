# PLOS 代码缺口 Review（2026-09-24）

> 基准：`main@d6b3bc5`（工作树干净）· 口径：**只列实测成立的缺口**，文档里的「未做 / 未接线」结论一律先验证再采信
> 方法：三路并行实测（① 未接线与孤儿符号 ② 分层与代码质量 ③ 文档-代码一致性）+ 全测试套件 + `npm run typecheck`
> 判据：判断「是否接线」= **找 `src/features` / `src/stores` 消费方**，而非找定义处（仓库红线）

---

## 零、结论先行

1. **主链路无大洞，测试健康。** 48 个测试文件全部绿（`test:library` ALL PASS + 19 个独立组全绿，54s）；导入 → 切分 → 学 → 测 → 判 → 报告 → 复习全闭环。
2. **缺口集中在四类，都不是「主链路漏了一段」**：
   - **A 已实现但零接线**（14 个符号 + 1 个孤儿文件 + 1 个整模块；含 D3 修复后**连带产生**的 2 个）—— 有实现、有单测、无人用 → ✅ **2026-09-24 清完（第 2 批，见 §二）**
   - **B 同族越层**（`stores → features`、`engine → i18n`、`ai → engine`）—— 正式规则的三条之外，实际存在的反向依赖 → ✅ **2026-09-24 收口（第 3 批，见 §三）**；其中 `ai → engine` 是同层互换，**刻意保留**
   - **C 重复实现 ≥3 处**（7 组）—— 违反「同一逻辑跨 ≥3 处必抽取」→ 第 4 批
   - **D 文档与代码相反**（3 处）—— 会误导后来者重复造轮子 / 误判门禁状态 → ✅ **2026-09-24 收口（第 1 批，见 §一）**
3. **最该先动的是 D，不是 A —— ✅ 已于 2026-09-24 收口**（详见 §一）。死代码只是浪费，反向文档会**主动误导**：`tech-debt-closeout §6.1` 声称「无历史时未用 `profile.level` 定 band」，而代码早已用（且 roadmap 把它列为已实施）——两文档自相矛盾。**D1/D2 改文档、D3 改代码**（删死代码后 `typecheck` 归零，README 无需改动即成立）。
4. **8 项 README `[ ]` 功能缺口逐条实测，全部属实，无一项「已悄悄做完」。**
5. **A 类已于 2026-09-24 清完（第 2 批）**：删 14 个零消费导出 + `assessment-engine` / `knowledge-engine` **两个整模块** + `separator.tsx` + 一组从未接线的「历史 provider 兜底标签」+ **33 个孤儿 i18n 键**。其中 `canStartCapabilityRun` 走**接线**而非删除（3 处内联判据收归一个门禁 ⇒ 消「两把尺子」）。门禁：`typecheck` exit 0 · 48/48 套件绿 · `npm run build` exit 0。
   ⚠️ **本轮实测推翻了原报告的一处计数**：`settings.models` 下的孤儿 i18n 键不是 8 个而是 **33 个**（`banner` 8 + 早期设置页重构遗留的「运行状态 / 当前配置」卡片文案 25，含整个 `kv{}` 子对象）—— 见 §二 末「漏报更正」。

---

## 一、🔴 高：文档与代码相反 —— ✅ **已收口（2026-09-24）**

> 处置：D1/D2 改文档（保留下方判断依据，只改被推翻的事实）；D3 改代码 —— 删掉死代码后 `typecheck` **归零**，README「必须 0 错误」**无需改动即成立**（文档本来是对的，是现实偏离了）。
> 验证：`npm run typecheck` **exit 0**（0 错误）· `npm run test:i18n` exit 0。

| # | 文档断言 | 代码实测 | 处置 |
|---|----------|----------|------|
| D1 ✅ | `docs/tech-debt-closeout-2026-09.md:135-137`：「`bandOfMastery` …… **无历史时也「未」用 `profile.level` 定 band**」 | **已用**。`engine/profile-band.ts:61-67::bandForChapter()` 无证据时按 `bandForLevel(profile?.level)` 定带；出卷主干全走它（`quiz-engine.ts:234/258/278/335`）。`roadmap §F1` 亦列为**已实施** ⇒ 两文档自相矛盾，代码站 roadmap | 删错误句 + 加校正注（保留「本体仍只看 `mastery`」那一半）；tech-debt 变更记录 v1.1 |
| D2 ✅ | `docs/roadmap-next-features-plan-2026-09.md` §F10：「`FORBIDDEN_KEYS` **并在导出前拒绝**」 | `pack-format.ts:128` 的 `FORBIDDEN_KEYS` **零生产消费**（仅单测引用）；导出靠**白名单** `PACK_FIELD_SPECS` 结构性排除 | 改写承重墙表该格为「白名单结构性排除 + 黑名单是单测泄漏断言」；roadmap 变更记录加行 |
| D3 ✅ | `README.zh-CN.md:329 / :498`：「`npm run typecheck` …… **必须 0 错误**」 | 实际 **3 条 TS6133**：`AIModelsSection.tsx:55-71` 一段**无人消费的 Banner 文案计算**（注释自称「Active Banner 文案」，`return` 里从未渲染）⇒ `npm run build` **直接失败** | 删该死代码段 + 连带删未使用的 `labelOfLocalModel`/`labelOfProvider` import 与 `providerReady` 解构 ⇒ typecheck 归零。**README 一字未改** |

**D3 的连带发现（新登记）**：删除该段后，`ai/presets.ts::labelOfLocalModel` / `labelOfProvider` 在 `src/**` 内变为**零消费导出**（仅 `presets.ts` 定义处）；`i18n/messages/{zh,en}.ts` 的 `settings.models.banner` 整块（`zh.ts:433-445`，8 键）变为**孤儿 i18n 键**。二者均不影响任何门禁，未在本次一并删除（见 §七 第 2 批）。

**行号漂移（符号仍在，引用已过期）**：`roadmap §一` 的 `LibraryPage:131`→实际 `:145`、`quiz-engine.ts:175 createPaper`→`:181`、`:36 bandOfMastery`→`:37`；`roadmap §附`「7 写 **5 读**」偏低（漏 `export-service.ts:120`、`import-service.ts:255/271`）；`tech-debt §1.1` `learner-model.ts:117/191`→`:115/189`、`§1.2` `loop.ts:283/167`→`:248/160`。

---

## 二、🟠 中：已实现但零接线 / 死代码 —— ✅ **已清完（2026-09-24，第 2 批）**

> 处置原则：**真死的一律删**（含连带孤儿与孤儿 i18n 键），唯一例外 `canStartCapabilityRun` 走**接线**（见 2.3）。
> 验证：`npm run typecheck` **exit 0** · **48/48 套件绿** · `npm run build` **exit 0** · `test:i18n` exit 0。

### 2.1 真死（全仓零引用，含自身文件内部）—— ✅ 已删

| 符号 | 原位置 | 备注 / 处置 |
|---|---|---|
| `graphEngine` + `GraphEngine` 接口 | `engine/graph-engine.ts:28 / :16` | 同文件 `subgraphOf` / `replaceChapterConcepts` **有消费**故保留；文件头已由「知识图谱引擎」改为「章概念子图工具」 |
| `createKnowledgeEngine` + `KnowledgeEngine` | `engine/knowledge-engine.ts:19 / :13` | **整文件删除**（仅经 barrel `export *`；文件头自称「V1 契约骨架仅为兼容旧桶导出」）+ 摘掉 `engine/index.ts:9` barrel 行 |
| `averageMastery` | `engine/mastery-engine.ts:34` | 同文件 `masteryOfUnit` 才被 planner 用（保留） |
| `CAPABILITY_EVIDENCE_PREVIEW_CHARS` | `engine/capability-engine.ts:51` | — |
| `QUIZ_QUOTA_PREVIEW` | `engine/quiz-engine.ts:366` | 题量预览已改由 i18n `m.quiz.hint*` 提供；连带 `PaperMode` 变该文件未用导入（同批摘除） |
| `isLocalEmbeddingAvailable` | `ai/embedding.ts:83` | 就绪判断实际走 `isEmbeddingModelReady`（`:128`） |
| `embedDefaultModel` | `ai/builtin.ts:136` | ⚠️ 它是 Rust IPC 命令 `embed_default_model` 的 TS 镜像。**本轮只删 TS 侧**；Rust 侧（`llm/commands.rs:324` + `lib.rs:119` 注册 + `tests/embedding-local.test.ts:286` 断言）**保留不动** ⇒ 该命令转入「前端零调用方」，已登记（§2.5） |
| `CHAPTER_FLOW` · `asMasterySubject` | `domain/chapter.ts:31 / :88` | 状态机常量仅被文档引用。**流转说明保留**——改挂到 `ChapterStatus` 的 doc 上（删常量不丢知识） |
| `DEFAULT_GOAL` | `domain/goal.ts:37` | `business-logic-review-2026-09.md:123` 已点名「建议删除」，本轮兑现 |
| `SkillGap` · `LearningPlan`（类型） | `domain/plan.ts:22 / :43` | 无人使用（`ActionKind` / `NextAction` / `MASTERY_THRESHOLD` / `MASTERY_FLOOR` 均有消费，保留） |
| `QUIZ_TYPE_LABEL` | `domain/quiz.ts:60` | 已被 i18n `m.quiz.typeBadge`（`features/quiz/meta.ts:72`）取代 |
| `labelOfLocalModel` · `labelOfProvider` | `ai/presets.ts:67 / :50` | ✅ **D3 修复后新产生**的孤儿，本轮清。**连带** `presetOf` / `LEGACY_PROVIDER_LABELS` / `LOCAL_MODEL_LABELS`（三者只被它俩消费）+ 未用的 `ProviderKind` 导入一并删除；文件头「与 Active Banner 共用」「`labelOfProvider` 兜底展示」两句删掉（前者随 D3 失效，后者**从未接线**） |
| ~~`bannerTitle`/`bannerDesc`/`bannerTone`~~ | ~~`AIModelsSection.tsx:55-71`~~ | ✅ **已删（2026-09-24，D3 的根因）** |

### 2.2 整模块 / 整文件 —— ✅ 已清

| 项 | 位置 | 证据 / 处置 |
|---|---|---|
| **`assessment-engine` 整模块未接线** | `engine/assessment-engine.ts` | 仅经 `engine/index.ts:13` barrel `export *`；生产链路是 `createPaper` / `gradeAndApply`，从不 import 本引擎；**唯一消费者是 `tests/i18n-alignment.test.ts`** ⇒「测试在养死代码」。已**整模块删除** + 摘 barrel 行 + 删该测试的 import / `QUESTION` 常量 / 对应用例 + 删其专属 i18n 键 `engine.notAnswered` · `engine.pendingSubjective`（zh/en 成对） |
| **孤儿文件 `separator.tsx`** | `components/ui/separator.tsx` | `Separator` 全仓零 import（`DocActionsMenu` 用的是 `dropdown-menu.tsx::DropdownMenuSeparator`）。已删文件 + 同步 `skills/plos-ui-system/references/component-catalog.md` 的组件台账（活表，必须跟） |
| `extractKeyPointsWithAi` 已被替代 | `ai/pipelines.ts:565` | 生产走 `extractKeyPointsMapped`（`features/learn/analyze-service.ts:346`）；旧函数仅 `tests/library-keypoint.test.ts` 消费。已删函数（含章内分块兼容执行器整段）+ 该测试用例 + `offlineProvider` 假件与两个连带未用导入 |

### 2.3 「两把尺子」：引擎有门禁，UI 自己重算 —— ✅ **已接线（非删除）**

`canStartCapabilityRun`（`capability-engine.ts:239`）原为零消费，而同一门禁被**内联重算 3 处**：`features/goals/capability-service.ts:303,396`、`features/goals/CapabilityPage.tsx:319`。

**处置：接线为唯一门禁**（而非删掉它）—— 它的 doc 注释本就写着「UI 禁用态与服务层共用同一判据，避免两处口径漂移」，写出来就是为了共用，只是从没接上。3 处内联改为 `!canStartCapabilityRun(...)`，语义逐字等价（三方读的是同一个 `CAPABILITY_LIMITS.minItems`）。

⚠️ 接线暴露了原签名过窄：形参是 `readonly CapabilityItem[]`，而 `submitCapabilityRun` 复校的是 `run.items`（`CapabilityItemSnapshot[]`，是 `CapabilityItem` 的 `Pick` 子集，**不可互赋**）。该判据只关心条数 ⇒ 形参放宽为两者联合。

### 2.4 漏报更正：孤儿 i18n 键是 **33 个**，不是 8 个

原报告（§一「D3 的连带发现」）只登记了 `settings.models.banner` 的 **8 键**。本轮按「同一处不劈两半」实测，发现 `settings.models` 下还有**一整个早期设置页重构遗留的孤儿簇**（「运行状态 / 当前配置」卡片的文案，含整个 `kv{}` 子对象），同批清理：

`pageTitle` · `pageSubtitle` · `timeToday` · `banner{}`(8) · `aiStatus` · `savedPassed` · `savedFailed` · `noModel` · `heuristicAlways` · `runtime` · `runtimeHeuristic` · `runtimeCallable` · `runtimeMissingCfg` · `retesting` · `retestConnection` · `retestOk` · `keychainNote`(顶层) · `statusLegend` · `currentConfig` · `kv{}`(10) = **33 键**

消费面实测（`dst/` 之外全仓 Grep）：全部**零命中**；保留的只有 `savedOk`（`ApiModelsTab.tsx:229`）· `currentUse`（同文件 `:168`、`BuiltinModelsPanel.tsx:259`）· `tabLocal`/`tabApi`/`localHint`（`AIModelsSection.tsx:62-82`）· `api{}` · `builtin{}` · `importAssist{}`。
**安全网**：`Messages = typeof zh` ⇒ 删到仍在用的键 `tsc` 必报错；`test:i18n` 再锁 zh/en 结构对齐。两道门禁本轮皆绿。

### 2.5 单侧孤儿登记（本轮**刻意未清**）

| 项 | 位置 | 为什么没清 |
|---|---|---|
| Rust IPC `embed_default_model` | `src-tauri/src/llm/commands.rs:324` + `src-tauri/src/lib.rs:119` 注册 + `tests/embedding-local.test.ts:286` 断言 | 它的 TS 镜像 `ai/builtin.ts::embedDefaultModel` 已删 ⇒ **前端零调用方**。但清 Rust 侧要动 `src-tauri/**` + IPC 契约测试（`D5 Rust 侧命令已注册 embed_*` 是**正向断言**，删命令要同批改），超出「清 TS 死代码」的批次边界。**需单独一轮**，不要顺手删 |

> 同族提醒：删任何 `invoke("xxx")` 的 TS 封装前，先查 Rust 侧是否还有别的调用方，以及**契约测试是否在正向断言该命令已注册**。

`canStartCapabilityRun`（`capability-engine.ts:239`）零消费，而同一门禁被**内联重算 3 处**：`features/goals/capability-service.ts:303,396`、`features/goals/CapabilityPage.tsx:319`（`items.length < CAPABILITY_LIMITS.minItems`）。规则改动时必然漂移。

---

## 三、🟠 中：分层越界（同族反向依赖）—— ✅ **已收口（2026-09-24，第 3 批）**

> 处置文档：`docs/architecture-service-layer-design-2026-09.md`；执行台账：`docs/architecture-service-layer-runbook-2026-09.md`。
> 判据（可执行）：`npm run layer:check`（`scripts/layer-boundary-scan.mjs`，断言 A1–A4 + 值依赖图无环）。

规则 `layer-import-boundaries.mdc` 声明方向 `domain → engine/ai/storage → stores → services → features`。`engine/ai → features` 无违规（0 命中），第 3 批前存在下列**反向**依赖：

| 方向 | 位置 | 说明 | 处置 |
|---|---|---|---|
| **stores → features** | `stores/useLoopStore.ts:31-43` | **值导入** `features/memory/memory-service`（`applyAiEntries`/`clearMemoryDoc`/`loadMemory`…） | ✅ memory 四服务模块下沉 `src/services/memory/` |
| | `stores/useIndexStore.ts:12, 54-56` | 反向 import `features/learn/index-service`，**并靠 `await import()` 打断 ESM 环** —— 文件 `:4` 自己写着「stores 不得反向依赖 features」。⚠️ **且该手法实测无效**：`npm run build` 报 `[INEFFECTIVE_DYNAMIC_IMPORT]`（`index-service` 同时被 6 处静态 import）⇒ 既违反分层、又没起到分包作用，是纯负债 | ✅ **消环**：store 纯化（`refreshCoverage` → 纯 setter `setCoverage`，编排归服务）+ `index-service` 下沉；动态 import 归零 |
| **engine → i18n** | ~~`engine/assessment-engine.ts:24-25`~~（该模块第 2 批已删）· `engine/loop.ts:25-26` · `engine/learning-planner.ts:43-44` | 纯逻辑层 `import { zh }` 作默认文案表（`m: Messages = zh`）⇒ engine 输出与 UI 语言层耦合 | ✅ 删 4 处默认值，`m` 变必填；导入改 `import type { Messages } from "../i18n/types"`（运行时零依赖） |
| **ai → engine** | `ai/pipelines.ts:34-35`（**值导入** `applyChapterRefine`）· `ai/refine-batch.ts:18` | 同层横向耦合 | **刻意保留**（同层互换允许，实测无环） |

### 3.1 ⚠️ 规则盲区 —— 本次越界能长期存在的**根因**（✅ 已补）

`rules/code-structure-and-dependencies.mdc:37` 原文只禁「`domain/engine/ai/storage` 不得 import features」，`rules/layer-import-boundaries.mdc` 的表格也没有 `stores` 那一行 —— **`stores` 从不在禁止名单里**，而代码注释（`useIndexStore.ts:4`）与审计报告却按「违规」处理。⇒ 下一个人读规则会得出「这样写合规」的结论。

第 3 批把层序与两条禁令写进上述两份规则 + `AGENTS.md`，并落成可执行门禁 —— **只改代码不改规则，同一类问题必然复发**。

### 3.2 第 3 批**顺带发现**（新，2026-09-24 实测）

| 项 | 实测 | 处置 |
|---|---|---|
| `components → features` **4 条** | `CommandPalette.tsx:5 → features/units` · `:10 → features/learn/index-service` · `:11 → features/plan/chapter-action` · `AppShell.tsx:5 → features/learn/ImportModal` | 1 条随本批下沉**自动消除**（`:10` 现指 `services/`）；**余 3 条登记为门禁基线，不在本批范围** —— 修它们要动 UI 挂载结构（`AppShell`/`ImportModal`/`units`/`chapter-action` 的归属），与本批「纯结构重构、零 UI 变化」冲突，需单独方案 + UI 测试保护 |
| **2 组既存模块级环** | ① `engine/profile-band.ts ⇄ engine/quiz-engine.ts`（同层 Tier 1，属模块拆分问题）② `components/CommandPalette ⇄ components/layout/AppShell ⇄ features/learn/ImportModal`（Tier 3，UI 事件总线式互引） | 登记为门禁基线；**同属未排期债务** |

> ⚠️ 方案 §4.1 曾断言 A5「无环 ✅ 0」，实测为 **2 组**（方案期只做了逐行 import grep，**未做 SCC**）⇒ 已在方案「实现偏离记录」登记。基线机制口径：**检测全量、只禁新增** —— 存量不被伪装成绿的。

---

## 四、🟠 中：重复实现（同一逻辑 ≥3 处，违反「先抽取」）

| 组 | 处数 | 位置 |
|---|---|---|
| `shortDate` 逐字相同 | 3 | `features/learn/library/shared.ts:47`（**已 export**）· `ChapterReaderPage.tsx:619` · `reader/ChapterRestatementPanel.tsx:649` —— 后两处仍留私有副本 |
| AI 错误分类器（自认「照抄 / 同口径」） | 3 | `learn/chapter-qa-service.ts:176` · `learn/restatement-service.ts:271` · `goals/capability-service.ts:608` |
| `aliveRef` 卸载守卫 7 行 | 3 | `reader/ChapterQaPanel.tsx:51` · `reader/ChapterRestatementPanel.tsx:66` · `study/CardSession.tsx:65` |
| 分段 Tab 三元 className | 3（+2 相似） | `settings/AIModelsSection.tsx:86` · `settings/SettingsPage.tsx:273, 378` |
| 长 className 串 | 6 | `"rounded-xl border border-line bg-subtle/60 px-4 py-3"`：`ImportModal.tsx:481/494/529/599/647` + `library/dialogs.tsx:371`；另一串 `border-dashed border-line` 亦 6 处 |
| 弹窗 props 签名 | 4（同文件） | `library/dialogs.tsx:58/122/212/411` |
| storage 适配器 `import type` 巨块 | 3~4 | `storage/types.ts:11` · `local.ts:8` · `memory.ts:10` · `tauri.ts:26` |

---

## 五、🟡 低：门禁与规范

| 项 | 证据 | 说明 |
|---|---|---|
| 单文件 >700 行 | `i18n/messages/{en,zh}.ts`（2370/2301）· `storage/tauri.ts:1103` · `learn/ImportModal.tsx:835` · `data/portability/DataPortabilityCard.tsx:714` · `quiz/QuizReportPage.tsx:707` · `src-tauri/src/db/commands.rs:1266` · `db/models.rs:796` | 词典表属合理例外；其余 6 个（含 2 个 Rust）应拆 |
| i18n 硬编码（真上屏） | `goals/GoalFormPage.tsx:344`「（第 {c.order} 章）」· `home/HomePage.tsx:353-354`「{月}月{日}日」· `learn/library/dialogs.tsx:46-51` `FORMAT_OPTIONS` 中文标签（英文界面也显示中文） | `engineering-code-style.mdc` 要求 UI 文案一律走 i18n |
| i18n 硬编码（.ts 层，抛给 UI） | `learn/library-actions.ts:56/128/131`（`setError(err.message)` 直接上屏）· `services/learn/index-service.ts`（原 `features/learn/`）· `learn/analyze-service.ts` 多处 | 分类 enum 应交给 UI 映射（`analyze-service` 已带 `kind`，文案是否上屏**待复核**） |
| locale 脆弱匹配 | `learn/library/dialogs.tsx:295` `msg.includes("上限") \|\| msg.includes("limit")` | 对错误串做中文子串匹配 |
| 原生 `<select>` | `features/progress/ProgressPage.tsx:200-213` | `react.mdc` 要求走 `components/ui/select.tsx`；全仓唯一一处 |
| `@/` alias 空配 | `tsconfig.json:19-21` · `vite.config.ts:10-14` 声明了 alias，`src` 内 **0 次使用** | 可保留（shadcn 生成层豁免位），但属死配置 |
| 无效动态 import —— ✅ **第 3 批消除 1 处** | ~~`useIndexStore.ts:54`（`index-service`）~~ 已随 store 纯化归零 · 余 `features/profile/resume-import.ts`（`learn/import/pdf.ts`） | `npm run build` 报 `[INEFFECTIVE_DYNAMIC_IMPORT]`：目标模块同时被静态 import ⇒ 拆不出 chunk，动态写法只增复杂度。**余 1 处待第 4 批** |
| 单 chunk >500 kB | `npm run build` 警告（主 chunk 2.35 MB / gzip 718 kB） | 无代码分割，属性能优化项非缺口 |

---

## 六、功能缺口（README 8 项 `[ ]`，逐条实测）

**全部属实，无一项「悄悄做完」。**

| # | 条目 | 代码证据 | 结论 |
|---|------|----------|------|
| 1 | 扫描件 PDF OCR 兜底 | `features/learn/import/pdf.ts:14` 注释「扫描件抛 `PdfNoTextError`，**不做 OCR**」；全仓无 `ocr`/`tesseract` | 未实现 |
| 2 | EPUB 解析 | 仅类型占位：`domain/document.ts:12` 联合成员 `"epub"` + i18n 标签 + renderer 注释；无解析器，`ImportModal.tsx:144-149` `FORMAT_OPTIONS` 无 epub | 未实现（仅占位） |
| 3 | URL 抓取网页 | `ImportModal.tsx:147` 的 `web` 是**粘贴**格式；全仓唯一抓取是 `import/github.ts`（`:77` 限 `hostname === "github.com"`） | 未实现 |
| 4 | 手动把一章拆成两章 | `engine/chapter-edit-engine.ts` 仅 `renumberChapters`/`renameChapter`/`mergeChapterRange`/`reorderChapters`，**无 split** | 未实现 |
| 5 | 跨文档学习单元 / 学习路径（F7-c） | 无 `learningUnit`/`learningPath` 编组实体；`GoalDetailPage.tsx:424` 的「LEARNING PATH」是目标范围内章的**只读展示** | 未实现（仅只读视图） |
| 6 | 人工调整章节前置关系 | 前置边仅由 AI 概念图自动生成（`ai/concept-map-reduce.ts:73`）+ `domain/knowledge.ts:93` 自动抬升；`GraphView.tsx` 只渲染 | 未实现 |
| 7 | 跨文档概念图谱 | 唯一图谱页 `knowledge/ChapterGraphPage.tsx:26` 按章 `subgraphOf` 裁剪；全局图 `storage.getGraph()` 有数据但**无全局视图页** | 未实现 |
| 8 | 加密同步 | 全仓无 `encrypt`/`aes`/`crypto.subtle`/密文逻辑；无同步后端 | 未实现 |

---

## 七、建议处置顺序

```text
第 1 批 —— ✅ 已完成 2026-09-24
  D1 tech-debt §6.1 反向结论 → 删错误句 + 加校正注（该文档变更记录 v1.1）
  D2 roadmap §F10「导出前拒绝」措辞 → 改为「白名单结构性排除 + 黑名单是单测断言」
  D3 未改 README —— 改为删掉 AIModelsSection.tsx:55-71 的 Banner 死代码段
     ⇒ typecheck exit 0、npm run build 恢复；连带新孤儿见 §二 末两行

第 2 批 —— ✅ 已完成 2026-09-24
  2.1 14 个真死导出 + knowledge-engine / assessment-engine 两个整模块 + separator.tsx
       + 从未接线的 labelOf* 标签族 + 33 个孤儿 i18n 键（§2.4 更正了原报告的 8 键漏报）
  2.3 canStartCapabilityRun → 走【接线】为唯一门禁（消「两把尺子」，非删除）
  ⚠️ 唯一未同步处：Rust `embed_default_model` 命令（TS 镜像已删，Rust 侧保留）→ 见 §2.5

第 3 批 —— ✅ 已完成 2026-09-24
  方案 docs/architecture-service-layer-design-2026-09.md ｜ 台账 docs/architecture-service-layer-runbook-2026-09.md
  3.1 新建 src/services 层；memory 四模块 + index-service 下沉 ⇒ stores → features 归零
  3.2 消环：useIndexStore 纯化（refreshCoverage → 纯 setter setCoverage，编排归服务）⇒ 动态 import 归零
  3.3 engine 去 i18n 值依赖 + 删 4 处 `m: Messages = zh`（m 变必填）；5 个测试文件同批
  3.4 新增可执行门禁 `npm run layer:check`；同批补 rules ×2 + AGENTS.md
  ⚠️ 未纳入本批：components → features 余 3 条 · 2 组既存环（见 §3.2）
  ⚠️ 仍未迁：features/ 下其余 12 个 *-service.ts（方案 §3.1.3，按需另批）

第 4 批（抽取重复）
  shortDate / AI 错误分类器 / aliveRef —— 3 组均为逐字相同，抽取零语义风险
  ⤴ 另含 §五「无效动态 import」余 1 处（features/profile/resume-import.ts）

第 5 批（功能增量）
  F7-c 学习单元实体 · 章节拆分 · EPUB / URL 抓取 · OCR —— 均为 P2，按产品需要排
```

---

## 附：本轮实测方法

- 三路 `Explore` 子代理并行：未接线与孤儿（全仓符号引用表 + 文件入边图）· 分层与质量（Grep 逐条 + `wc -l` + 滚动窗口去重）· 文档一致性（逐条断言回代码 + 双语计数）
- 本地复核：`npm run typecheck`（**修复前** 3 条 TS6133 → **exit 0**）· **全部 48 个 `test:*` 套件绿**（第 2 批后重跑，`TOTAL_FAIL=0`）· `npm run build` **exit 0**
- 所有「零消费」结论均经全仓 Grep（含 `tests/`、`scripts/`、`src-tauri/`）复核；命中仅出现在定义处 / barrel `export *` / 文档时判为死代码
- ⚠️ **`npm run build` 在本机需要绕过沙箱**：沙箱的 `safe-delete` 守卫会拦截 `vite:prepare-out-dir` 清空 `dist/assets`（316 文件 > 阈值 50，`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）—— 这是**环境限制**，与代码无关（报错点在 `vite:prepare-out-dir`，此前 `5073 modules transformed` 已成功）。
- ⚠️ **本报告的「代码级」结论一律先实测再采信**：第 2 批推翻了孤儿 i18n 键计数（8 → **33**）；第 3 批推翻了 A5「无环 ✅ 0」（实测 **2 组**）与「`components → features` 可直接归零」（实测 **4 条**，1 条随下沉消除、3 条需单独批次）。教训：**grep 逐行枚举 ≠ 图级断言**（环必须做 SCC），**计数必须先跑再写**。
- 第 3 批新增判据：`npm run layer:check`（`scripts/layer-boundary-scan.mjs`，报告模式 + `--fail-on-violation` 严格档 + `--json`）。

### 回扫口径（改哪些文档、为什么不动其余）

| 批次 | 处置 | 对象 | 理由 |
|---|---|---|---|
| 第 2 批 | **改** | 本报告 §零/§二/§七/§附 | 它是本轮的**唯一权威记录** |
| 第 2 批 | **改** | `skills/plos-ui-system/references/component-catalog.md` | 组件台账是**活表**，删组件必须跟 |
| 第 2 批 | **改** | `docs/library-module-review-2026-09.md` P2-3 / 建议 18、`docs/business-logic-review-2026-09.md` P2-5 | 三处是**开放的债/建议登记**（「未兑现承诺」类）—— 不标记会被重新排期 |
| 第 2 批 | **改** | `docs/business-flow-end-to-end-2026-09.md` 的「章级评测本地判分」行 | 它是**现状参照**，且该行断言 `assessment-engine.ts` 是「唯一路径」——模块已删，事实被推翻 |
| 第 3 批 | **改** | 本报告 §零/§三（新建 3.1/3.2）/§五/§七/§附 | 同上（唯一权威记录） |
| 第 3 批 | **改** | `docs/learner-memory-design-2026-09.md` §8 开头 | 加**位置注记**：§8.x 里 4 个服务模块已迁 `src/services/memory/`；**不逐条改写 20 余处路径** —— 它们是方案期快照，且该节签名是**行为契约**（未变） |
| 第 3 批 | **改** | `rules/code-structure-and-dependencies.mdc` · `rules/layer-import-boundaries.mdc` · `AGENTS.md` · `package.json` | 规则是**约束本体**：「stores 不在禁止名单」正是本次出事的机制 ⇒ 必须同批修，否则问题必复发 |
| 两批 | **不动** | 约 20 份 docs 里对已删符号 / 旧路径的历史引用（各轮 design / runbook / review 快照，如 `goal-capability-assessment-*`、`i18n-design`、`ai-chapter-mapreduce-*`、`library-detail-page-*`、`ui-workbench-plan`…）；本轮涉及的 `learner-memory-design` §8.x 内 20 余处旧路径同理 | 它们是**各自当时的历史快照**（记录「当时发生了什么」），改写＝篡改历史。判据：**据它们排期前逐条实测**，而非替它们改错 |
