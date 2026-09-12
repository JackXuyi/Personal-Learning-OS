---
name: tauri-ipc
description: Guides adding and changing Tauri 2 commands and events between the React (Vite) UI and the Rust desktop core. Use when implementing invoke/listen, registering generate_handler, adding serde payloads, touching src-tauri/src/db (SQLite commands, schema migration, TauriStorage 适配器), or when the user mentions Tauri commands, IPC, Rust-to-frontend events, or DB commands.
---

# Tauri IPC

PLOS 的 UI 与桌面核心只经 Tauri commands（与可选 events）通信。纯逻辑在 `src/{domain,engine,ai}`；**桌面能力**（Keychain 密钥、本地模型 sidecar）才落到 Rust。

## 现状速览（vault / llm / db）

| 命令面 | Rust 属主 | 前端调用侧 |
|---------|-----------|-----------|
| `vault_set_secret` / `vault_get_secret` / `vault_delete_secret` | `src-tauri/src/vault.rs` | `src/ai/vault.ts` |
| `llm_list_models` / `llm_download` / `llm_cancel_download` / `llm_delete` / `llm_generate` / `llm_default_model` / `llm_status` | `src-tauri/src/llm/commands.rs` | `src/ai/builtin.ts` |
| `db_*`（28 条：sections / chunks / fts / knowledge_units / relations / embeddings） | `src-tauri/src/db/commands.rs` | `src/storage/tauri.ts`（`TauriStorage`） |
| `app_status` | `src-tauri/src/lib.rs` | — |

## When to use

- 新增桌面能力（密钥、模型下载/生成、文件、窗口）
- 修改现有 `invoke('…')` 契约
- 需要 Rust 主动推送进度 / 状态到 UI（events）
- 增改 `db_*` 命令 / `TauriStorage` 适配器 / SQLite schema 迁移

## Command path（UI → Rust）

1. 在属主模块实现 `#[tauri::command]`（如 `vault.rs`、`llm/commands.rs`）。
2. 在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![…]` 注册。
3. 从 `src/` 以 `@tauri-apps/api/core` `invoke` 调用：

```ts
// 参考 src/ai/builtin.ts
return invoke("llm_download", { model });
```

```ts
// 参考 src/ai/vault.ts —— 纯浏览器预览须先守卫
if (!isTauri()) return; // hasKeyring() = isTauri()
await invoke("vault_set_secret", { account, secret });
```

- Rust 参数 **snake_case**；Tauri 自动把 **camelCase** JS key 映射过去。
- 优先把 `invoke` 封装进 `src/ai/*`（或 feature 的 hook/service）；叶子组件不应散落一次性调用。
- 密钥等敏感命令的调用方负责静默降级（Keychain 不可用不阻塞主流程，见 `src/ai/vault.ts` 约定）。

## Event path（Rust → UI，按需）

```rust
app.emit("llm-progress", payload)?;
```

```ts
await listen<LlmProgress>("llm-progress", (event) => { /* 更新 store */ });
```

- 在 `useEffect` cleanup 中 `unlisten()`。
- Payload 保持 `Serialize` / `Deserialize`，TS 形状放在调用侧文件旁（mirror，勿手写双份漂移——两边同改）。

## DB 命令（`src-tauri/src/db`）

SQLite 命令面 = `schema.sql` + `models.rs` + `commands.rs`，由 `TauriStorage`（`src/storage/tauri.ts`）消费。**UI/store 不直接 `invoke("db_*")`**——一律经 `src/storage` 适配器，与 localStorage 后端同签名（失败回退 `super.*`）。

### 调用约定（铁律）

1. **适配器方法内一律走 `trySqlite(cmd, args)`，不要裸 `invoke`。**
   `trySqlite` 负责：探测降级（`sqliteReady === false` 直接不打 IPC）、首次失败只告警一次、失败返回 `{ ok:false }` 让调用方回退 `super.*`。裸 `invoke` 会绕过降级与告警。

   ```ts
   override async listKnowledgeUnits(): Promise<KnowledgeUnit[]> {
     const r = await this.trySqlite<KnowledgeUnitDto[]>("db_list_knowledge_units", {});
     return r.ok ? r.value.map(fromUnitDto) : super.listKnowledgeUnits();
   }
   ```

2. **⚠️ 迁移方法（`migrateLegacy*`）必须用裸 `invoke`，绝不能用 `trySqlite`。**
   迁移由 `ensureMigration()` 调用；而 `trySqlite` 首次成功时会回头 `await this.ensureMigration()` → **自等待死锁**（`this.migration` 永远 pending）。这是本项目踩过的坑，已在 `migrateLegacyGraph` 注释里留证。

   ```
   probe() ─┬─ 首次成功 → ensureMigration() ─→ migrateLegacyRagData()  ─┐
   trySqlite ┘                                 migrateLegacyGraph()  ─┤ 必须裸 invoke
                                                                       └→ 若用 trySqlite → 回到 ensureMigration → 💀
   ```

3. **一次性迁移的幂等三件套**：独立 flag（**每段迁移一个**，如 `plos.rag.migrated.v1` / `plos.graph.migrated.v2`，复用旧 flag 会被存量用户置位跳过）+ 全 upsert（`ON CONFLICT DO UPDATE`；`chunk_knowledge`/FTS 先删后插）+ 空数据直接置 flag 返回。失败返回 `-1` 且**不写 flag**（下次启动重试）；**不清源**（localStorage 副本 = 灾备 + 非 Tauri 预览数据源）。

### DTO 契约（`models.rs` ↔ `tauri.ts`）

- Rust 侧 serde `rename_all = "camelCase"`；TS 侧手写 mirror 接口，**两边同改**。
- 新增字段要同时改 **Input / Row / Out 三处**——只加 Input 会让写入生效但读取回不来（`KnowledgeUnitOut` 缺 evidence 字段就是这个坑）。Row 用 `sqlx::FromRow`，Out 走 `From<Row>`。
- 转换后 `assert.deepEqual` 往返比较会被**显式 `undefined` 键**判不等（映射函数给可选字段赋了 `undefined`），测试里先做 JSON 往返归一化。

### 改 schema 的流程

1. `schema.sql` 改表定义（新库直接带新列）。
2. 版本注释 +1（当前 v4；v1 初版 / v2 chunks_fts trigram / v3 embeddings vector / v4 knowledge_units evidence 4 列）。
3. `mod.rs` 加 `migrate_vN`：用 `pragma_table_info(?)` **逐列探测再 ALTER**（可 bind、可 WHERE；别用裸 `PRAGMA table_info`），并在 `migrate()` 里按序串上。
4. `models.rs` 三处结构体 + `commands.rs` 的 INSERT/`ON CONFLICT DO UPDATE` 列同步。
5. `lib.rs` `generate_handler!` 注册新命令（现有 28 条 `db_*` 已注册，含 `db_delete_knowledge_unit` / `db_delete_relation`）。
6. 校验：`cd src-tauri && cargo test --lib`（serde camelCase 契约单测）+ `npm run typecheck`。

## Errors

- 命令通常返回 `Result<T, String>`；内部用 `anyhow::Result` / `Box<dyn Error>`。
- 把 Rust 错误映射为简短、用户安全的中文提示；详细日志留在 Rust。
- UI：try/catch + 现有提示模式。

## Do not

- `src/**` 直接 import Rust 模块，或 `src-tauri/**` import TS（见 `rules/layer-import-boundaries.mdc`）。
- 不经 `generate_handler!` 注册就新增命令。
- 纯浏览器预览（`isTauri() === false`）下调用桌面命令而不守卫。
- UI / store 层直接 `invoke("db_*")`（绕过 `src/storage` 适配器 → 破坏回退与降级）。
- 在 `migrateLegacy*` 里用 `trySqlite`（自等待死锁，见上）。

## Anchors

- Handler 注册表：`src-tauri/src/lib.rs`
- 命令实现：`src-tauri/src/vault.rs`、`src-tauri/src/llm/commands.rs`、`src-tauri/src/db/commands.rs`
- 前端封装：`src/ai/vault.ts`、`src/ai/builtin.ts`、`src/storage/tauri.ts`（DB 适配器）
- DB schema / 模型 / 迁移：`src-tauri/src/db/{schema.sql,models.rs,mod.rs}`
- 图 ↔ DTO 纯函数：`src/storage/graph-split.ts`
- 相关 skill：[rules/rust.mdc](../../rules/rust.mdc)、[layer-import-boundaries.mdc](../../rules/layer-import-boundaries.mdc)
