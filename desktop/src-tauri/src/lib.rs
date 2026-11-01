mod config;
mod eve_watcher;
mod windows;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use eve_watcher::EveForeground;
use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Manager, State, WebviewWindow};

/// Shared state across every webview window.
#[derive(Default)]
pub struct AppState {
    pub last_eve: Mutex<Option<EveForeground>>,
    /// Normalized server base URL; `None` until the setup page saves one.
    pub server_url: Mutex<Option<String>>,
    /// Last geometry write per widget window, so dragging does not rewrite
    /// `config.json` on every resize event.
    pub geometry_saved_at: Mutex<HashMap<String, Instant>>,
}

/// The page calls this once its React bridge is installed. Returning the last
/// foreground EVE window immediately avoids waiting for the next activation.
/// Window-local state (opacity, zoom, pin) also comes from here so the page
/// controls start at the value the window was actually created with.
#[tauri::command]
fn desktop_ready(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    mode: Option<String>,
    widget: Option<String>,
) -> serde_json::Value {
    // The page identifies itself for future per-window behaviour; P0 only needs
    // the last EVE foreground state, but accepting these keeps the IPC shape
    // aligned with `desktop_ready({ mode, widget })`.
    let _ = (mode, widget);

    let last_eve = state.last_eve.lock().ok().and_then(|guard| guard.clone());

    // Page-local caching only mirrors these; `config.json` is the source of
    // truth, so the slider starts at the same opacity the window was created
    // with (and a stale localStorage value from an older build is corrected).
    serde_json::json!({
        // The page reports this back in the usage heartbeat and compares it
        // with the release manifest to decide whether to show the update notice.
        "version": env!("CARGO_PKG_VERSION"),
        "lastEve": last_eve,
        "widgetOpacity": config::widget_opacity(&app),
        "uiScale": config::ui_scale(&app),
        // Read from the native window rather than config: the flag is applied
        // when the window opens, and the config is only a cache for next time.
        "alwaysOnTop": window.is_always_on_top().unwrap_or(false),
        // Lets the map bar show whether this map is already the startup map.
        "defaultMap": config::default_map(&app),
    })
}

#[tauri::command]
fn get_default_map(app: AppHandle) -> Option<String> {
    config::default_map(&app)
}

/// Remembers the map the main window opens on launch. `None` clears it, so the
/// client starts at the map chooser again.
#[tauri::command]
fn set_default_map(app: AppHandle, slug: Option<String>) -> Result<Option<String>, String> {
    config::save_default_map(&app, slug.as_deref())?;
    Ok(config::default_map(&app))
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

    // The address field accepts a map URL; probing resolves it to the server
    // base and drops the extra route (see `config::resolve_base`). The probe is
    // skipped for a bare origin, so first-time setup without a path stays fast.
    let resolved = config::resolve_base(&normalized).await?;

    if !resolved.verified {
        eprintln!(
            "[wanderer] could not verify {normalized:?}; using {:?}",
            resolved.base
        );
    }

    // A different server has different maps; the saved default map would 404.
    let server_changed = config::load(&app).as_deref() != Some(resolved.base.as_str());

    config::save(&app, &resolved.base)?;

    if server_changed {
        config::save_default_map(&app, None)?;
    }

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut guard) = state.server_url.lock() {
            *guard = Some(resolved.base);
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

/// Pins/unpins the calling widget window and remembers the choice per widget
/// id, so the next `open_widget` restores it.
#[tauri::command]
fn set_always_on_top(app: AppHandle, window: WebviewWindow, value: bool) -> Result<(), String> {
    window
        .set_always_on_top(value)
        .map_err(|error| error.to_string())?;

    if let Some(widget) = windows::window_key(window.label()) {
        config::save_widget_always_on_top(&app, widget, value)?;
    }

    Ok(())
}

// Zoom is controlled from the main map bar (and the page-level shortcuts) on
// every window, so these commands return the applied scale for the bar label.
#[tauri::command]
fn zoom_in(app: AppHandle) -> Result<f64, String> {
    windows::change_ui_scale(&app, 0.1)
}

#[tauri::command]
fn zoom_out(app: AppHandle) -> Result<f64, String> {
    windows::change_ui_scale(&app, -0.1)
}

#[tauri::command]
fn zoom_reset(app: AppHandle) -> Result<f64, String> {
    windows::reset_ui_scale(&app)
}

#[tauri::command]
fn set_window_title(window: WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|error| error.to_string())
}

/// Widget windows fade as a whole through the OS (`WS_EX_LAYERED`), so the page
/// asks Rust instead of changing CSS opacity. Persisted so the next widget
/// window opens at the same opacity.
#[tauri::command]
fn set_widget_opacity(app: AppHandle, opacity: f64) -> Result<(), String> {
    windows::set_widget_opacity(&app, opacity)
}

pub fn run() {
    tauri::Builder::default()
        // A native menu keeps the server address reachable even when the
        // remote page cannot load (wrong address, server down), where the
        // in-page "服务器" button is not available.
        //
        // Zoom and transparency are intentionally *not* menu items: they are
        // shown only in the main map window's in-page bar (see
        // `DesktopMainBar`), while detached windows use Ctrl+= / Ctrl+- /
        // Ctrl+0. A window-wide menu would repeat those controls in every
        // small window.
        .menu(|handle| {
            let settings =
                MenuItem::with_id(handle, "server-settings", "服务器设置…", true, None::<&str>)?;
            Menu::with_items(handle, &[&settings])
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
            }
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_ready,
            get_server_url,
            set_server_url,
            get_default_map,
            set_default_map,
            open_server_settings,
            open_widget,
            open_main,
            close_self,
            set_always_on_top,
            set_window_title,
            set_widget_opacity,
            zoom_in,
            zoom_out,
            zoom_reset
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
