# 桌面窗口行为：关闭按钮最小化 + 菜单栏常驻图标

> 2026-09-30 · 需求来自用户口述：「把左上角的关闭按钮改成最小化，在 mac 顶部展示当前应用」。
> 两处歧义已当面向用户确认：① 红色关闭按钮 → 最小化窗口（非退出）；② 「mac 顶部展示当前应用」= 菜单栏常驻小图标（tray），非应用名/标题栏调整。
> 代码真源以仓库为准；本文记录动机与不变量。

## 1. 现状与决策

| 项 | 现状 | 决策 |
|---|---|---|
| 窗口装饰 | macOS 原生标题栏（`tauri.conf.json` 未设 `decorations`/`titleBarStyle`） | **保持原生**，不做自绘标题栏 |
| 红色关闭按钮 | 点击 → 窗口关闭 → Tauri 默认退出应用 | 拦截 `CloseRequested` → `prevent_close()` + `minimize()` |
| 菜单栏 | 无 tray 图标 | `TrayIconBuilder` 常驻单色 template 图标 |

## 2. 关键不变量（改这块前必读）

1. **拦截关闭 ≠ 禁止退出**：`prevent_close` 只拦窗口关闭（红点 / `window.close()`）。真正退出路径有两条，都**绕过** `CloseRequested`，不会被拦截：
   - 托盘菜单「退出 Personal Learning OS」→ `app.exit(0)`；
   - ⌘Q（macOS 默认应用菜单的 Quit）。
2. **托盘初始化失败不阻塞启动**：与 `init_db` / `init_llm` 同风格，仅 `logging::log_line(Warn)`，UI 侧无感知。
3. **菜单栏图标必须是单色 template**：`icons/tray-icon.png`（36×36 = 18pt @2x）为黑色 + alpha 成形，代码侧必须保持 `icon_as_template(true)`，由系统按浅色/深色菜单栏自动反色。**不要换彩色图标**。
4. **恢复窗口的唯一入口是托盘 / Dock 点击**：`show_main_window` = `unminimize` + `show` + `set_focus` 三连；窗口最小化后点 Dock 图标由 macOS 自动恢复。
5. 左键单击托盘 = 唤起主窗口；菜单只在右键弹出（macOS 惯例，`show_menu_on_left_click(false)`）。

## 3. 改动清单

| 文件 | 改动 |
|---|---|
| `src-tauri/Cargo.toml` | `tauri` features 加 `tray-icon`、`image-png` |
| `src-tauri/src/tray.rs` | 新增：托盘构建 + 菜单（显示主窗口 / 退出）+ 点击事件 |
| `src-tauri/src/lib.rs` | `mod tray`；`setup` 中 `tray::init(app.handle())`；新增 `.on_window_event` 拦截关闭 |
| `src-tauri/icons/tray-icon.png` | 新增：单色「翻开的书」template 图标（PIL 生成，与主图标形状呼应） |

Rust 侧改动**不触及** `storage/tauri.ts` 与前端代码，无 IPC 新增。

## 4. 验收

- [x] `cargo check --lib` 通过（需重编 tauri，本地已缓存 `tray-icon` crate）
- [ ] 用户目测：点红点 → 窗口最小化到 Dock、应用不退出；菜单栏出现书本图标；左键点击唤起窗口；托盘菜单「退出」可结束应用
- [ ] 深色模式菜单栏图标可辨（template 自动反色）
