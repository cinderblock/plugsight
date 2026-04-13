//! Real-time device change notifications via WinRT DeviceWatcher.
//!
//! Spawns a background thread that uses `DeviceInformation::CreateWatcher()` to receive
//! incremental Added / Removed / Updated / EnumerationCompleted events, then forwards them
//! to the Tauri frontend as typed events.

use std::sync::{Arc, Mutex};
use std::collections::HashMap;

use tauri::{AppHandle, Emitter};
use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationUpdate, DeviceWatcher};
use windows::Foundation::TypedEventHandler;

use super::enumerator;
use super::types::{DeviceEvent, DeviceInfo, InstanceId};

/// The event name used for all device change events sent to the frontend.
pub const DEVICE_EVENT: &str = "device-event";

/// Shared state for tracking known devices (so we can emit proper Removed events with data).
type DeviceMap = Arc<Mutex<HashMap<InstanceId, DeviceInfo>>>;

/// Start the device watcher. Call this once from the Tauri `setup` hook.
///
/// The watcher runs for the lifetime of the application. It emits `DeviceEvent` payloads
/// to the frontend via `app_handle.emit(DEVICE_EVENT, ...)`.
pub fn start_watcher(app_handle: AppHandle) -> Result<(), String> {
    let watcher = DeviceInformation::CreateWatcher()
        .map_err(|e| format!("Failed to create DeviceWatcher: {e}"))?;

    let known_devices: DeviceMap = Arc::new(Mutex::new(HashMap::new()));

    // ── Added ───────────────────────────────────────────────────────────
    {
        let app = app_handle.clone();
        let known = known_devices.clone();

        watcher
            .Added(&TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(
                move |_watcher, info| {
                    if let Some(info) = info {
                        let id = info.Id().map(|s| s.to_string_lossy()).unwrap_or_default();

                        // Enrich with SetupAPI properties (WinRT DeviceInformation has limited data).
                        if let Some(device) = enumerator::get_device_by_instance_id(&id) {
                            if let Ok(mut map) = known.lock() {
                                map.insert(device.instance_id.clone(), device.clone());
                            }
                            let event = DeviceEvent::Added { device };
                            let _ = app.emit(DEVICE_EVENT, &event);
                        }
                    }
                    Ok(())
                },
            ))
            .map_err(|e| format!("Failed to register Added handler: {e}"))?;
    }

    // ── Removed ─────────────────────────────────────────────────────────
    {
        let app = app_handle.clone();
        let known = known_devices.clone();

        watcher
            .Removed(&TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(
                move |_watcher, update| {
                    if let Some(update) = update {
                        let id = update.Id().map(|s| s.to_string_lossy()).unwrap_or_default();
                        if !id.is_empty() {
                            if let Ok(mut map) = known.lock() {
                                map.remove(&id);
                            }
                            let event = DeviceEvent::Removed {
                                instance_id: id,
                            };
                            let _ = app.emit(DEVICE_EVENT, &event);
                        }
                    }
                    Ok(())
                },
            ))
            .map_err(|e| format!("Failed to register Removed handler: {e}"))?;
    }

    // ── Updated ─────────────────────────────────────────────────────────
    {
        let app = app_handle.clone();
        let known = known_devices.clone();

        watcher
            .Updated(&TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(
                move |_watcher, update| {
                    if let Some(update) = update {
                        let id = update.Id().map(|s| s.to_string_lossy()).unwrap_or_default();
                        if !id.is_empty() {
                            // Re-query the device's full properties.
                            if let Some(device) = enumerator::get_device_by_instance_id(&id) {
                                if let Ok(mut map) = known.lock() {
                                    map.insert(device.instance_id.clone(), device.clone());
                                }
                                let event = DeviceEvent::Updated { device };
                                let _ = app.emit(DEVICE_EVENT, &event);
                            }
                        }
                    }
                    Ok(())
                },
            ))
            .map_err(|e| format!("Failed to register Updated handler: {e}"))?;
    }

    // ── EnumerationCompleted ────────────────────────────────────────────
    {
        let app = app_handle.clone();

        watcher
            .EnumerationCompleted(&TypedEventHandler::<DeviceWatcher, windows::core::IInspectable>::new(
                move |_watcher, _| {
                    log::info!("Device enumeration completed");
                    let event = DeviceEvent::EnumerationComplete;
                    let _ = app.emit(DEVICE_EVENT, &event);
                    Ok(())
                },
            ))
            .map_err(|e| format!("Failed to register EnumerationCompleted handler: {e}"))?;
    }

    // ── Start the watcher ───────────────────────────────────────────────
    watcher
        .Start()
        .map_err(|e| format!("Failed to start DeviceWatcher: {e}"))?;

    log::info!("DeviceWatcher started successfully");

    // Keep the watcher alive by leaking it — it runs for the app's lifetime.
    // In a more sophisticated setup you'd store it in app state and stop it on exit.
    std::mem::forget(watcher);

    Ok(())
}
