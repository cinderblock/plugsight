//! Tauri commands exposed to the frontend via `invoke()`.

use std::collections::HashMap;

use crate::device::class_icons;
use crate::device::class_meta;
use crate::device::enumerator;
use crate::device::types::{ClassMeta, DeviceInfo};

/// Return all currently present devices.
///
/// This is used as a fallback / manual refresh. Normally, the frontend receives
/// devices incrementally via the DeviceWatcher event stream.
#[tauri::command]
pub fn get_all_devices() -> Result<Vec<DeviceInfo>, String> {
    Ok(enumerator::enumerate_all_devices())
}

/// Stream the initial device enumeration to the frontend as individual Added events.
///
/// Call this after subscribing to device events so the UI populates progressively.
/// Each device is emitted as it's discovered rather than waiting for the full list.
#[tauri::command]
pub fn stream_initial_devices(app: tauri::AppHandle) -> Result<(), String> {
    use crate::device::types::DeviceEvent;
    use tauri::Emitter;

    let devices = enumerator::enumerate_all_devices();
    for device in devices {
        let _ = app.emit("device-event", &DeviceEvent::Added { device });
    }
    let _ = app.emit("device-event", &DeviceEvent::EnumerationComplete);
    Ok(())
}

/// Get detailed info for a single device by instance ID.
#[tauri::command]
pub fn get_device_detail(instance_id: String) -> Result<Option<DeviceInfo>, String> {
    Ok(enumerator::get_device_by_instance_id(&instance_id))
}

/// Return metadata for all known device setup classes.
#[tauri::command]
pub fn get_class_metadata() -> Result<Vec<ClassMeta>, String> {
    Ok(class_meta::all_known_classes())
}

/// Return real Windows icons for the given device class GUIDs.
///
/// Returns a map of GUID → `data:image/png;base64,...` data URL strings.
/// Icons are cached in-process after first extraction.
#[tauri::command]
pub fn get_class_icons(class_guids: Vec<String>) -> Result<HashMap<String, String>, String> {
    Ok(class_icons::get_class_icons_batch(&class_guids))
}

/// Open the native Windows device properties dialog for a device.
///
/// Uses `rundll32.exe devmgr.dll,DeviceProperties_RunDLL` which is the same
/// mechanism the built-in Device Manager uses internally.
#[tauri::command]
pub fn open_device_properties(instance_id: String) -> Result<(), String> {
    use std::process::Command;

    Command::new("rundll32.exe")
        .arg("devmgr.dll,DeviceProperties_RunDLL")
        .arg("/DeviceID")
        .arg(&instance_id)
        .spawn()
        .map_err(|e| format!("Failed to open device properties: {e}"))?;

    Ok(())
}

/// Trigger a hardware scan (equivalent to "Scan for hardware changes" in the Windows Device Manager).
#[tauri::command]
pub fn scan_for_hardware_changes() -> Result<(), String> {
    // This uses CM_Reenumerate_DevNode on the root device node.
    // The DeviceWatcher will pick up any changes automatically.
    unsafe {
        use windows::Win32::Devices::DeviceAndDriverInstallation::*;

        let mut dev_inst: u32 = 0;
        let result = CM_Locate_DevNodeW(&mut dev_inst, None, CM_LOCATE_DEVNODE_NORMAL);
        if result != CONFIGRET(0) {
            return Err(format!("CM_Locate_DevNodeW failed: {result:?}"));
        }

        let result = CM_Reenumerate_DevNode(dev_inst, CM_REENUMERATE_NORMAL);
        if result != CONFIGRET(0) {
            return Err(format!("CM_Reenumerate_DevNode failed: {result:?}"));
        }
    }

    log::info!("Hardware scan triggered");
    Ok(())
}
