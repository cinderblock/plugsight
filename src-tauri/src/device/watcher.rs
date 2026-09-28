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
//! 3. **IP Helper `NotifyIpInterfaceChange`** — not a device event at all,
//!    but an Ethernet cable unplug or speed renegotiation changes a network
//!    adapter's link chip without any PnP activity, and this is where that
//!    shows up.
//!
//! All sources call into the same debounced `trigger_reenumerate`, so
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
    CM_NOTIFY_ACTION, CM_NOTIFY_ACTION_DEVICEINSTANCEENUMERATED,
    CM_NOTIFY_ACTION_DEVICEINSTANCEREMOVED, CM_NOTIFY_ACTION_DEVICEINSTANCESTARTED,
    CM_NOTIFY_EVENT_DATA, CM_NOTIFY_FILTER, CM_NOTIFY_FILTER_0,
    CM_NOTIFY_FILTER_FLAG_ALL_DEVICE_INSTANCES, CM_NOTIFY_FILTER_TYPE_DEVICEINSTANCE,
    CM_Register_Notification, CR_SUCCESS, HCMNOTIFICATION,
};

use windows::Win32::Foundation::{HANDLE, NO_ERROR};
use windows::Win32::NetworkManagement::IpHelper::{
    MIB_IPINTERFACE_ROW, MIB_NOTIFICATION_TYPE, NotifyIpInterfaceChange,
};
use windows::Win32::Networking::WinSock::AF_UNSPEC;

use super::enumerator;
use super::history;
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
    let mut initial_devices = enumerator::enumerate_all_devices();
    // Square the connection history with Windows' arrival dates first, so the
    // snapshot we diff against carries the same reconnect counts the frontend
    // will be sent.
    history::with(|h| h.decorate(&mut initial_devices, history::now_ms()));
    history::save_if_dirty();
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
    if let Err(e) = register_cm_notification(app_handle.clone(), shared.clone()) {
        log::warn!(
            "CM_Register_Notification setup failed; legacy device classes may not update incrementally: {e}"
        );
    }

    // ── NotifyIpInterfaceChange ─────────────────────────────────────────
    // An Ethernet cable being unplugged, or a link renegotiating to another
    // speed, changes a network adapter's link without any PnP event. The IP
    // interface above it does change state, so that's the trigger for
    // refreshing Ethernet link chips. Non-fatal for the same reason as above.
    if let Err(e) = register_ip_interface_notification(app_handle, shared) {
        log::warn!(
            "NotifyIpInterfaceChange setup failed; Ethernet link speeds won't refresh live: {e}"
        );
    }

    Ok(())
}

/// Register for IP interface changes (connect, disconnect, parameter changes)
/// on every adapter, funnelled into the same debounced re-enumeration as the
/// PnP sources. IPv4 and IPv6 each report a change, and a renegotiation fires
/// several; the debounce folds them into one pass.
fn register_ip_interface_notification(app: AppHandle, shared: SharedState) -> Result<(), String> {
    let context = Box::new(CmCallbackContext { app, shared });
    let context_ptr = Box::into_raw(context) as *const c_void;

    let mut handle = HANDLE::default();
    let result = unsafe {
        NotifyIpInterfaceChange(
            AF_UNSPEC,
            Some(ip_interface_callback),
            Some(context_ptr),
            false,
            &mut handle,
        )
    };
    if result != NO_ERROR {
        unsafe {
            drop(Box::from_raw(context_ptr as *mut CmCallbackContext));
        }
        return Err(format!("NotifyIpInterfaceChange failed: {result:?}"));
    }

    // Like the CM registration: the handle stays registered for the app's
    // lifetime and process exit cleans it up.
    let _ = handle;
    log::info!("NotifyIpInterfaceChange registered successfully");
    Ok(())
}

/// IP interface change callback, on a system worker thread.
unsafe extern "system" fn ip_interface_callback(
    context: *const c_void,
    _row: *const MIB_IPINTERFACE_ROW,
    _notification_type: MIB_NOTIFICATION_TYPE,
) {
    if context.is_null() {
        return;
    }
    let ctx = unsafe { &*(context as *const CmCallbackContext) };
    trigger_reenumerate(ctx.app.clone(), ctx.shared.clone());
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
/// device instance lifecycle event. We act on arrival (ENUMERATED or
/// STARTED) and removal (REMOVED): record it in the connection history, and
/// schedule a debounced refresh of the list. The other actions don't change the
/// device list as observed by SetupAPI.
unsafe extern "system" fn cm_notify_callback(
    _hnotify: HCMNOTIFICATION,
    context: *const c_void,
    action: CM_NOTIFY_ACTION,
    eventdata: *const CM_NOTIFY_EVENT_DATA,
    eventdatasize: u32,
) -> u32 {
    if context.is_null() {
        return 0;
    }

    // Record the arrival or removal against the device it names, right now.
    // This is what catches a device that drops and comes back inside one
    // debounce window: the re-enumeration below would see it present both
    // before and after, and report nothing.
    let arrived = action == CM_NOTIFY_ACTION_DEVICEINSTANCEENUMERATED
        || action == CM_NOTIFY_ACTION_DEVICEINSTANCESTARTED;
    let removed = action == CM_NOTIFY_ACTION_DEVICEINSTANCEREMOVED;
    if (arrived || removed)
        && let Some(instance_id) = unsafe { notified_instance_id(eventdata, eventdatasize) }
    {
        let now = history::now_ms();
        log::debug!("PnP notification {action:?} for {instance_id}");
        history::with(|h| {
            if removed {
                h.record_removal(&instance_id, now);
            } else {
                h.record_arrival(&instance_id, now);
            }
        });
    }

    // Refresh on every arrival or removal. ENUMERATED matters on its own: a
    // device instance that comes back (seen with GhostCOM re-creating a port it
    // had removed) can arrive with ENUMERATED and no STARTED, and refreshing on
    // STARTED alone left such a device missing from the list until something
    // else happened to trigger a pass.
    if arrived || removed {
        let ctx = unsafe { &*(context as *const CmCallbackContext) };
        trigger_reenumerate(ctx.app.clone(), ctx.shared.clone());
    }

    0 // ERROR_SUCCESS
}

/// The device instance ID a `CM_NOTIFY_FILTER_TYPE_DEVICEINSTANCE` notification
/// carries: a NUL-terminated UTF-16 string at the start of the event data's
/// union, bounded by the event data size.
///
/// # Safety
/// `eventdata` must be the pointer the notification callback was given, valid
/// for `size` bytes.
unsafe fn notified_instance_id(
    eventdata: *const CM_NOTIFY_EVENT_DATA,
    size: u32,
) -> Option<String> {
    if eventdata.is_null() {
        return None;
    }
    let offset = std::mem::offset_of!(CM_NOTIFY_EVENT_DATA, u);
    let max_chars = (size as usize).checked_sub(offset)? / 2;
    let start = unsafe { (eventdata as *const u8).add(offset) as *const u16 };
    let chars = unsafe { std::slice::from_raw_parts(start, max_chars) };
    let end = chars.iter().position(|&c| c == 0).unwrap_or(chars.len());
    (end > 0).then(|| String::from_utf16_lossy(&chars[..end]))
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
    let mut new_devices = enumerator::enumerate_all_devices();
    let now = history::now_ms();
    history::with(|h| h.decorate(&mut new_devices, now));

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
            log::debug!("Emitting Added {id}");
            let event = DeviceEvent::Added {
                device: device.clone(),
            };
            let _ = app.emit(DEVICE_EVENT, &event);
        }
    }

    // Find removed devices (in old but not in new).
    for id in state.known.keys() {
        if !new_map.contains_key(id) {
            // Normally already recorded by the PnP notification; this covers a
            // missed one. A duplicate is ignored.
            history::with(|h| h.record_removal(id, now));
            log::debug!("Emitting Removed {id}");
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
    drop(state);

    history::save_if_dirty();
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
        || old.links != new.links
        || old.arrived_at != new.arrived_at
        || old.reconnects != new.reconnects
        || old.connection_events.last() != new.connection_events.last()
        || old.is_present != new.is_present
}
