# 裸 id 标签收口（raw-id-label-fix）· 2026-09-21

> 一句话：**「实体解析不到 → 绝不显示裸 id」**这条规矩，F6 决策 D7-A 只立在了 goal 侧、
> 2026-09-21 补齐章侧，本轮再扫出**同族的 4 处可见兜底**并一次收口；顺带清掉真实库里
> 7 份历史遗留的整卷孤儿试卷。
>
> 关联：`docs/evidence-log-idempotency-fix-2026-09.md`（同日另一案，同族问题）、
> `docs/goal-capability-assessment-design-2026-09.md::D7-A`（规矩的出处）、
> `docs/progress-analytics-design-2026-09.md`（趋势模块本档）。

---

## 1. 取证（真实 localStorage + 源码全库扫描）

### 1.1 真实库决定性事实

`~/Library/WebKit/personal-learning-os/…/LocalStorage/localstorage.sqlite3`（UTF-16LE blob，
`.sqlite3` + `-wal` + `-shm` 一起拷出后读）：

| 事实 | 数值 |
|------|------|
| 现存章 | 44 个（2 份资料 `doc-b577e2b8` / `doc-3a3025f2`） |
| `plos.paper-results` 的 `perChapter` 章 id | 2 个，其中 **1 个不可解析：`chp-1e79433b`**（出现在 2 份卷里） |
| `plos.papers` | 8 份，其中 **7 份整卷都是孤儿**（`scope.chapterIds` = `chp-1e79433b` ×3 / `chp-9b4e308c` ×4），共 **21 处**孤儿 `question.chapterId` |
| `plos.paper-drafts` | 3 个空对象键，与 3 份 done 卷一一对应 |
| `plos.learner.byUnit` | 2 键，其中 1 个不可解析：`chp-fe61221e` |

⇒ **`/progress` 趋势下拉真的会渲染出 `chp-1e79433b` 这一项**（`ProgressPage` 把
`trend.chapters[].title` 直接放进 `<option>`）。这是本轮修的第一性理由，不是理论推演。

### 1.2 源码全库扫描（`?? <entityId>` / `|| <entityId>` 家族）

| 位置 | 形态 | 用户可见 | 判定 |
|------|------|----------|------|
| `features/progress/analytics.ts::buildTrend` | `titleOf(id) ?? id` | ✅ `/progress` 趋势下拉 | **缺陷（已实证）** |
| `components/CommandPalette.tsx:261` | `chapterTitle \|\| docTitle \|\| chunk.id` | ✅ 命令面板正文命中 | **缺陷（可触发）** |
| `features/goals/capability/CapabilityReportView.tsx:94` | `snap?.label ?? s.itemId` | ✅ 能力评测报告 | **缺陷（潜在，本机无数据）** |
| `features/goals/CapabilityRunPage.tsx:147` | `?.label ?? itemId` | ✅ 能力评测运行页 | **缺陷（潜在）** |
| `engine/learning-planner.ts:113 / :317` | `…?.title ?? id` | ❌ | **不可达**：上游 `filter` 用同一 `chapterById` 过滤过 |
| `engine/loop.ts:275` | `docTitleByDocId.get(docId) ?? docId` | ❌ | **不可达**：删文档必删其章 |
| `features/units.ts:29` | `UNIT_TITLES[unitId] ?? unitId` | ❌ | **合理**：静态字典，非用户数据 |
| `ai/pipelines.ts:229` | `ctx?.title ?? q.chapterId` | ❌ | 进 LLM 提示词，非渲染路径 |

### 1.3 为什么 7 份卷还活着（历史遗留，不是现有机制缺陷）

`features/learn/document-cascade.ts::deleteDocumentCascade` **已经**在删资料时按
`p.scope.chapterIds.some(…)` 级联删试卷。但 7 份孤儿卷创建于 **09-11 16:51–17:20**，
两篇现存资料是 **09-14 / 09-15** 导入的；而级联链路是 **2026-09-13** 才自
`library-actions.ts` 抽出的（见该模块头注释）。⇒ **删除发生在级联完善之前**。
结论：**不改** `document-cascade.ts`。

---

## 2. 决策（三轮确认，逐轮因事实纠正）

| # | 决策点 | 结论 |
|---|--------|------|
| **D1** | 修到哪一层 | **统一 4 处**（不是逐个 patch）——同一模式散在 4 个文件，逐个修必漏下一个 |
| **D2** | 趋势里「章已删」的那个选项 | **保留序列、只换文案**（`id` + `points` 不动，仍可下钻看历史曲线） |
| ~~D3~~ | 是否顺带清理孤儿试卷引用 | 初答「清理」→ **事实纠正**（7/8 是整卷孤儿，清理＝删卷）→ 改答**删题 + 连带删空卷** |
| **D3-b** | 删卷时判卷结果怎么办 | **跟随 `deletePaper`：一起删**（唯一真源，不制造「应用永远不会产生的状态」） |

> D3 的两次追问记录了一个教训：**选项描述里的前提必须先经数据验证**。首版选项写的是
> 「试卷变小」，实测是「试卷变空」——后果量级不同，用户基于错误预期做的选择必须回问。

---

## 3. 代码改动

| 文件 | 改动 |
|------|------|
| `src/features/progress/analytics.ts` | `TrendChapterSeries.title` 由 `string` 改 **`title?: string`**；`chapters.push({ id, title: titleOf(id), points: pts })`（去掉 `?? id`）；`buildTrend` 头注释补「与弱点榜的差别只在呈现上统一」 |
| `src/features/progress/ProgressPage.tsx` | `<option>{c.title ?? m.units.subjectGone}</option>` |
| `src/components/CommandPalette.tsx` | `label` 兜底改 `m.cmd.contentGone`（`chunk.id` 仍作 React key，**保留**） |
| `src/features/goals/capability/CapabilityReportView.tsx` | `label={snap?.label ?? c.itemGone}`（`key={s.itemId}` 保留） |
| `src/features/goals/CapabilityRunPage.tsx` | `labelOf` 兜底改 `c.itemGone` |
| `src/i18n/messages/zh.ts` / `en.ts` | 新增 `cmd.contentGone`、`capability.itemGone`（中英成对，**先于 UI 落地**）；`units.subjectGone` 复用（2026-09-21 上午已加） |

**分层说明**：`analytics.ts` 保持**零 i18n**（文案由 UI 决定），所以「不显示裸 id」这条
规矩在数据层的表达方式是**类型诚实**（`title?: string`），而不是在数据层塞文案。
`ai/` 与 `engine/` 均未被本改动触碰。

---

## 4. 数据清理（真实用户数据，已执行）

**安全流程**：确认无进程持有该库（`lsof` 空 + 5292 号 tauri 进程 cwd 是
`git/meetily/frontend`，非本项目）→ 备份三件套到 `/tmp/plos-backup-20260921-122329`
→ **副本上先 dry-run 再 apply**（验证写回逻辑）→ 真实库 dry-run（与副本逐字一致）
→ `--apply` → 逐 key 比对。

**清理口径 = `memory.ts::deletePaper` 的真实语义**（试卷本体 + 答题草稿 + 判卷结果一并移除）：

```
plos.papers        8 → 1   （删 7 份整卷，每份 3 题全为孤儿）
plos.paper-drafts  3 → 1 键（删 paper-08c78f50 / paper-8f512d42）
plos.paper-results 3 → 1 条（删同两份卷的结果）
其余 20 个 key               逐字节一致
PRAGMA integrity_check       ok
```

保留的 `paper-be3d6e6f`：3 题全部指向现存的 `chp-53915b6d` ✅。

**刻意不动**：`plos.evidence`（append-only 日志，悬空 `sourceId` 无可见症状；
`HomePage` 已兜底）、`plos.learner.byUnit` 的 `chp-fe61221e` 残留（弱点榜已过滤，
清理它属统计口径变更，需另行拍板）。

---

## 5. 测试

| 用例 | 锁什么 |
|------|--------|
| `TC-UC02-05`（**改档**） | 章已删 → `chapters.length === 1`、`points.length === 1`、`title === undefined`（原断言 `title === "ghost"` 已随口径修正） |
| `TC-RAWID-01` | 混合场景：可解析的有标题、已删的留空，**两者序列都在** |
| `TC-RAWID-02` | `analytics.ts` 的 series 构造不得出现 `?? id`；类型必须可选 |
| `TC-RAWID-03` | `ProgressPage` 用 `c.title ?? m.units.subjectGone`；且无裸 `{c.title}` 渲染 |
| `TC-RAWID-04` | `CommandPalette` 的 label 行不含 `chunk.id`，但 `chunk.id` 作 key 的用法**仍须存在**（证明断言只盯 label 行） |
| `TC-RAWID-05` | `CapabilityReportView` 的 label 行不含 `?? s.itemId`，`key={s.itemId}` 保留 |
| `TC-RAWID-06` | `CapabilityRunPage::labelOf` 不含 `?? itemId` |
| `TC-RAWID-07` | 三个兜底键中英成对、非空、且不相同（防漏译） |

新测试文件 `tests/no-rawid-label.test.ts`（7 例），`npm run test:rawid`，
并接入 `test:library` 链（19 → **20** 组，末位仍 `test:portability`）。

---

## 6. 刻意不做（登记备查）

- `engine/learning-planner.ts` 的两处 `?? id`：**不可达**（同一 map 先 filter），
  且改成别的东西反而会掩盖「图谱/章表不一致」这类真信号。
- `engine/loop.ts:275` 的 `?? docId`：删文档必删其章，属防御性冗余。
- `features/units.ts` 的 `UNIT_TITLES[unitId] ?? unitId`：静态字典兜底，合理。
- `learner.byUnit` 的孤儿键、`evidence` 的悬空 `sourceId`：无可见症状，
  归属「孤儿引用清理策略」这一更大议题（见 §7）。

---

## 7. 遗留

- **孤儿引用清理策略仍未定**：本轮只处理了试卷侧。证据流与 `learner.byUnit` 走
  append-only（c 档）；`deleteDocumentCascade` 是否补证据流清理仍待拍板。
- `plos.paper-results` 与 `plos.papers` 的可见性差异：本轮已让二者同步（都剩 1 条），
  但**今后若单独删卷**（不经脚本），`/progress` 的「N 份卷」仍会包含已删卷的历史 ——
  这是 `deletePaper` 的口径决定的，如要改需先改 `deletePaper`。

---

## 8. 验收

- [x] 真实库 `/progress` 趋势下拉不再出现 `chp-1e79433b`（数据清掉 + 显示兜底双保险）
- [x] `npm run test:rawid` 7/7 全绿；`npm run test:progress` 全绿（含改档后的 TC-UC02-05）
- [x] `npm run test:library` 20 组全绿（末位 `test:portability`）
- [x] `npm run typecheck` 零新增（仅 3 条 `AIModelsSection` 既存债）
- [x] 数据清理后逐 key 比对：仅 `plos.papers` / `-drafts` / `-results` 三键变化，
      `integrity_check = ok`
- [x] 4 处调用点全部不回落裸 id；3 处不可达/合理的兜底**明确登记为刻意保留**

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-21 | 初稿：取证 → D1–D3(b) 决策 → 4 处代码收口 + 存量试卷清理 → 测试与验收 | Agent |
