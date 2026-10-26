#[cfg(target_os = "macos")]
use tauri::{
    menu::{Menu, MenuItem as MacMenuItem, PredefinedMenuItem, Submenu},
    AppHandle,
};

#[cfg(target_os = "macos")]
pub fn build_macos_app_menu(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_name = app.package_info().name.clone();
    let new_session =
        MacMenuItem::with_id(app, "new-session", "新建会话", true, Some("CmdOrCtrl+N"))?;
    let general_settings = MacMenuItem::with_id(
        app,
        "settings-general",
        "常规设置…",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let model_settings = MacMenuItem::with_id(
        app,
        "settings-models",
        "模型设置…",
        true,
        Some("CmdOrCtrl+M"),
    )?;
    let about = PredefinedMenuItem::about(app, Some("关于 Pi Agent 无障碍测试版"), None)?;
    let services = PredefinedMenuItem::services(app, Some("服务"))?;
    let hide = PredefinedMenuItem::hide(app, Some("隐藏应用"))?;
    let hide_others = PredefinedMenuItem::hide_others(app, Some("隐藏其他应用"))?;
    let quit = PredefinedMenuItem::quit(app, Some("退出应用"))?;
    let separator = PredefinedMenuItem::separator(app)?;

    let app_menu = Submenu::with_items(
        app,
        app_name,
        true,
        &[
            &about,
            &separator,
            &services,
            &separator,
            &hide,
            &hide_others,
            &separator,
            &quit,
        ],
    )?;
    let file_menu = Submenu::with_items(app, "文件", true, &[&new_session])?;
    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &separator,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("复制"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;
    let settings_menu =
        Submenu::with_items(app, "设置", true, &[&general_settings, &model_settings])?;
    let toggle_sidebar = MacMenuItem::with_id(app, "toggle-sidebar", "显示或收起历史记录", true, Some("CmdOrCtrl+B"))?;
    let latest_session = MacMenuItem::with_id(app, "latest-session", "打开最新会话", true, Some("CmdOrCtrl+Shift+J"))?;
    let manage_sessions = MacMenuItem::with_id(app, "manage-sessions", "管理会话", true, Some("CmdOrCtrl+Shift+M"))?;
    let view_menu = Submenu::with_items(
        app,
        "显示",
        true,
        &[&toggle_sidebar, &latest_session, &manage_sessions, &PredefinedMenuItem::fullscreen(app, Some("进入或退出全屏幕"))?],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "窗口",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("最小化"))?,
            &PredefinedMenuItem::maximize(app, Some("缩放窗口"))?,
            &separator,
            &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
        ],
    )?;

    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &settings_menu,
            &view_menu,
            &window_menu,
        ],
    )?;
    app.set_menu(menu)?;
    Ok(())
}
