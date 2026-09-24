# 本地 DOCX 导入（F8 范围 3）实施 runbook

> **状态：✅ 已完成（2026-09-23，T1–T11 全 done）**。
> 任务定义与验收口径的唯一真源：`docs/library-import-docx-design-2026-09.md`
> （§8 伪代码 / §9 任务清单 / §10 实施步骤 / §11 通过标准 / §12 测试用例）。
> 本文只记录**执行状态、outcome 与实施期发现**，不复制方案内容。
>
> **口径**：用户在 Agent Mode 下确认 **「接受 D6，直接实施」** ⇒ D1 `mammoth`（用户已确认）+
> D3 GFM 表格（用户已确认）+ **D6 只用 `transformDocument` 取 AST、自写 Markdown 输出层**
> （D1 与 D3 同时成立的唯一形态）。

## Goal

把 `docs/library-import-docx-design-2026-09.md` 落到代码：本地文件 Tab 支持 `.docx`，
经 `mammoth` 取文档 AST → 自写 Markdown 输出层（四层标题判定 / 列表 / GFM 表格 / 图片跳过）
→ 归一化为 `ImportUnit` → 走**零改动**的 `runUnitImport` 共享管道。
兑现方案 §11.3 的 6 条通过标准（含最关键的一条：**导入真实「靠字号分层」的 DOCX 能还原层级**）。

## Context

- 方案（唯一真源）：`docs/library-import-docx-design-2026-09.md`
- 涉及路径（新增 4 / 修改 6）：`src/features/learn/import/`
  `{heading-patterns,docx-markdown,mammoth-reader,docx}.ts`（新）、
  `{pdf-layout,types,local-files,LocalFilePanel.tsx}.ts(x)`、
  `src/i18n/messages/{zh,en}.ts`、`package.json`、`tests/import-docx.test.ts`
- 已读规范：`AGENTS.md`、`rules/{commit-conventions,engineering-code-style,...}.mdc`、
  `skills/{tiered-change-workflow,docs-task-runbook,pre-task-technical-design}`
- 约束：**禁起浏览器**（`no-headless-browser-validation`）；**唯一新增依赖 = `mammoth`**；
  `engine/` 与 `ai/` 不 import `features/`；`storage/` 与 `src-tauri/**` **零改动**；
  被单测覆盖的纯逻辑必须 `.ts`（**测试不得 import `.tsx`**）

## Tasks

| ID | 任务 | 依赖 | 状态 | Outcome 摘要 |
|----|------|------|------|--------------|
| T1 | `heading-patterns.ts` 抽出 + `pdf-layout.ts` 改引用（**纯重构，零行为变更**） | — | done | 新增 `heading-patterns.ts`（`HEADING_PATTERNS` / `isNumberedHeading` / `isHeadingShape`，正则逐字搬迁）；`pdf-layout.ts` 删私有常量、两处内联判断改调 `isHeadingShape` + `isNumberedHeading`。证据：`npm run test:extract` **13/13 passed**（`promotePdfHeadings` 的 3 条断言**一字未改**）；`typecheck` 仅剩 3 条 `AIModelsSection` 基线 |
| T2 | 加 `mammoth` 依赖（`package.json`） | — | done | `mammoth@^1.12.3` 入 `dependencies`（新增 26 包）。实测运行时导出含 `convertToMarkdown`，而 `lib/index.d.ts` **无此声明**（类型落后于实现，方案 §3.3h① 复现）；`typecheck` 仅 3 条基线 —— 默认导入在 `moduleResolution: bundler` 下类型可用（TC-EDGE-10） |
| T3 | `docx-markdown.ts`：四层判定 + 列表 + GFM 表格 + 图片跳过 + 文本拼接 | T1 | done | 四层判定（style → styleId 数字 → **字号档位** → 编号兜底）+ 字符加权基准字号 + 列表（含 level 缩进）+ GFM 表格（单行降级、`\|` 转义、列数取最大补空）+ 图片**显式跳过** + 空段归并。**真机抽查 4 份真实 DOCX：标题 4 / 1 / 6 / 0（`size` 层命中 4 / 1 / 6），与方案 §3.3b 基线一致**；`橙子.docx` 表格 → GFM、跳过 14 张图（正文零 base64）；`邢行行.docx` 的「逐字空格」经证伪**在源 `text.value` 内**（我们零插入，TC-EDGE-08） |
| T4 | `mammoth-reader.ts`：AST 抓取 + 入参双形态探测 + 异常归一化 | T2 | done | **平台耦合点最先证伪**：node 下 `{ buffer }` 可用、传 `{ arrayBuffer }` 抛 `Could not find file in options`（方案 §3.3h② 复现）；`transformDocument` 拿到的 AST 实测带 `fontSize`（**磅**：24 / 18 / 14 / 12）、`isBold`、`numbering.isOrdered`、`table` 块。零 `as any`：用 `isRecord` + `Array.isArray` 收窄替代设计里的 `as never`；入参用 `ArrayBuffer` 直传，免掉设计里的 `bytes.buffer.slice(...) as ArrayBuffer` |
| T5 | `docx.ts`：编排 + 4 个语义化错误 | T3 T4 | done | 魔数（`D0 CF 11 E0`）→ AST → Markdown；4 个错误类（Legacy / BadArchive / NoText / TooLarge）。**偏离**：字符护栏改在此处抛 `DocxTooLargeError`（见 §实施期偏离） |
| T6 | `types.ts`：kind / LIMITS 两条 / `classifyLocalFile` / `stripExtension` / `extract` 两字段 | — | done | `LIMITS.localDocxBytes`（20MB）+ `LIMITS.docxMaxChars`（1.5M，**与 `pasteMaxChars` / `githubTotalChars` 并排**）；`LocalFileKind` 加 `"docx"`；`.docx` 判定（大小写不敏感）；`.doc` / `.docm` / `.dotx` 仍 `unsupported`；`stripExtension` 加 `docx`；`extract` 加 `headings` / `tables` |
| T7 | `local-files.ts`：docx 分支 + 3 个错误 kind 映射 | T5 T6 | done | 3 个新 kind（`docx-legacy` / `docx-bad-zip` / `docx-no-text`）；`splitFormat = headings > 0 ? "markdown" : "txt"`；`extract` 填 `headings` / `tables`。**偏离**：① 新增 `FILE_BYTE_LIMITS: Record<LocalFileKind, number>` 替掉 `pdf ? … : md` 三元（顺带修正 docx 超限时 detail 报错「尺子」错误）；② 错误映射并入**既有单一 catch**（设计在 docx 分支内再套一层 try/catch） |
| T8 | `LocalFilePanel.tsx`：accept + kindLabel 映射化 | T6 | done | `accept` 加 `.docx`；`kindLabel` 由三元链改 `Record<LocalFileKind, string>` 映射式（新增 kind 时 typecheck 强制补齐，不再静默显示成 Markdown） |
| T9 | i18n zh/en 成对（kindDocx + 3 错误 + 2 处文案更新） | T7 T8 | done | zh/en 成对：`kindDocx` + 3 条 DOCX 错误文案（`docx-legacy` **可行动**：写明「用 Word 另存为 .docx」）+ `dropTitle` / `unsupported` 加 `.docx`。`test:i18n` **8/8 ✓，0 ✗，exit 0** |
| T10 | `tests/import-docx.test.ts` + `test:docx` 串链 | T1–T9 | done | **两层测试 22 例全绿**：AST 字面量层（四层判定 / 表格三态 / 列表 / 图片跳过 / 多 run / 空段 / tab-break / 基准加权 / 表格不污染基准）+ 真字节层（测试内最小 ZIP 写入器 `store`+CRC32；AST 契约守卫 TC-DOCX-17、OLE / 随机字节 / 缺 `document.xml` / 无文本 / 超字符五条错误路径、`fileToUnit` 与 `runUnitImport` 端到端）。**连带同步两处既有断言**：`import-core` 的 `.docx → unsupported`（设计变更，改为认 docx + 补 `.doc` 仍拒绝）、`import-extract` 的 `localLabels` 夹具补 3 个新 kind。**并增强 G2 静态断言**：中文文案扫描名单加入 DOCX 三件套（为此把 `mammoth-reader` 的两条排障文案改成英文）。`test:docx` 已串入 `test:library` |
| T11 | 负向验证（变体实跑）→ 门禁 → docs 收口 → 提交 | T10 | done | 负向验证 **9/9 全部变红且源码逐字节还原**（含第 2 条「基准改段落数加权」—— 为它补了 TC-DOCX-A4，否则该条不会红）。门禁：`typecheck` 仅 3 条基线 / `test:library` exit 0 / `test:docx` 22/22 / `test:extract` 13/13 / `test:import` 30/30 / `test:i18n` 8/8。真机 4 份真实 DOCX 抽查 4 / 1 / 6 / 0。README 双语勾选 + 统计行手工同步（**条目层** `[x]` 38 · `[ ]` 8，两版实测一致；⚠️ 原始 `grep -o` 计数是 39 / 9，各含**图例行**那一个，别直接抄）；roadmap §F8 明细节 + 4 处汇总节回扫；方案文档补「实施期偏离」10 行 + 「方案自身缺陷」3 行并**就地修正 §8.5 的 OLE 魔数缺陷**。**提交 7 条（见下 §提交分组），全部只落本地、未 push** |

## 实施期发现（决策或文档被推翻时记此）

| 日期 | 发现 | 处置 |
|------|------|------|
| 2026-09-23 | 方案 §8.10 / §11.3 假定 `test:library` 链里已有 `test:extract` —— **实测不成立**：`test:library`（27 组）不含 `test:import` / `test:extract` / `test:i18n`，它们一直靠手工单独跑。 | 按方案意图把 `test:docx` **加入** `test:library`（使新测试进入例行门禁）；同时回填 §8.10 / §11.3 的实际链构成，并把「import 三件套不在链内」登记为遗留。 |
| 2026-09-23 | **方案 §8.5 的 `OLE_MAGIC = 0xd0cf11e0` 是错的**：该值是把魔数字节按**大端**读出的数字，小端读出为 `0xe011cfd0` ⇒ 判等永不成立，魔数判定**静默失效**（老 `.doc` 会被当成「坏压缩包」，用户拿不到「另存为 .docx」那句可行动提示）。 | 由单测 TC-DOCX-11 / A3 抓住 ⇒ 改**字节序列比对**；方案 §8.5 已就地更正，并写入「方案自身缺陷」表 D1。**教训：位运算常量与字节序混用是「不报错的错」**。 |
| 2026-09-23 | 负向验证第 2 条（正文基准改「段落数加权」）在原用例上**不会变红** —— 那些用例里两种加权口径恰好同解 ⇒ 该条等于没测。 | 补 **TC-DOCX-A4**（5 个短大字段 + 1 个长正字段，两种口径分道扬镳），该变体随即真变红。**教训：负向验证不真跑，就不知道守卫是不是空的**。 |
| 2026-09-23 | `tests/import-extract.test.ts` 的 G2 静态断言只扫 `github.ts` / `local-files.ts` / `pdf.ts` —— 新增的 DOCX 三件套不在名单内。 | 把三个新文件加入扫描名单（同层不变量应同层覆盖）；为此把 `mammoth-reader.ts` 的两条中文排障文案改成英文，保持「导入层零中文串」这条不变量**机械可查**。 |
| 2026-09-24 | **提交粒度自纠**：首轮按「一文件一组」提交后回看发现 —— `import-core` 的 `.docx → unsupported` 断言被**分类提交**（`classifyLocalFile` 那一刻）推翻，却拖到**测试提交**才同步 ⇒ 中间 3 条提交的 `test:import` 是红的。三条都未 push ⇒ `git reset`（soft，保工作树）重做分组。 | 定则：**「被本提交推翻的既有断言」必须与本提交同批**，不管它在哪个文件。重排后**逐条** `git stash -u` → `typecheck` + 相关套件 → `stash pop` 实测，7 条全绿。教训：**「编译得过」不等于「测试绿」**，中间提交的绿必须实测而非推断。 |
| 2026-09-24 | **i18n 与「新 kind」的次序不是免费的**：原以为「i18n 键新增可先于消费它的 UI」（既有定则），但 `error-text.ts` 的 `LocalErrorLabels = Record<LocalFileErrorKind, string>` 使**先加 kind 会让调用点立刻缺键** ⇒ 反向才会红。 | i18n 提交**刻意排在接线之前**（`1b4eb2e` 早于 `4b121a0`）。定则收紧为：**新增错误 kind 时，i18n 文案必须早于 kind 定义**（属性访问不触发多余属性检查，多几个键是安全的）；已同步进 memory。 |

## 提交分组（本地提交，未 push）

> 口径：一提交一可编译、且**相关测试绿**（不是「跑得起来」）。逐条实测：
> `git stash -u` → `typecheck` + 该提交相关的测试套件 → `git stash pop`。
> `package.json` 被**行级拆分**（依赖行进解析提交，`test:docx` 脚本 + `test:library` 串链进测试提交）
> ⇒ 那两条提交的 `git commit` 一律**裸 `-F -`**（走 index，不带 pathspec）。
>
> ⚠️ **本表不承诺总数**：特性主体是下面 7 条，但此后每次文档修订都会再加一条，
> 而写进文档的数字会被**写下它的那次提交本身**作废（本表第一版就踩了：写「7 条 / `= 10`」，
> 而补记提交一落就变成「8 条 / `= 11`」）。⇒ **要数字就当场实测，别抄这里。**

| # | commit | 任务 | 内容 | 独立实测 |
|---|--------|------|------|----------|
| 1 | `d06046e` | T1 | refactor：抽出 `heading-patterns.ts`（PDF / DOCX 共用标题判据唯一真源） | `test:extract` 13/13（`promotePdfHeadings` 断言一字未改） |
| 2 | `4a4a52d` | T6 | `.docx` 登记为可导入类型（分类 + 两条体积线 + `extract` 两字段 + `stripExtension`） | `test:import` 30/30 · `test:extract` 13/13 |
| 3 | `88b9c24` | T2–T5 | DOCX 解析层三件套 + `mammoth` 依赖行 + `package-lock` | `test:import` 30/30 · `test:extract` 13/13 |
| 4 | `1b4eb2e` | T9 | i18n zh/en（**刻意早于 5**：见实施期发现） | `test:i18n` exit 0 |
| 5 | `4b121a0` | T7 T8 | 适配器 docx 分支 + `FILE_BYTE_LIMITS` + 面板 `kindLabel` 映射化 | `test:import` 30/30 · `test:extract` 13/13 |
| 6 | `742e51d` | T10 | 单测 22 例 + `import-extract` 夹具/扫描名单 + `test:docx` 脚本与串链 | `test:docx` 22/22 · `test:extract` 13/13 · `test:i18n` exit 0 |
| 7 | `4804357` | T11 | docs：方案回填 / 本 runbook / roadmap / README 双语 | 纯文档，最终态跑完整 `test:library` exit 0 |

上表**不含**此后对本 runbook 的修订提交（它们只改本文件，不碰代码）。

`git rev-list --count origin/main..HEAD` 的**构成**（不是抄来的数）：
**本特性 7 条**（上表）+ **本 runbook 的补记提交**（每修订一次 +1）+ **本特性前既有的本地领先 3 条**。
T11 收尾时实测 10；补记后 11 —— 之后还会继续涨。
⚠️ **要用数字就当场实测**（`git rev-list --count origin/main..HEAD`），别抄这一段。

## 验证录像（2026-09-23 实测）

```text
$ npm run typecheck
src/features/settings/AIModelsSection.tsx(56,7): error TS6133: 'bannerTitle' …   ← 3 条均为 HEAD 既存基线
src/features/settings/AIModelsSection.tsx(57,7): error TS6133: 'bannerDesc' …
src/features/settings/AIModelsSection.tsx(58,7): error TS6133: 'bannerTone' …
（本任务 0 新增 error）

$ npm run test:docx     → import-docx: 22/22 passed
$ npm run test:extract  → import-extract: 13/13 passed   （含增强后的 G2 六文件静态断言）
$ npm run test:import   → import-core: 30/30 passed      （.docx 断言已按设计变更同步）
$ npm run test:i18n     → 8 ✓ / 0 ✗ / exit 0
$ npm run test:library  → exit 0（28 组串联，含新串入的 test:docx 22/22）

负向验证（逐条变异 → 实跑 → 还原并逐字节校验）：
① 去掉字号层                 → 18/22  变红 ✅
② 正文基准改段落数加权        → 21/22  变红 ✅
③ 表格文本同时计入正文        → 21/22  变红 ✅
④ 单行表也产分隔行            → 21/22  变红 ✅
⑤ 图片被当文本拼接            → 21/22  变红 ✅
⑥ .doc 魔数判定交给 mammoth   → 20/22  变红 ✅
⑦ splitFormat 恒取 markdown   → 21/22  变红 ✅
⑧ sizeTiers 改升序            → 20/22  变红 ✅
⑨ mammothInput 恒 { arrayBuffer } → 16/22 变红 ✅
9/9 变红，源码逐字节还原 ✓

真机抽查（本机真实 DOCX，非 CI）：
受控样本 4（size×4）· 报名系统需求 1 · 橙子.docx 6（+1 表格 +14 图跳过）· 邢行行.docx 0
→ 与方案 §3.3b 基线 4 / 1 / 6 / 0 **完全一致**；`邢行行.docx` 的「逐字空格」经证伪在**源 `text.value` 内**
```

> 2026-09-24：提交分组重排（见 §提交分组）后，按上述命令**逐提交复核**；最终态**复跑**一遍
> `typecheck` / `test:docx` / `test:extract` / `test:import` / `test:i18n` / `test:library`，
> 输出与本录像逐字一致（`ALL PASS`，exit 0）。

## 遗留（本次不做，登记备查）

1. **`test:library` 链不含 import 三件套**（`test:import` / `test:extract` / `test:i18n`）—— 一直靠手工单独跑；本次只把 `test:docx` 加入链内，未扩大范围。
2. **mammoth 的 AST 字段未文档化**（`transformDocument` 在 d.ts 里只有 `(element: any) => any`）—— 靠 `test:docx` 的 TC-DOCX-17 守卫；升级 mammoth 时若变红，先看是不是形状变了。
3. **zip bomb 只由两端夹住**（`localDocxBytes` 20MB 文件线 + `docxMaxChars` 1.5M 正文字符线）；mammoth 内部 jszip 解压，拿不到解压前声明大小。若要更严需换回自写 ZIP 层。
4. **行内样式（斜体 / 下划线 / 超链接 / 脚注引用）与文本框内容**仍不入库（D5 非目标）—— 对切分与要点提取无增益。
