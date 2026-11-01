use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

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
    /// Map slug the main window opens on launch, so a client started with
    /// Windows (or left running untouched) lands on its map and starts syncing
    /// instead of stopping at the map chooser.
    #[serde(default)]
    pub default_map: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            ui_scale: DEFAULT_UI_SCALE,
            window_sizes: HashMap::new(),
            widget_opacity: DEFAULT_WIDGET_OPACITY,
            widget_always_on_top: HashMap::new(),
            default_map: None,
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

/// Path segments that only ever belong to the app itself. Anything from the
/// first match onward is a route, not part of a subpath deployment.
const ROUTE_SEGMENTS: &[&str] = &[
    "desktop",
    "tracking",
    "maps",
    "characters",
    "profile",
    "admin",
    "sponsors",
    "help",
    "access-lists",
    "coming-soon",
    "news",
    "changelog",
    "license",
    "contacts",
];

const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// A base URL confirmed (or best-guessed) from what the user typed.
pub struct ServerBase {
    pub base: String,
    /// True when the server itself confirmed the base path. False means the
    /// value came from the offline guess and may need a correction later.
    pub verified: bool,
}

impl ServerBase {
    fn unverified(base: String) -> Self {
        Self {
            base,
            verified: false,
        }
    }
}

/// Candidate base paths derived from the entered URL, longest first, ending
/// with the origin. `<base>/wanderer/map-1` yields `/wanderer/map-1`,
/// `/wanderer`, and the origin, so the longest prefix the server answers for
/// wins and a subpath deployment is not truncated to its host.
fn candidate_bases(url: &Url) -> Vec<String> {
    let origin = url.origin().ascii_serialization();
    let mut segments: Vec<String> = url
        .path_segments()
        .map(|segments| segments.map(str::to_string).collect())
        .unwrap_or_default();

    while segments.last().is_some_and(|segment| segment.is_empty()) {
        segments.pop();
    }

    // Built shortest-first, then reversed, so the longest prefix is probed
    // before the origin for a subpath deployment.
    let mut bases: Vec<String> = vec![origin.clone()];
    let mut path = String::new();

    for segment in &segments {
        path.push('/');
        path.push_str(segment);
        bases.push(format!("{origin}{path}"));
    }

    bases.reverse();
    bases
}

/// Resolves the base URL of the server the user typed. A map address such as
/// `https://example.com/wanderer/my-map` is accepted: every path prefix is
/// probed against the public release manifest (then against the desktop
/// entry point, for servers older than the manifest), and the longest one that
/// answers becomes the base. When the server cannot be reached the value is
/// guessed from the path shape and marked unverified.
pub async fn resolve_base(input: &str) -> Result<ServerBase, String> {
    let url = Url::parse(input).map_err(|error| format!("地址格式不正确：{error}"))?;

    if url.path().trim_matches('/').is_empty() {
        return Ok(ServerBase {
            base: input.to_string(),
            verified: true,
        });
    }

    let bases = candidate_bases(&url);
    let client = reqwest::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("WandererDesktop/", env!("CARGO_PKG_VERSION")))
        .build();

    if let Ok(client) = client {
        if let Some(base) = probe_all(&client, &bases).await {
            return Ok(ServerBase {
                base,
                verified: true,
            });
        }
    }

    Ok(ServerBase::unverified(heuristic_base(&url)))
}

/// Returns the longest base that answers, or `None` when nothing does. Every
/// candidate shares one host, so a connection failure on the first candidate
/// means the rest would time out identically: stop instead of stalling the
/// settings page for four timeouts.
async fn probe_all(client: &reqwest::Client, bases: &[String]) -> Option<String> {
    let mut saw_response = false;

    for base in bases {
        match probe_manifest(client, base).await {
            Probe::Hit => return Some(base.clone()),
            Probe::Miss => saw_response = true,
            Probe::Unreachable => return None,
        }
    }

    // Older servers predate `/desktop/update.json`; the desktop entry point is
    // enough to tell a subpath deployment from a route on a root deployment.
    if saw_response {
        for base in bases {
            match probe_desktop(client, base).await {
                Probe::Hit => return Some(base.clone()),
                Probe::Miss => {}
                Probe::Unreachable => return None,
            }
        }
    }

    None
}

enum Probe {
    Hit,
    Miss,
    Unreachable,
}

async fn probe_manifest(client: &reqwest::Client, base: &str) -> Probe {
    let url = format!("{base}/desktop/update.json");

    let response = match client.get(url.as_str()).send().await {
        Ok(response) => response,
        // A timeout or DNS/TLS failure is a property of the host, not the path.
        Err(_) => return Probe::Unreachable,
    };

    if !response.status().is_success() {
        return Probe::Miss;
    }

    let body = response.text().await.unwrap_or_default();

    match serde_json::from_str::<serde_json::Value>(&body) {
        Ok(value) if value.get("latest").is_some() => Probe::Hit,
        _ => Probe::Miss,
    }
}

async fn probe_desktop(client: &reqwest::Client, base: &str) -> Probe {
    let url = format!("{base}/desktop");

    match client.get(url.as_str()).send().await {
        Ok(response) if response.status().is_success() || response.status().is_redirection() => {
            Probe::Hit
        }
        Ok(_) => Probe::Miss,
        Err(_) => Probe::Unreachable,
    }
}

/// Best guess when the server cannot be asked. A known route marks where the
/// base ends; otherwise a multi-segment path is treated as `<base>/<map>`,
/// while a single segment is kept as-is because it is more likely a deployment
/// subpath than a map slug.
fn heuristic_base(url: &Url) -> String {
    let origin = url.origin().ascii_serialization();
    let segments: Vec<&str> = url
        .path_segments()
        .map(|segments| segments.filter(|segment| !segment.is_empty()).collect())
        .unwrap_or_default();

    if let Some(index) = segments
        .iter()
        .position(|segment| ROUTE_SEGMENTS.contains(segment))
    {
        let prefix = segments[..index].join("/");

        return if prefix.is_empty() {
            origin
        } else {
            format!("{origin}/{prefix}")
        };
    }

    if segments.len() >= 2 {
        return format!("{origin}/{}", segments[..segments.len() - 1].join("/"));
    }

    if segments.is_empty() {
        origin
    } else {
        format!("{origin}/{}", segments[0])
    }
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

/// Map slugs are generated as `[a-z0-9-]`; the value is interpolated into a
/// URL path, so anything else is rejected rather than sent to the WebView.
fn is_valid_map_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 80
        && slug
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub fn default_map(app: &AppHandle) -> Option<String> {
    read(app)
        .ok()
        .flatten()
        .and_then(|config| config.default_map)
        .map(|slug| slug.trim().to_string())
        .filter(|slug| is_valid_map_slug(slug))
}

pub fn save_default_map(app: &AppHandle, slug: Option<&str>) -> Result<(), String> {
    let slug = slug.map(str::trim).filter(|slug| !slug.is_empty());

    if let Some(slug) = slug {
        if !is_valid_map_slug(slug) {
            return Err("地图标识不正确".to_string());
        }
    }

    update(app, |config| config.default_map = slug.map(str::to_string))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn bases(input: &str) -> Vec<String> {
        candidate_bases(&Url::parse(input).unwrap())
    }

    fn heuristic(input: &str) -> String {
        heuristic_base(&Url::parse(input).unwrap())
    }

    #[test]
    fn candidates_are_longest_first_and_end_with_the_origin() {
        assert_eq!(
            bases("https://example.com/wanderer/my-map"),
            vec![
                "https://example.com/wanderer/my-map".to_string(),
                "https://example.com/wanderer".to_string(),
                "https://example.com".to_string(),
            ]
        );
    }

    #[test]
    fn candidates_ignore_a_trailing_slash() {
        assert_eq!(
            bases("https://example.com/wanderer/"),
            vec![
                "https://example.com/wanderer".to_string(),
                "https://example.com".to_string(),
            ]
        );
    }

    #[test]
    fn a_bare_origin_has_one_candidate() {
        assert_eq!(bases("https://example.com"), vec!["https://example.com"]);
    }

    #[test]
    fn heuristic_keeps_the_subpath_before_a_known_route() {
        assert_eq!(
            heuristic("https://example.com/wanderer/desktop/my-map"),
            "https://example.com/wanderer"
        );
        assert_eq!(
            heuristic("https://example.com/desktop/my-map"),
            "https://example.com"
        );
    }

    #[test]
    fn heuristic_treats_a_two_segment_path_as_base_and_slug() {
        assert_eq!(
            heuristic("https://example.com/wanderer/my-map"),
            "https://example.com/wanderer"
        );
    }

    #[test]
    fn heuristic_keeps_a_single_segment_as_a_subpath_deployment() {
        assert_eq!(
            heuristic("https://example.com/wanderer"),
            "https://example.com/wanderer"
        );
    }

    #[test]
    fn map_slugs_are_restricted_to_path_safe_characters() {
        assert!(is_valid_map_slug("my-map_1"));
        assert!(!is_valid_map_slug(""));
        assert!(!is_valid_map_slug("../admin"));
        assert!(!is_valid_map_slug("a/b"));
        assert!(!is_valid_map_slug(&"a".repeat(81)));
    }
}
