//! Real-time device change notifications via WinRT DeviceWatcher + SetupAPI diffing.
//!
//! The WinRT DeviceWatcher notifies us that *something* changed in the device tree.
//! However, it returns device *interface* IDs (not PnP instance IDs), so we can't use
//! them directly with SetupAPI. Instead, we use the watcher purely as a trigger:
//!
//! 1. On app startup, the frontend calls `get_all_devices()` for the initial enumeration.
//! 2. The DeviceWatcher runs in the background listening for any change event.
//! 3. When any event fires, we debounce (200ms), re-enumerate all devices via SetupAPI,
//!    and diff against the last known state to emit proper Added/Removed/Updated events
//!    with correct PnP instance IDs and full device properties.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationUpdate, DeviceWatcher};
use windows::Foundation::TypedEventHandler;

use super::enumerator;
use super::types::{DeviceEvent, DeviceInfo, InstanceId};

/// The event name used for all device change events sent to the frontend.
pub const DEVICE_EVENT: &str = "device-event";

/// Minimum time between re-enumerations when rapid events arrive.
const DEBOUNCE_MS: u64 = 300;

/// Shared state: the last known device snapshot and a debounce timestamp.
struct WatcherState {
    /// Last known devices keyed by instance ID.
    known: HashMap<InstanceId, DeviceInfo>,
    /// Timestamp of the last re-enumeration (for debouncing).
    last_enum: Instant,
    /// Whether a re-enumeration is already pending on another thread.
    pending: bool,
}

type SharedState = Arc<Mutex<WatcherState>>;

/// Start the device watcher. Call this once from the Tauri `setup` hook.
///
/// The watcher runs for the lifetime of the application. It emits `DeviceEvent` payloads
/// to the frontend via `app_handle.emit(DEVICE_EVENT, ...)`.
pub fn start_watcher(app_handle: AppHandle) -> Result<(), String> {
    let watcher = DeviceInformation::CreateWatcher()
        .map_err(|e| format!("Failed to create DeviceWatcher: {e}"))?;

    // Build the initial snapshot so we can diff against it.
    // The frontend triggers the initial streaming enumeration via a command
    // (after it has subscribed to events), so we just build the known map here.
    let initial_devices = enumerator::enumerate_all_devices();
    let mut known_map = HashMap::new();
    for device in initial_devices {
        known_map.insert(device.instance_id.clone(), device);
    }

    let shared: SharedState = Arc::new(Mutex::new(WatcherState {
        known: known_map,
        last_enum: Instant::now(),
        pending: false,
    }));

    // All four event handlers do the same thing: trigger a debounced re-enumeration + diff.
    // We don't try to interpret the WinRT IDs at all.

    let make_trigger = |app: AppHandle, state: SharedState| {
        move || {
            trigger_reenumerate(app.clone(), state.clone());
        }
    };

    // ── Added ───────────────────────────────────────────────────────────
    {
        let trigger = make_trigger(app_handle.clone(), shared.clone());
        watcher
            .Added(&TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(
                move |_watcher, _info| {
                    trigger();
                    Ok(())
                },
            ))
            .map_err(|e| format!("Failed to register Added handler: {e}"))?;
    }

    // ── Removed ─────────────────────────────────────────────────────────
    {
        let trigger = make_trigger(app_handle.clone(), shared.clone());
        watcher
            .Removed(&TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(
                move |_watcher, _update| {
                    trigger();
                    Ok(())
                },
            ))
            .map_err(|e| format!("Failed to register Removed handler: {e}"))?;
    }

    // ── Updated ─────────────────────────────────────────────────────────
    {
        let trigger = make_trigger(app_handle.clone(), shared.clone());
        watcher
            .Updated(&TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(
                move |_watcher, _update| {
                    trigger();
                    Ok(())
                },
            ))
            .map_err(|e| format!("Failed to register Updated handler: {e}"))?;
    }

    // ── EnumerationCompleted ────────────────────────────────────────────
    {
        let app = app_handle.clone();
        watcher
            .EnumerationCompleted(
                &TypedEventHandler::<DeviceWatcher, windows::core::IInspectable>::new(
                    move |_watcher, _| {
                        log::info!("DeviceWatcher initial enumeration completed");
                        // Signal the frontend that the watcher is live and monitoring.
                        let _ = app.emit(DEVICE_EVENT, &DeviceEvent::EnumerationComplete);
                        Ok(())
                    },
                ),
            )
            .map_err(|e| format!("Failed to register EnumerationCompleted handler: {e}"))?;
    }

    // ── Start ───────────────────────────────────────────────────────────
    watcher
        .Start()
        .map_err(|e| format!("Failed to start DeviceWatcher: {e}"))?;

    log::info!("DeviceWatcher started successfully");

    // Keep the watcher alive for the app's lifetime.
    std::mem::forget(watcher);

    Ok(())
}

/// Debounced re-enumeration: when a DeviceWatcher event fires, wait a short time
/// for more events to settle, then re-enumerate and diff.
fn trigger_reenumerate(app: AppHandle, shared: SharedState) {
    let should_schedule = {
        let mut state = match shared.lock() {
            Ok(s) => s,
            Err(_) => return,
        };

        if state.pending {
            // Another re-enumeration is already scheduled.
            return;
        }

        let elapsed = state.last_enum.elapsed();
        if elapsed < Duration::from_millis(DEBOUNCE_MS) {
            // Too soon — schedule a delayed re-enumeration.
            state.pending = true;
            true
        } else {
            // Enough time has passed — enumerate immediately.
            false
        }
    };

    if should_schedule {
        let app2 = app.clone();
        let shared2 = shared.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(DEBOUNCE_MS));
            do_reenumerate_and_diff(&app2, &shared2);
            if let Ok(mut state) = shared2.lock() {
                state.pending = false;
            }
        });
    } else {
        do_reenumerate_and_diff(&app, &shared);
    }
}

/// Re-enumerate all devices via SetupAPI, diff against the known state,
/// and emit Added/Removed/Updated events for anything that changed.
fn do_reenumerate_and_diff(app: &AppHandle, shared: &SharedState) {
    let new_devices = enumerator::enumerate_all_devices();

    let mut new_map: HashMap<InstanceId, DeviceInfo> = HashMap::new();
    for device in new_devices {
        new_map.insert(device.instance_id.clone(), device);
    }

    let mut state = match shared.lock() {
        Ok(s) => s,
        Err(_) => return,
    };

    state.last_enum = Instant::now();

    // Find added devices (in new but not in old).
    for (id, device) in &new_map {
        if !state.known.contains_key(id) {
            let event = DeviceEvent::Added {
                device: device.clone(),
            };
            let _ = app.emit(DEVICE_EVENT, &event);
        }
    }

    // Find removed devices (in old but not in new).
    for id in state.known.keys() {
        if !new_map.contains_key(id) {
            let event = DeviceEvent::Removed {
                instance_id: id.clone(),
            };
            let _ = app.emit(DEVICE_EVENT, &event);
        }
    }

    // Find updated devices (in both, but properties changed).
    for (id, new_device) in &new_map {
        if let Some(old_device) = state.known.get(id) {
            if device_changed(old_device, new_device) {
                let event = DeviceEvent::Updated {
                    device: new_device.clone(),
                };
                let _ = app.emit(DEVICE_EVENT, &event);
            }
        }
    }

    // Replace the known state with the new snapshot.
    state.known = new_map;
}

/// Check if any meaningful device properties have changed.
fn device_changed(old: &DeviceInfo, new: &DeviceInfo) -> bool {
    old.name != new.name
        || old.status != new.status
        || old.problem_code != new.problem_code
        || old.driver_version != new.driver_version
        || old.manufacturer != new.manufacturer
        || old.class_name != new.class_name
        || old.is_present != new.is_present
}
