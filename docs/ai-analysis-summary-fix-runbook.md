# AI 分析（概念/要点/概览）summary 失败修复 Runbook

> 方案：`docs/ai-analysis-summary-fix-design-2026-09.md`（v1.2，12 章）
> 审计关联：`docs/library-import-extraction-audit-2026-09.md` §7
> 状态：**2026-09-11 已实施**（T1–T9 + T12 落盘；T10/T11 按 D2/D3 决策移出本轮）

## 决策记录

| ID | 结论 |
|----|------|
| D1 | 四层全修（参数透传 + 输出上限 + 截断修复 + UI 可观测） |
| D2 | 暂不动 API 档（`openai-compatible.ts` 零改动） |
| D3 | 本次不动「正文上限 40k 字 vs context 32768」（R3 留下轮） |
| D4 | 输出上限 4096（Rust `DEFAULT_MAX_TOKENS` + TS `BUILTIN_MAX_TOKENS`） |

## 任务落盘

| ID | 任务 | 状态 | outcome |
|----|------|------|---------|
| T0 | 并行会话协调编辑窗口 | ✅（v1.2 已解除） | 并行会话已提交 `9cacc80`+`4b6332b`，工作树干净 |
| T1 | Rust：`GenerateRequest` +2 字段、`resolve_sampling()`、兜底 4096、单测 | ✅ | `commands.rs`：`temperature`/`samplingPreset` 可选字段；纯函数统一采样优先级；`DEFAULT_MAX_TOKENS=4096`；5 例单测 |
| T2 | Rust：`tight_structured()` 转正 | ✅ | `models.rs` 移除 `#[allow(dead_code)]`，注释指向 `resolve_sampling` |
| T3 | TS：`ChatInput` +`maxTokens?`/`jsonMode?` | ✅ | `types.ts`，纯可选字段向后兼容 |
| T4 | TS：`json-repair.ts` 新增 | ✅ | `repairTruncatedJson`：完整元素边界回退 + 容器空壳回退 + 裸词垃圾拒修 + parse 验证兜底 |
| T5 | TS：`builtin.ts` 透传 | ✅ | `chat()` 组 request 带 `maxTokens`(默认 4096)/`temperature`/`samplingPreset:"tight"` |
| T6 | TS：`pipelines.ts` chatJson/extractJson | ✅ | `chatJson` 传 `jsonMode:true`；`extractJson` parse 失败后接修复；**实施中发现**：截断在第一个元素中间时整串无闭合符，`close<=open` 分支改为也走修复（超出方案伪代码的边界补丁） |
| T7 | UI：`KnowledgeTab` 失败原因可见 | ✅ | `failed` 升级 `{title,reason}[]`；概念 catch 补 `extra=e.message`；要点路径同形状；共用 `toFailedItems`；`analyze-service` 零改动（reason 本就已采集） |
| T8 | i18n：2 键 × 中英 | ✅ | `learn.detail.knowledge.failedItem`/`failedUnknown`，插在各语言 `graphNoAi` 之后，两路径共用 |
| T9 | 测试：`tests/ai-pipeline.test.ts` + `test:ai` | ✅ | 6 例（方案 5 例 + 「裸词垃圾/结构错乱拒修」），含 chatJson 透传根因回归守门 |
| T10 | openai-compatible `response_format` | ⏭ 移出 | D2 |
| T11 | 正文上限与 context 对齐 | ⏭ 移出 | D3（R3 已知风险） |
| T12 | 验证与文档 | ✅ | 见下 |

## 验证证据（全部实跑）

| 检查 | 结果 |
|------|------|
| `npm run typecheck` | 0 error |
| `cd src-tauri && cargo test --lib` | 19/19（14 既有 + 5 新增 `resolve_sampling`/兜底） |
| `npm run test:ai`（新增） | 6/6 |
| `npm run test:library` | 58/58（7+9+8+10+24）不回退 |
| `npm run test:rag` | 10/10 不回退 |
| `npm run test:i18n` | 8/8 |
| `git diff 4b6332b -- src/ai/openai-compatible.ts` | 空（D2 守门：API 档零改动） |

## 手工验证（待用户，桌面端）

1. builtin 档（qwen3.5:4b）对同一份此前失败的资料重跑「AI 分析概念」→ 期望逐章成功、图谱出现概念节点；
2. 若某章仍失败 → UI 顶部显示总体原因、失败列表逐条 `章标题：原因`（不再只有标题）；
3. 可选回归：deepseek 档同资料重跑 → 仍成功（请求体未变）。

## 改动文件清单（11 个）

| 文件 | 类型 |
|------|------|
| `src-tauri/src/llm/commands.rs` | 改（+resolve_sampling/+字段/+4096/+5 测试） |
| `src-tauri/src/llm/models.rs` | 改（去 dead_code + 注释） |
| `src/ai/types.ts` | 改（ChatInput +2 可选字段） |
| `src/ai/builtin.ts` | 改（request 透传 + BUILTIN_MAX_TOKENS） |
| `src/ai/json-repair.ts` | **新增** |
| `src/ai/pipelines.ts` | 改（chatJson jsonMode / extractJson 修复接入） |
| `src/features/learn/detail/KnowledgeTab.tsx` | 改（FailedItem + 渲染 + catch） |
| `src/i18n/messages/zh.ts` | 改（+2 键） |
| `src/i18n/messages/en.ts` | 改（+2 键） |
| `package.json` | 改（+test:ai） |
| `tests/ai-pipeline.test.ts` | **新增** |

## 遗留（下轮候选）

- **R3**：`conceptMaxTextChars=40_000`（中文约 3 万+ token）+ 4096 输出逼近 `context_size=32768`；若超长章仍失败，按 `context_size` 推导正文上限；
- **R6**：Tauri 档 `saveGraph` 只落 localStorage，SQLite `knowledge_units` 空表（双写统一，独立方案）；
- 概念分析失败时「总体原因」与逐章 reason 的 i18n（总体原因 `e.message` 为诊断直出，未套 i18n，与既有先例一致）。
