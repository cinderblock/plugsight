//! Real-time device change notifications via two complementary sources, plus
//! SetupAPI diffing.
//!
//! Two notification sources, both used purely as "something changed" triggers:
//!
//! 1. **WinRT `DeviceWatcher`** — watches device *interface* changes
//!    (`DeviceInformationKind::DeviceInterface`, the default). Catches USB,
//!    HID, audio, network, etc.
//!
//! 2. **Win32 `CM_Register_Notification`** with
//!    `CM_NOTIFY_FILTER_FLAG_ALL_DEVICE_INSTANCES` — watches every PnP device
//!    *node* arrival/removal regardless of class. This is the catch-all that
//!    covers legacy classes like `Ports (COM & LPT)` which don't reliably
//!    surface as WinRT device-interface events.
//!
//! Both sources call into the same debounced `trigger_reenumerate`, so
//! duplicate notifications for the same physical event coalesce into one
//! re-enumeration. Neither source's IDs are usable with SetupAPI directly,
//! so we always re-enumerate via SetupAPI and diff against the last known
//! state to emit proper Added/Removed/Updated events with correct PnP
//! instance IDs and full device properties.
//!
//! Pipeline:
//! 1. On app startup, the frontend calls `stream_initial_devices()` for the
//!    initial enumeration.
//! 2. The two watchers run in the background listening for any change event.
//! 3. When any event fires, we debounce (300ms), re-enumerate all devices
//!    via SetupAPI, and diff to emit the right events.

use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationUpdate, DeviceWatcher};
use windows::Foundation::TypedEventHandler;
use windows::Win32::Devices::DeviceAndDriverInstallation::{
    CM_NOTIFY_ACTION, CM_NOTIFY_ACTION_DEVICEINSTANCEREMOVED,
    CM_NOTIFY_ACTION_DEVICEINSTANCESTARTED, CM_NOTIFY_EVENT_DATA, CM_NOTIFY_FILTER,
    CM_NOTIFY_FILTER_0, CM_NOTIFY_FILTER_FLAG_ALL_DEVICE_INSTANCES,
    CM_NOTIFY_FILTER_TYPE_DEVICEINSTANCE, CM_Register_Notification, CR_SUCCESS, HCMNOTIFICATION,
};

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

/// Published handle to the watcher's shared state, so commands (e.g. the manual
/// "Scan for hardware changes" button) can force a synchronous re-enumeration
/// that bypasses the debounce. Set once during `start_watcher`.
static SHARED_STATE: OnceLock<SharedState> = OnceLock::new();

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

    // Publish the shared state so command-layer code (e.g. manual rescans) can
    // force a synchronous re-enumeration. `set` only fails if already set, which
    // would mean start_watcher was called twice — harmless to ignore.
    let _ = SHARED_STATE.set(shared.clone());

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
            .Removed(
                &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(
                    move |_watcher, _update| {
                        trigger();
                        Ok(())
                    },
                ),
            )
            .map_err(|e| format!("Failed to register Removed handler: {e}"))?;
    }

    // ── Updated ─────────────────────────────────────────────────────────
    {
        let trigger = make_trigger(app_handle.clone(), shared.clone());
        watcher
            .Updated(
                &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(
                    move |_watcher, _update| {
                        trigger();
                        Ok(())
                    },
                ),
            )
            .map_err(|e| format!("Failed to register Updated handler: {e}"))?;
    }

    // ── EnumerationCompleted ────────────────────────────────────────────
    {
        let app = app_handle.clone();
        watcher
            .EnumerationCompleted(&TypedEventHandler::<
                DeviceWatcher,
                windows::core::IInspectable,
            >::new(move |_watcher, _| {
                log::info!("DeviceWatcher initial enumeration completed");
                // Signal the frontend that the watcher is live and monitoring.
                let _ = app.emit(DEVICE_EVENT, &DeviceEvent::EnumerationComplete);
                Ok(())
            }))
            .map_err(|e| format!("Failed to register EnumerationCompleted handler: {e}"))?;
    }

    // ── Start ───────────────────────────────────────────────────────────
    watcher
        .Start()
        .map_err(|e| format!("Failed to start DeviceWatcher: {e}"))?;

    log::info!("DeviceWatcher started successfully");

    // Keep the watcher alive for the app's lifetime.
    std::mem::forget(watcher);

    // ── CM_Register_Notification ────────────────────────────────────────
    // Catches PnP node changes for legacy classes (e.g. Ports/COM) that the
    // WinRT DeviceWatcher misses. Failure here is non-fatal — the WinRT
    // watcher still covers the common cases — so we log and continue.
    if let Err(e) = register_cm_notification(app_handle, shared) {
        log::warn!(
            "CM_Register_Notification setup failed; legacy device classes may not update incrementally: {e}"
        );
    }

    Ok(())
}

/// Context passed to the CM notification callback. Boxed and intentionally
/// leaked so it lives for the app lifetime (matches the `mem::forget` pattern
/// used for the WinRT watcher and the CM notification handle itself).
struct CmCallbackContext {
    app: AppHandle,
    shared: SharedState,
}

/// Register a Win32 PnP notification that fires for *every* device instance
/// arrival/removal across the system. Funnels into the same debounced
/// re-enumeration as the WinRT watcher.
fn register_cm_notification(app: AppHandle, shared: SharedState) -> Result<(), String> {
    let context = Box::new(CmCallbackContext { app, shared });
    let context_ptr = Box::into_raw(context) as *const c_void;

    // ALL_DEVICE_INSTANCES flag means the InstanceId field of the union is
    // ignored — we get notified about every device node in the system.
    let filter = CM_NOTIFY_FILTER {
        cbSize: std::mem::size_of::<CM_NOTIFY_FILTER>() as u32,
        Flags: CM_NOTIFY_FILTER_FLAG_ALL_DEVICE_INSTANCES,
        FilterType: CM_NOTIFY_FILTER_TYPE_DEVICEINSTANCE,
        Reserved: 0,
        u: CM_NOTIFY_FILTER_0::default(),
    };

    let mut handle = HCMNOTIFICATION::default();
    let result = unsafe {
        CM_Register_Notification(
            &filter,
            Some(context_ptr),
            Some(cm_notify_callback),
            &mut handle,
        )
    };

    if result != CR_SUCCESS {
        // Reclaim the leaked context so we don't leak on the error path.
        unsafe {
            drop(Box::from_raw(context_ptr as *mut CmCallbackContext));
        }
        return Err(format!("CM_Register_Notification failed: {result:?}"));
    }

    // The OS holds the registration; `HCMNOTIFICATION` is a `Copy` raw
    // pointer with no `Drop`, so letting `handle` go out of scope leaves
    // the registration live for the app's lifetime. We never need to call
    // `CM_Unregister_Notification` — process exit cleans it up.
    let _ = handle;

    log::info!("CM_Register_Notification (ALL_DEVICE_INSTANCES) registered successfully");
    Ok(())
}

/// PnP notification callback. Invoked from a Windows worker thread for every
/// device instance lifecycle event. We only care about arrival/removal —
/// the other actions (ENUMERATED for existing devices, QUERY_REMOVE etc.)
/// don't change the device list as observed by SetupAPI.
unsafe extern "system" fn cm_notify_callback(
    _hnotify: HCMNOTIFICATION,
    context: *const c_void,
    action: CM_NOTIFY_ACTION,
    _eventdata: *const CM_NOTIFY_EVENT_DATA,
    _eventdatasize: u32,
) -> u32 {
    if context.is_null() {
        return 0;
    }

    if action == CM_NOTIFY_ACTION_DEVICEINSTANCESTARTED
        || action == CM_NOTIFY_ACTION_DEVICEINSTANCEREMOVED
    {
        let ctx = unsafe { &*(context as *const CmCallbackContext) };
        trigger_reenumerate(ctx.app.clone(), ctx.shared.clone());
    }

    0 // ERROR_SUCCESS
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
        if let Some(old_device) = state.known.get(id)
            && device_changed(old_device, new_device)
        {
            let event = DeviceEvent::Updated {
                device: new_device.clone(),
            };
            let _ = app.emit(DEVICE_EVENT, &event);
        }
    }

    // Replace the known state with the new snapshot.
    state.known = new_map;
}

/// Force an immediate synchronous re-enumeration + diff, bypassing the debounce.
///
/// Used by the manual "Scan for hardware changes" command so a user-triggered
/// rescan responds right away rather than waiting for the next DeviceWatcher
/// event to fire and then waiting out the debounce window. Any devices that
/// differ from the known snapshot surface as normal Added/Removed/Updated
/// events — so ghost handling on the frontend continues to work correctly.
pub fn force_reenumerate_and_diff(app: &AppHandle) -> Result<(), String> {
    let shared = SHARED_STATE
        .get()
        .ok_or_else(|| "DeviceWatcher not initialized yet".to_string())?;
    do_reenumerate_and_diff(app, shared);
    Ok(())
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
