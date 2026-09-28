mod commands;
mod device;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_all_devices,
            commands::get_device_detail,
            commands::get_class_metadata,
            commands::get_class_icons,
            commands::stream_initial_devices,
            commands::scan_for_hardware_changes,
            commands::open_device_properties,
            commands::system_boot_time,
        ])
        .setup(|app| {
            // Load the connection history before the first enumeration reads it.
            use tauri::Manager;
            match app.path().app_data_dir() {
                Ok(dir) => device::history::init(&dir),
                Err(e) => log::warn!("No app data dir; connection history won't persist: {e}"),
            }

            // Start the real-time device watcher on a background thread.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = device::watcher::start_watcher(app_handle) {
                    log::error!("Failed to start device watcher: {e}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
