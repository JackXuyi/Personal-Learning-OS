# 资料库「导入 / 提取」缺口修复 runbook（2026-09-11）

> 依据：`docs/library-import-extraction-audit-2026-09.md` 第 5 节建议顺序 M-1 → M-6。
> 纪律：本仓库常有并行会话，提交只按路径、只落本地不 push。

## 0. 前置事实

- 基线：`main`，工作区干净（仅新增审计文档），本地领先远端 0 个提交。
- 门禁：`npm run typecheck` + `npm run test:{import,chunk,retrieval,rag,i18n}`。
- 约束：不主动起浏览器校验（`rules/no-headless-browser-validation`）。

## 1. 任务清单与验收标准

| ID | 缺口 | 改动面 | 验收标准 |
|---|---|---|---|
| **M-1** | G1 替换/追加/重切后向量只失效不重算 | `library/dialogs.tsx`（替换、追加）、`detail/SplitTab.tsx`、`LibraryPage.tsx` + `tests/rag-wiring.test.ts` | ①单测：替换正文 → 旧向量清空 → 重算后向量条数 == chunk 数；②静态断言：三处 UI 均调用 `autoIndexAfterImport` |
| **M-2** | G2/G3 导入层中文硬编码 + 9 个死键 | `import/github.ts`、`import/local-files.ts`、`import/pdf.ts`、新增 `import/error-text.ts`、`i18n/messages/{zh,en}.ts`、`GithubPanel.tsx`、`LocalFilePanel.tsx`、`ImportModal.tsx` | typecheck 0 error；`test:i18n` 结构对齐；全仓 `grep` 导入层无中文字面量错误 |
| **M-3** | G4 本地 md 恒 UTF-8 解码 | 新增 `import/decode.ts`、`import/local-files.ts` | 单测：UTF-8 / UTF-8 BOM / UTF-16LE / GBK 四种输入均正确解码 |
| **M-4** | G6/G7 结果卡无抽取量与索引状态 | `ImportModal.tsx`、`i18n` | 结果卡出现「抽取 N 字符 · N/M 页有文本」与索引态一行 |
| **M-5** | G5 PDF 无版式后处理 | 新增 `import/pdf-layout.ts`、`import/pdf.ts` | 单测：y 聚类重排、分栏左右顺序、行尾连字符修复、跨页页眉页脚去噪、疑似标题提升 |
| **M-6** | G8 `extractKnowledge` 双轨空实现 | `ai/types.ts`、`ai/active.ts`、`ai/registry.ts`、`ai/builtin.ts`、`ai/openai-compatible.ts` + 4 处测试 mock | typecheck 0 error；全仓无 `extractKnowledge` |

## 2. 逐任务执行记录

### M-1 状态：done

- outcome：向量重算接线补齐，4 条正文变更路径全部入队；单测 `test:rag` 由 8 例扩至 10 例全绿。
- 设计取舍：不在 `index-chunks.ts` / `split-service.ts` 内触发（二者硬契约「零 AI」），改由**调用方 UI 层**触发（与 `ImportModal` 既有做法一致）。

### M-2 状态：done

- outcome：导入层不再产出中文文案——错误对象只携带 `kind` + 语言中立 `detail`；文案统一由 `import/error-text.ts` 按 `kind` 取 i18n。
- 死键处理：删除 `progressDone` / `refinedBadge` / `previewHead` / `stepPreview` / `github.fileTooMany`；`local.{unsupported,tooLarge,scanningNoText,readFailed}` 归并入 `local.errors`；`local.kindMd/kindPdf` 由 `LocalFilePanel` 消费。
- 新增 `GhErrorKind = "fetch-failed"`，区分「清单全部拉取失败」与「范围内无 md」。

### M-3 状态：done

- outcome：`decode.ts` 零依赖嗅探——BOM 优先 → 严格 UTF-8 试探 → GB18030 兜底；编码名经 `ImportUnit.extract.encoding` 上报，结果卡提示。

### M-4 状态：done

- outcome：单份结果卡新增「抽取 N 字符 · M/N 页有文本 · 已按 XX 解码」与索引态一行（已入队 / 未配置模型·仅全文检索 / 向量化进行中 i/n）。

### M-5 状态：done

- outcome：`pdf-layout.ts` 纯函数（无 pdfjs 依赖，可 node 直测）：y 聚类成行 + x 间距补空格 → 分栏检测（中线无重叠且两侧均有行）→ 行尾连字符与 CJK 拼接修复 → 跨页重复行/页码行去噪 → 疑似标题行提升为 Markdown 标题（提升 > 0 时 PDF 走 markdown 切分）。

### M-6 状态：done

- outcome：`AIProvider.extractKnowledge` 及其 5 处实现/声明全部删除，4 处测试 mock 同步清理；真实概念抽取唯一入口为 `ai/pipelines.extractChapterConceptsWithAi`。

## 3. 收尾核对（实测，2026-09-11）

```
npm run typecheck   → 0 error
npm run test:import    → import-core: 20/20 passed
npm run test:extract   → import-extract: 13/13 passed   （新增）
npm run test:chunk     → chunk-engine: 12/12 passed
npm run test:retrieval → retrieval: 21/21 passed
npm run test:rag       → rag-wiring: 10/10 passed       （8 → 10：新增 UC02-04 / TC-EDGE-11）
npm run test:i18n      → [i18n-alignment] 8/8 通过
npm run test:storage   → storage-adapter: 28/28 passed
npm run test:library   → 5 组（anchor/advice/keypoint/preview/overview）全绿
```

「done 已落盘」自证（防「文档说完成、代码没改」）：

| 断言 | 命令 | 结果 |
|---|---|---|
| `extractKnowledge` 已从接口与实现删除（仅剩说明性注释） | `grep -rn extractKnowledge src tests` | 仅 2 处注释命中 |
| 4 条正文变更路径均已接线 | `test:rag` 的 `TC-EDGE-11` | ✅ |
| 导入层无用户可见中文错误文案 | `test:extract` 的静态断言 | ✅ |
| 死键已清 | `grep -rn progressDone\|refinedBadge\|previewHead\|stepPreview\|fileTooMany src --exclude-dir=i18n` | 0 命中 |

未做：浏览器 / E2E / 截图级校验（遵守 `rules/no-headless-browser-validation`）；
「真实中文 PDF 抽取质量」「GitHub 整库端到端」仍为 runbook 手工待验项。

遗留（本次未动，已在审计文档 §6 留档）：G9 覆盖率文案提示、G10 `path`/`uri`、
`SourceDocument.source` 的 `本地文件 · <名称>` 数据标签本地化（需数据模型改动）。
