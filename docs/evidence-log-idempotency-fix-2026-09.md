# 证据流幂等写入修复（Evidence Log Idempotency Fix）

| 项 | 内容 |
|---|---|
| 状态 | ✅ **已实施**（2026-09-21；含存量数据修复） |
| 类型 | 缺陷修复（非新特性）→ README / roadmap 复选框不变 |
| 触发 | 真实 localStorage 快照的数据一致性审计 |
| 关联 | `docs/ui-workbench-plan-2026-09.md` §7.1（evidence log 薄层）· `docs/goal-capability-assessment-design-2026-09.md` D7（证据主体表达）· `docs/progress-analytics-design-2026-09.md`（热力图消费方） |
| 非目标 | ① 不改 `EvidenceEntry` 类型；② 不改证据流上限 `EVIDENCE_LOG_MAX`；③ 不动孤儿引用清理策略（只登记）；④ 不改概念管道；⑤ 不做浏览器级校验（`rules/no-headless-browser-validation.mdc`） |

---

## 1. 缺陷：同一份判卷落了 2 条完全相同的证据

### 1.1 取证（真实库，非看代码）

`~/Library/WebKit/personal-learning-os/…/LocalStorage/localstorage.sqlite3`（value 为 UTF-16LE blob）：

```
plos.evidence 共 12 条，**全部 kind = "assessment"**，恰好是 6 组"完全相同的对"：

  at=1788932763293  chp-595164ae  paper-eb0984ba  ×2
  at=1789004862956  chp-595164ae  paper-c6ab7436  ×2
  at=1789108988799  chp-595164ae  paper-84471971  ×2
  at=1789117064683  chp-1e79433b  paper-08c78f50  ×2
  at=1789118133585  chp-1e79433b  paper-8f512d42  ×2   ← 这对差 1ms（3585 / 3586）
  at=1789533317932  chp-53915b6d  paper-be3d6e6f  ×2
```

**5 对 `at` 精确到毫秒相同、1 对差 1 毫秒** —— 这是同一纳秒级窗口内两次并发的特征，
不是「用户点两次」（人手不可能毫秒级重复）。

### 1.2 根因链

| # | 事实 | 位置 |
|---|---|---|
| 1 | 幂等是**调用方自己**实现的 `listEvidence()` → `some()` → `appendEvidence()`，**跨两次 `await`** | `features/quiz/QuizReportPage.tsx::logAssessmentEvidence`（旧 `:84-116`） |
| 2 | 该函数由 `useEffect([paperId])` 调用 | 同上 `:135-172` |
| 3 | 入口挂了 `<React.StrictMode>` → **开发态 effect 双执行** | `src/main.tsx:13` |
| 4 | 两个调用都在对方的 `appendEvidence` 之前读到**同一份旧快照** → 双双写入 | — |

即：**「读—判—写」跨 `await` 边界 = 非原子的 TOCTOU**。生产构建下 effect 不双执行，
但同一页面两次并发挂载 / 快速重入仍可复现，缺陷本身与 StrictMode 无关，StrictMode 只是
把它从「偶发」变成「每次必现」。

### 1.3 用户可见后果

| # | 后果 | 位置 |
|---|---|---|
| 1 | **学习活动热力图活动量虚增一倍** —— `buildHeatmap` 按 evidence 条数逐条计数，assessment 日显示 2 倍 | `features/progress/analytics.ts::buildHeatmap` |
| 2 | **首页「最近证据」连续出现两条一模一样的行** —— `log.slice(0, 6)` 无去重 | `features/home/HomePage.tsx::loadRecentEvidence` |
| 3 | **F4 导出把重复数据当用户资产带走** | `features/data/portability/export-service.ts` |

---

## 2. 修复方案

### 2.1 决策（2026-09-21 结构化确认）

| ID | 决策 | 取 |
|---|---|---|
| **D1** | 幂等原子性放在哪一层 | **下沉到存储层**：新增 `appendEvidenceUnless(entry, predicate)`，把「查」与「写」放进同一段同步代码；调用方的三步整体删掉。备选（调用方模块级在途闸门）只挡同进程并发且只能源码级断言，不采 |
| **D2** | 存量 6 对重复怎么处理 | **改完代码顺手做一次去重修复**（先备份、演练、再写回、后校验） |
| **D3** | 「章已删 → 首页显示裸 id」是否同批修 | **同批修**（见 §4） |

### 2.2 为什么幂等键必须由**调用方**给

存储层刻意**不**自作聪明按 `(kind, sourceId)` 去重 —— 不同 kind 的语义不同：

- `assessment`：同一份试卷只落一条（幂等键 = `sourceId`，试卷 id）；
- `card`：**同一张卡可以反复评分**，`sourceId` 是卡 id，按它去重会把卡片证据永久压成 1 条。

故接口签名为 `appendEvidenceUnless(entry, predicate)`，`predicate` 表达「已存在重复吗」。
`tests/evidence-once.test.ts::TC-EV-04` 专门锁这条：同 `sourceId` 的 card 证据必须能落 2 条。

---

## 3. 代码改动

| 文件 | 类型 | 改动 |
|---|---|---|
| `src/storage/types.ts` | 修改 | `StorageAdapter` 新增 `appendEvidenceUnless(entry, predicate): Promise<boolean>`（含契约注释） |
| `src/storage/memory.ts` | 修改 | `InMemoryStorage` 实现：`some()` 命中即 `return false`，否则 `await this.appendEvidence(entry)`。⚠️ `some()` 与落库之间**不得有 `await`**（单线程 JS 下这段同步路径就是临界区）；`this.appendEvidence` 走**动态派发**，`LocalStorageAdapter` 的覆写因而照常落盘，基类无需再写一份上限逻辑 |
| `src/features/quiz/QuizReportPage.tsx` | 修改 | 三步查重收成一次 `appendEvidenceUnless`；主章计算逻辑与注释同步 |
| `src/i18n/messages/zh.ts` / `en.ts` | 修改 | 新增 `units.subjectGone`（「章节已不存在」/「Chapter no longer exists」），**先于**消费它的 UI 落地 |
| `src/features/home/HomePage.tsx` | 修改 | 新增 `ChapterIndex` + `loadChapterIndex`；`logToView` / `loadRecentEvidence` / `assembleLegacyEvidence` 改用全量索引 + 兜底文案；删掉 `chapterIndexOf` |
| `tests/evidence-once.test.ts` | 新增 | TC-EV-01~09（见 §5） |
| `package.json` | 修改 | 新增 `test:evidence` 并串入 `test:library`（末位仍 `test:portability`） |

**零改动区**：`src-tauri/**`、`src/domain/**`、`src/stores/**`、章节/学习者状态模型。
`LocalStorageAdapter` / `TauriStorage` **均无需 override**（继承基类实现）。

---

## 4. 同批修复：章主体不再落裸 id

### 4.1 缺陷

`HomePage::logToView` 的**主体解析**对两条路径的处理不一致：

| 主体 | 解析不到时 | 判定 |
|---|---|---|
| `goal`（能力评测） | `capability.evidenceFallback`（「能力评测」） | ✅ 符合 F6 决策 D7-A「**绝不显示裸 goalId**」 |
| 章（其余全部 kind） | `entry.subjectId` —— **裸 id** | ❌ **漏了** |

真实库：`doc-418a4116` 删除后，最近 6 行证据里有 **5 行**的主体章已不存在
（修复去重后：`chp-595164ae` ×3、`chp-1e79433b` ×2），首页会显示 `chp-1e79433b` 这种字符串。

### 4.2 更隐蔽的第二成因：解析走的是**按目标范围裁剪过**的索引

原先主体解析走 `ChapterLoopSnapshot.chaptersByDoc` / `docTitleOf`，而
`engine/loop.ts:270` 在目标带 `requiredChapterIds` 时会裁剪它们：

```ts
const kept = scopeIds ? chapters.filter((c) => scopeIds.has(c.id)) : chapters;
```

⇒ 落在目标范围外的**活章**同样解析不到，会被一并当成「已删」。
所以本修复**不能**只加一句兜底文案（那会制造「活章显示：章节已不存在」的假兜底），
而是改成按 `plan.docs`（全量文档，**未裁剪**）构建 `ChapterIndex`，
**一把尺子同时覆盖「范围外的活章」（显示真标题）与「真被删的章」（显示兜底文案）**。

回归锁：`TC-EV-08`（`logToView` 不得以 `entry.subjectId` 兜底；必须走 `units.subjectGone`；
必须从 `index.byId` 取；必须 `await loadChapterIndex(plan.docs)`；`chapterIndexOf` 不得复活）。

---

## 5. 测试

`tests/evidence-once.test.ts` —— **9 例全绿**（`npm run test:evidence`）：

| 层 | ID | 断言 |
|---|---|---|
| 行为 | TC-EV-01 | 首次追加返回 `true`，条目逐字段落库 |
| 行为 | **TC-EV-02** | **并发两次写入只落 1 条**；并用**旧三步写法**做对照，断言同一并发下它落 **2** 条 —— 证明这批断言确实在测竞态（不是空断言） |
| 行为 | TC-EV-03 | 顺序调用第二次被挡下（返回 `false`） |
| 行为 | TC-EV-04 | 存储层不替调用方猜键：同 `sourceId` 的 `card` 证据必须能落 2 条 |
| 行为 | TC-EV-05 | 上限裁剪仍生效（`EVIDENCE_LOG_MAX` **从 `memory.ts` 导入，不重写数字**） |
| 源码 | TC-EV-06 | `QuizReportPage` 不得再出现 `listEvidence(` / 裸 `appendEvidence(` |
| 源码 | TC-EV-07 | 基类实现里**查重必须早于第一个 `await`**；必须经 `this.appendEvidence` 动态派发 |
| 源码 | TC-EV-08 | `HomePage` 章主体兜底（§4 五条） |
| 文案 | TC-EV-09 | `units.subjectGone` 中英成对、非空、确实译过 |

**刻意不做**：构造真实 `QuizReportPage` 组件做浏览器级渲染断言（受
`rules/no-headless-browser-validation.mdc` 约束，且 `.tsx` 不被 strip-types 支持）。
竞态本身已用 `InMemoryStorage` 真跑并发覆盖；`.tsx` 里的接线事实走源码级断言。

---

## 6. 存量数据修复记录

```
备份：/tmp/plos-backup-20260921-102744/（localstorage.sqlite3 + -wal + -shm 三件套）
前提：应用未运行（DB 可获取写锁；文件 mtime 停在 2026-09-16）
规则：同一 (kind="assessment", sourceId) 只保留**数组里最早**的一条；其余 kind 一律不碰
       —— 与 QuizReportPage 现在强制执行的幂等键逐字对齐
演练：先在备份副本上 dry-run，确认 6 组全部是「除 at 外逐字段相同」的真重复
写回：plos.evidence 12 → **6** 条；PRAGMA integrity_check = ok
校验：逐 key 比对前后快照 —— **只有 plos.evidence 变了**（1631 → 816 字节），
      其余 21 个 key 逐字节一致
```

> ⚠️ `/tmp` 会被系统清理。需要长期保留请把备份移到 `~/Documents` 等持久位置。

---

## 7. 审计中发现的其余事实（**本次不修，登记备查**）

审计口径：真实快照逐 key 交叉核对引用完整性（章节 / 试卷 / 试卷结果 / 学习者状态 /
图表 / 目标 / 证据流）。

### 7.1 已删除资料 `doc-418a4116` 留下的孤儿引用

`deleteDocumentCascade` 现在会级联删试卷（`features/learn/document-cascade.ts` §1），
所以这批是**历史**产物（该资料在级联逻辑成型前就被删了/重切分了）：

| 残留 | 数量 | 位置 |
|---|---|---|
| 孤儿章 id | 4（`chp-1e79433b` / `chp-595164ae` / `chp-9b4e308c` / `chp-fe61221e`） | 被 `plos.papers[].scope.chapterIds`、`plos.paper-results[].perChapter`、`plos.evidence[].subjectId`、`plos.learner.byUnit` 引用 |
| 孤儿试卷 | **8 份试卷里 7 份**的 `scope.chapterIds` 指向已不存在的章 | `plos.papers` |
| 孤儿试卷 id | 3（`paper-eb0984ba` / `paper-c6ab7436` / `paper-84471971`） | 只作为 `plos.evidence[].sourceId` 存在，试卷本体已删 |
| 孤儿掌握度 | 1（`chp-fe61221e`，`mastery=0.585`） | `plos.learner.byUnit` |

**已有的防呆与后续收口**：`features/progress/analytics.ts::buildWeakness` 明确处理了
「章已删但 byUnit 残留 → 不可解析的主体不入榜」；`buildTrend` 的逐章序列原先用
`titleOf(id) ?? id` ⇒ **趋势下拉会显示 `chp-1e79433b` 这种裸 id**（与 §4 同族问题，
消费方不同）。✅ **2026-09-21 已修**：序列照旧保留、`title` 改为可选留空，由 UI 显示
`units.subjectGone`；同批收口命令面板与能力评测的 3 处同族兜底 —— 详见
`docs/raw-id-label-fix-2026-09.md`。

**未决 → 2026-09-21 部分拍板**：用户选定 **(b) 做一次性孤儿清理**并已执行，但范围
**收窄到试卷侧** —— 删 `chapterId` 已失效的题 + 连带删因此变空的卷与它的草稿/判卷结果，
口径**跟随 `memory.ts::deletePaper`**（唯一真源）：`plos.papers` 8 → 1、
`plos.paper-drafts` 3 → 1 键、`plos.paper-results` 3 → 1 条，其余 20 个 key 逐字节不变。
证据流与 `learner.byUnit` 仍维持 **(c) append-only**（悬空的 `subjectId` / `byUnit` 残留
没有用户可见症状，要清需另一次拍板）；`deleteDocumentCascade` 也尚未补证据流清理。

> **2026-09-22 收口（本条已被推翻，保留原句留痕）**：上句的后半「尚未补证据流清理」
> **结论作废，且方向是反的** —— 实测证据流**不该**被级联清理（三个消费方全都只看行为、
> 不看主体；按主体删 = 回溯改写历史），改由**消费侧**兜底（首页跳过解析不到的章级行）。
> 但同句前半的 `learner.byUnit` **判反了**：它不是 append-only 派生态，消费方过滤
> （`analytics.ts:354`）是**兜底不是清理**，已随资料回收。同批补齐 6 项。
> 详见 `docs/document-cascade-cleanup-2026-09.md` §2/§3。

### 7.2 其他

- `plos.paper-drafts` 原有 3 个**空对象** `{}`（对应 3 份已判卷的 done 试卷）——判卷后未清草稿，
  属存储占用而非用户可见问题。2026-09-21 清理孤儿卷时已连带删掉 2 个（只剩 `paper-be3d6e6f`）。
- `plos.knowledge-units` / `-relations` / `chunks` / `embeddings` / `sections` 在 localStorage
  里为空是**预期**：RAG 五类已迁 SQLite。⚠️ **2026-09-21 起 `Document` / `Chapter` 也已下沉**（schema v5，
  localStorage 侧只剩**冻结迁移快照**）—— 下半句「localStorage 只承载其余实体」已不完整，现状以
  `src/storage/tauri.ts` 头注释为准。
- `doc-b577e2b8` 无 `analysis` 字段而 `doc-3a3025f2` 只有 `chaptersAt` —— `analysis` 全部
  可选（`domain/document.ts:45`），属合法老数据形状。

---

## 8. 验收

- [x] `npm run test:evidence` 全绿 —— **9/9**
- [x] `npm run test:library` 全链全绿（`test:evidence` 已串入，末位仍 `test:portability`）
- [x] `npm run typecheck` 零新增（仅 3 条 `AIModelsSection.tsx` 既存债）
- [x] 存量数据修复后 `integrity_check = ok`，且仅 `plos.evidence` 一个 key 变化
- [x] 逐提交可编译抽查与基线持平

---

## 变更记录

| 日期 | 内容 | 作者 |
|---|---|---|
| 2026-09-21 | 初稿并实施：真实库数据审计 → 定位「非原子查重 + StrictMode effect 双执行」；D1–D3 确认；存储层落实 `appendEvidenceUnless`（基类一处，两个子类继承）；同批补章主体兜底并修掉「范围裁剪索引」这一更隐蔽成因；存量 12 → 6 条去重（先备份后校验）；9 例新测试 + `test:evidence` 串链 | Agent |
