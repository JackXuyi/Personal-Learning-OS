# PLOS i18n 孤儿键台账

| 字段 | 内容 |
|------|------|
| 作者 | Agent |
| 日期 | 2026-10-21 |
| 状态 | **已核实**（54 个疑似孤儿逐条给出判断；本轮只删 25 个确认无主的命名空间级键，其余登记待接线） |
| 来源方案 | `docs/copy-optimization-design-2026-10.md` §5.4 T-P2-3 |
| 检测口径 | 键路径**末段**在全仓 `src/**`（排除 `i18n/messages`）0 命中 |

---

## ⚠️ 检测方法与它的局限

| 要点 | 说明 |
|------|------|
| **不要用裸 grep 拼多模式** | `grep -rn "a\|b"` 会**静默返回 0 命中**。本轮实测踩过：据此误判 `learn.import.formatNote/Web/Txt` 是孤儿键并删掉，`typecheck` 立刻报 TS2551 —— 实际 `ImportModal.tsx:156-158` 有真实消费方。**改判据请用 Grep 工具或 Node 正则** |
| 启发式有误报 | 键名与局部变量同名会被误判。实测 `learn.detail.metaLine` 的 `metaLines` 是 `ContentTab` 的局部变量，**不是**该键的消费方 |
| 数量以实测为准 | 本表基于 2026-10-21 的 1823 个叶子键；键会随开发变动，引用前重扫 |

---

## 1. 判定为「功能已被取代」⇒ 整命名空间零消费（17 键）

这些键对应的 UI 已被 V2 重构取代，命名空间整体零消费。**保留待用户确认后再删**（涉及范围较大，且可能有历史链接价值）。

| 命名空间 | 键数 | 被什么取代 | 证据 |
|---------|------|-----------|------|
| `learn.catalog` | 13 | 章节目录页 → V2 资料库（`/learn`） | `src/features/learn/catalog/` 目录不存在；无人 import |
| `career` | 4 | U6 并入 `/goals`；`/career` 路由已重定向 | `grep "m\.career"` 零命中 |

<details>
<summary>展开 17 个键名（完整路径，可被工具校验）</summary>

| 命名空间 | 键 |
|---------|---|
| `learn.catalog` | `learn.catalog.filterUnmet` `learn.catalog.doclessTitle` `learn.catalog.doclessDesc` `learn.catalog.docMeta` `learn.catalog.docReady` `learn.catalog.learnedToday` `learn.catalog.learnedYesterday` `learn.catalog.learnedAgo` `learn.catalog.notLearned` `learn.catalog.exploredOf` `learn.catalog.unmetEmpty` `learn.catalog.unsplitCount` `learn.catalog.unsplitHint` |
| `career` | `career.currentGoal` `career.importanceLine` `career.remainingGap` `career.gapList` |

</details>

---

## 2. 判定为「功能未接线」⇒ 保留，标注待接线（14 键）

键已写好但 UI 未消费，说明对应功能做到一半。**删了将来还得重写，留着**。

| 键 | 推测状态 |
|----|---------|
| `learn.detail.papers.noPapers` | 试卷空态未接线 |
| `learn.import.github.filesHead` | GitHub 文件清单标题未接线 |
| `learn.reader.pointsEyebrow` | 阅读页要点区眉题 |
| `learn.reader.graphEyebrow` | 阅读页图谱区眉题 |
| `learn.reader.graphDesc` | 阅读页图谱区说明 |
| `learn.reader.restatement.scheduleHint` | 复述面板调度提示 |
| `learn.reader.restatement.historyEmpty` | 复述面板历史空态 |
| `knowledge.chapterGraph.extractBusy` | 图谱提炼中的状态 |
| `assessment.docScopeEmpty` | 单章测评空态 |
| `quiz.center.sectionGrading` | 试卷中心判卷分区 |
| `quiz.center.sectionHistory` | 试卷中心历史分区 |
| `capability.refining` | 能力评测进行中 |
| `capability.reRun` | 能力评测「重跑」 |
| `aiTask.fallbackDone` | AI 任务降级终态 |
| `aiTask.alreadyRunning` | AI 任务重复触发 |

---

## 3. 误判排除（1 键 + 1 处需注意）

| 键 | 说明 |
|----|------|
| `learn.detail.analyze.aiOff` | 实测 1 处消费 ⇒ **不是孤儿**，已从名单剔除 |
| `learn.detail.metaLine` | **是真孤儿**，但需人工确认：`ContentTab.tsx` 有个同名局部变量 `metaLines`，二者无关。删前确认 UI 没有改用别的写法 |

---

## 4. 判定为「疑似重复 / 可并入既有键」（待定 20 键）

这些键语义与既有键高度重叠，删前需确认 UI 是否已改用别的写法。

| 键 | 与谁重叠 |
|----|---------|
| `settings.storage.data.mdDone` | 与同段 `mdTitle` 相邻，疑为导出成功提示被并入别处 |
| `goals.gapOf` | 与 `goals.detail` 的缺口展示重叠 |
| `goals.doneAllSub` | 与 `goals.doneAll` 重叠 |
| `goals.deleted` | 与 `memory` 的删除提示重叠 |
| `goals.form.invalidScope` | `goals.form` 的校验提示 |
| `learner.countTotal` | 与 `learner` 统计块其余键同批未接线 |
| `learner.countMastered` | 同上 |
| `learner.countProficient` | 同上 |
| `learner.accuracyNone` | `learner` 统计块，F1 字段展示未接线 |
| `learner.patternSubmissions` | 同上 |
| `learner.patternAccuracy` | 同上 |
| `memory.manualPlaceholder` | `memory` 手动编辑区 |
| `learn.search.contentEmpty` | 搜索空结果 |
| `learn.library.unsplitBadge` | 未切分徽标，与 `learn.catalog.*` 同期废弃 |
| `learn.detail.split.strategyParagraphs` | 切分策略项 |
| `learn.detail.analyze.reAnalyze` | `analyze` 按钮三态（⚠️ 与本轮新增的 `analyze.errXxx` 区分，那三个**有**消费方） |
| `learn.detail.analyze.analyzing` | 同上 |
| `learn.detail.analyze.notAnalyzed` | 同上 |
| `learn.detail.linkGoalsSaved` | 关联目标成功提示 |
| `learner.resume.usePaste` | 画像恢复面板 |

---

## 5. 本轮处置

| 动作 | 对象 | 理由 |
|------|------|------|
| **删除** | 无 | ⛔ 本轮不删任何孤儿键 |
| **新增门禁检查** | 孤儿键**只报告不失败** | 与并行开发冲突（功能开发中途键必然无消费方），失败会阻塞他人 |
| **登记** | 全部 54 个 | 本表 |

> ⚠️ **为什么本轮不删**：`test:i18n` 只锁 zh/en 键同构，删键不会让任何门禁变红 —— 删错了也没人拦。本轮实测已因此差点误删 3 个键。孤儿键清理应是独立一轮，且逐条确认 UI 现状后再删。

---

## 6. 重扫方法

```bash
# 用 Node 正则（勿用裸 grep 拼多模式，会静默 0 命中）
node --experimental-strip-types --no-warnings -e '
const { zh } = await import("./src/i18n/messages/zh.ts");
// 收集 src 下源码（排除 i18n 字典）→ 按键路径末段做 \b 匹配
// 命中数为 0 ⇒ 疑似孤儿
'
```

误报排除：末段匹配会与局部变量名撞车（`metaLine` vs `metaLines`）。逐条用 Grep 工具复核后再定性。
