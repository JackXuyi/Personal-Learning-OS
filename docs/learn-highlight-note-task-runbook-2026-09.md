# 划线高亮与笔记 · 任务 Runbook（F5 第 2 项 + T12）

## Goal

按 `docs/learn-highlight-note-design-2026-09.md`（**v0.2**，用户已确认 D1–D10）实现：章级阅读页左栏「选中原文 → 划线 → 可选写笔记 → 落库 → 重进自动恢复高亮 → 右栏第 7 区回看跳转」；并同批完成 **T12**（修正既有 `?at=` / 章内引用跳转的系统性偏前口径）。全流程零 AI、纯本地；不动 `Chapter` 正文契约、不动掌握度、不写证据流。

## Context

- 方案：`docs/learn-highlight-note-design-2026-09.md` v0.2（§0.1 决策 D1–D10；§8 逐文件伪代码；§12 用例）
- 存储 key：`plos.annotations`（新 key，零迁移）；`TauriStorage` 与 `src-tauri/**` 零改动
- 验证入口：`npm run typecheck` + `npm run test:annotation` + 既有 `test:*` 回归
- 硬约束：纯逻辑必须 `.ts` 且不依赖 `document`/JSX（`--experimental-strip-types` 不支持 JSX）；禁止起浏览器校验（`rules/no-headless-browser-validation.mdc`）

## Tasks

### T1 — `domain/annotation.ts`（新增）+ `domain/index.ts` 导出
- **Status:** done
- **Outcome:** 新增 `src/domain/annotation.ts`（`Annotation` / `ANNOTATION_LIMITS` / `annotationId` / `hasNote` / `quoteExcerpt`；`hashId` djb2 内联第三份，注释记录「第四处才抽 `src/lib/hash.ts`」）；`domain/index.ts` 追加 `export * from "./annotation";`。**刻意保留的差异**：`ANNOTATION_LIMITS.maxQuoteChars=2000` 与 `features/learn/evidence-anchor.ts::MAX_QUOTE_CHARS=2000` 数值相同但语义不同（用户选区 vs AI 摘录），注释写明不合并的理由。

### T2 — `evidence-anchor.ts` 新增 `foldToNone`（D7）
- **Status:** done
- **Outcome:** `src/features/learn/evidence-anchor.ts` 新增 `foldToNone(s): FoldedText`（移除全部空白 + 下标映射 + 末尾哨兵），复用同文件私有 `isWhitespace`；注释写明「为什么需要第二档」与假命中代价。

### T3 — 存储三层：`types.ts` 契约 + `memory.ts` 实现 + `local.ts` 持久化
- **Status:** done
- **Outcome:** `storage/types.ts` 追加 5 方法 + `import type { Annotation }`；`memory.ts` 加 `annotations` Map、5 方法、`deleteDocument` 追加批注级联、文件内 `byStart` 全序排序（`start` 升序，同起点用 `end` 兜底）；`local.ts` 加 `KEY_ANNOTATIONS = "plos.annotations"` + 构造函数 load + `persist()` + 3 个 override（`deleteAnnotations` 空数组短路）。验证：`npm run typecheck` 仅余既存 3 条（`AIModelsSection.tsx:56-58`）。

### T4 — `highlight.ts`：收窄 `clearHighlights` + DOM 文本定位层
- **Status:** done
- **Outcome:** ① 新增 `render/plain-text-layout.ts`（**纯 TS、零 import**）——`plainTextLayout()` / `plainTextToDomText()`，把渲染规则从 `PlainTextRenderer` 抽出为单一真源，并**让渲染器改为消费它**（§11.2 的硬要求）；② `highlight.ts` 重写：`clearHighlights` 收窄为 `mark[data-plos-anchor]` + 新增 `unwrapMarks`（`data-plos-annotation`）、`domTextSegments`/`domOffsetToPoint`/`textSegmentsInRange`/`markDomRange`/`locateRangeInDom`（两档：精确 → `foldToNone`）/`markRanges`（顺序贪心 + 从后往前）/`scrollToQuote`；③ `highlightRange` **暂留**（T12 删），其 mark 加 `ANCHOR_ATTR`。
- **Notes:** 两处实现级改进：**① 包裹改为「按文本节点分段」**（跨行区间若整体 `extractContents` 会把多个 `<p>` 塞进一个 mark，破坏块级结构）→ 每段单节点 `surroundContents` 必定成功；**② 闪烁用现成 `animate-pulse`**（600ms 后移除），不新增 CSS/hex。验证：`npm run typecheck` 无新增 error。

### T5 — `annotation-service.ts`（新增，八态编排）
- **Status:** done
- **Outcome:** `src/features/learn/annotation-service.ts`：八态（`ok`/`unanchored`/`no-body`/`duplicate`/`too-short`/`too-long`/`capped`/`error`）+ `createAnnotation` / `updateAnnotationNote` / `removeAnnotation` / `listChapterAnnotations` / `relinkAnnotations` / `chapterOfRange`。判定顺序：护栏 → 正文存在 → 锚定 → 回校取**原文字面** → 幂等（id 区间派生）→ 章上限 → 落库。**不 import `src/ai/*`**。
- **Notes:** 实现级决定：① `updateAnnotationNote` 收整条 `record` 而非 id —— 存储契约刻意不加 `getAnnotation(id)`（调用方手上就有这条记录，少一个 API 面）；② 「回看命不中不删记录」与「重定位失败删除」**并存且不矛盾**：前者是渲染差异（数据仍在正文里），后者是数据已被替换。

### T6 — i18n：`learn.reader.annotations` 子区（zh + en 成对）
- **Status:** done
- **Outcome:** `zh.ts` / `en.ts` 各新增 `annotations` 块（按方案 §8.12 键名 + 实现所需的 `locate` / `removeConfirmTitle` / `removeConfirmDesc`，见方案「实现偏差登记」表）。

### T7 — `reader/SelectionToolbar.tsx` + `reader/ChapterAnnotationsPanel.tsx`（新增）
- **Status:** done
- **Outcome:** 工具条（`mouseup` 选区校验：非塌陷 + 完全落在 `bodyRef` 内 + 长度护栏 → 浮动定位；`Esc` 关闭并清选区；笔记内联 `textarea` + 计数；失败就近内联**不用 Toast**）；面板（三态：无正文快照 / 空态 / 列表；内联编辑；`ConfirmDialog` 二次确认删除；orphan 条目保留删除入口）。
- **Notes:** ⚠️ 用到的状态色 token 是 `text-destructive` —— 先写的 `text-state-due` 在本仓库**不存在**（`main.css` 只有 mastered/learning/weak/idle/failed），已改正（否则是静默无样式）。
  ⚠️ **T11 自审又修掉一处自触发**（`SelectionToolbar`）：document 级 `mouseup` 监听会把「点工具条按钮」也算作一次选区建立 → 把刚切到 `mode:"note"` 的浮层**重置回 idle**（输到一半的笔记被 `setNote("")` 清掉）。修法：`toolbarRef.contains(e.target)` 直接返回。**弹出式浮层 + 全局事件监听**的通用坑，后续同类交互照此防。

### T8 — `ChapterReaderPage.tsx` 接线（加载 / 应用高亮 / 第 7 区 / 闪烁定位）
- **Status:** done
- **Outcome:** 新增 `bodyBoxRef`（工具条定位宿主）+ `annotations` / `locatedIds` state；两个 effect（按 `chapter.id` 加载；`requestAnimationFrame` 后 `unwrapMarks` + `markRanges` + 回填 `locatedIds`）；四个 handler（create / updateNote / remove / locate）；左栏改为「相对宿主 + 正文容器 + 工具条」三层；右栏在 5 与 6 之间插入第 7 区（方案 §8.8，编号沿用七区规划）。验证：`npm run typecheck` 仅余既存 3 条。

### T9 — 测试：`tests/annotation.test.ts` + `package.json` script + 存储契约
- **Status:** done
- **Outcome:** `tests/annotation.test.ts` **32 项全绿**（`npm run test:annotation`）：domain 纯函数 / `foldToNone` / `plainTextLayout` / `locateQuoteInDomText` 两档 + 顺序消歧 / 服务层八态 / `relinkAnnotations` / 存储契约 / T10 接线 / 源码级「零 AI」断言 / i18n 状态穷尽。`package.json` 加 `test:annotation` 并串进 `test:library`。
- **Notes:** ⚠️ **实现偏差（已登记，见方案 §11.1）**：方案原写「`tests/storage-adapter.test.ts` 补批注契约」，但该文件**自述范围是 RAG 存储层**（Section/Chunk/KnowledgeUnit/Relation/Embedding，A–H 段）；批注由 `LocalStorageAdapter` 承载、不属 RAG → 契约用例（`TC-STORE-01` 级联 / `TC-STORE-02` 空数组幂等 / `TC-STORE-03` 全序排序）改放 `tests/annotation.test.ts`，并在方案 §11.1 同步更正指向，避免「文档说的和代码不一样」。

### T10 — `relinkAnnotations` 接入重切分 / 合并入口
- **Status:** done
- **Outcome:** `split-service.ts`（`splitDocumentNow` 在 `saveChapters` + `rebuildChunks` 之后调用 relink）、`chapter-edit-service.ts`（`applyChapterEdit` 同位置；`unchanged()` 短路返回 0/0）；两个 result 类型各加 `annotationsRelinked` / `annotationsDropped`；i18n `learn.detail.split.annotations(relinked, dropped)`（zh+en，**无内容时返回空串**，调用方直接拼接）；3 个调用点（`SplitTab.runSplit`、`SplitTab.runEdit`、`LibraryPage.runSplit`）追加该说明。
- **Notes:** ① 只 merge 会改区间（rename/reorder 恒 0），但**不按操作分支判断** —— 统一调一次，少一个分支就少一类漏迁移；② 导入图无环（`useLoopStore` 不 import split/chapter-edit，故 `split-service → annotation-service → useLoopStore` 安全，非 TDZ 陷阱）；③ ⚠️ **待抽**：「结果文案 + 划线附加说明」组合已 2 个文件 / 3 处重复，第 3 个切分入口出现时抽共享函数（已在 `LibraryPage.tsx` 注释声明）；④ 接线回归由 `TC-WIRE-01/02` 锁定（合并后 chapterId 迁移、重切分后陈旧 chapterId 被纠正）。

### T12 — 【D10】`?at=` 系统性偏前修复
- **Status:** done
- **Outcome:** **删除 `highlightRange` 导出**，新增 `highlightSourceRange(root, text, start, end)` + 纯函数 `sourceRangeCandidates`（三档候选，`MIN_FRAGMENT_CHARS=4` **三档统一**护栏）；`evidence-anchor.ts` 新增 `bestOccurrence`（**左侧上下文消歧**）+ 私有 `commonSuffixLen`；两个调用点同批改完（`ContentTab.tsx` 含 **20 万字符截断边界 → 先 `setShowAll(true)`**；`ChapterReaderPage.tsx` 复用 `body` 表达式并传 `body` 而非偏移）；6 处注释同步（`ChapterRestatementPanel` / `MermaidBlock`×2 / `ChapterReaderPage`×2 / `tests/render-mermaid.test.ts`）。
- **Notes:** ① **初版取「首个命中」是错的** —— 真实库实测会跳到 2.6 万字符外的同构片段（页眉模板句 / 重复表头 / mermaid 源码），违背 D10「绝不错位」的初衷 → 补上上下文消歧（W3C `TextQuoteSelector` 的 `prefix` 思路），补后 plain 侧候选①命中 **2746 次零偏差**；② 候选②从「剥边缘装饰」升级为「抹掉全部 GFM 标记」，比原稿更准（`**加粗**` 能重建出可见文本）；③ `MIN_CONTEXT_MATCH=4` 门槛：中文里无关片段常共尾「。」，不设门槛会被 1 字符偶合骗走；④ 候选③的 `MIN_FRAGMENT_CHARS` 提升为**三档统一**——实测 `at` 落在章尾时窗口被 clamp 成 2–4 字（如「贸发会议」），短串照样错位。
- **真实库验收（`TC-ATC-14`，探针跑完即删）**：旧口径 **1885/4449 取样点必然错位** → 新口径命中 **99.6%**、plain 路径逐字对齐 **99.7%**（候选① 2746 次零偏差，残余 8 点偏 3–71 字符）、**34/44 章全点对齐 → 达判据**。⚠️ markdown 2 章**离线不可验证**（GFM 改写 + mermaid → SVG 文本，无法复现真实 DOM），残留风险与两条后续方案已登记于方案 §12.2。

### T11 — 收尾：`typecheck` + 全量 `test:*` + 文档同步
- **Status:** done
- **Outcome:** ① `npm run typecheck` **无新增 error**（仅既存 3 条 `AIModelsSection.tsx:56-58`）；② **全量 37 个 `test:*` 脚本全绿**（`test:annotation` **45 项**）；③ 方案 v0.2 → **v0.3**（实施回填：§8.16 改写 + §12.2 实测结果表 + §11.1/§11.2 两处实现偏差登记 + 精度取舍表补 4 行 + §0.1 D10 补强说明）；④ `roadmap` F5 第 2 项标 ✅（含 T12 的实测数字与 markdown 遗留）+ F5 现状快照加「已过时」提示 + Done 标准更新为 4/4；⑤ README 双语 checkbox 各 +1（**实测 33/33 已实现、12/12 未实现、29/29 个 `###`**）并**手工同步顶部硬编码统计行**（32/13 → 33/12）。

---

## 收工清单（分层提交）

按 `plos-layered-commit` 的层级顺序落 7 条本地提交（**只落本地，未 push**）：

| # | 层 | 短哈希 | 内容 |
|---|----|--------|------|
| 1 | `domain` | `47a8643` | `Annotation` 领域模型 + 区间派生 id + 护栏常量 |
| 2 | `storage` | `d9f2836` | 存储五方法 + `plos.annotations` 持久化 + 文档级联 |
| 3 | `features`（服务层） | `918a8c1` | 八态编排 + `relinkAnnotations` 接线（T5 / T10） |
| 4 | `features`（DOM 层） | `9c22bfb` | DOM 文本定位层（T4）+ `?at=` 口径修正（T12 / D10） |
| 5 | `ui` + `i18n` | `8b8d1a7` | 浮动工具条 + 右栏第 7 区 + 页面接线 + 双语文案 |
| 6 | `test` | `ed59131` | 45 项单测 + `test:annotation` script |
| 7 | `docs` | `746c7de` | 方案 v0.3 + 本 runbook + roadmap / README 同步 |

提交前后核对：`git diff --cached --name-only` 全空、`git status --short` 全空、`git rev-list --count origin/main..HEAD` = 19（本组 7 条叠加既有 12 条）。

⚠️ **组 3 → 组 4 → 组 5 之间存在两个「提交态不自洽」的中间态**：`ChapterReaderPage.tsx` **单文件横跨三层**（DOM 定位口径 / 服务层调用 / 右栏 UI），组 4 删掉 `highlightRange` 后它仍在引用旧名，直到组 5 才补齐。拆 hunk 可消除，但收益低于风险（`git apply --cached` 需伪造一个从未存在过的中间态文件），故按「紧随的下一组补齐」处理。同理 **T4 与 T12 同批提交** —— 两者都改 `highlight.ts`，且 T12 正是删掉 T4 暂留的 `highlightRange`，属同一文件的同一处演化，不宜再拆。

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-09-16 | 建立 runbook（方案 v0.2 确认后） |
| 2026-09-16 | T1–T11 + T12 全部 done（含 T9/T10/T12 的实施细节与真实库实测数字）；方案同步升 v0.3 |
| 2026-09-16 | 回填收工清单（7 条分层提交哈希 + 中间态不自洽的说明） |
