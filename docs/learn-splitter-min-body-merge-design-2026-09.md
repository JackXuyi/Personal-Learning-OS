# 章节切分 · 短章合并兜底设计（v1.0，2026-09）

> 关联：`docs/knowledge-import-design-2026-09.md`（GitHub 导入 UC-03）、`docs/library-import-extraction-audit-2026-09.md`
> 状态：已确认实施（决策点 D1 = 200 字 / D2 = 仅 engine 兜底）

## 1. 背景与根因

GitHub 导入的资料在章节列表出现「README.md」13 字空壳章，以及「贡献指南 82 字」「许可协议 28 字」这类碎章。

链路：`buildRepoMarkdown`（`src/features/learn/import/github.ts:295`）给每个文件前插入 `# <相对路径>` 作为文件边界 → `splitDocument`（`src/engine/splitter-engine.ts`）按 #/## 标题切分。

| 现象 | 根因 |
|------|------|
| 「README.md」空壳章 | 文件自身以 `# 一级标题` 开头时，`# README.md` 边界章的正文只剩标题行自己；splitter 只丢弃「完全空白」的章，不处理「只有标题」的章 |
| 82 字 / 28 字章单独存在 | 标题切分路径没有「最小正文体量」兜底 |
| AI 精修未救回 | 精修只改标题名，`mergeIntoPrevious` 建议未被采纳 |

## 2. 目标与完成标准

- 标题切分产出的章，正文（剔除标题行后）低于阈值时自动并入相邻章；
- 导入与「重新切分」两条链路（`pipeline.ts` / `split-service.ts`）统一生效；
- 纯函数、确定性、零 AI；不丢任何原文（contentRef 取并集）；
- typecheck 0 error；新增单测全绿。

## 3. 方案（D2 = 仅 engine 兜底）

`splitter-engine.splitByHeadings` 在建章之后增加一道合并兜底，`github.ts` 不动（多文件仓库的文件边界语义保留，垃圾边界由 engine 层吸收）。

### 规则

1. 新增 `SplitOptions.minBodyCharsPerChapter`（默认 **200**，0 = 关闭），仅作用于标题切分路径；段落聚类路径本就按体量聚合，不受影响。
2. 章正文体量 = `firstBodyLines(contentRef 切片).trim().length`（剔除所有标题行后计字符）。
3. 扫描找出最靠前的短章并合并，迭代至无短章：
   - **非首章 → 并入上一章**（上一章 `end` 扩到本章 `end`，标题留上一章）；
   - **首章 → 并入下一章**（下一章 `start` 扩到本章 `start`，含本章标题行，不丢内容）；
   - keyPoints 合并截断至 6 条；每次合并后重写 `order`。
4. **防吞保护**：某次合并会把章节收敛到只剩 1 章、且整份正文总量 > 10,000 字符（`MERGE_SINGLE_CHAPTER_MAX_BODY`，约 6 倍目标章节体量 1600）时，停止合并保留现状——避免「全篇皆短章」的超长文档被吞成一个巨章。小文档（正文 ≤ 10,000 字符）允许自然收敛为 1 章。
   - 已知代价：两章结构（如 超长章 + 28 字尾章）且正文 > 10,000 时，尾章会保留。可接受：防吞优先于消碎。

### 不做的事

- 不改 `github.ts`（D2 决策）；不动 AI 精修管线；不改段落聚类行为；不新增 i18n 文案。

## 4. 代码改动清单

| 文件 | 改动 |
|------|------|
| `src/engine/splitter-engine.ts` | ① `SplitOptions` 增 `minBodyCharsPerChapter`；② 新增模块内纯函数 `mergeShortChapters(text, chapters, minBody)`；③ `splitByHeadings` 返回前调用 |
| `src/features/learn/split-service.ts` | `SplitRunOptions.split` 类型增 `minBodyCharsPerChapter`（值经 `...opts.split` 已自动透传） |
| `src/features/learn/import/pipeline.ts` | `runUnitImport` 的 `split?:` 内联类型同步（`DEFAULT_SPLIT` 不必加，engine 缺省即 200） |
| `tests/library-splitter.test.ts` | 新增单测（见 §5） |
| `package.json` | 增 `test:splitter` script |

## 5. 测试用例

1. **UC-1 空壳边界章**：`# README.md\n\n# 主标题\n\n正文...` → 空壳章并入下一章，章数减一，下一章 contentRef.start = 0，原文无丢失；
2. **UC-2 尾部短章**：尾章正文 < 200 → 并入上一章，contentRef 取并集；
3. **UC-3 首章短章**：首章正文 < 200 且有下一章 → 并入下一章；
4. **UC-4 阈值边界**：正文恰为 200 字 → 不合并（`<` 严格判断）；199 字 → 合并；
5. **UC-5 防吞保护**：两个短章 + 总正文 > 10,000 → 停止收敛，保留 2 章；
6. **UC-6 小文档收敛**：全短章、总正文 ≤ 10,000 → 收敛为 1 章；
7. **UC-7 关闭开关**：`minBodyCharsPerChapter: 0` → 行为与旧版一致；
8. **UC-8 段落聚类不受影响**：无标题文本走聚类，章数与旧逻辑一致。

## 6. 运行

```
npm run test:splitter && npm run typecheck
```
