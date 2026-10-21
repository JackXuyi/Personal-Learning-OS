# AI 即时反馈层 · 实施 runbook

## Goal

按 `docs/ai-immediate-explain-design-2026-10.md` 的推荐档（D1–D8 全部取推荐项），落地两个 AI native 能力：

- **Feature A**：作答页客观题「就地要点提示」——有原文依据、可点回原文、**不给 AI 看答案**；
- **Feature B**：阅读页「问这一章」升级为掌握度驱动档位 + 最多 3 轮追问线程。

**Done 的定义**：`typecheck` / `layer:check` / `ui:check` / `copy:check` / `test:i18n` / `test:explain` / `test:qa` / `test:quiz` 全绿；`ui:check` 的 palette 硬编码计数与开工前实测值相比**不上涨**；零新增持久化、零 `src-tauri/**` 改动。

## Context

- 方案：`docs/ai-immediate-explain-design-2026-10.md`（12 章 / 1187 行，D1–D8 已由用户确认「按推荐档实施」）
- 上游调研：`docs/ai-native-learning-benchmark-2026-10.md`（P0-A / P0-B 的定义已在方案 §1.2 修订）
- 相关约定：`rules/layer-import-boundaries.mdc`（`ai/**` ↛ `features/**`）、`rules/no-headless-browser-validation.mdc`（禁止起浏览器取证）、`skills/ui-impl-tokens/SKILL.md`
- 与 UI 整改方案的关系：D8 = 本方案 T0 先行建共用渲染件，整改方案 T4 复用同一份

### 开工前基线（实测，勿凭记忆）

| 项 | 实测值（2026-10-21 开工前） | 命令 |
|---|---|---|
| palette 硬编码计数 | **436** 处 / 19 文件 | `node scripts/ui-consistency-scan.mjs` |
| `tests/*.test.ts` 数量 | **54** | `ls tests/*.test.ts \| wc -l` |
| 扫描文件总数 | 288 | 同上 |
| local ahead of origin/main | 11 | `git rev-list --count origin/main..HEAD` |

> ⚠️ `QuizAnswerPage.tsx` 当前 **55 处**硬编码（`slate-*` / `indigo-*`）。本方案 D7 = 只 token 化**触及行**，
> 新增行一律语义 token ⇒ 完工后该计数**只降不升**（改造会顺带减少触及行）。

---

## 实施前的事实校正（相对方案正文）

> 方案正文有两处与仓库现状不符，实施按下表执行并记入**设计偏差表**（方案 §13 追加）：

| # | 方案原文 | 仓库实际 | 处理 |
|---|---|---|---|
| 1 | `useAiTask` 未在上下文中标注路径，伪代码按 hook 使用 | 实际位于 `src/stores/useAiTaskStore.ts`（**不是** `src/hooks/`），导出 `useAiTask(id)`，返回 `{ running, status, phase, progress, message, endedAt, skipIfFinished, run, clear }` | 按实际路径 import；无偏差 |
| 2 | §8.4 写「`AskChapterInput` 增两个可选字段」 | 该文件是 `src/features/learn/chapter-qa-service.ts`（不是「chapter-qa-service.ts 独立目录」），字段名一致 | 无偏差，仅确认 |

---

## Tasks

### T0 — 抽出共用渲染件 `features/learn/reader/qa-shared.tsx`

- **Status:** done
- **依赖:** —
- **Outcome:** 5 个渲染件原样搬出；`ChapterQaPanel` 改为引用（-115 行），无第二份 `QaNotice`。commit `8761148`。
- **Notes:** 把 `ChapterQaPanel` 内已验证的 `QaNotice` / `renderWithCitations` / `CitationList` / `jumpTo` / `previewOf` **原样搬**（JSX 与 className 逐字保留，只改 import 路径）。禁止出现第二份 `QaNotice`。

### T1 — i18n 成对落地（zh/en 同批）

- **Status:** done
- **依赖:** —
- **Outcome:** `quiz.explain` 16 键 + `learn.reader.qa` 8 键；`test:i18n` 7/7、`copy:check` 1848 值全绿。commit `81f0153`。
- **Notes:** 新增 `quiz.explain` 命名空间（16 键）+ `learn.reader.qa` 追加 8 键。**先 i18n 后 UI** 是本项目既定顺序。

### T2 — `ai/pipeline-core.ts` 增 LIMITS 与温度档

- **Status:** done
- **依赖:** —
- **Outcome:** 新增 4 个上限 + `TEMPERATURE.explain: 0.1`（`TEMPERATURE` 一并改为 `as const`，typecheck 绿）。commit `f87da83`。
- **Notes:** ⚠️ `as const` 字面量陷阱：凡以 LIMITS 值为默认参数的函数，参数必须显式标 `: number`。 新增 `explainQuoteMaxChars` / `explainMaxQuotes` / `qaThreadMaxTurns` / `qaThreadTurnChars`；`TEMPERATURE` 增 `explain: 0.1`。⚠️ `as const` 字面量陷阱：凡以 LIMITS 值为默认参数的函数，参数必须显式标 `: number`。

### T3 — `domain/qa.ts` 增 `TutorTier` / `ChapterQaTurn` 纯类型

- **Status:** done
- **依赖:** —
- **Outcome:** 两类型落地（附口径注释：阈值唯一产出方是 `tutorTierOf`）。commit `f87da83`。
- **Notes:** 仅类型，不进任何持久化实体。

### T4 — 新增 `ai/explain-question.ts`（prompt / parse / run）

- **Status:** done
- **依赖:** T2
- **Outcome:** 落地并接单测。commit `71b50c0`。
- **Notes:** ⚠️ 实现微调：选项块的免责声明**一个字都不提答案** —— 原文写的
  「不含正确项信息」本身含「正确项」三字，会命中自己的泄露扫描；且提了反而是
  提醒模型「存在一个答案」。
- **Notes:** 范式照抄 `ai/chapter-qa.ts`。🔴 D3 红线：`buildExplainMessages` 产物**不得包含任何正确项标记**，此条写进单测断言。

### T5 — `chapter-qa-service.ts` 增 `tutorTierOf` / `trimThread` 纯函数

- **Status:** done
- **依赖:** T2 T3
- **Outcome:** 两函数落地 + `AskChapterInput` 增两可选字段。commit `71b50c0`。
- **Notes:** 阈值 0.4 / 0.75；`trimThread` 保留**成对** user/tutor，去掉开头孤立 tutor 轮。

### T6 — `ai/chapter-qa.ts` 注入 tier / history

- **Status:** done
- **依赖:** T3
- **Outcome:** `TIER_LINE` + `threadBlock` 落地，service 透传；3 条新断言锁「缺省逐字节不变」（含 golden 串全等）。commit `f3a98ff`，`test:qa` 30/30。
- **Notes:** 缺省必须**逐字节不变**（单测锁）。`tierLine` 排在「用户问题」之后、线程之前。

### T7 — 新增 `features/quiz/explain-service.ts` + `meta.ts` 增 `referenceOptionText`

- **Status:** done
- **依赖:** T4
- **Outcome:** 编排层与本地参考答案落地。commit `13591e3`。
- **Notes:** 内部 `locatePaperSource`，不新建文件、不改 `contextLabel()`。返回既有 `ChapterAnswer`。

### T8 — 新增 `ExplainPanel.tsx` + 接进 `QuizAnswerPage`

- **Status:** done
- **依赖:** T0 T1 T7
- **Outcome:** 六态面板 + 两条揭示通道；缓存按 `q.id`；任务 id 注册需 `AiTaskId` 增 ``explain:${string}``。commit `8761148`。
- **Notes:** 缓存按 `q.id`（不按 index）；任务 id `explain:{paperId}:{qid}`。⚠️ 不得删底部 sticky 栏的 `key={index}`（WKWebView 残影，两次实测）。

### T9 — `ChapterQaPanel` 追问线程 UI + 档位标签 + 手动切档

- **Status:** done
- **依赖:** T5 T6
- **Outcome:** 档位标签 + 追问区 + 两个快捷追问；改档持续生效。commit `793b1a8`。
- **Notes:** 线程会话级（D6）；只有拿到 `answered` / `unanchored` 才追加进线程。

### T10 — 单测 `tests/quiz-explain.test.ts`（新）+ `tests/chapter-qa.test.ts` 扩展

- **Status:** done
- **依赖:** T4 T5 T6 T7
- **Outcome:** `tests/quiz-explain.test.ts` 16/16；`package.json` 增 `test:explain` 并并入 `test:library`。
- **Notes:** ⚠️ 为让 `meta.ts` 可被 node 单测 import，其 i18n 导入由 `../../i18n`
  **改为 `../../i18n/messages/zh`** —— 索引会连带 `I18nProvider.tsx`，而单测不
  支持 JSX。这是本轮唯一一处「为可测性」的既有文件改动。
- **Notes:** `package.json` 增 `test:explain`；禁止 import `.tsx`。

### T11 — 门禁全跑 + palette 计数复核

- **Status:** done
- **依赖:** 全部
- **Outcome:** `typecheck` / `layer:check`（违规 0、新增环 0）/ `ui:check` / `copy:check` / `test:i18n` / `test:explain` 16/16 / `test:qa` 30/30 / `test:quiz` 17/17 / `test:library` 全套件绿。**palette 436 = 开工前 436，未上涨**（D7 达成）。
- **Notes:** `layer:check` 基线豁免仍为「边 3 条 / 环 2 组」，无新增。

### T12 — 文档回扫

- **Status:** done
- **依赖:** T11
- **Outcome:** 方案头部状态改为「已实施」、§3.4 决策点标注已全部取推荐档、新增 §13 实现偏差表（5 条）；调研稿 §6 两条 P0 标注为「定义已修正并已交付」并给出 ⚠️ 说明。
- **Notes:** 另修掉方案正文 4 处此前遗留的乱码/错字（`nih masteryty`、`gebenheit`、`封郑`、`渴望错后`）。

---

## 实施步骤（分组提交，每组独立可编译）

| 步骤 | 任务 | 验证 |
|---|---|---|
| 1 | T2 + T3 | `typecheck` 绿 |
| 2 | T1 | `test:i18n` + `copy:check` 绿 |
| 3 | T4 + T5 | `typecheck` 绿 + `test:qa` 仍绿（缺省行为未变的回归信号） |
| 4 | T6 | 同步骤 3 + 逐字节不变断言 |
| 5 | T7 | 纯逻辑单测 |
| 6 | T0 + T8 | `typecheck` + `ui:check` |
| 7 | T9 | `typecheck` + `ui:check` |
| 8 | T10 + T11 | 全部门禁绿 |
| 9 | T12 | 文档一致性 |

**提交纪律**（`skills/per-commit-gate-grouping`）：精确路径 `git add`，绝不 `-a`；只落本地不 push；每组前后核对 `git diff --cached --name-only`。


---

## 验收结论（2026-10-21）

| 项 | 开工前 | 完工后 | 判定 |
|---|---|---|---|
| palette 硬编码计数 | 436 / 19 文件 | **436** / 19 文件 | ✅ 未上涨（D7） |
| `tests/*.test.ts` | 54 | **55**（新增 `quiz-explain.test.ts`） | ✅ |
| `test:explain` | — | 16/16 | ✅ |
| `test:qa` | 27 | 30（+3 条缺省不变锁） | ✅ |
| `layer:check` | 违规 0 / 新增环 0 | 违规 0 / 新增环 0 | ✅ |
| 新增持久化 | — | **0**（解释与线程均为会话级内存） | ✅ |
| `src-tauri/**` 改动 | — | **0** | ✅ |

**人工走查待用户实跑**（`rules/no-headless-browser-validation.mdc`，本轮不起浏览器）：
EX-A02（未配置 AI）、EX-A03（未建索引）、EX-A05（引用缺失提示）、UC-04/UC-05
（弱章脚手架档与追问线程的手感）。

**已知缺口（登记待办，非本轮引入）**：`ChapterReaderPage` 未消费 `?at=` 参数，
因此从答题页点引用会落在章首而非精确位置 —— 影响范围含既有的跨章引用跳转。
