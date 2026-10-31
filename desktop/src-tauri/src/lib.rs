mod config;
mod eve_watcher;
mod windows;

use std::sync::Mutex;

use eve_watcher::EveForeground;
use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Manager, State, WebviewWindow};

/// Shared state across every webview window.
#[derive(Default)]
pub struct AppState {
    pub last_eve: Mutex<Option<EveForeground>>,
    /// Normalized server base URL; `None` until the setup page saves one.
    pub server_url: Mutex<Option<String>>,
}

/// The page calls this once its React bridge is installed. Returning the last
/// foreground EVE window immediately avoids waiting for the next activation.
#[tauri::command]
fn desktop_ready(
    state: State<'_, AppState>,
    mode: Option<String>,
    widget: Option<String>,
) -> serde_json::Value {
    // The page identifies itself for future per-window behaviour; P0 only needs
    // the last EVE foreground state, but accepting these keeps the IPC shape
    // aligned with `desktop_ready({ mode, widget })`.
    let _ = (mode, widget);

    let last_eve = state.last_eve.lock().ok().and_then(|guard| guard.clone());

    serde_json::json!({ "lastEve": last_eve })
}

#[tauri::command]
fn get_server_url(state: State<'_, AppState>) -> Option<String> {
    state.server_url.lock().ok().and_then(|guard| guard.clone())
}

/// Saves the address entered on the setup page, then points the main window at
/// it. Widget windows belong to the previous server and are closed.
///
/// Async on purpose: `apply_server` may create/re-navigate windows, and on
/// Windows creating a WebView2 window from a synchronous command deadlocks the
/// main thread (see `WebviewWindowBuilder`'s known issues).
#[tauri::command]
async fn set_server_url(app: AppHandle, window: WebviewWindow, url: String) -> Result<(), String> {
    let normalized = config::normalize(&url)?;
    config::save(&app, &normalized)?;

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut guard) = state.server_url.lock() {
            *guard = Some(normalized);
        }
    }

    windows::apply_server(&app)?;

    if window.label() != "main" {
        let _ = window.close();
    }

    Ok(())
}

// The commands below create windows. They must stay async: `WebviewWindowBuilder`
// deadlocks on Windows when a window is created from a synchronous command,
// which shows up as the new window (and the whole app) becoming unresponsive.
#[tauri::command]
async fn open_server_settings(app: AppHandle) -> Result<(), String> {
    windows::open_server_settings(&app)
}

#[tauri::command]
async fn open_widget(app: AppHandle, map_slug: String, widget: String) -> Result<(), String> {
    windows::open_widget(&app, &map_slug, &widget)
}

#[tauri::command]
async fn open_main(app: AppHandle) -> Result<(), String> {
    windows::ensure_main(&app)
}

#[tauri::command]
fn close_self(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, value: bool) -> Result<(), String> {
    window
        .set_always_on_top(value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_window_title(window: WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        // A native menu keeps the server address reachable even when the
        // remote page cannot load (wrong address, server down), where the
        // in-page "服务器" button is not available.
        .menu(|handle| {
            let settings =
                MenuItem::with_id(handle, "server-settings", "服务器设置…", true, None::<&str>)?;
            let quit = MenuItem::with_id(handle, "quit", "退出", true, None::<&str>)?;

            Menu::with_items(handle, &[&settings, &quit])
        })
        .on_menu_event(|app, event| {
            if event.id() == "server-settings" {
                // Menu callbacks run on the main thread. Creating a WebView2
                // window here deadlocks on Windows, so use a separate thread
                // (the same rule as async commands).
                let app = app.clone();
                std::thread::spawn(move || {
                    if let Err(error) = windows::open_server_settings(&app) {
                        eprintln!("[wanderer] failed to open server settings: {error}");
                    }
                });
            } else if event.id() == "quit" {
                app.exit(0);
            }
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_ready,
            get_server_url,
            set_server_url,
            open_server_settings,
            open_widget,
            open_main,
            close_self,
            set_always_on_top,
            set_window_title
        ])
        .setup(|app| {
            // Runtime env (dev) or the address saved on first launch. With
            // neither, the main window shows the setup page instead of a map.
            let initial = config::resolve_initial(app.handle());

            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut guard) = state.server_url.lock() {
                    *guard = initial;
                }
            }

            windows::ensure_main(app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;

            eve_watcher::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Wanderer desktop");
}
