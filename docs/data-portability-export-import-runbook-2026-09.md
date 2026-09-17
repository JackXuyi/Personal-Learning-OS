# 数据可携带（导出 / 导入 / 单章 Markdown）实施 runbook

> **状态：全部完成（2026-09-17）**。T1–T13 全部 done，验证门禁全绿。
> 实施偏差不在此重复登记 —— **唯一真源**：方案文档 `docs/data-portability-export-import-design-2026-09.md` §13。

## Goal

把方案 `docs/data-portability-export-import-design-2026-09.md`（已确认，D1–D6 拍板）落到代码：设置页一键导出 `.plosbak.json` 全量备份、从备份 merge/replace 导入、单章导出 Markdown；兑现 README 两条 `P0`；全程零网络、零 AI、可离线单测。

## Context

- 方案（唯一真源）：`docs/data-portability-export-import-design-2026-09.md`（§13 = 实施偏差记录）
- 涉及路径：`src/storage/*`、`src/features/data/portability/*`（新）、`src/features/settings/SettingsPage.tsx`、`src/i18n/messages/{zh,en}.ts`、`src-tauri/src/{backup.rs,lib.rs,db/commands.rs}`、`tests/`、`README{,.zh-CN}.md`
- 已读文档：`AGENTS.md`、`rules/*`、`skills/docs-task-runbook`、`skills/pre-task-technical-design`
- 验证门禁结果：`npm run typecheck` **零新增 error**（仅既存 3 条 `AIModelsSection` banner 未使用）；`npm run test:portability` **30/30**；`npm run test:library` 串联 18 组**全绿**；`cargo test --lib` **50/50**（新增 6 条，零新增 warning）
- 约束：**禁起浏览器**（`no-headless-browser-validation`）；`src-tauri/**` 改动仅限 `backup.rs` + `db_clear_rag` + 注册；零新增运行时依赖、零新增 crate

## Tasks

### T1 — `clearAll()` 三后端
- **Status:** done
- **Outcome:** `storage/types.ts` 追加唯一接口方法 + 语义边界注释；`memory.ts` 以「重新赋值」重建 22 组结构（与构造函数初值逐字段同形）；`local.ts` 新增 `ALL_KEYS`（22 个 key，与 `persist()` 写入集合 + 独立 key `plos.active-goal` 对齐）并 `removeItem` 全清（**不用** `persist()`，避免留 22 个 `"[]"` 垃圾）；`tauri.ts` 先 `db_clear_rag` 成功后才走父类，失败抛错（不降级）。验证：`test:portability` 的 TC-EDGE-05 用 localStorage 替身断言非偏好 key 全清、`plos:settings:v1`/`plos:lang:v1`/两个迁移 flag 保留、且幂等。

### T2 — Rust `backup.rs`（5 命令）+ 注册
- **Status:** done
- **Outcome:** 新增 `src-tauri/src/backup.rs`（`backup_dir`/`backup_save`/`backup_list`/`backup_read`/`backup_reveal`）；字符集白名单 + `.plosbak.json`/`.md` 双后缀 + 拒 `..`（`safe_name` 读路径 / `safe_save_name` 写路径）；先写 `.tmp` 再 `rename`；`backup_reveal` 用 canonicalize 校验必须落在 backups 目录内，macOS `open -R`（Windows/Linux 分支照 `logging.rs` 补齐）；`lib.rs` `mod backup;` + 5 条注册。验证：`cargo test --lib` 的 5 条 backup 用例（含 `../evil`、`a/b`、反斜杠、后缀不符全部被拒；save→list→read 往返；`.tmp` 不进列表；同名覆盖）。

### T3 — Rust `db_clear_rag` + 注册 + 单测
- **Status:** done
- **Outcome:** `db/commands.rs` 新增 `clear_rag(pool)`（抽出便于单测）+ `db_clear_rag` 命令，事务内清 7 表（FTS 用 `DELETE` 不 `DROP`）；`lib.rs` 注册。验证：2 条 Rust 用例 —— 七表全空且 `_schema_version` 仍在、空库重复清空幂等。

### T4 — `backup-format.ts`
- **Status:** done
- **Outcome:** `BackupData` 20 字段 + `EntityCounts` + `COUNT_KEYS`（20）+ `BACKUP_FIELDS`（由 `FIELD_SPECS` 派生，单一真源）+ `BACKUP_KIND`/`EXPORT_VERSION`(1)/`BACKUP_SUFFIX`/`APP_VERSION` + `parseBackup`（判别式，7 类校验）+ `migrateBackup`（判别式）+ `countsOf`/`countsEqual` + 三个命名/格式化纯函数（`defaultBackupName`/`preImportBackupName`/`chapterMarkdownName`/`humanBytes`）。验证：TC-UC01-02、TC-UC06-01…04、TC-EDGE-06/11 + 命名用例。

### T5 — `export-service.ts`
- **Status:** done
- **Outcome:** `collectSnapshot` 遍历式收集（文档 → 章 → 小节/复述；文档 → 块/批注；全量概念/关系/向量；试卷 → 草稿；目标 → 能力三件套）+ 三类可观测孤儿计数；`embeddings` 显式剥掉 `vector`（D4）；`exportBackup` 用 `countsOf(data)` 派生 counts（不变量 1）。验证：TC-UC01-01/02/03、TC-EDGE-06/07/08（导出纯读、不重复读库）。

### T6 — `import-service.ts`
- **Status:** done
- **Outcome:** 校验在 `clearAll` 之前（判别式短路）；`preBackup` 注入式自动预备份（复用 `exportBackup`）；`chapters` 按 id 合并（同 id 取备份）；`learnerState` 按 `lastReviewedAt ?? lastAssessmentAt ?? 0` 较新取胜、平局/缺失保留本机；`cardStates` 计数覆盖；`evidence` 按 `(at,kind,subjectId,sourceId)` 去重 + 按 `at` 升序 append + 报出上限裁剪数；`profile` 缺失**绝不**调 `saveProfile`；孤儿过滤计数；末尾 `saveGraph(库内全量)` 收口；写入失败回 `write-failed` + `partial` 统计，配额错误单独分类。验证：TC-UC03-01…08、TC-UC04-01…03、TC-EDGE-01/02/03/04/09。

### T7 — `markdown-export.ts`
- **Status:** done
- **Outcome:** `chapterBodyOf`（复用 `chapterPreviewOf` 的夹取口径）+ `chapterToMarkdown`（`# 标题` → 正文 → `## <i18n 小标题>` → 要点，要点带 `> 出处`）；要点清洗走 `cleanKeyPoints`（单一真源，120 字 / 20 条 / 去重）。验证：TC-UC05-01…04（含噪声过滤、空要点不写标题、区间越界夹取）。

### T8 — `desktop-backup.ts` + 浏览器落盘兜底
- **Status:** done
- **Outcome:** 5 条 IPC 薄封装 + `isTauri()` 守卫（非桌面 `backupList` 返回 `[]`）+ `downloadText(filename, text, mime)`（Blob + `revokeObjectURL`）。验证：TC-UC02-01 断言守卫语义（真 invoke 行为属 §12.2 不可自动验证项）。

### T9 — `DataPortabilityCard.tsx` + 接入 `SettingsPage.tsx`
- **Status:** done
- **Outcome:** 卡片三块（导出 / 导入 / 单章 Markdown）+ 导入预览面板（counts + 模式选择 + 浏览器端「我已自行备份」勾选）+ replace 二次确认（`ConfirmDialog`，文案含将写入与本机当前规模）+ 结果面板（写入/保留/跳过/裁剪/预备份路径 + 在 Finder 中显示）+ 最近备份列表（桌面端）；`busy` 期间全按钮禁用；错误只存分类、渲染时经 `errorText` 映射；导入成功后 `useLoopStore.refresh` + `useIndexStore.refreshCoverage`。`SettingsPage.tsx`：计数读取抽成 `reloadCounts` 并作为 `onDataChanged` 传入（导入换库后重算），`StorageSection` 挂载卡片。`data-testid` 按 §7.1 落齐。验证：`npm run typecheck` 零新增 error。

### T10 — i18n 双语（新键 + 改写旧 `note`）
- **Status:** done
- **Outcome:** `settings.storage.data.*` 共 44 个叶子（含 20 键 `countLabels` 与全部错误分类文案）；改写 `settings.storage.note`（旧句承诺「本里程碑不提供清除按钮」已与事实不符）；zh/en 同批。验证：`npm run test:i18n` 8/8（递归结构对齐 + 叶子非空）。

### T11 — `tests/data-portability.test.ts` + `package.json` script + `test:library` 串联
- **Status:** done
- **Outcome:** 新增 `test:portability` 并追加到 `test:library` 链尾；30 条用例（TC-UC01～UC08 可自动化的部分 + TC-EDGE-01…11），含 `makeFullSample`（20 类实体全覆盖、同段正文出现两次、含 `keyPointRefs`/`overview`/嵌套 feedback/向量本体）与两条**反模式守卫**（导出零写入、counts 不另起一次读取）；`local` 后端清库契约用最小 localStorage 替身验证。**30/30 通过**。

### T12 — README 双语（2 条 checkbox + 顶部统计行实测同步）
- **Status:** done
- **Outcome:** 两条 `P0` 改勾选并以新文案重写（含「一个 `.plosbak.json` / merge 或 replace」）；实测 `grep -c '^- \[x\] '` = **35 / 35**、`^- \[ \] ` = **10 / 10**、`^### ` = **29 / 29**（两版一致）；顶部硬编码统计行手工同步为 `35 shipped · 10 not yet` / `已实现 35 项 · 未实现 10 项`。

### T13 — 文档收尾
- **Status:** done
- **Outcome:** ① 方案文档状态 → 已实施，新增 **§13 实施偏差记录（14 条）** 与变更记录；② `roadmap-next-features-plan-2026-09.md` 全量回扫 8 处（§摘要「过度承诺」段、档位表、推进顺序、mermaid 节点、可开工清单、已实施清单、一致性债第 4 条、一句话总结）+ F4 章节头加状态块（含 3 条与原文的范围差异）；③ `business-flow-end-to-end-2026-09.md:507` 收口项改为已兑现（F3 2026-09-16 / F4 2026-09-17）。

## 验证录像（命令与结果）

| 命令 | 结果 |
|------|------|
| `npm run typecheck` | 仅 3 条既存 `AIModelsSection` banner error，零新增 |
| `npm run test:portability` | `[data-portability] 30/30 通过` |
| `npm run test:i18n` | `8/8 通过` |
| `npm run test:library` | 18 组串联全绿（含 `[data-portability] 30/30`） |
| `cargo test --lib`（src-tauri） | `50 passed; 0 failed`（新增 6 条），零新增 warning |

## 未随本次交付的部分（明确记录，不留暗坑）

1. **浏览器端 Blob 下载 / Tauri webview `<input type="file">`** —— 受 `no-headless-browser-validation` 约束无法自动验证，只有代码自审 + 方案 §12.3 的 6 条手工验收清单（待用户执行）。
2. **孤儿 Section / Chunk 的清理** —— 本次只计数不清理（接口层无可观测全量入口，清理牵动 FTS 与向量级联，另案决策）。
3. **单目标 / 单文档范围导出** —— 按 D6-A 不在 v1；`collectSnapshot` 已参数化，扩展成本低。
4. **导入并发写库无锁** —— 本机单用户，接受（方案 §12.2）。
5. **`cargo check` 的 2 条既存 warning**（`llm/models.rs` 未构造的枚举变体、`logging.rs` 未用的 `as_str`）—— 与本次无关，未顺手改。

## 收工清单（分层提交）

按 `plos-layered-commit` 的层级顺序落 8 条本地提交（**只落本地，未 push**）：

| # | 层 | 短哈希 | 内容 |
|---|----|--------|------|
| 1 | `tauri` | `51721e9` | `backup.rs` 五命令 + `db_clear_rag` + `lib.rs` 注册（T2 / T3） |
| 2 | `storage` | `3f0ed05` | `clearAll()` 三后端 + 偏好 / 迁移 flag 保留边界（T1） |
| 3 | `features`（服务层） | `5a27865` | 格式层 + 导出 / 导入 / 单章 Markdown + 桌面封装（T4–T8） |
| 4 | `i18n` | `3dc0c4a` | `settings.storage.data` 双语 44 键 + 重写旧 `note`（T10） |
| 5 | `ui` | `a7e7b3a` | 数据可携带卡片 + 设置页接线（T9） |
| 6 | `test` | `913e378` | 30 项单测 + `test:portability` 串联（T11） |
| 7 | `docs` | `0364c56` | 方案（§13 实施偏差 14 条）+ 本 runbook + README / roadmap 同步（T12 / T13） |
| 8 | `chore(skill)` | `9cb7d01` | 方案模板补 §3.4 决策点占位 + 自检项（流程缺口，非本 feature 代码） |

提交前后核对：每组 `git diff --cached --name-only` 前＝仅目标文件、后＝空；末组后 `git status --short` 仅剩 `?? docs/learner-memory-design-2026-09.md`（F9 方案，**待确认未实施**，刻意不随本次提交）；`git rev-list --count origin/main..HEAD` = **8**。

（回填本清单的提交是第 9 条 `docs`，不在上表内 —— 哈希无法自引用。）

⚠️ 与 F5 不同，本次 8 组**不存在「提交态不自洽」的中间态**，逐组可编译（理由留证，便于日后回溯判断）：

1. 组 1 先落 Rust 能力、组 2 才落调用它的 TS。`tauri.ts` 把命令名当字符串，反向也能 typecheck 通过，但运行时会调一条尚不存在的命令 —— 故刻意正序，不以「能编过」为准。
2. 组 3 的服务层是**纯增量新模块**且不依赖 i18n（`makeFullSample` 之外，`markdown-export` 的 `pointsHeading` 由调用方传入），首个消费方在组 5 才出现。
3. 组 4 的 i18n 键必须先于组 5 的 UI —— 反向会立即报「引用不存在的键」（`Messages` 类型约束），符合 `AGENTS.md` 的 i18n 硬约束。
4. 组 6 的单测 import 组 3 的服务层与组 2 的 `clearAll`，两者已在库 → 单独 checkout 组 6 可跑绿。
5. 组 7 的 README 统计行为**实测**结果：`grep -c '^- \[x\] '` = 35/35、`^- \[ \] ` = 10/10、`^### ` = 29/29（两版一致）；顶部硬编码统计行 grep 数不到，手工同步为 `35 shipped · 10 not yet` / `已实现 35 项 · 未实现 10 项`。

另：组 1 落库后曾发现 commit subject 误标为 `T1/T2/T3`（T1 实际在组 2），已用 `rebase -i`（`edit` + `--amend`，**仅改提交信息**）修正；rebase 前后 `HEAD^{tree}` 均为 `9904dc4a…`，工作树内容零变化。

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-09-17 | 建立 runbook（方案 D1–D6 确认后） |
| 2026-09-17 | T1–T13 全部 done（每项带 Outcome 与实施期发现）；验证门禁全绿：`typecheck` 零新增 error、`test:portability` 30/30、`test:library` 18 组、`cargo test --lib` 50/50 |
| 2026-09-17 | 回填收工清单（8 条分层提交哈希 + 逐组可编译的留证说明） |
