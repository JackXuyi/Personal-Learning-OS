# 全局文案优化技术方案（术语表 + 一致性治理）

| 字段 | 内容 |
|------|------|
| 作者 | Agent |
| 日期 | 2026-10-20 |
| 状态 | **待确认**（用户已拍板三项决策点：范围＝三档全做 / 定位语＝UI 与 README 一起改 / 孤儿键＝先出清单逐个判断） |
| 关联需求 | 用户「基于现状，优化当前项目的文案，先生成详细方案」 |
| 前序方案 | `docs/settings-left-menu-layout-design-2026-10.md` §9（**设置页去技术化已实施**；本文是它的**全局续篇**，不推翻其任何决策） |
| 门禁基线（实测 2026-10-20） | `typecheck` 0 error；`copy:check` zh 0 / en 0 命中 |

---

## 1. 背景

### 1.1 上一轮做完了什么

`docs/settings-left-menu-layout-design-2026-10.md` §9 已把**设置页**的用户可见文案去技术化完毕，配套门禁 `npm run copy:check`（`scripts/settings-copy-scan.mjs`）当前双语 0 命中。

**但该方案的 §9.5 明确把以下内容列为「另案」**，即本轮的输入：

| 前序 §9.5 列出的「另案」项 | 本轮是否承接 |
|------------------------|------------|
| 主壳 `nav.brandSub`「本地优先 · 学习闭环」 | ✅ 承接（用户已定：UI 与 README 一起改） |
| 主壳 `nav.footerBadge`「Pre-MVP」 | ✅ 承接 |
| `app.metaDescription` / `index.html` meta / `package.json` description | ✅ 承接 |
| README 定位语 | ✅ 承接（用户已定） |
| `settings.embedding` 整卡术语（向量 / 维度 / 块） | ✅ 承接（用户已定三档全做） |
| 图表 / 复盘 / 画像等设置页外的文案 | ✅ 承接（**本轮主体**） |

### 1.2 为什么现在做

设置页是「用户主动去调参数」的地方，去技术化的收益有限；**真正决定产品观感的是用户在主流程里遇到的文案**——首页、资料库、导入、测评、复盘、我的画像。上一轮遗留的这部分，是当前体验的短板。

### 1.3 本轮目标（一句话）

> 把「面向开发者写给用户看」的技术语言，换成「面向用户讲清楚好处与后果」的人话；同时建立**术语表 + 门禁 + 孤儿键台账**三件套，让文案质量不再靠人肉自觉维持。

---

## 2. 现状实测（2026-10-20，全部实测而非记忆）

### 2.1 字典规模与结构

| 指标 | 实测值 |
|------|--------|
| i18n 叶子值总数 | **zh 1830 / en 1830**（完全同构） |
| 命名空间 | **24 个** |
| zh 缺失 en 键 | **0** |
| en 缺失 zh 键 | **0** |
| 空串值 | **0** |
| 命名空间叶子数分布 | `learn` 567、`settings` 294、`quiz` 184、`learner` 112、`memory` 105、`goals` 80、`capability` 74、`knowledge` 52、`units` 52、`assessment` 47、`review` 39、`progress` 34、`nav` 31、`plan` 30、`home` 29、`cmd` 27、`common` 23、`engine` 19、`career` 11、`spaces` 9、`aiTask` 5、`chapter` 2、`scaffold` 2、`app` 2 |

> ✅ **双语基础设施健康**：键同构、零空值、零裸 `${}` 插值（全部走函数参数）。
> ⚠️ `test:i18n` **只锁键同构，不报孤儿键**——这是 §6 门禁设计的动因。

### 2.2 技术词命中（值级扫描，判据见 §3.1）

| 语言 | 命中 | 总数 | 命中率 |
|------|------|------|--------|
| zh | **82** | 1830 | 4.5% |
| en | **64** | 1830 | 3.5% |

按命名空间分布（zh）：

| 命名空间 | 命中 | 性质 |
|---------|------|------|
| `settings` | 36 | **其中 25 条是黑名单误报**（见 §3.1 说明：键名/协议值）；真技术味集中在 `settings.embedding` 整卡（14 条）与 `countLabels`（3 条） |
| `learn` | 32 | **主战场**：OCR 系列 8 条、向量/索引系列 6 条、导入与错误文案 |
| `learner` | 4 | `subtitle` 暴露「领域模型」 |
| `spaces` | 3 | **整页是开发备忘**（见 §2.4） |
| `memory` | 2 | `privacyMaskNote` 有 markdown 残迹 |
| `quiz` / `assessment` / `home` / `nav` | 各 1–2 | 「学习闭环」「本地数据库」等 |
| `goals`（en 侧） | 1 | `privacyMaskNote` 类表述 |

### 2.3 三类硬缺陷（不是「技术味」，是**功能缺陷**）

#### 🔴 D1：英文界面下拉残留中文（i18n 绕过）

- **位置**：`src/features/learn/library/dialogs.tsx:50-55`
  ```ts
  const FORMAT_OPTIONS: { value: DocumentFormat; label: string }[] = [
    { value: "markdown", label: "Markdown" },
    { value: "note", label: "笔记" },      // ← 硬编码中文
    { value: "web", label: "网页" },        // ← 硬编码中文
    { value: "txt", label: "纯文本" },      // ← 硬编码中文
  ];
  ```
- **消费方**：`dialogs.tsx:194`（重命名对话框）、`dialogs.tsx:385`（替换正文对话框）
- ** irony**：i18n 字典里**已有** `learn.import.formatNote` / `formatWeb` / `formatTxt`（zh/en 双侧齐备），但**零消费方**（实测 `grep -rn "formatNote\|formatWeb\|formatTxt" src/` → 0 命中）⇒ 有人写了键、忘了接线。
- **后果**：切到 en，资料「原始类型」下拉仍显示「笔记 / 网页 / 纯文本」。

#### 🔴 D2：用户界面渲染 markdown 源码

- **位置**：`src/i18n/messages/zh.ts:946` / `en.ts:962` → `memory.privacyMaskNote`
- **现值（zh）**：`已掩码手机号 / 邮箱 / 身份证 / 生日 / 主页链接；姓名与公司名**不掩码**，靠提示词约束模型不输出。`
- **现值（en）**：`…names and company names are **not** masked and rely on prompt constraints.`
- **后果**：`MemoryAiDialog.tsx:136` 用 `<p>` 渲染 ⇒ `**` 原样显示给用户。
- **附带问题**：内容本身在讲「靠提示词约束模型不输出」——这是**实现手段**（提示词）而非**用户可判断的事实**（可能残留姓名）。

#### 🟠 D3：孤儿键 21 个（零消费方）

实测（排除 `src/i18n/messages/` 后全仓 grep，键末段 0 命中）：

```
settings.storage.data.mdDone      career.currentGoal       career.importanceLine
career.remainingGap               career.gapList            goals.gapOf
goals.doneAllSub                  goals.deleted             goals.form.invalidScope
learner.countTotal                learner.countMastered     learner.countProficient
learner.accuracyNone              learner.patternSubmissions learner.patternAccuracy
learner.resume.usePaste           memory.manualPlaceholder  learn.catalog.filterUnmet
learn.catalog.doclessTitle        learn.catalog.doclessDesc learn.catalog.docMeta
learn.catalog.docReady            learn.catalog.learnedToday learn.catalog.learnedYesterday
learn.catalog.learnedAgo          learn.catalog.notLearned   learn.catalog.exploredOf
learn.catalog.unmetEmpty          learn.catalog.unsplitCount learn.catalog.unsplitHint
learn.library.unsplitBadge        learn.search.contentEmpty learn.detail.linkGoalsSaved
learn.detail.split.strategyParagraphs learn.detail.analyze.reAnalyze
learn.detail.analyze.analyzing    learn.detail.analyze.notAnalyzed learn.detail.analyze.aiOff
learn.detail.papers.noPapers      learn.import.github.filesHead
learn.reader.pointsEyebrow        learn.reader.graphEyebrow  learn.reader.graphDesc
learn.reader.restatement.scheduleHint learn.reader.restatement.historyEmpty
knowledge.chapterGraph.extractBusy assessment.docScopeEmpty  quiz.center.sectionGrading
quiz.center.sectionHistory        capability.refining        capability.reRun
aiTask.fallbackDone               aiTask.alreadyRunning
```

> ⚠️ 逐个 grep 抽验（`mdDone` / `gapOf` / `countTotal` / `filterUnmet` / `doclessTitle` / `unsplitBadge` / `contentEmpty` / `linkGoalsSaved` / `filesHead` / `graphDesc` / `scheduleHint` / `extractBusy` / `sectionGrading` / `refining` / `fallbackDone` / `alreadyRunning` / `invalidScope` / `remainingGap` / `gapList`）**全部 0 命中**；`metaLine` 有 2 命中（保留）。
> ⚠️ 数量以**实测**为准（本轮实施时须重测，键会随开发变动）。

### 2.4 `/spaces` 整页是开发备忘（半废弃占位页）

- **路由**：`src/App.tsx` 有 `spaces` 路由 ⇒ **可达**（虽然 `NAV_ITEMS` 里没有，手敲 URL 能进）。
- **实现**：`src/features/spaces/SpacesPage.tsx` → 复用 `src/features/scaffold.tsx::ScaffoldPage`（纯占位页组件，`CheckList` 打勾/省略号）。
- **文案**（zh）：

| 键 | 现值 | 问题 |
|----|------|------|
| `spaces.scope[0]` | 存储层就绪：内存 + localStorage 适配器统一在单一接口之后 | 内部架构描述 |
| `spaces.scope[2]` | SQLite / 文件系统后端接口已在 src/storage 预留 | **源码路径** |
| `spaces.nextSteps[0]` | 创建一个 Learning Space（名称、描述、图标） | 中英混排 |
| `spaces.nextSteps[2]` | 文档解析 + 分块（chunking）流水线 | 内部流程 |
| `spaces.nextSteps[3]` | 列出文档并附带来源引用 | 内部流程 |

- **判断**：这是**开发备忘被当成产品文案**的典型。上一轮 §9.5 的判据「用户拿这条信息要做什么决定」在此不适用——用户**没有要做的决定**，因为这页还没有功能。
- **三条出路**（见 §5.4 决策点 D4）。

### 2.5 定位语分布（用户已定：UI 与 README 一起改）

| 位置 | 现值 | 性质 |
|------|------|------|
| `nav.brandSub` | 本地优先 · 学习闭环 | **⚠️ 已被注释**（`NavSidebar.tsx:25`）⇒ UI 不可见，改它零用户收益（但属技术债） |
| `nav.footerBadge` | Pre-MVP | UI 可见（侧栏页脚） |
| `app.metaDescription` | Personal Learning OS —— 开源、本地优先的自适应学习系统：… | UI 不可见（meta） |
| `index.html` meta description | An open-source, local-first AI learning system that decides what you should learn next. | 搜索引擎可见 |
| `package.json` description | An open-source, local-first AI learning system that turns your knowledge into an adaptive learning experience. | npm 可见 |
| README.zh-CN.md:3 | **开源、本地优先的自我学习评测系统。** | **首屏定位语** |
| README.zh-CN.md:125 | `### 🔒 本地优先` | **章节标题（核心卖点）** |
| README.zh-CN.md:390 | `## 🔒 隐私与本地优先` | **章节标题（核心卖点）** |
| README.zh-CN.md:405 | `2. **本地优先** —— 联网是增强项，不是依赖项。` | **产品原则** |
| README.zh-CN.md:13 / README.md:13 | badge `status-pre--MVP-orange` | **状态徽章** |

> 🔴 **关键区分**（决定 §5.1 的改法）：README 里的「本地优先」是**产品核心卖点**，有两个独立章节论述它（隐私与离线能力），删掉等于删掉产品价值主张 ⇒ **不改**。
> 而「Pre-MVP」是**开发阶段代号**，出现在面向用户的 UI（`footerBadge`）与仓库徽章上 ⇒ 需替换为用户语言。
> 「自适应」在 `metaDescription` / `package.json` 里指「难度随作答调整」这一**真实功能**（`assessment.subtitle` 有同义表述）⇒ 属准确描述，不是技术黑话，但可换成更易懂的「按你的水平调整难度」。

### 2.6 其他实测事实

| 事实 | 实测结论 |
|------|---------|
| 源码硬编码中文 | `src/features/**/*.tsx` 中的中文**全部在注释里**；用户可见文案 0 硬编码（除 D1 的 `FORMAT_OPTIONS`） |
| `src/ai/**` 硬编码中文 | **是 prompt 与内部日志**，不是用户可见文案 ⇒ 本轮不动（改动会改变 AI 行为，属高风险） |
| 裸 `${}` 插值 | 0 处 ⇒ 全部走 `(p) => string` 函数参数，不存在「插了原始标识符」的结构性风险 |
| 枚举直出 UI | `KnowledgePackCard.tsx:490` 的 `w.kind` 仅作 React `key`，文案走 `warningText(p, w)` 映射 ⇒ 安全 |
| `settings.storage.data.countLabels` | 上一轮刻意保留（准确指代「清掉了什么」）+ 3 个括注 ⇒ 保留 |
| Emoji | 28 处，**全部是成功态标记**（✓ ✅ 🎉 📥）⇒ 与 `rules/react.mdc`「状态色仅 dot/徽标」不冲突，**保留** |
| 门禁基线 | `typecheck` 0 error；`copy:check` zh 0 / en 0 |
| 工作树状态 | `docs/settings-left-menu-layout-*.md`（2 个新文件）+ `scripts/settings-copy-scan.mjs` **尚未提交** ⇒ 本轮开工前应先收口上一轮提交 |

---

## 3. 判据体系

### 3.1 三分类（沿用上一轮 §9.1，本轮扩展第四类）

| 类型 | 定义 | 例子 | 处理 |
|------|------|------|------|
| **A 实现层描述** | 讲系统怎么做的 | 「SQLite / 文件系统后端接口已在 src/storage 预留」 | **改**：讲结论不讲实现 |
| **B 开发侧指令 / 里程碑 / 内部代号** | 开发者工作流 | 「Pre-MVP」「U6 · UI Workbench 收官」「npm run tauri dev」 | **删或改**：用户不该看到 |
| **C 必须填的外部参数 / 协议常量** | 第三方真实字段名 | `Base URL`、`API Key`、日志级别 `debug/info/warn/error` | **保留**（值可加显示映射） |
| **D 用户要做的决定** | 用户据此行动 | 「导出前会自动备份」「切英文后下拉也变英文」 | **保留并写清后果** |
| **E（新增）格式名 / 文件类型名** | 用户在文件选择器里见过的名字 | `Markdown`、`PDF`、`EPUB`、`TXT` | **保留**：用户按扩展名选文件，改了反而找不到 |
| **F（新增）产品核心卖点** | 构成产品价值主张 | 「本地优先」在 README 的隐私章节 | **保留**：删掉等于删产品价值 |

> ⚠️ **黑名单必须精准**。上一轮的教训：`向量` 刻意不入黑名单，因为 `embedding` 整卡术语划到另案；若列进判据而本轮不改，门禁会永远红着 ⇒ **恒红的门禁等于没有门禁**。
> 本轮的黑名单只覆盖**本轮真会改的词**（§7.1）。

### 3.2 改写句式规范（一致性层）

| 规范 | 规则 | 正例 | 反例 |
|------|------|------|------|
| **讲后果不讲实现** | 说「会发生什么」，不说「用什么做的」 | 「关掉后不再记录，已有的记录不会被删除」 | 「关闭后停止写入 log 文件」 |
| **先说结论再给条件** | 条件从句后置 | 「切到英文后，类型下拉也会跟着变」 | 「下拉选项由 i18n 字典提供」 |
| **数字给口径** | 数值必带含义 | 「50 页」+「请先把 PDF 拆成几份」 | 「超过 OCR_LIMIT(50)」 |
| **不用 Markdown 标记** | 纯文本 UI 不用 `**` `` ` `` | 「姓名与公司名不掩码」 | 「姓名与公司名**不掩码**」 |
| **不用源码路径** | UI 文案不出现 `src/…`、函数名、文件名 | 「已在内部预留好」 | 「已在 src/storage 预留」 |
| **中英不混排** | 中文界面的中文句子不夹英文技术词 | 「纯文本」 | 「纯文本（txt）」 |
| **错误文案给行动项** | 说清发生了什么 + 用户能做什么 | 「这个文件打不开，可能已损坏」 | 「errNotJson」 |
| **en 侧母语化** | 不直译中文句式 | 「Names and company names aren't masked」 | 「names and company names are not masked」 |

---

## 4. 方案总览

### 4.1 三档结构（用户已定：三档全做）

| 档 | 名称 | 范围 | 风险 | 预估 |
|----|------|------|------|------|
| **P0** | 硬缺陷修复 | D1 格式下拉绕过 i18n；D2 markdown 残迹；§2.4 spaces 整页；`learner.subtitle` 暴露「领域模型」 | **低**（纯文案 + 1 处组件接线） | 0.5 天 |
| **P1** | 术语口语化 | `settings.embedding` 整卡（14 条）+ `learn` 命名空间向量/索引系列（6 条）+ `learn.import` 错误文案 + `memory` 隐私说明 | **中**（VectorIndexCard 信息结构需重排） | 1.5 天 |
| **P2** | 一致性治理 | 术语表 + 门禁扩到全量 + 孤儿键台账 + 定位语统一（含 README / meta / package.json） | **低**（新增只读资产） | 1 天 |

### 4.2 依赖关系

```
P0（硬缺陷）──┐
              ├──> P1（术语层）──> P2（治理层：术语表 + 全量门禁 + 孤儿键台账）
P2-定位语 ────┘
```

⚠️ **顺序不可换**：P2 的门禁黑名单依赖 P0/P1 已把词改完，否则门禁会红。孤儿键台账同理——**先改完再判孤儿**，否则会把「本轮正在改的键」误判为孤儿。

### 4.3 与前序方案的关系

本文**不推翻** `docs/settings-left-menu-layout-design-2026-10.md` 的任何决策。§3.1 的三分类沿用其 §9.1 并**新增 E/F 两类**；§3.2 的句式规范是其 §9 判据的细化。**上一轮 §9.5 列出的「另案」项，本轮逐条给出处置**（见 §5）。

---

## 5. 详细设计

### 5.1 定位语处置（用户已定：UI 与 README 一起改）

#### A 组：UI 内可见

| 键 | 现 zh | 新 zh | 现 en | 新 en | 理由 |
|----|-------|-------|-------|-------|------|
| `nav.footerBadge` | Pre-MVP | **预览版** | Pre-MVP | **Preview** | B 类：开发阶段代号出现在用户界面。参照上一轮 `about.badge` 已改「预览版」，此处保持一致（**同值不同键**的问题在上一轮 §9.5 被明确留待本轮统一） |
| `nav.brandSub` | 本地优先 · 学习闭环 | **学习闭环**（或按 P2 术语表定稿） | Local-first · Learning loop | **Learning loop** | ⚠️ **该行已被注释**（`NavSidebar.tsx:25`）⇒ 改它**零用户收益**，但属技术债：一行被注释的文案留在字典里会误导后来者。本轮**改值并保留注释状态**（不擅自取消注释——那是 UI 决策） |

#### B 组：仓库元信息（面向搜索引擎与 npm）

| 位置 | 现值 | 新值 | 理由 |
|------|------|------|------|
| `index.html` meta description | `Personal Learning OS — an open-source, local-first AI learning system that decides what you should learn next.` | `Personal Learning OS — an open-source learning app that turns your own material into quizzes and tells you what to study next.` | ①「local-first」在 meta 里**零信息量**（所有 AI 产品都这么说）；②「AI learning system」抽象；③ 新句讲清**机制**（资料 → 试卷 → 下一步） |
| `package.json` description | `An open-source, local-first AI learning system that turns your knowledge into an adaptive learning experience.` | `An open-source learning app that turns your own material into quizzes and tells you what to study next.` | 与 index.html **同源同句**（避免三处各说一套） |
| `app.metaDescription` | `Personal Learning OS —— 开源、本地优先的自适应学习系统：由它决定你下一步该学什么。` | `Personal Learning OS —— 开源的学习应用：把你的资料变成试卷，告诉你下一步该学什么。` | 与 en 侧同结构；「自适应」→「把资料变成试卷」（讲机制） |

> ⚠️ **`package.json` description 是 npm 包页与 GitHub 仓库描述的来源**，改动会影响对外第一印象。措辞须诚实：**「开源的学习应用」不夸大人工智能**（项目确实有 AI 能力，但那句话不构成差异点）；**「把你的资料变成试卷」是真实机制**（`quiz` 命名空间 184 个值就是干这个的）。

#### C 组：README（用户已定「一起改」，但须区分）

| 位置 | 处置 | 理由 |
|------|------|------|
| README 首屏 bold 定位语（zh:3 / en:3） | **保留** | 「开源、本地优先的自我学习评测系统」= 产品一句话定义，README 首屏必须有力 |
| `### 🔒 本地优先`（zh:125） | **保留** | 核心卖点章节 |
| `## 🔒 隐私与本地优先`（zh:390 / en:386） | **保留** | 核心卖点章节 |
| `2. **本地优先** —— 联网是增强项，不是依赖项。`（zh:405） | **保留** | 产品原则条款 |
| badge `status-pre--MVP-orange`（zh:13 / en:13） | **改** → `status-preview-orange` | B 类：开发阶段代号。改为「预览版 / Preview」与 UI 侧一致 |
| README 正文其余「Pre-MVP」提及 | **逐处判断** | 需先实测分布（实施时 grep）；原则上「本版为 Pre-MVP 里程碑（U6 · UI Workbench 收官）」类**必改** |

> 🔴 **README 双语严格对齐**（`AGENTS.md` 硬约束）：任何 zh 侧改动必须同批改 en 侧，**且两文件的段落结构、行号位置需保持对应**。
> ⚠️ README 顶部**统计行是硬编码文字**（`grep -c` 数不到），改文案时须手工同步统计数字（记忆：基线 `[x]` 44 / `[ ]` 2，实测为准）。

### 5.2 P0：硬缺陷修复

#### T-P0-1：`FORMAT_OPTIONS` 改走 i18n（修 D1）

- **改法**：`FORMAT_OPTIONS` 从**模块级常量**改为**组件内派生**（需要 `m` 才能取词）：
  ```ts
  // ❌ 现状：模块级，硬编码中文
  const FORMAT_OPTIONS: { value: DocumentFormat; label: string }[] = [...];

  // ✅ 改后：组件内 useMemo 派生，读 i18n
  const formatOptions = useMemo(
    () => [
      { value: "markdown" as const, label: m.learn.format.markdown },
      { value: "note" as const, label: m.learn.format.note },
      { value: "web" as const, label: m.learn.format.web },
      { value: "txt" as const, label: m.learn.format.txt },
    ],
    [m.learn.format],
  );
  ```
- **为何复用 `learn.format.*` 而非 `learn.import.formatNote/Web/Txt`**：
  - `learn.format.*` 是**格式名的单一事实源**（已覆盖 `pdf` / `markdown` / `txt` / `docx` / `epub` / `web` / `note` / `code` / `image` / `custom` / `fallback` 共 11 个，zh/en 齐备）；
  - `learn.import.formatNote/Web/Txt` 是**重复的**三个键（语义完全相同）⇒ 属 §2.3 D3 孤儿键，**随本任务删除**（zh/en 同批）。
  - ⚠️ 删键纪律：**改名/删键必须与消费方同批**（`AGENTS.md` i18n 纪律）——本任务正是**接线**，同批最干净。
- **验收**：切 en 后，`dialogs.tsx:194` 与 `:385` 两个下拉显示 `Notes / Web / Plain text`。

#### T-P0-2：`memory.privacyMaskNote` 去 markdown 残迹 + 讲事实（修 D2）

| 侧 | 现值 | 新值 |
|----|------|------|
| zh | `已掩码手机号 / 邮箱 / 身份证 / 生日 / 主页链接；姓名与公司名**不掩码**，靠提示词约束模型不输出。` | `手机号 / 邮箱 / 身份证 / 生日 / 主页链接会自动打码；姓名与公司名不会自动打码，AI 整理时也不会主动写出。` |
| en | `Phone numbers, emails, ID numbers, birthdays and homepage links are masked; names and company names are **not** masked and rely on prompt constraints.` | `Phone numbers, emails, ID numbers, birthdays and homepage links are masked automatically. Names and company names are not masked automatically — the assistant will not write them out on its own.` |

- **两处改动**：① 删 `**`（D 类硬缺陷）；②「靠提示词约束模型不输出」→「不会主动写出」（D2 的内容修正：讲**用户能判断的事实**，不讲实现手段）。
- **验收**：`MemoryAiDialog.tsx:136` 渲染无 `**` 字符。

#### T-P0-3：`learner.subtitle` 去「领域模型」

| 侧 | 现值 | 新值 |
|----|------|------|
| zh | `系统如何理解我——由学习记录推导，全部字段可指到领域模型。` | `系统如何理解你——每个判断都来自你的学习记录，你也能逐项对照修改。` |
| en | `How the system sees you — derived from learning records, every figure maps to the domain model.` | `How the system sees you — every judgment comes from your own study records, and you can check each one.` |

- **理由**：「领域模型」是实现词；后半句的真实价值是**可核对、可修改**（F9 的产品承诺：一份「系统整理、用户可改」的文档）⇒ 换成用户能感知的能力。
- **核对**：`memory.subtitle` 已用「系统从你的学习记录里整理出来的一份观察，你可以直接改」⇒ 改后**与 memory 侧句式对齐**（一致性层）。

#### T-P0-4：`/spaces` 整页处置

**三选一（D4 决策点，见 §9.2）**：

| 方案 | 做法 | 成本 | 风险 | 后果 |
|------|------|------|------|------|
| **A（推荐）** | **下线该路由**，删除 `SpacesPage.tsx` + `scaffold.tsx::ScaffoldPage` + `spaces` / `scaffold` 命名空间（zh/en 同批） | 0.5 天 | **低**（该页无功能、无用户数据、无入口） | 断链 `/spaces` 需重定向到 `/`；`scaffold` 命名空间另 2 键需确认无其他消费方（实测仅 `SpacesPage` 用 `ScaffoldPage`） |
| **B** | **保留页面，改成用户语言**（scope/nextSteps 讲「这个空间能做什么」，但那需要真功能才写得出来） | 1 天 | **中**（写不出真实内容 ⇒ 变成新的空头承诺） | 占位页继续存在，误导用户以为可用 |
| **C** | **保留页面但标注未开放**（标题加「即将推出」，内容改为「这个功能还在开发」） | 0.5 天 | 低 | 诚实，但「开发中」的占位页对开源项目是常见减分项 |

> 🔴 **A 是推荐**，但需用户确认（§9.2 D4）：**`/spaces` 是否有未在代码中体现的规划意图？**（`spaces` 命名空间的 scope/nextSteps 描述的是「学习空间」产品形态，与 F10 知识包功能方向相关。删路由不删知识，方案会写清。）

### 5.3 P1：术语口语化

#### T-P1-1：`settings.embedding` 整卡（14 条）术语替换

**这是本轮最大的单块改造。** 上一轮 §9.5 把它划为另案，理由是「牵动 `VectorIndexCard.tsx` 的信息结构」——本轮正面承接。

**核心矛盾**：卡片现在的信息结构是**按技术概念排的**（模型 → 维度 → 上下文 → 覆盖率 → 块数），用户要先理解「向量」才知道该看什么。

**改法（信息结构重排）**：

| 现有顺序 | 新顺序 | 理由 |
|---------|--------|------|
| ① 标题「向量索引（本地）」 | ① **「语义搜索」** | 讲**用户得到什么**（能搜到「意思相近但用词不同」的内容），不讲怎么实现 |
| ② `desc`（讲建立向量索引） | ② 改写为**用户收益** + 一句原理 | 保留「意思相近但用词不同」这个类比（用户已能理解），删「建立向量索引」 |
| ③ `spec`「1 维 · 0k 上下文 · CPU 推理」 | ③ **删除**（用户不需要知道维度） | 「维」「上下文」「CPU 推理」是纯实现参数；模型大小（MB）保留（用户要判断下载成本） |
| ④ `model`「向量模型」 | ④ **「搜索用的本地模型」** | |
| ⑤ `status.*`（已就绪/未下载/下载中） | ⑤ 保留（用户要判断可用性） | |
| ⑥ `download` / `redownload` / `cancel` / `delete` | ⑥ 保留 | |
| ⑦ `autoIndex`「导入后自动向量化」 | ⑦ **「导入后自动建立搜索索引」** | |
| ⑧ `coverage`「索引覆盖率」 | ⑧ **「已可搜索的内容」** | |
| ⑨ `coverageValue`「1 / 1 块」 | ⑨ **「1 / 1 份资料」**（或按实际分母改） | ⚠️ 分母语义**必须核对**：`coverageValue` 的分母真源是「块数」还是「资料数」？实施时读 `services/learn/index-service` 确认真源，**不得改错口径** |
| ⑩ `rebuild`「重建索引」 | ⑩ **「重新建立索引」** | |
| ⑪ `onlyMissing`「仅补齐缺失」 | ⑪ 保留 | |
| ⑫ `notReady` / `noModel` | ⑫ 保留（用户要据此行动） | |
| ⑬ `running` / `doneAll` / `failedPartial` | ⑬ 保留 | |
| ⑭ `desktopOnly` / `unsupportedPlatform` / `ramBelowMin` | ⑭ 保留（环境限制，必须说清） | `ramBelowMin`「设备内存 1GB 低于该模型要求的 1GB」——数字口径要核对 |

> ⚠️ **P1 的真源核对义务**：涉及「块 / 资料 / 分母 / 内存要求 / 维度」的文案，**数字口径必须与代码常量一致**（`services/learn/index-service`、`ai/builtin`）。**只换说法，不改数字与条件**——这是上一轮 §9.2-C 立的规矩，本轮同样适用。

#### T-P1-2：`learn` 命名空间的向量/索引系列（6 条）

| 键 | 现 zh | 新 zh |
|----|-------|-------|
| `learn.search.fulltextOnlyHint` | 向量索引不可用（未配置 Embedding 模型或尚未建索引） | 语义搜索还没准备好（需要先下载搜索模型并建立索引） |
| `learn.search.indexing` | 索引中 1/1 | 正在建立索引 1/1… |
| `learn.import.indexQueued` | 已入队向量化 | 已加入搜索索引队列 |
| `learn.import.indexOffNoModel` | 未下载本地向量模型 · 本次仅全文索引 | 未下载搜索模型 · 本次只建立关键词索引 |
| `learn.import.indexOffDisabled` | 已关闭「导入后自动向量化」· 本次仅全文索引 | 已关闭「导入后自动建立索引」· 本次只建立关键词索引 |
| `learn.import.indexOffPreview` | 浏览器预览不支持本地向量模型 · 本次仅全文索引 | 浏览器预览不支持搜索模型 · 本次只建立关键词索引 |

> ⚠️ **「全文索引」也不够口语**——候选：「只按标题和正文里的字查找」「只做关键词查找」。实施时统一为一套说法（术语表 P2 固化）。
> ⚠️ `learn.reader.qa.emptyIndex`「本章还没有建立检索索引」同理。

#### T-P1-3：`learn.import` 的 OCR 与错误文案（8 条）

OCR 本身是**用户主动勾选的开关**（`ocrToggle`「扫描版 PDF 用 OCR 识别文字」）⇒ **「OCR」是功能名，属 C/E 类，保留**。但**解释句**要去实现层：

| 键 | 现 zh | 新 zh | 处理 |
|----|-------|-------|------|
| `ocrToggle` | 扫描版 PDF 用 OCR 识别文字 | 保留 | 功能名 |
| `ocrTag` | OCR 识别 | 保留 | 短标签 |
| `ocrDesktopOnly` | OCR 仅桌面端可用（浏览器预览无法调用系统识别） | OCR 识别需要桌面版（浏览器预览调用不了系统识别功能） | 「系统识别」→ 去掉「系统」歧义；补「桌面版」 |
| `pdf-no-text` | 未抽取到文本（可能为扫描件）—— 可勾选上方「OCR 识别」重试 | 没找到文字（这可能是扫描件）—— 勾选上面的「OCR 识别」再试一次 | 「抽取」→「找到」，更口语 |
| `pdf-ocr-unavailable` | 这台设备无法做 OCR 识别（仅 macOS 桌面端支持，且需要系统带中文识别能力） | 这台设备不能做 OCR 识别（目前只有 macOS 桌面版支持，系统还得能识别中文） | 括号内嵌条件拆成顺句 |
| `pdf-ocr-too-many-pages` | 页数超过 OCR 上限（50 页），请先把 PDF 拆成几份再导入 | 超过 50 页了，OCR 处理不了这么多页——请先把 PDF 拆成几份再导入 | 「上限（50 页）」→「超过 50 页了」，数字保留 |
| `pdf-ocr-failed` | OCR 识别失败，可改用「粘贴」把文字直接粘进来 | OCR 识别没成功——可以改用「粘贴」把文字直接贴进来 | 「失败」→「没成功」 |
| `pdf-ocr-no-text` | OCR 未识别出文字（页面上可能只有图表，或扫描太模糊） | OCR 没认出文字（页面上可能只有图表，或者扫得太模糊） | |

> ⚠️ **「50 页」是操作上限，用户需要它** ⇒ 保留数字，但改成顺句，别用「上限（50 页）」这种参数写法。

#### T-P1-4：其余实现层表述（散点）

| 键 | 现 zh | 新 zh | 分类 |
|----|-------|-------|------|
| `learn.library.loadFailedDesc` | 本地数据库暂时不可用。你的资料没有被改动，重启应用后再试一次。 | 暂时读不出你的资料。资料没有被改动，重启应用后再试一次。 | A 类：「数据库」是实现词。⚠️ **「读不出」是否比「不可用」更准**须核对 `StorageUnavailableError` 的真实语义（可能是全部存储不可用，不只是读） |
| `quiz.center.loadFailedDesc` | 可能是本地数据库暂时不可用。请重启应用再试；数据仍在，不会因本次失败丢失。 | 可能是存储暂时出了点问题。请重启应用再试；数据仍在，不会因本次失败丢失。 | 同上 |
| `learn.import.subtitle` | 粘贴 Markdown，或从本地文件 / GitHub 公开仓库 / 网页链接导入资料，系统会切分成章节逐章学习。 | 保留（Markdown / GitHub 是真实来源名，属 E 类） | ✅ 保留 |
| `assessment.docScopeHint` | 从资料的章节直接出单章测评卷——结果写入章掌握度，进入学习闭环。 | 从资料的章节直接出一份单章测评卷——成绩会计入这一章的掌握度。 | 「进入学习闭环」是内部术语（且 §5.1 决定从 UI 去掉「学习闭环」话术） |
| `nav.readyTooltip` | AI Provider 已就绪 | AI 已就绪 | 「Provider」是技术词；`nav.aiReady` 已是「AI 就绪」⇒ 统一 |

> ⚠️ **`learner` 命名空间其余 4 条命中**（`countTotal` 等）为孤儿键，不在此处理（见 §6）。

### 5.4 P2：一致性治理

#### T-P2-1：术语表（新增资产）

新建 `docs/copy-terminology-2026-10.md`（**单一事实源**），内容：

| 类别 | 用户语言 | 禁用 | 备注 |
|------|---------|------|------|
| 搜索能力 | 语义搜索 / 搜索索引 | 向量、Embedding、向量化 | 「意思相近但用词不同」是好的用户类比，保留 |
| 存储 | 存在这台设备上 / 临时 | localStorage、SQLite、后端、适配器 | |
| 模型 | 搜索用的本地模型 / 聊天用的模型 | 向量模型、Embedding 模型 | |
| 索引建立 | 建立索引 / 重新建立索引 | 重建索引（歧义） | |
| 失败 | 读不出 / 暂时出了点问题 | 数据库不可用、后端异常 | |
| 定位语 | 预览版 | Pre-MVP、MVP、Workbench、U6 | |
| 阶段代号 | （不出现在 UI） | U1–U6、Pre-MVP、Workbench | |
| 保留清单 | Markdown / PDF / EPUB / TXT / Base URL / API Key / 模型名 / API Key / OCR | —— | C/E/D 类，见 §3.1 |

#### T-P2-2：门禁扩到全量

**改造 `scripts/settings-copy-scan.mjs`** ⇒ 更名为 `scripts/copy-scan.mjs`（`package.json` 的 `copy:check` 同步），判据：

| 项 | 现状 | 目标 |
|----|------|------|
| 扫描范围 | 仅 `settings` 子树 + `nav.settings.hint` | **全部 24 个命名空间的值** |
| 判据 | 固定正则黑名单 | **术语表驱动的黑名单**（与 §5.4-1 单一事实源） |
| 硬编码扫描 | 无 | **新增**：源码中绕过 i18n 的中文 UI 字面量（`FORMAT_OPTIONS` 那类）——用「排除注释与 `src/ai/**`」的规则扫描 `src/features/**` |
| 孤儿键检测 | 无（`test:i18n` 不报） | **新增**：键末段在全仓 0 命中 ⇒ 报告（**不直接失败**，因为实施期会临时有未接线键） |
| markdown 残迹检测 | 无 | **新增**：值中含 `**` / `` ` `` ⇒ 失败（纯文本 UI 禁用） |
| 失败行为 | exit 1 | 保持 exit 1 |

> 🔴 **门禁的致命风险是「恒红」**。上一轮 §9.7 的教训：`sed | grep` 写法会扫到键名与注释 ⇒ 永久命中 ⇒ 门禁退化。**本轮必须值级扫描 + 黑名单只含本轮真改的词**。
> ⚠️ 「孤儿键检测」**只报告不失败**（会与并行开发冲突），失败项只进台账。

#### T-P2-3：孤儿键台账（新增资产）

新建 `docs/copy-orphan-keys-2026-10.md`，逐条记录 §2.3 的 21 个键，每条给出**判断结论**（用户已定「先出清单，逐个判断去留」）：

| 判断类别 | 处理 | 示例 |
|---------|------|------|
| **重复键** | 删（zh/en 同批） | `learn.import.formatNote/Web/Txt`（并入 `learn.format.*`） |
| **功能未接线** | 保留，标注「等 T-xxx 接线」 | `learn.detail.papers.noPapers`、`quiz.center.sectionGrading` |
| **功能已被别的键覆盖** | 删 | 待逐条判断 |
| **疑似误判** | 保留 | `learn.detail.metaLine`（实测有 2 处命中） |

> ⚠️ **删键纪律**：zh/en 同批；删前全仓 grep 确认（含 `docs/` 与 `tests/`）；`test:i18n` 会在删后仍绿（它只锁同构），**必须人工核对 en 侧也删了**。

#### T-P2-4：定位语统一（§5.1 的执行批）

与 §5.1 合并成一批提交：UI 键 + `index.html` + `package.json` + README 双语 + badge。

> 🔴 **README 双语严格对齐 + 顶部统计行手工同步**（`AGENTS.md` 硬约束 + 记忆陷阱：统计行是硬编码文字，`grep -c` 数不到）。

---

## 6. 任务清单

| ID | 任务 | 档 | 依赖 | 复杂度 | 验证 |
|----|------|----|------|--------|------|
| T0 | **收口上一轮未提交文件**（`docs/settings-left-menu-layout-*.md` 2 个 + `scripts/settings-copy-scan.mjs`） | — | — | S | `git status` 干净；`copy:check` 仍绿 |
| T1 | `FORMAT_OPTIONS` 改走 `learn.format.*`；删 `learn.import.formatNote/Web/Txt` | P0 | T0 | S | en 切英文后两个下拉显示 `Notes/Web/Plain text`；`test:i18n` 绿 |
| T2 | `memory.privacyMaskNote` 去 `**` + 改写口径 | P0 | T0 | S | `MemoryAiDialog` 渲染无 `**` |
| T3 | `learner.subtitle` 改写 | P0 | T0 | S | 与 `memory.subtitle` 句式对齐 |
| T4 | `/spaces` 处置（按 D4 结论执行 A/B/C 之一） | P0 | D4 确认 | S/M | 路由可达性 + 文案复核 |
| T5 | `settings.embedding` 整卡术语替换 + `VectorIndexCard` 信息结构重排 | P1 | T0 | L | **数字口径与代码常量核对**（分母/内存/维度） |
| T6 | `learn` 向量/索引系列 6 条 + `learn.reader.qa.emptyIndex` | P1 | T5 | S | 与 T5 术语一致 |
| T7 | `learn.import` OCR 8 条 + 错误文案 4 条 | P1 | T0 | M | 数字（50 页）保留 |
| T8 | 其余散点（`loadFailedDesc` ×2、`docScopeHint`、`readyTooltip`） | P1 | T0 | S | |
| T9 | **术语表** `docs/copy-terminology-2026-10.md` | P2 | T5–T8 | M | 与实际改动一致 |
| T10 | **门禁扩到全量**：`scripts/copy-scan.mjs`（含硬编码 / markdown 残迹 / 孤儿键报告） | P2 | T9 | M | **反向自检**：改动前的字典喂进去 ⇒ 命中数 > 0（证明不是恒绿） |
| T11 | **孤儿键台账** `docs/copy-orphan-keys-2026-10.md`（21 条逐条判断） | P2 | T1 | M | 结论与实际删改一致 |
| T12 | **定位语统一**：UI 键 + `index.html` + `package.json` + README 双语 + badge | P2 | T9 | M | README 双语对齐；统计行手工同步；badge 已换 |
| T13 | 全量门禁 + 文档回扫 + 提交收口 | — | T1–T12 | S | 见 §8.3 |

**提交粒度**：T1–T13 各自独立提交，每提交可编译、相关门禁绿。
**文案提交纪律**（沿用上一轮 §10 的教训）：

| 纪律 | 理由 |
|------|------|
| zh/en **同一提交** | `test:i18n` 只锁键同构、不锁值 ⇒ 拆两次提交，中间态是「中文已改、英文还是旧文案」 |
| 删键与**接线同批** | 删键单独提交会留下「没人消费的键」，`test:i18n` 不报错 ⇒ 静默腐烂 |
| 逻辑修正与文案**分开提交** | 独立可验证的行为 vs 纯措辞，混在一起以后查不出是哪个改动修的 |
| README / meta / `package.json` **单独一批** | 对外文案，revert 粒度独立 |

---

## 7. 门禁与判据

### 7.1 自动门禁

```bash
npm run typecheck     # 0 error
npm run layer:check   # 无新增环
npm run ui:check      # 无新增违规
npm run test:i18n     # 绿（键同构）
npm run copy:check    # 新版：全量值级扫描 + 硬编码 + markdown 残迹
```

### 7.2 `copy:check` 的黑名单（**只含本轮真改的词**）

| 词 | 为什么在列 | 为什么不在列 |
|----|-----------|-----------|
| `localStorage` / `SQLite` / `Keychain` / `Tauri` | 内部实现 | |
| `Pre-MVP` / `Workbench` | 阶段代号 | |
| `src/` 路径 | 源码路径 | |
| `**` / `` ` `` | markdown 残迹 | |
| `Embedding` / `向量` | 本轮 P1 真改 | ~~`块`~~（P1-1 改「块」但 `countLabels.chunks` 刻意保留 ⇒ **不入黑名单**） |
| `数据库`（中文） | 本轮真改 | |
| `领域模型` | 本轮真改 | |
| ~~`索引`~~ | T6 改说法但 `settings.embedding` 术语表里「索引」是**用户语言** | ❌ **不入** |
| ~~`OCR`~~ | 功能名（C/E 类） | ❌ **不入** |
| ~~`Markdown` / `PDF` / `EPUB`~~ | 文件格式名（E 类） | ❌ **不入** |
| ~~`API Key` / `Base URL`~~ | 外部参数（C 类） | ❌ **不入** |
| ~~`本地优先`~~ | 核心卖点（F 类，README 保留） | ❌ **不入**（UI 侧 `nav.brandSub` 改值但该词仍在 `app.metaDescription` 改写后消失 ⇒ 需在实施时确认） |

> 🔴 **这张表就是「恒红门禁」防线**。每一行「不在」都对应一个「本轮真会改的词」——若实施时把某个「不在」的词也改了，**必须回来更新这张表**，否则门禁与实际不符。

### 7.3 人工判据（自动门禁覆盖不到的部分）

| # | 判据 | 方法 |
|---|------|------|
| 1 | 每句都能回答「这对我有什么用」 | 逐句朗读；不懂技术的用户会不会追问「那是什么」 |
| 2 | 数字口径与代码常量一致 | 读 `engine/quiz-engine.ts`、`services/learn/index-service`、`ai/builtin` 核对 |
| 3 | en 侧不是中文句式直译 | 母语感检查 |
| 4 | README 双语段落结构对应 | 逐段对照 |
| 5 | 切 en 后界面无中文残留 | 全页面走查（含下拉、按钮、空态、错误态） |

---

## 8. 测试方案

### 8.1 测试范围

| 层级 | 工具 | 覆盖 | 不负责 |
|------|------|------|------|
| 单元 | `npm run test:i18n` | zh/en 键同构（**本轮有删键** ⇒ 两侧必须同时删） | 值是否合理 |
| 静态 | `npm run typecheck` | 类型、删键后 `Messages` 约束、**新键是否存在** | 运行时 |
| 静态 | `npm run layer:check` | 无新增模块环 | — |
| 静态 | `npm run ui:check` | 无原生下拉、sticky 无 blur | 文案 |
| **文案** | `npm run copy:check`（新版） | 全量值级技术词 + 硬编码中文 + markdown 残迹 | 语义是否失真 |
| 手工 | dev 走查（**不启浏览器自动化**，仓库规则 `no-headless-browser-validation`） | 双语切换、每个受影响页面、空态与错误态 | — |

### 8.2 通过标准

`typecheck` 0 error；`layer:check` 无新增环；`ui:check` 无新增违规；`test:i18n` 绿；`copy:check` 全量 0 命中；孤儿键台账结论与实际删改一致；README 双语对齐；**受影响页面逐条走查通过**。

### 8.3 反向自检（证明门禁不是恒绿）

| 门禁 | 改动前喂入 | 期望 |
|------|-----------|------|
| `copy:check` 全量 | 改动前的 `HEAD` 版本字典 | **命中数 > 0**（zh ≥ 60 / en ≥ 45，实测基线） |
| `copy:check` markdown 残迹 | 改动前字典 | **≥ 1**（`memory.privacyMaskNote`） |
| 硬编码中文扫描 | 改动前 `dialogs.tsx` | **≥ 1**（`FORMAT_OPTIONS`） |

> 🔴 这三条是本轮门禁的**可信度证明**，缺一即门禁不可信。

---

## 9. 风险与遗留

### 9.1 风险登记册

| 编号 | 风险 | 类别 | 概率 | 影响 | 等级 | 应对 |
|------|------|------|------|------|--------|------|
| RK-01 | **门禁恒红**（黑名单含本轮不打算改的词） | 技术 | 中 | 高 | 高 | §7.2 表逐行写明「在/不在」；实施中改了就回来更新 |
| RK-02 | **删错键**（孤儿键其实有动态消费方） | 技术 | 中 | 中 | 中 | 删前全仓 grep（含 `docs/` `tests/`）；台账逐条判断；zh/en 同批 |
| RK-03 | **数字口径改错**（块数 vs 资料数、维度、内存） | 数据 | 中 | 高 | 高 | T5 强制读代码常量核对；**只换说法不改数字** |
| RK-04 | **README 双语失对齐** | 数据 | 中 | 中 | 中 | 同批改 + 逐段对照 + 统计行手工同步 |
| RK-05 | **改文案顺手改了 AI 行为**（`src/ai/**` 的中文是 prompt） | 体验 | 低 | 高 | 中 | 本轮**明确不动** `src/ai/**`；硬编码扫描排除该目录并在脚本注释写明 |
| RK-06 | **孤儿键检测与并行开发冲突** | 进度 | 高 | 低 | 中 | 孤儿键检测**只报告不失败**；台账进 docs 不进 CI |
| RK-07 | **上一轮未提交文件被并行会话裹走** | 进度 | 中 | 中 | 中 | T0 先行收口；`git add` 用精确路径 |
| RK-08 | **用户界面文案被误当作产品说明改掉**（如「本地优先」章节） | 需求 | 中 | 中 | 中 | §3.1 F 类：核心卖点保留；改动前逐条对照 §5.1-C 表 |
| RK-09 | en 侧句子过长撑破布局（术语替换后长度变化） | 体验 | 低 | 低 | 低 | 替换后长度基本持平（口语化通常更短）；侧栏/卡片宽度已有 `truncate` 兜底 |

### 9.2 待用户确认的决策点

| ID | 决策点 | 选项 | 推荐 | 影响 |
|----|--------|------|------|------|
| **D4** | `/spaces` 占位页怎么处置 | **A 下线路由** / B 保留并改写文案 / C 标注未开放 | **A** | A 会删 `spaces` + `scaffold` 命名空间（zh/en 同批），断链 `/spaces` 重定向到 `/`；B 写不出真实内容；C 保留减分项 |
| **D5** | `nav.brandSub` 已被注释——是否顺手取消注释让它显示？ | A 保持注释（只改字典值） / B 取消注释并在侧栏显示 | **A** | B 会在侧栏品牌区加一行字，是**独立的 UI 决策**，不该由文案优化顺带做 |
| **D6** | README badge `pre--MVP` → `preview` 之外，README 正文中若提到「本版为 Pre-MVP 里程碑（U6 · UI Workbench 收官）」类句子，是否一并改写？ | A 一并改写 / B 保留（作为项目历史记录） | **A** | README 是对外门面，里程碑代号属于内部管理语言；A 需同步改 en 侧 |

### 9.3 明确不做

| 内容 | 理由 |
|------|------|
| `src/ai/**` 的中文 prompt | 改它 = 改 AI 行为，属功能变更而非文案优化 |
| `src/i18n/messages/**` 的**键名** | 用户看不见；改名 = 跨文件重命名，收益为零 |
| `data-testid` / URL 段 / Rust 协议常量 | 技术标识 |
| emoji（28 处成功态标记） | 与 `rules/react.mdc`「状态色仅 dot/徽标」不冲突，是刻意设计 |
| `countLabels` 的实体名（切片/向量/证据等 3 个括注之外） | 上一轮已定：准确指代「清掉了什么」，改了反而失真 |
| `Base URL` / `模型名` / `API Key` / `Markdown` / `PDF` / `OCR` | C/E 类，用户必须按原样识别 |
| README 的「本地优先」核心章节 | F 类：产品核心卖点 |
| 文档（`docs/**`）的措辞 | 本轮是**用户可见文案**优化；docs 是工程文档，两者口径本就不同 |

---

## 10. 实施步骤

1. **T0**：收口上一轮未提交文件（`git add` 精确路径 + 单独提交）。
2. **T1–T4（P0 批）**：先修硬缺陷。T1 同批删 `formatNote/Web/Txt`；T4 按 D4 结论执行。
   - 每条改完立即跑 `typecheck` + `test:i18n` + `copy:check`。
3. **T5（P1 最大块）**：`settings.embedding` 整卡。**先读代码常量核对数字**，再改文案，再重排 `VectorIndexCard` 信息结构。
4. **T6–T8（P1 剩余）**：术语一致化 + OCR/错误文案 + 散点。
5. **T9（术语表）**：**必须在 T5–T8 之后**——表是从实际改动里提炼的，不是先写表再套。
6. **T10（门禁）**：改造脚本，跑**反向自检**（§8.3 三条）。
7. **T11（孤儿键台账）**：逐条判断。
8. **T12（定位语）**：UI + meta + package.json + README 双语 + badge 同批。
9. **T13**：全量门禁 + 文档回扫 + 提交收口。

**回滚策略**：纯文案 + 少量组件接线，**无数据/迁移/存储副作用**。T1–T13 各自独立提交 ⇒ 任何一批可单独 `git revert`。⚠️ 唯二需注意的：**删键提交**（revert 会同时恢复 zh/en 两侧）与 **README 提交**（revert 需同步恢复统计行）。

---

## 11. 交付物清单

| 类型 | 路径 |
|------|------|
| 设计文档 | `docs/copy-optimization-design-2026-10.md`（本文） |
| 执行手册 | `docs/copy-optimization-runbook-2026-10.md`（实施时创建） |
| 术语表 | `docs/copy-terminology-2026-10.md` |
| 孤儿键台账 | `docs/copy-orphan-keys-2026-10.md` |
| 门禁脚本 | `scripts/copy-scan.mjs`（由 `scripts/settings-copy-scan.mjs` 演进） |

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-10-20 | 初稿。基于实测（zh/en 各 1830 叶子值 / 24 命名空间 / 技术词命中 zh 82 · en 64 / 孤儿键 21 / spaces 占位页 / FORMAT_OPTIONS 硬编码中文 / privacyMaskNote markdown 残迹）制定三档方案。已拍板：范围＝三档全做、定位语＝UI 与 README 一起改、孤儿键＝先出清单逐个判断。待确认：D4（spaces 处置）、D5（brandSub 注释）、D6（README 里程碑句） | Agent |
