# 设置新增 Tauri 日志配置 —— 技术方案

> 需求原话：「在设置中新增 tauri 日志配置，方便配置日志的写入地址和排查问题」。
> 承接上一轮 AI 分析链路双端排查日志（`docs/ai-analysis-summary-fix-runbook.md`
> 「排查日志」章节）：控制台/终端日志已就绪，本方案把它们**落成文件**并给出配置入口。

| 项 | 内容 |
|------|------|
| 作者 | Agent（许一） |
| 日期 | 2026-09-11 |
| 状态 | **已实施（2026-09-11，决策 D1–D5 全部落地）** |
| 关联 | `docs/ai-analysis-summary-fix-design-2026-09.md`（排查日志前身）；`rules/rust.mdc`（模块 → lib.rs 注册）；`rules/layer-import-boundaries`（src↔src-tauri 只走 IPC） |

**本轮范围一句话**：Rust 新增自研轻量日志模块（配置持久化 + 按天文件 sink + 4 条命令），现有 `[llm]`/启动日志接入；设置页新增「日志」分区（开关/级别/目录/最近日志预览/打开目录）；前端 `aiLog` 可选转发写同一文件。**不引入任何 Tauri 插件、不改现有存储层。**

---

## 1. 背景

### 1.1 现象

上一轮修复后，AI 分析链路的排查日志只存在于两个「易失」位置：应用 DevTools 控制台（关窗口即没）与 `tauri dev` 终端（打包版根本没有终端）。用户拿到打包版遇到问题，**没有任何办法把日志交给开发者**。

### 1.2 现状事实（已逐一核实）

| # | 位置 | 事实 |
|---|------|------|
| ① | `src-tauri/Cargo.toml` | **零日志依赖**（无 log/tracing）；`tauri` features 为空，**无任何插件** |
| ② | `src-tauri/src/lib.rs` | 3 处 `eprintln!`（sqlite init skipped / local LLM init skipped / setup 内）；`init_llm` 已取到 `app_data_dir`（`ModelManager::new` 先例） |
| ③ | `src-tauri/src/llm/commands.rs:196-224` | `llm_generate` 前后 3 行 `eprintln`（上轮加的 `[llm] generate …`），打包版不可见 |
| ④ | `src/ai/log.ts` | `[ai:*]` 控制台日志 helper（`aiLog`/`aiErrPreview`），仅 `console.*` |
| ⑤ | `src/features/settings/SettingsPage.tsx:19-28` | 6 个分区（ai/storage/learning/appearance/shortcuts/about），`SECTION_ORDER` 静态数组，`st.sections[key]` 走 i18n |
| ⑥ | `src-tauri/capabilities/default.json` | 仅 `core:default`——若走 `tauri-plugin-log`/`dialog` 需新增插件依赖 + capability 权限 + 前端 npm 包，爆炸半径大 |
| ⑦ | `src-tauri/src/vault.rs` | macOS-only 钥匙串命令的封装先例（`Result<T, String>` 契约） |

### 1.3 问题定义

需要一条**不依赖插件、打包版可用、用户可配置落盘位置**的日志通道：Rust 侧日志（llm/启动）+ 前端 AI 链路日志写进同一份文件，设置页可看可管。

---

## 2. 方案目标

| ID | 目标 | 度量 |
|----|------|------|
| G1 | 日志落盘 | 打包版运行后，日志文件存在于配置目录，含 `[llm]`/`[ai:*]` 行 |
| G2 | 可配置 | 设置页可改：启用开关、级别（debug/info/warn/error）、写入目录（恢复默认） |
| G3 | 可排查 | 设置页可直接预览最近 200 行 + 一键打开日志目录 |
| G4 | 零依赖 | 不新增 Cargo/npm 依赖，不新增 Tauri 插件与 capability |
| G5 | 不伤害主流程 | 日志写入任何失败（磁盘满/权限）静默降级，绝不 panic、不阻塞推理 |

**非目标**（本轮不做）：远程上报/telemetry；`log`/`tracing` 生态接入；tauri-plugin-log；日志正文内容脱敏管道（延续上轮「只写元数据」硬约束）；SQLite 日志库。

## 3. 项目现状（架构层）

- 分层约束：UI → stores → storage；桌面能力 → `invoke()`；src ↔ src-tauri 只走 IPC。
- 设置持久化现状分两套：AI 模型配置在 JS localStorage（`plos:settings:v1`）；Rust 侧无配置文件（模型文件目录由 manager 固定）。**日志配置属 Rust 能力，持久化放 Rust 侧**（`app_data_dir/logging/config.json`），前端只经命令读写——避免 localStorage 与 Rust sink 真源分叉。
- 设置页分区结构见 §1.2 ⑤；i18n 键对齐由 `test:i18n` 强制（zh/en 必须成对）。

## 4. 技术架构

```
┌─ 设置页「日志」分区（桌面端才显示）
│    开关 / 级别 / 目录 / 预览 / 打开目录
└────────┬────────────────────────────┐
         │ invoke（src/lib/desktop-log.ts 封装，isTauri 守卫）
         ▼
┌─ Rust logging.rs（新模块，零依赖）────────────────────────┐
│  log_get_config / log_set_config / log_open_dir /        │
│  log_read_recent / log_write（前端转发入口）              │
│                                                          │
│  LogConfig {enabled, level, dir?}                        │
│    └─ 持久化: <app_data>/logging/config.json             │
│  Sink: OnceLock<Mutex<Sink>>                             │
│    └─ 按天文件 <dir>/plos-YYYY-MM-DD.log，写时顺带清理>7天 │
└──────┬───────────────────────────────┬───────────────────┘
       │ 直调（Rust 内部）             │ log_write（前端转发）
       ▼                               ▼
  lib.rs setup / llm_generate      aiLog（src/ai/log.ts）
  （现 eprintln 三处 → 双写：终端 + 文件）
```

关键取舍：

1. **自研 sink 而非 tauri-plugin-log**：G4（零依赖）+ 需求只有「按天文件 + 级别 + 目录」三件事；插件引入 log/tracing facade、capability 权限、前端 npm 包三重成本，且配置目录自定义仍要绕 Folder target。自研约 150 行 Rust，全部可单测。
2. **前端日志走 `log_write` 转发**：`aiLog` 在 `isTauri()` 时 fire-and-forget 转发（不 await、失败静默）→ `[ai:*]` 与 `[llm]` 同文件同格式，排查一份日志看全链路。
3. **按天分文件即轮转**：文件名带日期天然轮转，清理逻辑只在「跨天首次写入」时跑一次，无需后台线程。
4. **配置真源在 Rust**：JS 只经命令读写，避免双写分叉（本仓多次出现两套数据分叉教训）。

## 5. 交互流程

1. 用户打开「设置 → 日志」（桌面端）：显示当前状态卡——开关、级别 Segment、目录（只读）、最近 200 行预览（mono 滚动区 + 刷新）、「打开日志目录」按钮。
2. 改开关/级别 → `log_set_config` 即时生效（sink 原子替换）+ 持久化，下次启动保持。
3. 点「恢复默认目录」→ dir 置回 `<app_data>/logs`。
4. 纯浏览器预览：`isTauri()` 为 false → 「日志」Tab 不渲染（`SECTION_ORDER` 过滤），`aiLog` 不转发。

## 6. 用户用例（User Cases）

| UC | 角色 | 场景 | 期望 |
|----|------|------|------|
| UC-01 | 用户 | 打包版 AI 分析又失败 | 打开设置→日志，预览里看到 `[ai:analyze] 章概念分析失败 … reason=…`，复制给开发者 |
| UC-02 | 用户 | 日志文件想挪到自选目录 | 改目录（D3 决策）后新日志落新目录，旧文件不动 |
| UC-03 | 用户 | 不想写日志 | 关开关 → sink 停写，配置保留 |
| UC-04 | 开发者 | 排查采样是否生效 | 日志里 `[llm] generate … temp=0.10 preset=tight` 与 `[ai:builtin] 生成请求 temperature=0.2` 同文件对照 |

## 7. 线框 UI（Wireframe）

```
设置 → [AI 模型][本地存储][学习行为][外观与语言][快捷键][日志][关于]
                                              ─────
┌─ 日志 ────────────────────────────────────────────────┐
│  写入文件  [●开启]      级别  [debug|info|warn|error]   │
│  写入目录  ~/Library/Application Support/…/logs  (只读) │
│           [打开目录]  [恢复默认]                        │
│  ── 最近日志（200 行）─────────────────  [刷新] ──────  │
│  2026-09-11T12:40:01 [llm] generate model=qwen3.5:4b …  │
│  2026-09-11T12:40:01 [ai:builtin] 生成请求 …             │
│  （mono / text-xs / 滚动区 max-h-64 / tail 200）         │
└──────────────────────────────────────────────────────┘
```

## 8. 涉及文件及改动伪代码

| 文件 | 类型 | 说明 |
|------|------|------|
| `src-tauri/src/logging.rs` | **新增** | LogConfig + Sink + 5 命令 + 单测 |
| `src-tauri/src/lib.rs` | 改 | `mod logging;` + setup `logging::init` + `generate_handler!` 5 条 + 2 处启动 eprintln 双写 |
| `src-tauri/src/llm/commands.rs` | 改 | `llm_generate` 3 处 eprintln → `logging::log_line`（终端+文件双写） |
| `src/lib/desktop-log.ts` | **新增** | 5 个 invoke 封装（isTauri 守卫） |
| `src/ai/log.ts` | 改 | `aiLog` 追加 fire-and-forget 转发 |
| `src/features/settings/SettingsPage.tsx` | 改 | `SectionKey` + `logs` 分支 + `LogsSection` 组件 |
| `src/i18n/messages/zh.ts` / `en.ts` | 改 | `sections.logs` + `settings.logs.*`（双语成对） |

**logging.rs 核心**（约 150 行）：

```rust
#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogConfig { enabled: bool, level: LogLevel, dir: Option<String> } // None = 默认目录

pub enum LogLevel { Debug, Info, Warn, Error }  // serde 小写；序数比较做过滤

static SINK: OnceLock<Mutex<Option<Sink>>> = ...;
struct Sink { enabled: bool, level: LogLevel, dir: PathBuf, day: String }

pub fn init(app_data_dir: &Path);        // 读 config.json（缺失/损坏用默认）+ 建 Sink
pub fn log_line(level, scope, message);  // 内部入口：终端 eprintln + 文件追加 + 跨天轮转/清理；任何 IO 失败静默
pub fn write_only(level, scope, message);// 前端 log_write 用：只写文件（终端已有 console）
```

**命令契约**（全部 `Result<T, String>`，与 vault 一致）：

```
log_get_config()  -> { enabled, level, dir }        // dir 为落地绝对路径
log_set_config(c) -> { dir }                         // 即时生效 + 持久化；目录不存在则创建
log_open_dir()    -> ()                              // macOS open / win explorer / linux xdg-open
log_read_recent(n)-> string[]                        // 当前天文件尾部 n 行
log_write(level, scope, message) -> ()               // 前端转发入口（只进文件）
```

**aiLog 转发**：

```ts
// src/ai/log.ts — WRITE 表之外追加
if (isTauri()) void invoke("log_write", { level, scope, message }).catch(() => {});
```

## 9. 任务清单（Tasks）

| ID | 任务 | 依赖 | 规模 | 用例 |
|----|------|------|------|------|
| T1 | `logging.rs`：config 读写 + Sink + 单测（roundtrip/级别过滤/跨天/清理，tmpdir） | — | M | UC-01..04 |
| T2 | `lib.rs` 接线（mod/init/注册）+ 启动日志双写 | T1 | S | UC-01 |
| T3 | `llm/commands.rs` 3 处 eprintln → 双写 | T1 | S | UC-04 |
| T4 | `src/lib/desktop-log.ts` 封装 | T1 | S | UC-01..03 |
| T5 | `aiLog` 转发 | T4 | S | UC-01 |
| T6 | 设置页 `LogsSection` + SECTION_ORDER/isTauri 过滤 | T4 | M | UC-01..03 |
| T7 | i18n 双语键 + test:i18n 回归 | T6 | S | — |
| T8 | 门禁（typecheck / cargo test / test:i18n / test:ai）+ 文档收尾（本方案状态 + runbook） | 全部 | S | — |

## 10. 实施步骤

1. T1：先写 `logging.rs` 纯逻辑（config 解析、级别比较、文件名/清理函数与 IO 分离，便于 tmpdir 单测）→ `cargo test --lib`。
2. T2/T3：接线 lib.rs 与 llm 命令；`tauri dev` 手跑确认终端 + 文件双行出现。
3. T4/T5：JS 封装 + aiLog 转发 → typecheck。
4. T6/T7：设置页分区 + i18n → typecheck + test:i18n。
5. T8：全量门禁；方案状态改「已实施」，runbook 补「文件日志」章节。

## 11. 测试方案

| 层 | 方式 | 内容 |
|----|------|------|
| Rust 单测 | `cargo test --lib`（logging 纯函数部分，tmpdir 落盘） | config roundtrip、损坏 JSON 回默认、级别过滤、跨天换文件、>7 天清理、log_write 行格式 |
| TS | `npm run typecheck` + `test:i18n` | 封装类型；双语键对齐 |
| 手工 | `tauri dev` + 打包版 | §12 清单 |

## 12. 测试用例

| ID | UC | 步骤 | 期望 | 方式 |
|----|----|------|------|------|
| TC-01 | UC-01 | dev 跑一次概念分析，看日志文件 | 文件含 `[ai:*]` 与 `[llm]` 行，时间戳升序 | 手工 |
| TC-02 | UC-03 | 关开关 → 跑分析 → 刷新预览 | 无新增行；重开开关后恢复 | 手工 |
| TC-03 | UC-02 | 恢复默认/改目录（按 D3 决策） | 新目录生成 `plos-YYYY-MM-DD.log`；损坏路径（只读盘）写失败但**不崩、不阻塞分析** | 手工 + 单测 |
| TC-04 | UC-01 | 删除 config.json + 写入 `"{bad"` 后重启 | 回默认配置，应用正常启动 | 单测 |
| TC-05 | UC-04 | 预览区 | tail 200 行、mono、可滚动、刷新生效 | 手工 |
| TC-06 | — | 纯浏览器预览 | 无「日志」Tab；控制台日志不报错 | 手工 |
| TC-07 | — | 磁盘写满模拟（dir 指向 /dev/null 文件） | 主流程（llm_generate）照常返回 | 单测/手工 |

## 13. 风险

| ID | 风险 | 影响 | 缓解 |
|----|------|------|------|
| R1 | 目录路径无效/只读（TC-03） | 写日志失败 | IO 全静默降级；UI 显示写入失败提示（log_get_config 附 last_error） |
| R2 | 前端 fire-and-forget 转发洪水（长文档分析逐章多条） | 日志膨胀 | 默认 level=info 且单行短元数据；按天文件 + 7 天清理封顶 |
| R3 | 并发写（多窗口/异步任务） | 行交错 | Rust 侧全局 Mutex 串行化；单行原子追加（<4KB 通常一次 write） |
| R4 | log_write 被 JS 侧恶意/异常调用灌爆 | 磁盘 | 级别过滤 + 单条 8KB 截断（Rust 侧再截一次） |

## 14. 决策记录（2026-09-11 已确认）

| ID | 结论 | 影响 |
|----|------|------|
| D1 | **Rust + 前端同写一文件** | T5 保留：`aiLog` fire-and-forget 转发 `log_write` |
| D2 | **默认开 + info** | `LogConfig::default()` = `{enabled: true, level: info, dir: None}`；开箱即有日志 |
| D3 | **只读展示 + 恢复默认** | 零插件；目录不可改路径，只能恢复默认 `<app_data>/logs` |
| D4 | **按天文件 + 保留 7 天自动清理**（推荐项默认入档） | 清理逻辑在跨天首次写入时执行 |
| D5 | **新增「日志」Tab**（第 7 个分区，纯浏览器隐藏） | `SECTION_ORDER` + i18n `sections.logs` |

## 附：缺陷修复记录

### B1 · 改配置时日志目录被改（2026-09-11 修）

**现象**：在设置里切换日志开关或级别，目录显示值就会变一级（`<app_data>/logs` → `<app_data>` → `Application Support` → …）。

**根因**（两处事实叠加）：

| # | 位置 | 事实 |
|---|------|------|
| ① | `SettingsPage.tsx`（`LogsSection.update`） | 决策 D3 下 UI 不提供路径输入，**恒发 `dir: null`**（也承担「恢复默认」语义） |
| ② | `logging.rs` `log_set_config` | 空 dir 的兜底写成了 `state.sink.dir.parent()`——**当前目录的父级**，而非默认目录 `<app_data>/logs` |

于是每次保存都是一次「目录上移」；`create_dir_all` 还会把错误目录真的建出来，`log_get_config` 再把它显示回 UI。重启回默认（config.json 存的是 `null`），所以表现为「改一次变一次」。

**修复**：

1. `LogState` 显式持有 `default_dir`（`<app_data>/logs`）——空 dir 的唯一回退目标，**不再从当前 sink 目录派生**；
2. 抽出 `apply_config(state, config) -> PathBuf`（纯内存态应用）与 `persisted_config(state, config, dir)`（落盘归一化），`log_set_config` 只管 IO；
3. `resolve_dir` 去首尾空白；落盘**一律写解析后的规范路径**（修掉「内存用裁剪值、磁盘写原文」的不一致）；
4. 解析结果等于默认目录时 `dir` 归一化为 `None`，不把默认路径写死。

**回归测试**：`saving_without_dir_keeps_default_dir`（连续保存两次目录不得漂移，且不等于父级）、`blank_and_custom_dirs_resolve_and_persist`（空白=默认、自定义目录裁剪后落盘、默认归一化为 None）。

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-11 | 初稿 v1.0：自研零依赖方案（logging.rs + 5 命令 + 设置页分区），含 5 个决策点待确认 | Agent |
| 2026-09-11 | v1.1：决策入档（D1 双端同写 / D2 默认开 info / D3 只读+恢复默认 / D4 按天+7天清理 / D5 新增日志 Tab）；状态定稿待实施 | Agent |
| 2026-09-11 | v1.2：**已实施**——logging.rs（29/29 含 10 例新单测）+ lib.rs/llm_generate 接线 + desktop-log.ts + aiLog 转发 + 设置页日志 Tab（zh/en）；typecheck 0 error、test:ai 6/6、test:library 全过、test:rag 10/10 | Agent |
| 2026-09-11 | v1.3：**缺陷 B1 修复**——改配置时目录漂移（空 dir 误以 `sink.dir.parent()` 兜底）；`LogState` 增 `default_dir`、抽 `apply_config`/`persisted_config`、路径规范化；cargo 31/31（+2 例回归） | Agent |
