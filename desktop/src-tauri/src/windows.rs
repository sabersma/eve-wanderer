use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use crate::AppState;

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

    WebviewWindowBuilder::new(app, "main", url)
        .title(title)
        .inner_size(1360.0, 860.0)
        .min_inner_size(960.0, 640.0)
        .on_navigation(move |url| navigation_allowed(&app_for_nav, url))
        .on_new_window(open_in_browser_window)
        .build()
        .map(|_| ())
        .map_err(|error| format!("failed to open main window: {error}"))
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
            .map_err(|error| format!("failed to open server: {error}"))
    } else {
        ensure_main(app)
    }
}

pub fn open_widget(app: &AppHandle, map_slug: &str, widget: &str) -> Result<(), String> {
    let (width, height) = match widget {
        "signatures" => (380.0, 560.0),
        "kills" => (720.0, 460.0),
        "characters" => (340.0, 460.0),
        "jspace" => (360.0, 420.0),
        "bookmarks" => (440.0, 560.0),
        _ => return Err(format!("unsupported widget: {widget}")),
    };

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

    WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title(format!("Wanderer · {widget}"))
        .inner_size(width, height)
        .min_inner_size(260.0, 220.0)
        .on_navigation(move |url| navigation_allowed(&app_for_nav, url))
        .on_new_window(open_in_browser_window)
        .build()
        .map(|_| ())
        .map_err(|error| format!("failed to open {widget} window: {error}"))
}

/// Opens the server-address form in its own window so the current map keeps
/// working until the user saves a new address.
pub fn open_server_settings(app: &AppHandle) -> Result<(), String> {
    if focus_existing(app, "server-settings") {
        return Ok(());
    }

    let app_for_nav = app.clone();

    WebviewWindowBuilder::new(app, "server-settings", WebviewUrl::App("index.html".into()))
        .title("Wanderer · 服务器设置")
        .inner_size(560.0, 400.0)
        .min_inner_size(440.0, 320.0)
        .resizable(false)
        .on_navigation(move |url| navigation_allowed(&app_for_nav, url))
        .on_new_window(open_in_browser_window)
        .build()
        .map(|_| ())
        .map_err(|error| format!("failed to open server settings: {error}"))
}
