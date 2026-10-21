# 设置页左侧菜单布局 · 实施 runbook

| 字段 | 内容 |
|------|------|
| 日期 | 2026-10-20 |
| 方案 | `docs/settings-left-menu-layout-design-2026-10.md`（修订 3） |
| 状态 | **已完成**（代码全数落地，静态门禁全绿；人工走查项见 §5，待用户实跑） |
| 范围 | `src/features/settings/**`、`src/App.tsx`、`src/lib/storage-label.ts`、`src/i18n/messages/{zh,en}.ts`、`scripts/settings-copy-scan.mjs`、两份文档 |

## 1. 提交清单（本地，未 push）

| # | 提交 | 内容 | 任务 |
|---|------|------|------|
| 1 | `d8eb3ab` | 重构：设置页按分区拆分文件结构（515 → 120 行） | T1–T3 |
| 2 | `7c5a066` | 设置页改为左侧菜单 + 右侧内容，分区 URL 化 | T4–T5 |
| 3 | `a27f65a` | 修复：桌面端把保存位置显示成内存（预览态） | T6 |
| 4 | `78ddc57` | 文案：设置页用户可见文案去技术化（P0）+ 日志级别显示映射 | T7–T8 |
| 5 | `d7c763e` | 文案：AI 分区去掉开发者指令与实现名 | T9 |
| 6 | 本次提交 | 文案值级门禁 `copy:check` + 文档回扫 | T10 |

> T7 与 T8 合并为一个提交：`logs.levels` 的 4 个新键紧贴 `logs.writeError` 那行，而 `writeError` 的值本身就在 T7 被改写 ⇒ 两者落在**同一个 hunk**，无法在不制造「改一半」中间态的前提下拆分。

## 2. 任务状态

| ID | 任务 | 状态 | 落点 |
|----|------|------|------|
| T1 | 抽 `settings-nav.ts` | ✅ | `SectionKey` / `SECTION_ORDER` / `isSectionKey` / `visibleSections` |
| T2 | 抽 `SectionShell.tsx` | ✅ | 只放 `SectionShell`（`KV`/`StatCell` 见 §4-②） |
| T3 | 6 个分区搬到 `sections/*.tsx` | ✅ | `StorageSection` / `LearningSection` / `AppearanceSection` / `ShortcutsSection` / `LogsSection` / `AboutSection` |
| T4 | 路由化 | ✅ | `App.tsx` 两条路由；`useParams` + `<Navigate replace>` |
| T5 | 两栏布局 + 删顶部 Tab | ✅ | `SettingsNav` + `PageContainer size="wide"` + `lg:grid-cols-[200px_minmax(0,1fr)]` |
| T6 | 修保存位置判定缺陷 | ✅ | `lib/storage-label.ts::storagePlacementOf`；两个消费方共用 |
| T7 | 文案去技术化 P0 | ✅ | §9.2 A–G 全数改值 + `countLabels` 3 处括注 |
| T8 | 日志级别显示映射 | ✅ | `settings.logs.levels.*` 4 键 + `LogsSection` 渲染 |
| T9 | AI 分区 4 条 | ✅ | `keychainNote` / `localStorageNote` / `embedding.previewDisabled` / `builtin.previewNotice` |
| T10 | 回扫 + 门禁 | ✅ | 前序文档指针、方案状态与判据、`npm run copy:check` |

## 3. 门禁结果（2026-10-20 实测，全部现跑）

| 门禁 | 结果 |
|------|------|
| `npm run typecheck` | ✅ 0 error |
| `npm run layer:check` | ✅ 违规 0 条 / 新增环 0 组（基线仍为「边 3 条 / 环 2 组」，未增加） |
| `npm run ui:check` | ✅ 原生下拉 0 命中、sticky 无 `backdrop-blur`；focus 环漂移仍为 `/25`×3 · `/40`×3（**既存基线，非本批引入**） |
| `npm run test:i18n` | ✅ 7 项全绿（`logs.levels` 4 键两侧齐备、无空叶子） |
| `npm run copy:check` | ✅ zh 0 命中 · en 0 命中（新增门禁，见 §4-①） |
| `wc -l SettingsPage.tsx` | ✅ 108 行（红线 ≤200） |
| `grep role="tablist" src/features/settings/` | ✅ 0 命中（顶部 Tab 与内层双 Tab 均未用 tablist 角色） |
| `grep previewNoticeHead\|Tail src/` | ✅ 0 命中（键已合并，无孤儿） |

## 4. 与方案的偏差（3 处，均已回写方案「变更记录 · 修订 3」）

1. **§9.7 判据改写**：初稿的 `sed | grep` 会把键名 / 参数名 / 文档路径一起算进去 —— `localStorageNote:`、`errSqliteBlocked:`、`previewMeta: (backend: string…)`、`docs/tauri-log-config-design-…` 永久命中，门禁恒红。改为 `scripts/settings-copy-scan.mjs`（按 i18n 实际对象摊平**叶子值**判定）+ `npm run copy:check`。
   - 实测：raw grep zh **1** / en **8**（全是标识符与注释）；值级 zh **0** / en **0**。
   - 反向自检：把改动前的字典（`HEAD~5`）喂同一正则 ⇒ **17 命中**，证明门禁不是恒绿。
2. **`KV` / `StatCell` 未搬进 `SectionShell.tsx`**：它们只有数据与备份分区一个消费方，放进「共用」文件会变成单消费者的伪共享。现留在 `sections/StorageSection.tsx`。
3. **`builtin.previewNoticeHead/Tail` 合并为单键 `previewNotice`**：删掉 `<code>npm run tauri dev</code>` 后 Tail 失去消费方；而 `test:i18n` 只锁键同构、**不报孤儿键**，留着会静默腐烂。改名与消费方同批提交（仓库 i18n 纪律允许）。

## 5. 待人工验收（**不自动起浏览器**，按仓库 `no-headless-browser-validation` 规则）

| # | 操作 | 期望 |
|---|------|------|
| 1 | 打开 `#/settings` | 地址栏被 replace 成 `#/settings/ai`，左栏「AI 模型」选中，无空白 |
| 2 | 依次点左栏 7 项 | 内容整体替换、地址栏同步、选中态唯一 |
| 3 | 刷新 / 浏览器后退 | 分区保持不变 / 与内容同步回退 |
| 4 | 手输 `#/settings/nope`、`#/settings/AI` | 重定向到 `#/settings/ai` |
| 5 | 浏览器预览态手输 `#/settings/logs` | 重定向到 `#/settings/ai`，左栏无「帮助与诊断」 |
| 6 | 窗口拖窄至 <1024px | 左栏变内容上方全宽列表（限高 224px 可滚），选中态同步 |
| 7 | 切 en | `Appearance & language` 不截断；7 项均单行 |
| 8 | 桌面端看「数据与备份 → 保存位置」 | **「这台设备」**（修前误显示「内存（预览态）」） |
| 9 | 桌面端「帮助与诊断」切 4 档级别 | 按钮显示 详细/常规/提醒/出错，写盘值与 `settings-log-level-debug` 等 testid 仍为协议值 |
| 10 | 浏览器预览进 AI 分区 | 不再出现 `npm run tauri dev`；`Base URL` / `模型名` / `API Key` 仍在 |

## 6. 回滚

改动集中在 UI 层与 i18n 值，无数据 / 迁移 / 存储副作用。`git revert` 上述任一提交即可单独回退；整批回退 = revert 6 个提交。`App.tsx` 若单独回退路由，需同时回退 `SettingsPage` 的 `useParams`（否则 `/settings` 无段时永远重定向到不存在的路由）。
