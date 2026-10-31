use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Url};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppConfig {
    pub server_url: String,
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
    let path = config_path(app).ok()?;
    let content = fs::read_to_string(path).ok()?;
    let config: AppConfig = serde_json::from_str(&content).ok()?;

    normalize(&config.server_url).ok()
}

pub fn save(app: &AppHandle, server_url: &str) -> Result<(), String> {
    let path = config_path(app)?;

    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|error| format!("无法创建配置目录：{error}"))?;
    }

    let content = serde_json::to_string_pretty(&AppConfig {
        server_url: server_url.to_string(),
    })
    .map_err(|error| format!("无法序列化配置：{error}"))?;

    fs::write(&path, content).map_err(|error| format!("无法保存配置：{error}"))
}
