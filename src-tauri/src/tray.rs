//! macOS 菜单栏常驻图标（tray）。
//!
//! 需求（2026-09-30 用户确认）：
//! 1. 窗口左上角红色关闭按钮 → 最小化而非退出（见 `lib.rs::on_window_event`）；
//! 2. 屏幕顶部菜单栏常驻一个可点开的图标，作为「找回窗口 / 真正退出」的入口。
//!
//! 拦截了 CloseRequested 后应用无法靠关窗退出，托盘菜单的「退出」是明确
//! 的可靠出口（⌘Q 依赖 macOS 默认应用菜单，同样可用）。
//! 图标 `icons/tray-icon.png` 为单色 template 图（黑色 + alpha 成形），
//! `icon_as_template(true)` 让系统按浅色/深色菜单栏自动反色。

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

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
    Ok(())
}

/// 从最小化/后台恢复主窗口并置前。
fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}
