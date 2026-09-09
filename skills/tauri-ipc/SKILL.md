---
name: tauri-ipc
description: Guides adding and changing Tauri 2 commands and events between the React (Vite) UI and the Rust desktop core. Use when implementing invoke/listen, registering generate_handler, adding serde payloads, or when the user mentions Tauri commands, IPC, or Rust-to-frontend events.
---

# Tauri IPC

PLOS 的 UI 与桌面核心只经 Tauri commands（与可选 events）通信。纯逻辑在 `src/{domain,engine,ai}`；**桌面能力**（Keychain 密钥、本地模型 sidecar）才落到 Rust。

## 现状速览（vault / llm）

| 命令面 | Rust 属主 | 前端调用侧 |
|---------|-----------|-----------|
| `vault_set_secret` / `vault_get_secret` / `vault_delete_secret` | `src-tauri/src/vault.rs` | `src/ai/vault.ts` |
| `llm_list_models` / `llm_download` / `llm_cancel_download` / `llm_delete` / `llm_generate` / `llm_default_model` / `llm_status` | `src-tauri/src/llm/commands.rs` | `src/ai/builtin.ts` |
| `app_status` | `src-tauri/src/lib.rs` | — |

## When to use

- 新增桌面能力（密钥、模型下载/生成、文件、窗口）
- 修改现有 `invoke('…')` 契约
- 需要 Rust 主动推送进度 / 状态到 UI（events）

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

## Errors

- 命令通常返回 `Result<T, String>`；内部用 `anyhow::Result` / `Box<dyn Error>`。
- 把 Rust 错误映射为简短、用户安全的中文提示；详细日志留在 Rust。
- UI：try/catch + 现有提示模式。

## Do not

- `src/**` 直接 import Rust 模块，或 `src-tauri/**` import TS（见 `rules/layer-import-boundaries.mdc`）。
- 不经 `generate_handler!` 注册就新增命令。
- 纯浏览器预览（`isTauri() === false`）下调用桌面命令而不守卫。

## Anchors

- Handler 注册表：`src-tauri/src/lib.rs`
- 命令实现：`src-tauri/src/vault.rs`、`src-tauri/src/llm/commands.rs`
- 前端封装：`src/ai/vault.ts`、`src/ai/builtin.ts`
- 相关 skill：[rules/rust.mdc](../../rules/rust.mdc)、[layer-import-boundaries.mdc](../../rules/layer-import-boundaries.mdc)
