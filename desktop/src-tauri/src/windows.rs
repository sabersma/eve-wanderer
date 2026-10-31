use std::time::{Duration, Instant};

use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use crate::{config, AppState};

/// Default size (logical pixels) of each detached widget window. Users can
/// resize them freely; the size is remembered per widget in the config file.
fn default_widget_size(widget: &str) -> Option<(f64, f64)> {
    match widget {
        "signatures" => Some((380.0, 560.0)),
        "kills" => Some((720.0, 460.0)),
        "characters" => Some((340.0, 460.0)),
        "jspace" => Some((360.0, 420.0)),
        "bookmarks" => Some((440.0, 560.0)),
        _ => None,
    }
}

const MIN_WIDGET_WIDTH: f64 = 260.0;
const MIN_WIDGET_HEIGHT: f64 = 220.0;

/// `widget-<slug>-<widget>` -> `<widget>`. Slugs keep their own dashes, so the
/// widget id is always the last segment. `None` for `main` and
/// `server-settings`; per-widget settings (geometry, always-on-top) key off it.
pub fn window_key(label: &str) -> Option<&str> {
    label
        .strip_prefix("widget-")?
        .rsplit_once('-')
        .map(|(_, widget)| widget)
}

fn apply_ui_scale(app: &AppHandle, window: &WebviewWindow) {
    let scale = config::ui_scale(app);
    if let Err(error) = window.set_zoom(scale) {
        eprintln!("[wanderer] failed to apply UI scale {scale}: {error}");
    }
}

/// Applies the saved zoom to every open window when the user changes it from
/// the main map bar, then persists it so windows opened later start at the same
/// size. Returns the scale that was actually applied.
pub fn set_ui_scale(app: &AppHandle, scale: f64) -> Result<f64, String> {
    let scale = config::clamp_ui_scale(scale);
    config::save_ui_scale(app, scale)?;

    for window in app.webview_windows().into_values() {
        apply_ui_scale(app, &window);
    }

    Ok(scale)
}

pub fn change_ui_scale(app: &AppHandle, delta: f64) -> Result<f64, String> {
    set_ui_scale(app, config::stepped_ui_scale(config::ui_scale(app), delta))
}

pub fn reset_ui_scale(app: &AppHandle) -> Result<f64, String> {
    set_ui_scale(app, config::DEFAULT_UI_SCALE)
}

/// The menu "退出" path calls `app.exit(0)` directly, so windows never see
/// `CloseRequested`; persist the final size of every widget window first.
///
/// The menu item is currently removed (it was easy to hit by accident), so
/// geometry is saved by the per-window `CloseRequested`/`Destroyed` handler.
/// Keep this for when the item comes back.
#[allow(dead_code)]
pub fn save_all_geometry(app: &AppHandle) {
    for window in app.webview_windows().into_values() {
        if window_key(window.label()).is_some() {
            save_geometry_now(&window);
        }
    }
}

/// Saved geometry converted to the logical pixels the window builder expects.
/// Positions that no longer land on a connected monitor are dropped (the
/// window opens centered) rather than restoring it off-screen.
fn restored_geometry(app: &AppHandle, widget: &str) -> Option<(f64, f64, Option<(f64, f64)>)> {
    let saved = config::saved_window(app, widget)?;
    if saved.width < 120.0 || saved.height < 120.0 {
        return None;
    }

    let monitors = app.available_monitors().unwrap_or_default();
    let saved_position = saved.x.zip(saved.y);

    let target = saved_position.and_then(|(x, y)| {
        let center_x = x + saved.width / 2.0;
        let center_y = y + saved.height / 2.0;

        monitors.iter().find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            let left = position.x as f64;
            let top = position.y as f64;

            center_x >= left
                && center_x <= left + size.width as f64
                && center_y >= top
                && center_y <= top + size.height as f64
        })
    });

    let scale = target
        .map(|monitor| monitor.scale_factor())
        .or_else(|| {
            app.primary_monitor()
                .ok()
                .flatten()
                .map(|monitor| monitor.scale_factor())
        })
        .filter(|scale| *scale > 0.0)
        .unwrap_or(1.0);

    let max_width = target
        .map(|monitor| monitor.size().width as f64 / scale)
        .unwrap_or(4000.0);
    let max_height = target
        .map(|monitor| monitor.size().height as f64 / scale)
        .unwrap_or(3000.0);

    let width = (saved.width / scale).clamp(MIN_WIDGET_WIDTH, max_width);
    let height = (saved.height / scale).clamp(MIN_WIDGET_HEIGHT, max_height);
    let position = saved_position.and_then(|(x, y)| target.map(|_| (x / scale, y / scale)));

    Some((width, height, position))
}

fn save_geometry_now(window: &WebviewWindow) {
    let Some(key) = window_key(window.label()) else {
        return;
    };

    let (Ok(size), Ok(position)) = (window.inner_size(), window.outer_position()) else {
        return;
    };

    // A zero-size window (minimized/being destroyed) would poison the saved
    // state and reopen at the builder minimum. A maximized window would save
    // the screen size instead of the size the user actually chose.
    if size.width == 0 || size.height == 0 || window.is_maximized().unwrap_or(false) {
        return;
    }

    let geometry = config::SavedWindow {
        width: size.width as f64,
        height: size.height as f64,
        x: Some(position.x as f64),
        y: Some(position.y as f64),
    };

    if let Err(error) = config::save_window(window.app_handle(), key, geometry) {
        eprintln!("[wanderer] failed to save window geometry: {error}");
    }
}

/// Resize/move events fire continuously while dragging, so geometry writes are
/// throttled; closing the window always writes the final size.
fn save_geometry_throttled(window: &WebviewWindow) {
    let Some(key) = window_key(window.label()) else {
        return;
    };

    if let Some(state) = window.app_handle().try_state::<AppState>() {
        if let Ok(mut guard) = state.geometry_saved_at.lock() {
            let now = Instant::now();
            if let Some(last) = guard.get(key) {
                if now.duration_since(*last) < Duration::from_millis(800) {
                    return;
                }
            }
            guard.insert(key.to_string(), now);
        }
    }

    save_geometry_now(window);
}

fn track_geometry(window: &WebviewWindow) {
    let tracked = window.clone();

    window.on_window_event(move |event| match event {
        WindowEvent::Resized(_) | WindowEvent::Moved(_) => save_geometry_throttled(&tracked),
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => save_geometry_now(&tracked),
        _ => {}
    });
}

/// The server chosen on first launch (or supplied by WANDERER_SERVER_URL in
/// development). `None` means the setup page is still showing.
pub fn current_server(app: &AppHandle) -> Option<String> {
    app.try_state::<AppState>()
        .and_then(|state| state.server_url.lock().ok().and_then(|guard| guard.clone()))
}

fn page_url(base: &str, path: &str) -> Result<Url, String> {
    let url = format!("{}{}", base.trim_end_matches('/'), path);
    Url::parse(&url).map_err(|error| format!("invalid server URL ({url}): {error}"))
}

/// Tauri window labels only need to be unique; keep them readable but safe.
fn sanitize_label(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn is_local_origin(url: &Url) -> bool {
    matches!(url.scheme(), "tauri" | "asset")
        || matches!(url.host_str(), Some("tauri.localhost"))
        || (url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost") | Some("127.0.0.1")))
}

/// Keep webview navigation on the Wanderer server (plus the EVE SSO domain it
/// redirects through) and on the bundled setup page. The IPC capability is
/// broader than this allowlist, so this check is what stops an arbitrary https
/// page from reaching Rust.
fn navigation_allowed(app: &AppHandle, url: &Url) -> bool {
    if url.scheme() == "about" || is_local_origin(url) {
        return true;
    }

    if let Some(base) = current_server(app) {
        if let Ok(base) = Url::parse(&base) {
            if url.origin() == base.origin() {
                return true;
            }
        }
    }

    matches!(
        url.host_str(),
        Some(host)
            if host == "eveonline.com"
                || host == "login.eveonline.com"
                || host.ends_with(".eveonline.com")
    )
}

fn encode_path_segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());

    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }

    encoded
}

/// Handles `window.open` / `target="_blank"` from the map pages (zkillboard,
/// dotlan, anoik, J-Space Helper, ...). wry denies every new-window request
/// when no handler is installed, so without this those buttons silently do
/// nothing inside the desktop client. http(s) links go to the system browser;
/// anything else (`javascript:`, `file:`, custom schemes) is dropped.
fn open_in_browser_window(url: Url, _features: NewWindowFeatures) -> NewWindowResponse<tauri::Wry> {
    if matches!(url.scheme(), "http" | "https") {
        let url = url.to_string();

        // Runs on the main thread's WebView2 message loop, so the shell call
        // is moved to a thread of its own rather than blocking that loop.
        let _ = std::thread::Builder::new()
            .name("wanderer-open-external".to_string())
            .spawn(move || open_external(&url));
    }

    NewWindowResponse::Deny
}

fn open_external(url: &str) {
    #[cfg(target_os = "windows")]
    {
        use windows::core::{w, PCWSTR};
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let wide: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            ShellExecuteW(
                HWND::default(),
                w!("open"),
                PCWSTR(wide.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Development on Linux/WSL only; WSLg maps xdg-open to the Windows
        // default browser through the usual interop helpers.
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

fn focus_existing(app: &AppHandle, label: &str) -> bool {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        true
    } else {
        false
    }
}

/// Opens the map picker, or the setup page when no server has been chosen yet.
/// The main window is not declared in tauri.conf.json because its URL depends on
/// the server address.
pub fn ensure_main(app: &AppHandle) -> Result<(), String> {
    if focus_existing(app, "main") {
        return Ok(());
    }

    let (url, title) = match current_server(app) {
        Some(base) => (
            WebviewUrl::External(page_url(&base, "/desktop")?),
            "Wanderer".to_string(),
        ),
        None => (
            WebviewUrl::App("index.html".into()),
            "Wanderer · 服务器设置".to_string(),
        ),
    };

    let app_for_nav = app.clone();

    let window = WebviewWindowBuilder::new(app, "main", url)
        .title(title)
        .inner_size(1360.0, 860.0)
        .min_inner_size(960.0, 640.0)
        .on_navigation(move |url| navigation_allowed(&app_for_nav, url))
        .on_new_window(open_in_browser_window)
        .on_page_load(|window, _| apply_ui_scale(window.app_handle(), &window))
        .build()
        .map_err(|error| format!("failed to open main window: {error}"))?;

    apply_ui_scale(app, &window);
    Ok(())
}

/// Applies a newly saved server address: stale widget windows belong to the old
/// server, so they are closed, then the main window is navigated (or opened).
pub fn apply_server(app: &AppHandle) -> Result<(), String> {
    let base = current_server(app).ok_or_else(|| "server is not configured".to_string())?;
    let target = page_url(&base, "/desktop")?;

    for (label, window) in app.webview_windows() {
        if label.starts_with("widget-") {
            let _ = window.close();
        }
    }

    if let Some(main) = app.get_webview_window("main") {
        main.navigate(target)
            .map_err(|error| format!("failed to open server: {error}"))?;
        // A new document can reset WebView2's zoom factor; re-apply it now
        // instead of waiting for the next page-load callback.
        apply_ui_scale(app, &main);
        Ok(())
    } else {
        ensure_main(app)
    }
}

pub fn open_widget(app: &AppHandle, map_slug: &str, widget: &str) -> Result<(), String> {
    let default_size =
        default_widget_size(widget).ok_or_else(|| format!("unsupported widget: {widget}"))?;

    let label = format!("widget-{}-{}", sanitize_label(map_slug), widget);
    if focus_existing(app, &label) {
        return Ok(());
    }

    let base = current_server(app).ok_or_else(|| "server is not configured".to_string())?;
    let path = format!(
        "/desktop/{}/widget/{}",
        encode_path_segment(map_slug),
        encode_path_segment(widget)
    );
    let url = page_url(&base, &path)?;
    let app_for_nav = app.clone();

    // Saved sizes are per widget id, so a size chosen for the signatures window
    // also applies to signatures windows on other maps.
    let (width, height, position) =
        restored_geometry(app, widget).unwrap_or((default_size.0, default_size.1, None));

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title(format!("Wanderer · {widget}"))
        .inner_size(width, height)
        .min_inner_size(MIN_WIDGET_WIDTH, MIN_WIDGET_HEIGHT)
        // The window keeps its native title bar and border: transparency is
        // applied to the whole native window with `WS_EX_LAYERED` (see
        // `apply_widget_opacity`) rather than by making the WebView2 surface
        // translucent. Per-pixel WebView2 transparency requires
        // `no_redirection_bitmap`, which stops Windows from painting the
        // non-client area, and it composited the page against a white backdrop.
        .on_navigation(move |url| navigation_allowed(&app_for_nav, url))
        .on_new_window(open_in_browser_window)
        .on_page_load(|window, _| apply_ui_scale(window.app_handle(), &window));

    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }

    let window = builder
        .build()
        .map_err(|error| format!("failed to open {widget} window: {error}"))?;

    apply_ui_scale(app, &window);
    apply_widget_opacity(app, &window);

    // Restore the pin before the window is shown again, so reopening a pinned
    // widget does not flash behind the game for a frame.
    if config::widget_always_on_top(app, widget) {
        if let Err(error) = window.set_always_on_top(true) {
            eprintln!("[wanderer] failed to restore always-on-top: {error}");
        }
    }

    track_geometry(&window);
    Ok(())
}

/// Fades one widget window as a whole. The page itself stays fully opaque, so
/// the table, toolbar, text, title bar and border all get the same alpha — the
/// earlier CSS-opacity approach only faded the widget root and let the opaque
/// WebView2 background show through as white.
fn apply_widget_opacity(app: &AppHandle, window: &WebviewWindow) {
    apply_window_opacity(window, config::widget_opacity(app));
}

fn apply_window_opacity(window: &WebviewWindow, opacity: f64) {
    #[cfg(target_os = "windows")]
    set_window_opacity(window, opacity);

    #[cfg(not(target_os = "windows"))]
    let _ = (window, opacity);
}

/// `SetLayeredWindowAttributes` with `LWA_ALPHA` applies one alpha value to the
/// entire composed window. Only the layered style is needed here — no
/// transparent/frameless window flags — so decorations, resizing and the DWM
/// shadow keep working normally.
#[cfg(target_os = "windows")]
fn set_window_opacity(window: &WebviewWindow, opacity: f64) {
    use windows::Win32::Foundation::{COLORREF, HWND};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE, LWA_ALPHA,
        WS_EX_LAYERED,
    };

    let Ok(raw) = window.hwnd() else {
        return;
    };
    // Tauri returns the handle through its own `windows` crate version; wrap the
    // raw pointer in our `HWND` so both sides share one handle type.
    let hwnd = HWND(raw.0);
    let alpha = (opacity.clamp(0.0, 1.0) * 255.0).round() as u8;

    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if style & (WS_EX_LAYERED.0 as isize) == 0 {
            // Users who never touch the slider keep the normal, non-layered
            // window. The style cannot be removed later without recreating the
            // window, so once layered a window stays layered (alpha 255 is
            // visually identical to opaque).
            if opacity >= 1.0 {
                return;
            }
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | (WS_EX_LAYERED.0 as isize));
        }

        if let Err(error) = SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA) {
            eprintln!("[wanderer] failed to apply widget opacity: {error}");
        }
    }
}

/// Saves the new opacity and applies it to every open widget window, so all
/// five windows stay in sync. The main map window is never faded.
pub fn set_widget_opacity(app: &AppHandle, opacity: f64) -> Result<(), String> {
    let opacity = config::clamp_widget_opacity(opacity);

    // Apply first: a read-only config directory must not make the slider look
    // dead; the save error is still reported to the page.
    for window in app.webview_windows().into_values() {
        if window_key(window.label()).is_some() {
            apply_window_opacity(&window, opacity);
        }
    }

    config::save_widget_opacity(app, opacity)
}

/// Opens the server-address form in its own window so the current map keeps
/// working until the user saves a new address.
pub fn open_server_settings(app: &AppHandle) -> Result<(), String> {
    if focus_existing(app, "server-settings") {
        return Ok(());
    }

    let app_for_nav = app.clone();

    let window =
        WebviewWindowBuilder::new(app, "server-settings", WebviewUrl::App("index.html".into()))
            .title("Wanderer · 服务器设置")
            .inner_size(560.0, 400.0)
            .min_inner_size(440.0, 320.0)
            .resizable(false)
            .on_navigation(move |url| navigation_allowed(&app_for_nav, url))
            .on_new_window(open_in_browser_window)
            .on_page_load(|window, _| apply_ui_scale(window.app_handle(), &window))
            .build()
            .map_err(|error| format!("failed to open server settings: {error}"))?;

    apply_ui_scale(app, &window);
    Ok(())
}
