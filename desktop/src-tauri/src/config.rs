use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Url};

/// Every write rewrites the same small JSON file (`ui_scale` changes and window
/// geometry saves can overlap), so read-modify-write cycles are serialized.
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

pub const DEFAULT_UI_SCALE: f64 = 1.0;
pub const MIN_UI_SCALE: f64 = 0.5;
pub const MAX_UI_SCALE: f64 = 2.0;

/// Whole-window opacity of the detached widget windows. 1.0 is fully opaque;
/// 0.3 keeps the widgets readable while letting the game show through.
pub const DEFAULT_WIDGET_OPACITY: f64 = 1.0;
pub const MIN_WIDGET_OPACITY: f64 = 0.3;
pub const MAX_WIDGET_OPACITY: f64 = 1.0;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppConfig {
    pub server_url: String,
    /// WebView2 zoom factor applied to every window. Persisted so a new window
    /// opens with the same UI size the user chose.
    #[serde(default = "default_ui_scale")]
    pub ui_scale: f64,
    /// Last size/position of each widget window, keyed by widget id
    /// (`signatures`, `jspace`, `bookmarks`, `kills`, `characters`).
    #[serde(default)]
    pub window_sizes: HashMap<String, SavedWindow>,
    /// Whole-window opacity for the detached widget windows (0.3–1.0). Applied
    /// by the OS through `WS_EX_LAYERED`, so a reopened widget starts at the
    /// opacity the user last chose instead of flashing fully opaque.
    #[serde(default = "default_widget_opacity")]
    pub widget_opacity: f64,
    /// Last always-on-top choice per widget id. It is a per-window flag, so a
    /// widget window reopened later should not silently drop the pin the user
    /// had chosen for it.
    #[serde(default)]
    pub widget_always_on_top: HashMap<String, bool>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            ui_scale: DEFAULT_UI_SCALE,
            window_sizes: HashMap::new(),
            widget_opacity: DEFAULT_WIDGET_OPACITY,
            widget_always_on_top: HashMap::new(),
        }
    }
}

/// Window geometry in **physical** pixels. Physical values keep the intent when
/// the window reopens on a monitor with a different scale factor: the restore
/// path converts them back to logical pixels using the target monitor's scale.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SavedWindow {
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
}

fn default_ui_scale() -> f64 {
    DEFAULT_UI_SCALE
}

fn default_widget_opacity() -> f64 {
    DEFAULT_WIDGET_OPACITY
}

pub fn clamp_widget_opacity(value: f64) -> f64 {
    if !value.is_finite() {
        return DEFAULT_WIDGET_OPACITY;
    }
    value.clamp(MIN_WIDGET_OPACITY, MAX_WIDGET_OPACITY)
}

pub fn clamp_ui_scale(scale: f64) -> f64 {
    if !scale.is_finite() {
        return DEFAULT_UI_SCALE;
    }
    scale.clamp(MIN_UI_SCALE, MAX_UI_SCALE)
}

/// Steps by 10% and rounds to two decimals so repeated `+ 0.1` does not drift
/// into 1.0000000000000002 and render as 99%.
pub fn stepped_ui_scale(current: f64, delta: f64) -> f64 {
    clamp_ui_scale(((current + delta) * 100.0).round() / 100.0)
}

/// Where the chosen server is remembered. On Windows this is
/// `%APPDATA%\<identifier>\config.json`, so it survives reinstalls of the app
/// but stays per Windows user.
fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("无法定位配置目录：{error}"))?;

    Ok(dir.join("config.json"))
}

/// Distinguishes "no config yet" from "config is broken": a corrupt file must
/// not be silently replaced (that would drop the saved server address).
fn read(app: &AppHandle) -> Result<Option<AppConfig>, String> {
    let path = config_path(app)?;

    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content)
            .map(Some)
            .map_err(|error| format!("配置文件格式不正确：{error}")),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法读取配置：{error}")),
    }
}

fn write(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;

    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|error| format!("无法创建配置目录：{error}"))?;
    }

    let content =
        serde_json::to_string_pretty(config).map_err(|error| format!("无法序列化配置：{error}"))?;

    fs::write(&path, content).map_err(|error| format!("无法保存配置：{error}"))
}

fn update<F: FnOnce(&mut AppConfig)>(app: &AppHandle, mutate: F) -> Result<(), String> {
    let _guard = CONFIG_LOCK.lock().map_err(|_| "配置锁已损坏".to_string())?;

    let mut config = read(app)?.unwrap_or_default();
    mutate(&mut config);
    config.ui_scale = clamp_ui_scale(config.ui_scale);
    config.widget_opacity = clamp_widget_opacity(config.widget_opacity);
    write(app, &config)
}

/// Accepts `example.com`, `https://example.com/`, or a path-prefixed deployment
/// such as `https://example.com/wanderer/` and returns a normalized base URL
/// without a trailing slash.
pub fn normalize(input: &str) -> Result<String, String> {
    let raw = input.trim();
    if raw.is_empty() {
        return Err("请输入服务器地址".to_string());
    }

    let candidate = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };

    let url = Url::parse(&candidate).map_err(|error| format!("地址格式不正确：{error}"))?;

    if !url.username().is_empty() || url.password().is_some() {
        return Err("地址不能包含用户名或密码".to_string());
    }

    match url.scheme() {
        "https" => {}
        // Plain HTTP is only accepted for local development; a remote server
        // must be HTTPS for the SSO cookie and the Tauri IPC allowlist.
        "http" if is_local_host(&url) => {}
        _ => return Err("请使用 https 地址（本机开发可用 http://localhost）".to_string()),
    }

    if url.host_str().is_none() {
        return Err("地址缺少主机名".to_string());
    }

    if url.query().is_some() || url.fragment().is_some() {
        return Err("地址不能包含查询参数或 # 片段".to_string());
    }

    let mut base = url.to_string();
    while base.ends_with('/') {
        base.pop();
    }

    Ok(base)
}

fn is_local_host(url: &Url) -> bool {
    matches!(
        url.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("[::1]") | Some("::1")
    )
}

/// Runtime `WANDERER_SERVER_URL` wins so `tauri dev` can point anywhere without
/// touching the saved user configuration. Release builds normally have no such
/// variable and fall back to the value the user entered on first launch.
pub fn resolve_initial(app: &AppHandle) -> Option<String> {
    if let Ok(value) = std::env::var("WANDERER_SERVER_URL") {
        if let Ok(normalized) = normalize(&value) {
            return Some(normalized);
        }
        eprintln!("[wanderer] ignoring invalid WANDERER_SERVER_URL={value:?}");
    }

    load(app)
}

pub fn load(app: &AppHandle) -> Option<String> {
    read(app)
        .ok()
        .flatten()
        .and_then(|config| normalize(&config.server_url).ok())
}

pub fn save(app: &AppHandle, server_url: &str) -> Result<(), String> {
    update(app, |config| config.server_url = server_url.to_string())
}

pub fn ui_scale(app: &AppHandle) -> f64 {
    read(app)
        .ok()
        .flatten()
        .map(|config| clamp_ui_scale(config.ui_scale))
        .unwrap_or(DEFAULT_UI_SCALE)
}

pub fn save_ui_scale(app: &AppHandle, scale: f64) -> Result<(), String> {
    update(app, |config| config.ui_scale = scale)
}

pub fn saved_window(app: &AppHandle, key: &str) -> Option<SavedWindow> {
    read(app).ok().flatten()?.window_sizes.get(key).cloned()
}

pub fn save_window(app: &AppHandle, key: &str, geometry: SavedWindow) -> Result<(), String> {
    update(app, |config| {
        config.window_sizes.insert(key.to_string(), geometry);
    })
}

pub fn widget_opacity(app: &AppHandle) -> f64 {
    read(app)
        .ok()
        .flatten()
        .map(|config| clamp_widget_opacity(config.widget_opacity))
        .unwrap_or(DEFAULT_WIDGET_OPACITY)
}

pub fn save_widget_opacity(app: &AppHandle, opacity: f64) -> Result<(), String> {
    update(app, |config| config.widget_opacity = opacity)
}

pub fn widget_always_on_top(app: &AppHandle, widget: &str) -> bool {
    read(app)
        .ok()
        .flatten()
        .and_then(|config| config.widget_always_on_top.get(widget).copied())
        .unwrap_or(false)
}

pub fn save_widget_always_on_top(app: &AppHandle, widget: &str, value: bool) -> Result<(), String> {
    update(app, |config| {
        config
            .widget_always_on_top
            .insert(widget.to_string(), value);
    })
}
