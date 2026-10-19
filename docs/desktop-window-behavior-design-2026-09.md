# 桌面窗口行为：关闭按钮收进菜单栏 + 纯菜单栏应用（Dock 无图标）

> 2026-09-30 首版（关闭按钮 → 最小化到 Dock + 菜单栏托盘图标）；**2026-10-19 修订**（用户再次口述「把左上角的关闭按钮改成最小化到顶部的菜单栏，而不是退出当前客户端」，并当面试板「Dock 里还要不要保留图标」→ 选**彻底变成纯菜单栏应用**）。
> 修订动因：首版是 `minimize()`（收进 **Dock**），与用户要的「收进**顶部菜单栏**」不是一回事；且用户明确不要 Dock 图标。
> 代码真源以仓库为准；本文记录动机与不变量。

## 1. 现状与决策

| 项 | 现状 | 决策 |
|---|---|---|
| 窗口装饰 | macOS 原生标题栏（`tauri.conf.json` 未设 `decorations`/`titleBarStyle`） | **保持原生**，不做自绘标题栏 |
| 红色关闭按钮 | 点击 → 窗口关闭 → Tauri 默认退出应用 | 拦截 `CloseRequested` → `prevent_close()` + `hide()`（**收进菜单栏**，不是最小化到 Dock） |
| 菜单栏 | 无 tray 图标 | `TrayIconBuilder` 常驻单色 template 图标 |
| Dock 图标 | 默认 `NSApplicationActivationPolicyRegular` ⇒ Dock 有图标 | 切 `ActivationPolicy::Accessory` ⇒ **Dock 无图标**，菜单栏图标是唯一入口 |

### 1.1 为什么是 `hide()` 而不是 `minimize()`

两者视觉相近（窗口都从屏幕消失），但**可恢复性完全不同**：

- `minimize()`：窗口进入 Dock 右侧的最小化区，点 Dock 图标由 macOS 自动恢复。
- `hide()`：窗口直接 `orderOut`，**macOS 不会自动恢复**。点 Dock 图标只会触发 `NSApplicationDelegate::applicationShouldHandleReopen`（tao 转成 `RunEvent::Reopen`，本身不带任何恢复动作）—— 没有托盘图标的话，窗口就再也回不来了，应用退化为无法唤回的僵尸进程。

用户要的是「收进菜单栏」，配合「Dock 无图标」，所以只能走 `hide()` + 托盘图标这条唯一通路。

## 2. 关键不变量（改这块前必读）

1. **拦截关闭 ≠ 禁止退出**，但**退出路径只剩一条**：`prevent_close` 只拦窗口关闭（红点 / `window.close()`）；真正退出走托盘菜单「退出 Personal Learning OS」→ `app.exit(0)`。
   ⚠️ **⌘Q 已随 `Accessory` 策略失效**：`NSApplicationActivationPolicyAccessory` 下应用菜单不挂载，macOS 默认应用菜单（含 Quit）不存在。首版文档写的「⌘Q 同样可用」在 2026-10-19 后**不再成立**——不要按旧结论改别处。
2. **`hide()` 的前置条件是托盘可用**：`tray::is_available()` 是唯一判据。托盘初始化失败时必须回退 `minimize()`（Dock 图标此时仍在，可点回）。**先切 Accessory 再发现托盘没建成**同样危险，所以「切策略」与「收走窗口」两处都以 `tray_ok` / `is_available()` 把关。
3. **托盘初始化失败不阻塞启动**：与 `init_db` / `init_llm` 同风格，仅 `logging::log_line(Warn)`，UI 侧无感知。
4. **菜单栏图标必须是单色 template**：`icons/tray-icon.png`（36×36 = 18pt @2x）为黑色 + alpha 成形，代码侧必须保持 `icon_as_template(true)`，由系统按浅色/深色菜单栏自动反色。**不要换彩色图标**。
5. **恢复窗口的唯一入口是托盘**：`show_main_window` = `unminimize` + `show` + `set_focus` 三连，缺一不可——`set_focus` 内部走 `makeKeyAndOrderFront` + `activateIgnoringOtherApps:`，`Accessory` 策略下没有 `activateIgnoringOtherApps` 就抢不到前台焦点。`unminimize` 保留以兼容用户用黄点（最小化）后的恢复。
6. 左键单击托盘 = 唤起主窗口；菜单只在右键弹出（macOS 惯例，`show_menu_on_left_click(false)`）。

## 3. 改动清单

### 3.1 首版（2026-09-30，已交付）

| 文件 | 改动 |
|---|---|
| `src-tauri/Cargo.toml` | `tauri` features 加 `tray-icon`、`image-png` |
| `src-tauri/src/tray.rs` | 新增：托盘构建 + 菜单（显示主窗口 / 退出）+ 点击事件 |
| `src-tauri/src/lib.rs` | `mod tray`；`setup` 中 `tray::init(app.handle())`；新增 `.on_window_event` 拦截关闭 |
| `src-tauri/icons/tray-icon.png` | 新增：单色「翻开的书」template 图标（PIL 生成，与主图标形状呼应） |

### 3.2 修订（2026-10-19）

| 文件 | 改动 |
|---|---|
| `src-tauri/src/lib.rs` | `on_window_event` 的 `minimize()` → 按 `tray::is_available()` 分支 `hide()` / `minimize()`；`setup` 里 `tray::init` 改为记录 `tray_ok`，成功才 `set_activation_policy(ActivationPolicy::Accessory)` |
| `src-tauri/src/tray.rs` | 新增模块级 `AVAILABLE: AtomicBool` + `is_available()`；`init` 成功后置位；`show_main_window` 注释补充 `Accessory` 下三连的必要性 |

Rust 侧改动**不触及** `storage/tauri.ts` 与前端代码，无 IPC 新增、无 Cargo feature 变更（`tray-icon` 首版已加）。

## 4. 验收

首版（2026-09-30）：

- [x] `cargo check --lib` 通过（需重编 tauri，本地已缓存 `tray-icon` crate）
- [ ] 用户目测：点红点 → 窗口最小化到 Dock、应用不退出；菜单栏出现书本图标；左键点击唤起窗口；托盘菜单「退出」可结束应用
- [ ] 深色模式菜单栏图标可辨（template 自动反色）

修订（2026-10-19）：

- [x] `cargo check --lib` 通过
- [ ] 用户目测：点红点 → 窗口消失、**Dock 里不再有本应用图标**、菜单栏书本图标仍在
- [ ] 左键点菜单栏图标 → 窗口回到前台且**能直接打字/点击**（验证 `set_focus` 的 `activateIgnoringOtherApps` 生效）
- [ ] 托盘右键菜单「退出」可结束应用；**⌘Q 不再可用**（预期行为，非缺陷）
- [ ] 托盘图标初始化失败的回退路径未被实跑覆盖（需人为破坏 `icons/tray-icon.png` 才能触发，属已知未验项）

