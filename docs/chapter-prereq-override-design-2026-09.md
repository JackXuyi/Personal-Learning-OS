# 章级前置人工调整（F7 范围 4）技术方案

| 字段 | 内容 |
|------|------|
| 作者 | Agent / 许一 |
| 日期 | 2026-10-10 |
| 状态 | 已实施（2026-10-10） |
| 关联需求 | `docs/roadmap-next-features-plan-2026-09.md` §F7 范围 4（`P2 · 小~中`）；`docs/code-gap-review-2026-09.md` 缺口 #6 |
| 前置阅读 | `docs/knowledge-sqlite-prereq-plan-design-2026-09.md`（D2 自动推导那一条的原始设计） · `docs/chapter-edit-design-2026-09.md`（F7-a/F7-b 的表单与落库范式） |

---

## 1. 要解决的问题

章与章的先后关系**已经存在**，但用户改不了：

- 它由概念层的 `prerequisite` 边**抬升**而来（`domain/knowledge.ts::chapterPrerequisiteIds`）；
- 边本身来自 AI 抽取（`ai/concept-map-reduce.ts`），**没有任何人工增删入口**
  （`saveRelation(s)` 的生产调用点只有数据迁移与知识包导入）；
- 于是两类偏差无法纠正：**漏判**（用户明知 B 依赖 A，AI 没抽出来）与**误判**
  （两章其实互相独立，却因一条概念边被排成先后）。

**影响面**（为什么值得做）：章级前置参与 `buildChapterPlan` 的**软排序**，
下游是首页「今日主行动」、`/plan` 计划页、判卷报告页的「生成学习计划」——
标注错了会让用户看到/走错顺序（不阻断，但天天看见错误的理由）。

**范围界定**：只做「章 ↔ 章」的人工修正。**不做**概念层关系的直接编辑
（那是概念图谱的事，且会污染 `KnowledgeUnit` 的抽取语义）。

---

## 2. 否决的方案：给 `Chapter` 加字段

最直觉的做法是 `Chapter.prerequisiteOverrideIds`（roadmap 里也是这么写的），
**实测后否决**：

| 否决理由 | 证据 |
|---|---|
| 存储是**列式显式列**，加字段必然连带 Rust 侧 | `src-tauri/src/db/schema.sql:182-194` 的 `chapters` 表逐列声明；DTO 逐字段映射（`storage/tauri.ts:136-149,199-228`） |
| 加列 = 表结构变更 = `_schema_version` +1 + 迁移步骤 | `schema.sql:197-201`：结构变更时 +1 并在 Rust 侧补迁移；当前 v5 |
| 与「`src-tauri/**` 零改动」的既有约束冲突 | 该约束是本仓库的硬边界（改动面大、无法在本环境的自动门禁里验证迁移正确性） |
| 不映射就是**静默丢数据** | 只在 TS 侧加字段、`toChapterDto` 不映射 → 桌面端一重启就丢，比不做更糟 |

⇒ 改为**独立持久化实体**，沿用仓库既有的「新增 key → 无旧数据 → 零迁移」惯例
（F5 复述/卡片/批注、F6 能力、F9 记忆、F10 包记录都是这条路）。

---

## 3. 决策

| # | 决策 | 理由（含被否决项） |
|---|---|---|
| **D1** | 覆盖语义 = **增量**（`added` / `removed`），**不是**整体替换 | 整体替换会在概念**重新抽取**后冻结成一份过时清单（新边进不来）；增量让自动推导始终保留，人工只做修正。副产品：「恢复自动」= 清空记录，天然可得 |
| **D2** | 独立实体 `ChapterPrereqOverride`，主键 `chapterId` | 见 §2。一个章至多一条记录，`added`/`removed` 都是章 id 数组 |
| **D3** | 合并的**唯一实现**在 domain（`chapterPrerequisiteIds` 接受 `overrides`），UI 不自己算 | 仓库的「两把尺子」防线：同一规则两处实现，改口径必漏一处。UI 侧另给 `chapterPrereqEntries`（带来源标记的视图），内部走**同一个** `prereqEntriesCore` |
| **D4** | 计划引擎的取值门 = `graph != null \|\| overrides.size > 0` | 人工项不该依赖「概念抽取是否跑过」。**只有人工覆盖、没有图时照样生效**；两者都无 = 现状行为（零回归） |
| **D5** | 人工项**不按调用范围过滤** | `chapters` 参数是「本次要排的章」，而人工项是用户对**全局**的声明。范围过滤交由下游既有的一道（`learning-planner.ts` 的 `chapterById.has(pid)`） |
| **D6** | UI 落点 = 资料详情页**新增「前置关系」Tab** | 候选是「本章之外的全部章」，行内放不下；且需要同时显示「哪些是自动的、哪些是自己加的」。不复用「章节列表」Tab：那里已经承载切分/精修/改名/合并/拆分/排序，再塞关系编辑会变成一锅粥 |
| **D7** | 编辑范围 = **同一份资料内**的章 | 概念抽取按资料进行，跨资料的章级前置极罕见（只在整库导入的图里可能出现）；且下游按范围过滤，不会出错。**如实写在页内说明里**，不假装支持 |
| **D8** | 空记录**不落库**（`added` 与 `removed` 双空 → 删除记录） | 空记录与无记录语义相同，留着只会长出无意义的行；也让「恢复自动」只有一种表示 |
| **D9** | 孤儿记录**不级联清理**（章/资料被删后记录残留） | 与证据流同口径：清掉等于改写用户历史；消费侧本来就按「章是否还在」兜底（D5 + `chapterById` 过滤）。清库（`clearAll`）除外 —— 那时全库已空，留着纯属脏 key |
| **D10** | 进 F4 导出白名单 | 人工修正**不可再生**（不像向量、章节结构那样能重算），丢掉就是真丢。字段设为 `optional` + `countsEqual` 缺键按 0 容错 → **不升 `EXPORT_VERSION`**，旧包照常可导入（见 §5） |

---

## 4. 落点（逐层）

### 4.1 domain（`src/domain/knowledge.ts`）

```ts
export interface ChapterPrereqOverride {
  chapterId: string;
  added: string[];    // 人工新增（自动推导之外）
  removed: string[];  // 人工剔除（从自动推导里排除）
}

export interface ChapterPrereqEntry { chapterId: string; origin: "auto" | "manual"; }

function prereqEntriesCore(derived, override, selfId?)   // 单一合并实现（自环剔除、保序、去重）
export function chapterPrereqEntries(derived, override)  // UI 视图（带来源）
export function prereqOverrideMap(list)                  // 列表 → Map（口径一处）
export function togglePrereqOverride(current, chapterId, targetId, want, derived)
export function chapterPrerequisiteIds(graph, chapters, overrides?)  // 原签名 + 第 3 个可选参数
```

`togglePrereqOverride` 的归一化规则（**这是「不攒垃圾记录」的关键**）：

| 场景 | 结果 |
|---|---|
| `want=true` 且本来就是自动项 | 不写记录（与自动一致 = 无修正） |
| `want=false` 且本来就不是前置 | 不写记录 |
| `want=true` 且不是自动项 | 记入 `added`（并从 `removed` 移除） |
| `want=false` 且是自动项 | 记入 `removed`（并从 `added` 移除） |
| 两条清单都空 | 返回 `undefined` ⇒ 调用方删记录 |
| `targetId === chapterId` | 恒等返回（自环无效） |

### 4.2 存储（`src/storage/`）

| 文件 | 改动 |
|---|---|
| `types.ts` | `StorageAdapter` 末尾加 `listPrereqOverrides` / `savePrereqOverride` / `deletePrereqOverride` |
| `memory.ts` | 内存镜像字段 + 3 方法；**`listPrereqOverrides` 返回深拷贝**、按 `chapterId` 升序；`savePrereqOverride` 存入副本；`clearAll` 重置 |
| `local.ts` | 新 key `plos.chapter-prereq-overrides.v1`（load / `persistRest` / **`ALL_KEYS`** 三处同步）+ 2 个写方法的 `override` |
| `tauri.ts` | **零改动** —— 它只覆写了 `persistDocuments()`，其余 key 由继承来的 `persistRest()` 落 localStorage |

### 4.3 计划引擎（`src/engine/`）

- `learning-planner.ts`：`ChapterPlanInput` 加 `prereqOverrides?: ReadonlyMap<…>`；
  `buildChapterPlan` 的取值门见 D4；
- `loop.ts`：`runChapterLoop` 的 `Promise.all` 多读一项，`prereqOverrideMap(...)` 后传入
  （覆盖首页主行动 / `/plan` 两条下游）；
- `features/quiz/QuizReportPage.tsx`：`togglePlan` 里与 `getGraph()` 并排读一次。

### 4.4 UI（`src/features/learn/`）

| 文件 | 职责 |
|---|---|
| `prereq-service.ts` | `loadPrereqOverrides` / `applyPrereqToggle` / `clearPrereqOverride` —— 只做编排，判定全在 domain |
| `detail/PrereqTab.tsx` | 章列表 + 生效前置 chip（人工项带「人工」标）+「调整」入口 + 空态/无推导提示 |
| `detail/ChapterPrereqDialog.tsx` | 勾选候选（其余章）+「自动/人工」来源标记 +「恢复自动」 |
| `DocumentDetailPage.tsx` | `TAB_VALUES` 加 `prereq`、第 6 个 Tab（插在「关键知识点」与「章节试卷」之间） |

**操作即保存**（无草稿态），与章节编辑同体例。

### 4.5 i18n

`learn.detail.tabs.prereq` + `learn.detail.prereq.*`（18 键，zh/en 成对）；
`settings.storage.data.countLabels.prereqOverrides`（F4 条数明细用）。

---

## 5. F4 导出/导入（含向后兼容）

| 点 | 处置 |
|---|---|
| `BackupData` | 加 `prereqOverrides?: ChapterPrereqOverride[]`（**可选**：旧包不含此键） |
| `FIELD_SPECS` | 加 `{ key: "prereqOverrides", shape: "array", optional: true }` |
| `EntityCounts` / `COUNT_KEYS` / `countsOf` | 加一项（`data.prereqOverrides?.length ?? 0`） |
| `countsEqual` | **缺键按 0 计**（`?? 0`）——见下方「为什么」 |
| `export-service` | 与概念图并排全量读一次 |
| `import-service` | 与 `sections` / `restatements` 同口径按 `chapterIds` 过滤孤儿；冲突规则 = 「同 id 取导入侧」；`added`/`removed` 里指向范围外章的条目**不过滤**（惰性孤儿，过滤反而丢人工意图） |
| `EXPORT_VERSION` | **不升**（仍是 1） |

**为什么不升版本**：本键的语义是「缺省即空的可选集合」—— 旧包缺键与空数组**等价**，
没有需要迁移的状态。若为此升版本，反而会把「本来能导入的旧包」判成
`unsupported-version`（因为 `migrateBackup` 只认最新版）。

**为什么 `countsEqual` 要容错**：新版本给 `EntityCounts` 加了键之后，旧包 `counts` 里
没有该键，严格 `===` 会把它判成 `corrupt` —— 「防静默丢数据」的守卫反过来**拒收合法旧包**。
`?? 0` 不削弱守卫：被校验的一侧一律由 `countsOf(data)` 现算，
「声明缺失 + 实际有内容」仍然被抓（`5 !== 0`）；只有「缺失 + 实际为空」才放行，
而两者本就是同一信息。单测 `TC-UC06-06` 正反两面都锁住。

---

## 6. 测试与门禁

| 套件 | 覆盖 |
|---|---|
| `tests/chapter-prereq-override.test.ts`（**新增**，`npm run test:prereqoverride`） | A 合并语义（含空 Map ≡ 不传、自环、范围外人工项）· B 开关归一化（6 种抵消路径）· C 视图来源与保序 · D 存储（深拷贝/顺序/幂等/clearAll）· E 服务 · F 计划端到端（人工增删真的改变标注与排序、**无图时仍生效**、零回归）—— **30 项** |
| `tests/planner-prereq.test.ts` | D2 自动推导的软排序行为未回归（6 项） |
| `tests/data-portability.test.ts` | 样本加 `prereqOverrides`（`BACKUP_FIELDS`/`COUNT_KEYS` 20 → 21）；新增 `TC-UC06-06` 旧包兼容（正反两面） |
| 门禁 | `typecheck` 0 · `layer:check` 违规 0 / 新增环 0 · `ui:check` 原生下拉 0 / sticky 残影 0 · `test:i18n` · `test:common` 各套件不回归 |

---

## 7. 有意不做

| 不做 | 理由 |
|---|---|
| 概念层关系的直接编辑 | 那是概念图谱的职责；且会与 AI 抽取的语义打架（抽取结果下次会被覆盖） |
| 跨资料的章级前置编辑 | 概念抽取按资料进行 ⇒ 跨资料前置极罕见；做它要引入「按资料分组的候选列表」这一套 UI。**当前如实写在页内说明里** |
| 前置的可视化（有向图/依赖链） | 本页是「清单 + 勾选」，够用；画图属另一件事（`GraphView` 已有概念图层） |
| 撤销/重做 | 与章节编辑同口径（要引入编辑栈）。「恢复自动」提供了单章回退 |
| 前置的**硬阻断** | 现状是软排序（标注 + 同类内后移）。改硬阻断是**产品决策**（要不要拦住用户），不在本范围内 |
| 给记录加 `documentId` | 反范式：章 id 全局唯一，`chapterId` 已够定位；加它等于维护第二份真源 |

---

## 8. 边界与已知取舍

- **孤儿记录**（章被删/被合并、资料被删）留在存储里，消费侧按「章是否还在」兜底（D5/D9）。
  仅在 `clearAll`（清库 / replace 导入）时随库清空。
- **人工项指向范围外章**时，`chapterPrerequisiteIds` 会产出该条目，但计划侧
  `chapterById.has(pid)` 会把它挡在「前置未掌握」标注之外 —— 不会显示看不见的章名。
- **前半章保留 id 的拆分（F7-b）** 与「合并保留首章 id」都天然保住了覆盖记录的有效性
  （记录挂在 id 上，id 在则记录继续生效）。
- 本页只影响**计划排序**，**不影响**出卷范围、就绪度、报告逐章统计（那些不吃章级前置）。
