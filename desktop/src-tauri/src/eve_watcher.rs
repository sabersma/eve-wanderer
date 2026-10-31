use serde::Serialize;
use tauri::AppHandle;

/// Raw foreground-window information sent to the React bridge. The title is
/// matched against map characters in JS; Rust never opens EVE logs or files.
#[derive(Clone, Debug, Serialize)]
pub struct EveForeground {
    pub title: String,
    pub process: String,
    pub hwnd: i64,
    pub at: u64,
}

#[cfg(target_os = "windows")]
static APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

#[cfg(target_os = "windows")]
pub fn start(app: AppHandle) {
    let _ = APP_HANDLE.set(app);

    // SetWinEventHook with WINEVENT_OUTOFCONTEXT queues events to the thread
    // that installed the hook, so this thread also runs a message loop.
    let _ = std::thread::Builder::new()
        .name("wanderer-eve-watcher".to_string())
        .spawn(|| unsafe { imp::run() });
}

#[cfg(not(target_os = "windows"))]
pub fn start(_app: AppHandle) {}

#[cfg(target_os = "windows")]
fn emit(eve: EveForeground) {
    use tauri::Manager;

    let Some(app) = APP_HANDLE.get().cloned() else {
        return;
    };

    let app_for_task = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(state) = app_for_task.try_state::<crate::AppState>() {
            if let Ok(mut last_eve) = state.last_eve.lock() {
                *last_eve = Some(eve.clone());
            }
        }

        let Ok(payload) = serde_json::to_string(&eve) else {
            return;
        };
        let script =
            format!("window.__wandererDesktop && window.__wandererDesktop.onActiveEve({payload});");

        for window in app_for_task.webview_windows().values() {
            let _ = window.eval(&script);
        }
    });
}

#[cfg(target_os = "windows")]
mod imp {
    use std::time::{SystemTime, UNIX_EPOCH};

    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, MAX_PATH};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, TranslateMessage, EVENT_SYSTEM_FOREGROUND, MSG,
        WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
    };

    use super::{emit, EveForeground};

    const EVE_PROCESS: &str = "exefile.exe";

    unsafe extern "system" fn win_event_proc(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        _id_object: i32,
        _id_child: i32,
        _event_thread: u32,
        _event_time: u32,
    ) {
        if event != EVENT_SYSTEM_FOREGROUND || hwnd.0.is_null() {
            return;
        }

        let Some(process) = process_name(hwnd) else {
            return;
        };
        if !process.eq_ignore_ascii_case(EVE_PROCESS) {
            return;
        }

        let title = window_title(hwnd);
        if title.trim().is_empty() {
            return;
        }

        emit(EveForeground {
            title,
            process,
            hwnd: hwnd.0 as i64,
            at: now_ms(),
        });
    }

    unsafe fn process_name(hwnd: HWND) -> Option<String> {
        let mut process_id: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id as *mut u32));
        if process_id == 0 {
            return None;
        }

        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, BOOL(0), process_id).ok()?;

        let mut buffer = [0u16; MAX_PATH as usize];
        let mut size = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        result.ok()?;

        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        let name = path.rsplit(['\\', '/']).next()?.to_string();
        Some(name)
    }

    unsafe fn window_title(hwnd: HWND) -> String {
        let length = GetWindowTextLengthW(hwnd);
        if length <= 0 {
            return String::new();
        }

        let mut buffer = vec![0u16; length as usize + 1];
        let copied = GetWindowTextW(hwnd, &mut buffer);
        if copied <= 0 {
            return String::new();
        }

        String::from_utf16_lossy(&buffer[..copied as usize])
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0)
    }

    pub unsafe fn run() {
        let _hook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(win_event_proc),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );

        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}
