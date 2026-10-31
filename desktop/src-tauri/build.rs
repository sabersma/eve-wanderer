fn main() {
    // The map pages are served from the remote Wanderer server, so every IPC
    // call arrives from a remote origin. Tauri only lets remote origins reach
    // custom commands that are declared in the app ACL manifest, and the
    // generated `allow-*` permissions must also be listed in the capability.
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "desktop_ready",
            "get_server_url",
            "set_server_url",
            "open_server_settings",
            "open_widget",
            "open_main",
            "close_self",
            "set_always_on_top",
            "set_window_title",
            "set_widget_opacity",
            "zoom_in",
            "zoom_out",
            "zoom_reset",
        ]));

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
