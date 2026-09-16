# 缺陷修复：资料库要点出现「空数据」

| 项 | 内容 |
|---|---|
| 日期 | 2026-09-16 |
| 状态 | ✅ **已实施**（生成侧 + 渲染侧），待人工核对界面 |
| 触发 | 用户截图：资料详情页「关键知识点」章 18 / 章 20 各出现一行只有圆点的空条目 |
| 性质 | **缺陷修复**（非新特性）→ README / roadmap 复选框不变 |
| 取证源 | 本机 Tauri localStorage 真实快照 + 项目自身 markdown 组件离线 SSR |

---

## 一、现象与直觉落差

直觉：「要点没提取出来 → 是空的」。

事实：**`plos.chapters` 里一条空字符串都没有**。真正的问题是三条要点文本是
`"4."` / `"5."` 这种**纯编号碎片**，而它在界面上恰好渲染成「一个孤立圆点」。

## 二、取证（两路独立，互相咬合）

### 2.1 真实持久化数据

Tauri localStorage 落盘在
`~/Library/WebKit/personal-learning-os/WebsiteData/Default/<origin>/<origin>/LocalStorage/localstorage.sqlite3`。
拷出 `.sqlite3` + `-wal` + `-shm` 快照后按 UTF-16LE 解码 `plos.chapters` 得到 JSON。

| 核对项 | 实测 |
|---|---|
| 全部 44 章 | 空字符串 keyPoints = **0 条** |
| 真正的脏条目 | **3 条**：章 18「3.5.5 境外园区」`"4."`、章 20「4.2.5 信用卡使用」`"4."`、章 22「4.4.4 建筑成本」`"5."` |
| 与截图对照 | 章 18 要点 2 条 → 界面 3 行（1 有效 + 2 空点）✅ 吻合 |
| 另有 5 条要点含裸换行（章 13/14/16/18/21） | 侧面印证走的是**代码兜底**路径（AI 精修会折叠空白） |

### 2.2 离线渲染复现（决定性证据）

把 `"4."` 喂给项目自己的 `MarkdownInline` 同构组件做 SSR，修复前输出：

```html
<span class="leading-5"><span class="block">
<span class="block">· </span>
</span></span>
```

**一条要点 → 两行、各一个孤立圆点**：第一行来自 `KnowledgeTab` 外层自带的 `•`，
第二行来自 `inlineMarkdownComponents` 自己覆写的 `li`（`· {children}`）。

## 三、根因链（4 步，第 ②③④ 步各缺一道门）

| 步 | 位置 | 问题 |
|---|---|---|
| ① PDF 抽取 | `dongdiwen.pdf` | 编号标题被糊成同一行，产生正文以「4.2.2 …」开头的**微型小节**（正文 < `minBodyCharsPerChapter` 默认 200） |
| ② 断句 | `engine/splitter-engine.ts` `summarize()` | 正则 `/(?<=[。！？.!?])\s*/` 把编号里的点号当句尾：`"4.2.2 外汇管理…"` → `["4."]`。⚠️ 该兜底路径**没有质量门**（AI 侧 `parseKeyPointDrafts` 与精修侧 `cleanRefinedKeyPoints` 都有） |
| ③ 合并 | `engine/splitter-engine.ts` `mergeShortChapters()` | `[...prev, ...cur].slice(0, 6)` —— **无任何过滤**，脏碎片就此并进正常章。（`chapter-edit-engine.mergeChapterRange` 那条路**有**过滤 → 同仓库 3 套口径） |
| ④ 渲染 | `features/learn/render/markdown-core.tsx` `inlineMarkdownComponents` | `"4."` 被 CommonMark 判为空有序列表项；`li` 被覆写成 block span **且自印一个 `·`** → 空行 + 双圆点。`hr` 覆写成空 block span 也会凭空撑行 |

## 四、修复内容

### 4.1 生成侧（治本 · 清洗单一真源）

| # | 位置 | 改动 |
|---|---|---|
| 1 | `src/lib/text-quality.ts` | 新增 `normalizeKeyPointText` / `isNumberingOrPunctOnly` / `isUsefulKeyPoint` / `cleanKeyPoints(list, {maxCharsPerItem,maxItems,dedupe})`。`cleanKeyPoints` 顺序：规范化 → 质量门（空 / 非人话 / **纯编号标点**）→ 截字 → 去重 → 截条数 |
| 2 | `src/engine/splitter-engine.ts` `summarize()` | 产出过 `cleanKeyPoints`；纯编号首句直接返回 `[]`（**不改断句正则** —— 避免全量要点内容漂移） |
| 3 | `src/engine/splitter-engine.ts` `mergeShortChapters()` 两处拼接 | 改用 `cleanKeyPoints(..., { maxItems: MERGED_KEY_POINTS_CAP })`（**不截字、不去重**，保持既有口径）；顺手把硬编码 `6` 换成共享常量 |
| 4 | `src/engine/splitter-engine.ts` `cleanRefinedKeyPoints()` | 改用 `cleanKeyPoints(..., { maxCharsPerItem: 80, maxItems: 5 })` |
| 5 | `src/engine/chapter-edit-engine.ts` `mergeChapterRange()` | 改用 `cleanKeyPoints(..., { maxItems: MERGED_KEY_POINTS_CAP, dedupe: true })`；私有 `normalizePoint` 删除，refs 对齐统一走 `normalizeKeyPointText` |

**第二道门的必要性**：`"4.2.2"` 这类碎片**过得了**旧质量门（`hasMeaningfulText`
要求 ≥2 个字母数字，`"4.2.2"` 有 3 个数字）。纯编号判据必须独立成门。

### 4.2 渲染侧（存量脏数据立刻不再显示）

| # | 位置 | 改动 |
|---|---|---|
| 6 | `features/learn/detail/KnowledgeTab.tsx` | `keyPointRefs` 与 `keyPoints` 两条分支在 map 前按 `isUsefulKeyPoint` 过滤（`pointViews` useMemo） |
| 7 | `features/learn/render/markdown-core.tsx` | `li` 去掉自印的 `· `；`hr` 改为返回 `null`（空 block 会撑一行） |
| 8 | `features/learn/ChapterReaderPage.tsx` | 要点芯片与「Why it matters」导语均改用过滤后的要点 —— **方案范围扩充**，见 §7 |
| 9 | `features/learn/reader/ChapterQaPanel.tsx` | 示例问题（要点前 3 条）先过滤 —— 否则会生成「解释 4.」这种按钮，**方案范围扩充** |

### 4.3 存量数据：**不做迁移**（D3）

不动 `plos.chapters`，零风险。脏条目仍在库里，但界面不再显示；重新切分后自然消失。

## 五、决策记录（D1–D4，用户全取推荐项）

| # | 决策点 | 定案 |
|---|---|---|
| D1 | 治本层修到什么程度 | **质量门 + 清洗单一真源**：不动断句正则，回归面最小 |
| D2 | 渲染侧是否一并修 | **过滤脏要点 + 修 `MarkdownInline`** |
| D3 | 已落库脏要点 | **不做迁移**，靠渲染层过滤 |
| D4 | 44 章 `keyPointRefs` 全为 0 | **记待办，下一轮单独排查**（另一条根因，不混批） |

## 六、验证证据

### 6.1 真实数据 + 离线渲染探针（修复后重跑）

```
A. 渲染层：碎片 "4." 的整行 HTML
修复前: <li ...><span class="mr-1">•</span>...<span class="block">· </span>...
修复后: <li ...><span class="mr-1">•</span>...<span class="block"></span>...
修复后（正常要点）: <li ...><span class="mr-1">•</span><span class="leading-5">东帝汶被列为最贫困国家之一</span></li>

B. summarize() 对编号开头的输出
"4.2.2 外汇管理出入境，须获得明确授权。" → []
"5.1 关税及相关规定"                     → []

C. 存量快照（真实 plos.chapters）：要点共 135 条，渲染过滤后丢弃 3 条
  章 18「3.5.5 境外园区」：2 → 1 条，丢弃 ["4."]
  章 20「4.2.5 信用卡使用」：2 → 1 条，丢弃 ["4."]
  章 22「4.4.4 建筑成本」：2 → 1 条，丢弃 ["5."]
```

C 项与 §2.1 的取证逐条吻合 → 过滤范围既不多也不少。

### 6.2 测试

| 套件 | 结果 |
|---|---|
| `test:splitter` | **11/11**（新增 UC-9 断句碎片质量门 / UC-10 合并后无脏碎片 / UC-11 `isUsefulKeyPoint` 判据） |
| `test:library` 全链 | ✅ 全绿（含 overview 30/30、ai-map-reduce 28/28、progress 35/35） |
| `test:chapters` / `test:render` / `test:storage` / `test:i18n` / `test:keypoint` / `test:card` / `test:flashcard` / `test:aimap` / `test:qa` / `test:restatement` / `test:overview` / `test:progress` | ✅ 全部 OK |
| `npm run typecheck` | 仅 3 条**既存**错误（`settings/AIModelsSection.tsx:56-58` 未使用变量，非本次引入） |

## 七、方案范围扩充登记（实施期新增，非静默改）

方案 D2 只点名了 `KnowledgeTab`。实施时 grep 章节要点的**全部**消费面，发现另外 2 处
同类渲染点，若不修则「空数据」现象在别的界面照旧：

| 位置 | 方案原文 | 实现 | 理由 |
|---|---|---|---|
| `ChapterReaderPage.tsx` 要点芯片 + `leadOf` 导语 | 未提及 | 一并过质量门 | 芯片会渲染成一个写着 `4.` 的按钮；`leadOf` 更严重 —— 脏碎片会成为**整段「Why it matters」导语** |
| `ChapterQaPanel.tsx` 示例问题 | 未提及 | 一并过质量门 | 会生成「解释 4.」这种无意义建议按钮 |

**刻意不动**：要点**计数**类消费点（`ChapterRow` 的「N 要点」、`DocumentCard` 累计、
`SplitTab` 统计、`LibraryPage` 搜索匹配）。理由是计数语义是「库里存了多少条」，
应当诚实反映数据；D3 既然不做迁移，计数与可见数的差异就是存量脏数据的必然表现，
重新切分后自然归零。若要一并改，需先重新定义「已提取要点」的统计口径 —— 超出本次修复范围。

## 八、遗留待办（下一轮）

| # | 问题 | 证据 |
|---|---|---|
| 1 | **这份 PDF 全部 44 章 `keyPointRefs` 为 0** —— 「提取要点」的 AI 结果从未落库（属另一条根因，D4 决定单独排查） | 应用日志：`章要点分析失败 doc=doc-3a3025f2 chapter=1.5.1 民族 reason=AI 要点抽取未返回任何带原文出处的要点。` |
| 2 | 章 13 要点为「帝坝港夜景航拍\n\n济发展，并维护东网络安全。」—— PDF 抽取把图注与残句混行 | 属**导入文本质量**问题（PDF 抽取层），与本次要点清洗无关 |

## 九、改动文件清单

| 类型 | 文件 |
|---|---|
| 生成侧 | `src/lib/text-quality.ts` · `src/engine/splitter-engine.ts` · `src/engine/chapter-edit-engine.ts` |
| 渲染侧 | `src/features/learn/detail/KnowledgeTab.tsx` · `src/features/learn/render/markdown-core.tsx` · `src/features/learn/ChapterReaderPage.tsx` · `src/features/learn/reader/ChapterQaPanel.tsx` |
| 测试 | `tests/library-splitter.test.ts`（+3 用例，11/11） |

零改动区（未触碰）：`src-tauri/**`、`src/storage/**`、`src/domain/**`、`src/stores/**`、i18n 双语字典。

## 变更记录

| 日期 | 内容 | 作者 |
|---|---|---|
| 2026-09-16 | 初稿：根因定位（真实快照 + 离线渲染双取证）、D1–D4 定案、生成侧 + 渲染侧实施完毕、测试全绿、登记 §7 范围扩充与 §8 两条遗留待办 | Agent |
