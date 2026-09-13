# 资料导入流程优化方案（2026-09-13）

| 字段 | 内容 |
|------|------|
| 作者 | Agent |
| 日期 | 2026-09-13 |
| 状态 | **已实施（O1~O4，2026-09-13）**；O5~O7 未实施，D2 决策留档 |
| 前置 | `library-import-extraction-audit-2026-09.md`（G1–G8 已修 / M-1~M-6 done）、`ai-chapter-mapreduce-design-2026-09.md`（map-reduce 已落地）、纯符号要点修复 `bf938d6`（已实施） |

---

## 0. 结论先行

导入链路的主干（三来源归一化 → 五阶段管道 → chunks → 后台向量化）经过两轮修复后已无**接线级**缺口。本轮优化聚焦三类问题：

1. **🔴 一处质量门旁路**：昨天堵住的「纯符号要点」只拦了**分析路径**（`parseKeyPointDrafts` / `parseKeyPointMerge`），**导入精修路径**（`cleanRefinedKeyPoints`）没拦 —— 同一个 `!` 仍可在导入时从 AI 精修混进 `keyPoints`。
2. **🟠 两处健壮性缺口**：重复导入无去重（同 repo 导两次 = 两份资料 + 两份向量）；粘贴来源无体积护栏（唯一没护栏的入口）。
3. **🟠/🟡 体验与清洗盲区**：badge 行残留碎片、引用式图片未清洗、批量导入不可取消、导入后分析仍需逐章手动触发。

---

## 1. 优化项清单

| ID | 严重度 | 问题 | 证据（现状） | 建议 |
|---|---|---|---|---|
| **O1** | 🔴 | 导入精修的 keyPoints 无质量门，「!」类垃圾可从导入路径再次入库 | `engine/splitter-engine.ts:447` `cleanRefinedKeyPoints` 只做「剔空、截 80 字、≤5 条」，**没有有效字符校验**；`refineSplitResult`（`pipelines.ts:142`）在导入 `refine` 阶段对每章跑 AI 精修并替换 keyPoints | 把 `hasMeaningfulText` 从 `ai/chapter-map-reduce.ts` **下沉到共享层**（依赖方向 ai→engine 单向，helper 放 `engine/` 或 `lib/`，ai 侧 re-export），`cleanRefinedKeyPoints` 过滤时复用；合并章的 `keyPoints` 拼接处（`splitter-engine.ts:428`）同样过滤 |
| **O2** | 🟠 | 重复导入无去重：同一 GitHub repo / 同名文件导两次 = 两份资料 + 两份 chunk + 两份向量，检索结果重复、配额浪费 | `pipeline.ts:55-78` 无任何查重——`source` 只透传保存，`runBatchImport` 照单全收 | 导入前按 `source`（GitHub URL / 本地文件名+字节数）查 `listDocuments()`；命中 → 按 D1 决策处理（跳过 / 覆盖 / 询问） |
| **O3** | 🟠 | 粘贴来源是唯一无体积护栏的入口：超大粘贴可撑爆 localStorage 配额且失败发生在管道中段（read 已写入） | 审计文档 §1.2 明示「无体积校验」；`ImportModal.tsx:205` `text: body` 直取 textarea 原文 | 粘贴沿用 `LIMITS.githubTotalChars`（1.5M）或独立上限，超限**前置拦截**（按钮禁用 + 提示），与本地文件/GitHub 护栏口径对齐 |
| **O4** | 🟠 | 清洗盲区：三类常见 README 噪音未被 `stripMarkdownNoise` 覆盖 | ①badge 行 `[![Build Status](…)](…)` 洗完剩 `Build Status` 碎片行；②引用式图片 `![alt][id]` 与定义行 `[id]: url` 原样保留；③HTML 注释 `<!-- -->` 保留 | `normalize-text.ts` 扩展三条规则：纯「链接包图片」行整行删除；引用式图片/定义行删除（或保 alt）；HTML 注释删除。均为纯正则，测试好写 |
| **O5** | 🟡 | 导入后分析全手动：概览 / 概念 / 要点都要进详情页逐章点 | `analyze-service.ts` 仅由详情页 Tab 触发；导入结果卡只有「索引入队状态」 | 结果卡增加可选「导入后自动分析」开关（默认关），开启则后台串行跑要点+概览（`onlyMissing` 语义，失败静默）。受 D2 决策约束 |
| **O6** | 🟡 | 批量导入不可取消、单份失败无重试 | `runBatchImport`（`pipeline.ts:120`）串行 for 循环，无 AbortSignal；失败只进 `summary.failed` | 传入 `AbortSignal`，UI 加「取消」按钮；结果卡失败项加「重试本份」。改动中等 |
| **O7** | 🟡 | GitHub 限流配额浪费：重复预览/导入重复打 api.github.com（60 次/时） | `resolveGithubUrl` 每次全新拉取；`fetchMdContents` 无 etag/缓存 | O2 落地后影响已减小；如再做，预览结果按 URL 做 sessionStorage 短缓存（5 分钟）。**建议缓一缓** |

---

## 2. 决策点

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| **D1** | O2 重复导入策略 | A. 静默跳过（结果卡标「已存在」）· B. 静默覆盖（删旧 doc + chapters + chunks 后重建）· C. 弹窗询问 | **A**——最符合「避免冗余」与最小惊讶原则；B 的删除链路（向量/FTS 关联表）风险高，C 打断批量流程 |
| **D2** | O5 自动分析 | A. 不做（保持手动）· B. 全局设置开关，默认关 · C. 导入结果卡一次性勾选 | **C**——不新增设置项，按次选择，符合现有结果卡的交互形态 |
| **D3** | O1 质量门 helper 下沉位置 | A. `engine/`（与 `applyChapterRefine` 同文件）· B. 新建 `src/lib/text-quality.ts` | **B**——`hasMeaningfulText` 语义是通用文本质量，不是切分引擎职责；engine 与 ai 各自 import，依赖单向不破 |

---

## 3. 建议实施顺序

```
O1（质量门旁路，~20 行 + 测试）
  → O3（粘贴护栏，~15 行）
  → O4（清洗扩展，~30 行正则 + 测试）
  → O2（去重，中等，需 D1）
  → O5 / O6（体验项，需 D2 / 单独评估）
```

O1~O4 合计约 1 个 runbook 的量（T1~T5），O5/O6 视 D2 决策另开。

## 4. 验收口径（O1~O4）

- `npm run typecheck` 0 新增 error
- `test:import` / `test:aimap` / `test:chunk` 全绿；O1 补「精修要点含纯符号被过滤」单测
- O2 补「同 source 二次导入 → 跳过（D1-A）」单测
- 全程不做浏览器校验（`rules/no-headless-browser-validation`）

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-13 | 初稿：O1~O7 七项 + 决策点 D1~D3 | Agent |
| 2026-09-13 | 状态置「已实施（O1~O4）」；D1 终选「弹窗询问」（方案原文推荐 skip，实施时用户改选）；badge 行规则收窄为仅空 alt（偏差见 runbook T3）；O5~O7 待后续 | Agent |
