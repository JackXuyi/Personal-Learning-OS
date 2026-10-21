# 全局文案优化 执行手册（runbook）

| 字段 | 内容 |
|------|------|
| 对应方案 | `docs/copy-optimization-design-2026-10.md` |
| 执行日期 | 2026-10-21 |
| 状态 | **全数完成**（T0–T13；9 条本地提交，未 push） |
| 关联资产 | `docs/copy-terminology-2026-10.md`（术语单一事实源）｜`docs/copy-orphan-keys-2026-10.md`（孤儿键台账）｜`scripts/copy-scan.mjs`（门禁） |

---

## 1. 提交清单（9 条，按落地顺序）

| # | sha | 提交 | 覆盖任务 |
|---|-----|------|---------|
| 1 | `a530b48` | docs: 收口设置页左侧菜单方案文档与 copy:check 门禁 | T0 |
| 2 | `1842384` | 文案：资料格式下拉改走 i18n，修英文界面残留中文 | T1 |
| 3 | `14ead1c` | 文案：去掉界面里的 markdown 残迹与「领域模型」实现词 | T2 · T3 |
| 4 | `f54401e` | refactor(ui): 下线 /spaces 学习空间占位页，断链归首页 | T4 |
| 5 | `e450c7b` | 文案：向量索引卡与导入链路术语口语化（zh/en 同批） | T5–T8 |
| 6 | `9e961c2` | refactor(i18n): 服务层错误串改机器令牌，文案回 UI 按 kind 映射 | 实施中新增发现 |
| 7 | `7508e62` | chore(copy): 门禁扩到全量 + 术语表 + 定位语去开发代号 | T9 · T10 · 定位语 |
| 8 | `30a05b3` | docs: i18n 孤儿键台账（54 个逐条定性） | T11 |
| 9 | `29d478b` | docs: 仓库元信息去开发代号，与 UI 侧定位语对齐 | T12 收尾 |

---

## 2. 方案被实施推翻的四处（回写依据）

方案是「事前推断」，实施中实测推翻它的地方比预想的多。以下四处已在方案 §11 追加修订记录，此处留详细口径。

### 2.1 §2.3 的「21 个孤儿键」结论**不可靠**（P0 阶段即发现）

- **原判**：`learn.import.formatNote/Web/Txt` 等 21 个键零消费，可删。
- **实测**：删键后 `typecheck` 立刻报 TS2551 —— `ImportModal.tsx:156-158` 有真实消费方。
- **根因**：原判据用**裸 grep 拼多模式**（`grep "a\|b"`），它会**静默返回 0 命中**。本轮实测复现多次：查 `formatNote|formatWeb|formatTxt`、查 `pdf-no-text|"pdf-ocr-unavailable"` 全部返回空。
- **修正**：改用 Node 正则重扫得 **54 个**疑似孤儿，逐条用 Grep 工具复核后定性，登记台账，**本轮一个都没删**。
- **教训已写入**：`docs/copy-orphan-keys-2026-10.md` 开头 + 本项目 MEMORY「通用坑」。

### 2.2 §5.3 的 `coverageValue` 单位改法**会改错口径**

- **原判**：`1 / 1 块` → `1 / 1 份资料`。
- **实测**：`index-service.ts::embeddingCoverage` 的分母是 `collectTargets(store, "chunk")` 的**正文切片数**，不是资料数。
- **修正**：单位改成口语的「段 / passages」，但**仍按切片计数**，口径未动。若照原判改会把「已索引的段落数」说成「已索引的资料数」，是事实错误。

### 2.3 §9.3「明确不做」漏了一项：服务层中文错误串

- **原判**：用户可见文案 = i18n 字典。
- **实测**：`useAiTaskStore.run` 的 catch 是 `finish(id, "error", e.message)`，`SplitTab` / `dialogs.tsx` 的 catch 也直接 `setNotice(e.message)` ⇒ **6 个服务抛的中文 message 会原样渲染给用户**，切英文不生效。
- **修正**：新增提交 #6，按仓库既有约定（服务层只产 enum、文案由 UI 映射）把 message 换成机器令牌。顺带修掉两个**判据从未生效**的既存缺陷（详见 §3）。

### 2.4 §5.1 的 D6「README 里程碑句」**无处可改**

- **原判**：README 正文可能有「本版为 Pre-MVP 里程碑（U6 · UI Workbench 收官）」类句子。
- **实测**：`Pre-MVP` 在 README 只出现在**状态徽章**一处（zh:13 / en:13），正文零命中。
- **修正**：只改徽章，D6 的其余部分无对象。

---

## 3. 顺带修掉的两个既存缺陷

这两个不是文案问题，是**逻辑缺陷**——判据匹配 message 里的中文字符串，而 message 本身是中文，所以分支从未命中：

| 位置 | 原判据 | 问题 | 修正 |
|------|--------|------|------|
| `SplitTab.tsx` 切分 catch | `err.message.includes('no-body')` | message 是「这份资料没有正文。」，**不含** `'no-body'` ⇒ 分支从未命中，异常一律落到兜底显示原始 message | 判 `SplitServiceError.kind` |
| `dialogs.tsx` 追加 catch | `msg.includes("上限") \|\| msg.includes("limit")` | 同上；且中英两套判据并存 | 判 `LibraryActionError.kind` |

---

## 4. 门禁结果（实施后实测）

| 门禁 | 结果 |
|------|------|
| `typecheck` | 0 error |
| `layer:check` | 无新增环（基线不变） |
| `ui:check` | 原生下拉 0 + sticky 0 |
| `test:i18n` | 7 项绿 |
| `copy:check` | **五项全 0 命中**（zh 1823 值 / en 1823 值 / markdown 残迹 ×2 / 界面层硬编码） |
| `build` | 通过 |
| 受影响单测 | `test:enrich` 20 项 · `test:splitter` 11 项 · `test:chapters` 40 项 · `test:overview` 30 项，全绿 |

### 反向自检（证明门禁不是恒绿）

| 检查 | 喂入 | 结果 |
|------|------|------|
| 技术词检出 | `HEAD~3` 的字典 | **23 命中** ✅ |
| markdown 残迹检出 | `HEAD~3` 的字典 | **1 命中** ✅ |
| 硬编码中文检出 | 界面层源码 | 本轮真实抓出 `FORMAT_OPTIONS` + 6 个服务的中文串 ✅ |

---

## 5. 刻意保留清单（勿在后续轮次误删）

| 对象 | 理由 |
|------|------|
| README 的「本地优先」两章节 + 首屏定位语 | 产品核心卖点（F 类判据） |
| `settings.embedding.spec` / `ramBelowMin` / `unsupportedPlatform` | 环境限制说明，用户要据此判断能否运行 |
| `settings.storage.data.countLabels` | 上一轮定案：精确指代「清掉了什么」 |
| `settings.storage.data.errSqliteBlocked` | 错误原因需说清是本机哪一层失败 |
| `learn.import.bodyPlaceholder` 的「向量化」 | 只是举例的章节名 |
| `OCR` 字样 | 功能名，用户主动勾选的开关（E 类） |
| `Markdown` / `PDF` / `EPUB` / `Base URL` / `API Key` | 格式名 / 外部参数，用户须按原样识别 |
| 28 处 emoji | 全是成功态标记，与 `rules/react.mdc`「状态色仅 dot/徽标」不冲突 |
| `src/ai/**` 的中文 | 是 prompt，改它 = 改 AI 行为 |
| `src/features/memory/memory-import.ts` 的中文 | F9 记忆文档的统计行，受 `lastWritten` 契约约束，本轮登记豁免 |

以上豁免在 `scripts/copy-scan.mjs` 里以 `KEY_EXEMPT` / `KNOWN_EXEMPT` 显式登记，每条都写明理由。

---

## 6. 待用户实跑（仓库规则禁止自动起浏览器）

| # | 走查项 |
|---|--------|
| 1 | 切英文后：资料「原始类型」下拉显示 `Notes / Web / Plain text`（本轮修复点） |
| 2 | 切英文后：AI 精修失败、章节切分失败、资料追加失败的通知条显示英文（本轮修复点） |
| 3 | 设置页 → 语义搜索卡：新标题/描述/覆盖率文案排版正常，「已可搜索的内容 12 / 40 段」可读 |
| 4 | `/spaces` 断链重定向到首页，刷新不报错 |
| 5 | 「我的画像」页副标题与「记忆」页句式风格一致 |
| 6 | 侧栏页脚徽章显示「预览版」 |
| 7 | 浏览器预览态：语义搜索卡显示「语义搜索需要桌面版」 |
| 8 | 导入手册：OCR 开关在扫描件 PDF 上的提示与错误文案 |

---

## 7. 遗留项（本轮明确不做）

| # | 遗留 | 处置建议 |
|---|------|---------|
| 1 | **54 个孤儿键**（`docs/copy-orphan-keys-2026-10.md`） | 独立一轮清理，逐条确认 UI 现状后再删。⚠️ `test:i18n` 不报孤儿键，删错无门禁拦 |
| 2 | `memory-import.ts` 统计行文案 | 与 F9 记忆文档结构耦合，需连 `lastWritten` 合并器一起评估 |
| 3 | `nav.brandSub` 仍是注释状态 | 取消注释是独立的 UI 决策（D5 已定为 A：保持注释） |
| 4 | `learn.catalog` / `career` 两个零消费命名空间（17 键） | 功能已被取代，确认无历史链接需求后可整块删 |
