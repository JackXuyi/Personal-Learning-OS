//! macOS 菜单栏常驻图标（tray）。
//!
//! 需求（2026-09-30 用户确认，2026-10-19 修订为纯菜单栏应用）：
//! 1. 窗口左上角红色关闭按钮 → 收进菜单栏而非退出（见 `lib.rs::on_window_event`）；
//! 2. 屏幕顶部菜单栏常驻一个可点开的图标，作为「找回窗口 / 真正退出」的入口；
//! 3. 激活策略切到 `Accessory` ⇒ Dock 不再显示本应用，菜单栏图标是**唯一**入口。
//!
//! 拦截了 CloseRequested 后应用无法靠关窗退出，托盘菜单的「退出」是明确
//! 的可靠出口。⚠️ `Accessory` 策略下应用菜单不再显示 ⇒ **⌘Q 失效**，退出只剩托盘。
//! 图标 `icons/tray-icon.png` 为单色 template 图（黑色 + alpha 成形），
//! `icon_as_template(true)` 让系统按浅色/深色菜单栏自动反色。

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// 托盘图标是否可用。⚠️ 这是「窗口能否安全收进菜单栏」的唯一判据：
/// 托盘建失败时若仍 `hide()` 窗口，用户将**既唤不回也退不出**
/// （macOS 不会自动恢复被 hide 的窗口，Dock 点击只发 Reopen 事件），
/// 故 `lib.rs` 据此在失败时回退到 `minimize()`（Dock 图标可点回）。
static AVAILABLE: AtomicBool = AtomicBool::new(false);

/// 托盘图标是否已成功创建。
pub fn is_available() -> bool {
    AVAILABLE.load(Ordering::Relaxed)
}

/// 菜单栏图标：36×36（= 18pt @2x），与主图标呼应的「翻开的书」单色造型。
const TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/tray-icon.png");

const SHOW_ITEM_ID: &str = "show";
const QUIT_ITEM_ID: &str = "quit";

/// 创建托盘图标；失败仅告警不阻塞启动（由调用方记日志）。
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, SHOW_ITEM_ID, "显示主窗口", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_ITEM_ID, "退出 Personal Learning OS", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(tauri::image::Image::from_bytes(TRAY_ICON_PNG)?)
        .icon_as_template(true)
        .tooltip("Personal Learning OS")
        .menu(&menu)
        // 左键单击直接唤起主窗口；菜单只在右键时弹出（macOS 惯例）。
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            SHOW_ITEM_ID => show_main_window(app),
            QUIT_ITEM_ID => app.exit(0),
            _ => {}
        })
        .build(app)?;
    AVAILABLE.store(true, Ordering::Relaxed);
    Ok(())
}

/// 从隐藏/最小化/后台恢复主窗口并置前。
///
/// `Accessory` 策略下应用不在 Dock，`show` + `set_focus`（内部走
/// `activateIgnoringOtherApps:`）是**唯一**能把窗口拉回前台的路径，
/// 缺一不可。`unminimize` 保留以兼容用户用黄点最小化后的恢复。
fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}
