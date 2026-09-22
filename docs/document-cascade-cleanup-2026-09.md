# 资料删除级联收口 —— 「证据流清理」的真相与同族 6 项补齐

> **范围**：遗留清单上的「⑤ `deleteDocumentCascade` 证据流清理」（`raw-id-label-fix` §7、
> `evidence-log-idempotency-fix` §7.1、`tech-debt-closeout` §4 三处同口径标「**待拍板**」）。
> **结论一句话**：**证据流不该清**（它是行为历史，清了等于回溯改写已发生的事实）；
> 而级联**确实漏了同族的 6 项**派生学习资产 —— 已补齐。
> **日期**：2026-09-22 ｜ **状态**：已实施

---

## 1. 立项依据：三处实测与文档记载不符

按仓库规矩「文档说『未做 / 缺口』→ 先实测再排期」，逐条对过 `local.ts` 的 24 个存储 key：

| 实体 | 文档怎么说 | 实测（2026-09-22） |
|---|---|---|
| 批注 `plos.annotations` | 三份文档**都没提** | ✅ **早已被级联删** —— `memory.ts::forgetDocument:123-126`，且是 `learn-highlight-note-design:337` 的**既定决策**（「否则留下指不到正文的孤儿」） |
| chunks / 向量 | `data-portability…:273` 说「`deleteDocument` 只级联章与批注，**不清 Section/Chunk**」 | ⚠️ **对 chunk 已过时** —— `document-cascade.ts` 步骤 0（rag-wiring T14）早已清 chunk + 向量；**对 Section 曾成立**（本轮才补） |
| 证据流 `plos.evidence` | 「未补证据流清理」（待拍板） | ⚠️ 它的消费方**全都不看主体、只看行为** ⇒ 不该按主体清（见 §3） |

> **教训（已回填 `skills/doc-truth-rescan`）**：一句话里可以同时有「已过时的半句」与
> 「仍成立的半句」。回扫时别整句删或整句留 —— **按半句拆开分别处置**。

## 2. 实测漏掉的同族 6 项

判据统一为一句话：**主体（章）随资料消失 ⇒ 这条数据永久指不到真源**。

| # | 实体 | 索引 | 为何必须回收 | 本轮处置 |
|---|---|---|---|---|
| ① | `plos.restatements` | `chapterId` + `documentId` | 由章派生；**含用户手写原文**，与「批注随资料删」是**同一条口径**，两条规矩只差一处会自相矛盾 | 删 |
| ② | `plos.flashcards`（`CardState`） | `chapterId` + `documentId` | 卡面每次由 `Chapter` 派生，章没了卡也不存在 | 删 |
| ③ | `plos.learner.byUnit` | 章 id | **真源是卷面**，而卷面已在步骤 1 删除 ⇒ 留着就是第二把尺子（`/learner` 平均掌握度的分母） | 删该资料的章键 |
| ④ | Section 层 | `chapterId` / `documentId` | 与 chunk 同级冗余；步骤 0 清了 chunk 却漏了它 | 删 |
| ⑤ | `plos.goals[].requiredChapterIds` | 章 id | 悬空指针 ⇒ 目标范围静默退化 | **剔悬空 id，剔空则不动**（见 §4） |
| ⑥ | `plos.knowledge-packs.v1[].documentIds` | 资料 id | 详情页溯源行会指向已删资料 | 剔 id，**包记录保留**（另一半职责是「导入过了」的去重提示） |

**消费方已过滤 ≠ 已清理**：`analytics.ts:354`（弱点榜）与 `aggregate.ts:56`（`/learner`）都
显式跳过「解析不到主体」的 `byUnit` 键。可见症状因此为零 —— 但过滤是**兜底**，
不是**清理**：真源（试卷）已经不存在，留着键只是把错误数据交给每个消费方各自处理。

## 3. 为什么不修证据流（决策 D1）

「补证据流清理」曾三处挂账。实测后**结论是反向的**：它与上面 6 项**性质不同**。

| 消费方 | 只用到 | 按主体删行的后果 |
|---|---|---|
| `/progress` 热力图 | `at` **逐日计数**（`analytics.ts:38`） | 「我上周学了 5 次」→ 回溯变 3 次 |
| F9 记忆 · 节奏 / 学习模式 | `at` / `kind` **分布**（`memory-facts.ts:81,163`） | 「你常在 22 点学习」结论被改写 |
| 首页「最近证据」 | 主体标题 | 唯一真实缺陷（幽灵行）→ **改消费侧跳过** |

三处**全都不需要主体**。即 `plos.evidence` 是**行为历史**，不是「指向主体的派生态」——
按主体删等于**回溯改写已经发生的事实**。它的上限机制（`EVIDENCE_LOG_MAX` 环形丢最旧）
本来就在表达「**按容量衰减，不按主体衰减**」。

**顺带纠正**：`appendEvidenceUnless` 的契约是 **append-only**，仓库里从来没有过删除证据的
适配器方法 —— 「未补清理」之所以拖了三轮，是因为它**不是遗漏，而是口径冲突**，
当年标「待拍板」是对的。

### 3.1 因此仓库里**没有**新增任何证据删除 API

改动落在消费侧（`HomePage::logToView`）：**章解析不到 ⇒ 该行不渲染**。

- `logToView` 返回 `EvidenceView | undefined`；调用方 `filter` 掉；
- ⚠️ **先过滤再截断**（`.map → .filter → .slice(0, 6)`）：先 `slice` 会让幽灵行白占掉
  真实行的名额，用户看到「最近证据只有 2 条」却不知道另外 4 条被谁占了；
- **目标级（`capability`）行仍保留**（`capability.evidenceFallback`）：它自带 `verdict`，
  且不引用已删内容 —— 与章级行不同，它没有「指不到主体」的问题；
- ⚠️ **别把这条改动搬到 `/progress`**：趋势下拉**仍然保留**已删章的序列并回落
  `units.subjectGone`（`TC-RAWID-01/03` 锁的正是「历史序列不因解析失败而剔除」）。
  首页证据行 = 当前资产视图，趋势序列 = 历史序列，**两种不同的展示**。

## 4. 一个必须保留的例外：目标范围「剔空则不动」

`goal-util.ts:46` 的 `scopeOf` 把**空** `requiredChapterIds` 读作「**全库回退**」。
于是「把悬空 id 剔干净」有一个致命副作用：

```
用户有一个圈了 3 章的目标 → 那 3 章所属的资料被删 → 剔空 ⇒ 目标范围变「全库」
⇒ 该目标静默把用户**其它所有资料**的章都纳入范围
```

**限定目标被静默变成全局目标**，比留着悬空 id（该目标退化为 0 章，诚实）错得更远。
故实现为：`kept.length === 0` 时**不动**该目标（`goal-only-a` 的守卫用例 = TC-CASC-06）。
同理 `kept.length === required.length`（无变化）时跳过写入，避免无谓落盘。

## 5. 改动清单

| 文件 | 改动 |
|------|------|
| `src/features/learn/document-cascade.ts` | 新增 `purgeDerivedAssets()`（§2 的 6 项）；步骤编号 3→4 顺延；**文件头新增「为什么证据流不在这里清」的论证表**（含三处消费方与后果） |
| `src/features/home/HomePage.tsx` | `logToView` 返回 `EvidenceView \| undefined`，章解析不到即跳过；`loadRecentEvidence` 改为先过滤再截断；`logToView` 注释改为**两个历史时点**（09-21 保留占位 → 09-22 改跳过），不删旧句 |
| `tests/document-cascade.test.ts` | **新增 12 例**（见 §6） |
| `package.json` | `test:cascade` 新增，并串入 `test:library` |

**未改**：`storage/types.ts` 与三个适配器（**零存储契约变更** —— 全部复用既有方法：
`deleteRestatement` / `deleteCardStates` / `saveLearnerState` / `deleteSection` /
`saveGoal` / `saveImportedPack`）、`src-tauri/**`、`DeleteReport` 与删除确认弹窗文案。

### 5.1 为什么不动删除确认弹窗（DeleteReport）

弹窗的既有口径是报**结构化学习资产**（章节 / 试卷 / 概念 / 块数）—— 证据是**批注**
（同样是用户原创内容，同样在库内被级联删除）**从来就没进过这个列表**。
单把「复述」加进去会制造新的不一致（批注不报、复述报），且要动 i18n 双语成对 +
`DeleteDocDialog`。**保留现状口径**，把事实写在本文件里。

> ⚠️ **已知的诚实缺口**：用户在删除确认弹窗看到的数字**不包含**复述与笔记的数量。
> 如果希望弹窗如实告知「将同时删除 N 条复述、M 条笔记」，那是**另一次改动**
> （`DeleteReport` + `dialogs.tsx` + i18n 成对），本轮刻意不做。

## 6. 验收与守卫

`tests/document-cascade.test.ts`（**12 例**，`npm run test:cascade`，已并入 `npm run test:library`）：

| 用例 | 锁定内容 |
|---|---|
| TC-CASC-01 | 既有能力不回归：资料本体 / 章节 / 试卷清理，**旁观资料零改动** |
| TC-CASC-02/03/04/05 | 复述 / 卡状态 / 章级掌握度 / 小节：**本资料清、他资料不动**（成对写入才验得出） |
| TC-CASC-06 | 目标范围剔悬空 id；**剔空则原地不动**（§4 的语义翻转防线） |
| TC-CASC-07 | 包溯源剔 id、**包记录保留** |
| TC-CASC-08 | **反面口径**：证据流一条不少（含指向被删章的旧证据） |
| TC-CASC-09 | **源码守卫**：级联模块不得出现 `listEvidence` / `deleteEvidence`（剥注释后判） |
| TC-CASC-10 | 源码守卫：`logToView` 章解析不到即 `return undefined`；不得再用 `subjectGone` 占位；**filter 必须早于 slice** |
| TC-CASC-11 | `previewDeleteCascade` 纯只读（复述 / 卡 / 小节 / 掌握度四项逐一断言） |
| TC-CASC-12 | 对不存在的资料调用是幂等空操作，且不误改目标范围 |

**负向验证（守卫非假绿，5 组实跑）** —— 全部干净变红：

| 变体 | 变红的用例 |
|---|---|
| 去掉 `purgeDerivedAssets` 调用 | TC-CASC-02 ~ 07（6 例） |
| `logToView` 恢复 `subjectGone` 占位行 | TC-CASC-10 |
| 把 `slice(0, 6)` 挪到 `filter` 之前 | TC-CASC-10 |
| 目标范围「剔空也写回」 | TC-CASC-06 |
| 级联里插一行 `await store.listEvidence()` | TC-CASC-09 |

**门禁**：`npm run typecheck` 仅剩既存 3 条 `AIModelsSection` 基线；`test:cascade` 12/12；
`test:library` 全链 exit=0。本轮**无用户可见新增文案** → 无 i18n 改动。

## 7. 遗留（本轮**未做**，非「漏做」）

| 项 | 状态 | 说明 |
|---|---|---|
| 删除确认弹窗补报复述 / 笔记条数 | **未做** | §5.1：需扩 `DeleteReport` + i18n 成对，属另一次改动 |
| 历史孤儿数据的**一次性**清理 | **未做** | 截至 2026-09-21 的存量孤儿（`doc-418a4116` 系列）已在 `evidence-log-idempotency-fix` §7 盘点；试卷侧已清，其余随「删下一份资料」自然收敛 —— 存量清理需单独拍板 |
| 重切分（非删资料）路径的同类孤儿 | **未做** | `resplit-mastery` 已迁移 `byUnit`；证据流与复述的重切分重定位不在本轮范围 |
| 出卷难度引入 `cognitiveLevel` 权重 | **未做** | `#11` 的另一层，产品决策未拍板（见 `tech-debt-closeout-2026-09.md`） |

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-22 | 初稿即定稿：实测推翻「证据流是遗漏」（实为口径冲突）、补齐同族 6 项、新增 12 例守卫（5 组负向验证） | Agent |
