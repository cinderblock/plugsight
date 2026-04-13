//! Full device enumeration via Win32 SetupAPI.
//!
//! Provides functions to enumerate all devices (or a single device by instance ID)
//! and return fully-populated `DeviceInfo` structs.

use windows::Win32::Devices::DeviceAndDriverInstallation::*;
use windows::core::PCWSTR;

use super::properties;
use super::types::DeviceInfo;

/// Enumerate all present devices in the system.
///
/// Calls `SetupDiGetClassDevsW` with `DIGCF_ALLCLASSES | DIGCF_PRESENT` and iterates
/// through every device information element.
pub fn enumerate_all_devices() -> Vec<DeviceInfo> {
    let mut devices = Vec::new();

    unsafe {
        let dev_info_set = SetupDiGetClassDevsW(
            None,
            PCWSTR::null(),
            None,
            DIGCF_ALLCLASSES | DIGCF_PRESENT,
        );

        let dev_info_set = match dev_info_set {
            Ok(h) => h,
            Err(e) => {
                log::error!("SetupDiGetClassDevsW failed: {e}");
                return devices;
            }
        };

        let mut index: u32 = 0;
        loop {
            let mut dev_info_data = SP_DEVINFO_DATA {
                cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32,
                ..Default::default()
            };

            let result = SetupDiEnumDeviceInfo(dev_info_set, index, &mut dev_info_data);
            if result.is_err() {
                // ERROR_NO_MORE_ITEMS — enumeration complete.
                break;
            }

            if let Some(device) = build_device_info(dev_info_set, &dev_info_data) {
                devices.push(device);
            }

            index += 1;
        }

        let _ = SetupDiDestroyDeviceInfoList(dev_info_set);
    }

    log::info!("Enumerated {} devices", devices.len());
    devices
}

/// Look up a single device by its PnP instance ID and return its properties.
///
/// Uses `SetupDiCreateDeviceInfoList` + `SetupDiOpenDeviceInfoW` which is the
/// correct way to open a specific device by instance ID (as opposed to passing
/// the ID as the "Enumerator" parameter to `SetupDiGetClassDevsW`, which expects
/// enumerator names like "USB" or "PCI").
pub fn get_device_by_instance_id(instance_id: &str) -> Option<DeviceInfo> {
    let wide_id: Vec<u16> = instance_id.encode_utf16().chain(std::iter::once(0)).collect();

    unsafe {
        // Create an empty device info set (not filtered by class).
        let dev_info_set = SetupDiCreateDeviceInfoList(None, None);
        let dev_info_set = match dev_info_set {
            Ok(h) => h,
            Err(_) => return None,
        };

        let mut dev_info_data = SP_DEVINFO_DATA {
            cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32,
            ..Default::default()
        };

        // Open the specific device by instance ID into the info set.
        let result = SetupDiOpenDeviceInfoW(
            dev_info_set,
            PCWSTR(wide_id.as_ptr()),
            None,
            0,
            Some(&mut dev_info_data),
        );

        let device = if result.is_ok() {
            build_device_info(dev_info_set, &dev_info_data)
        } else {
            None
        };

        let _ = SetupDiDestroyDeviceInfoList(dev_info_set);
        device
    }
}

/// Build a `DeviceInfo` from a SetupAPI device info set and device data.
fn build_device_info(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> Option<DeviceInfo> {
    let instance_id = properties::get_instance_id(dev_info, dev_data);
    if instance_id.is_empty() {
        return None;
    }

    let description = properties::get_device_desc(dev_info, dev_data);
    let friendly_name = properties::get_friendly_name(dev_info, dev_data);
    let name = friendly_name.unwrap_or_else(|| description.clone());
    let manufacturer = properties::get_manufacturer(dev_info, dev_data);
    let class_name = properties::get_class_name(dev_info, dev_data);
    let class_guid = properties::get_class_guid(dev_info, dev_data);
    let driver_version = properties::get_driver_version(dev_info, dev_data);
    let hardware_ids = properties::get_hardware_ids(dev_info, dev_data);
    let parent_id = properties::get_parent_id(dev_info, dev_data);
    let (status, problem_code) = properties::derive_device_status(dev_info, dev_data);

    Some(DeviceInfo {
        instance_id,
        name,
        description,
        manufacturer,
        class_name,
        class_guid,
        driver_version,
        status,
        problem_code,
        hardware_ids,
        parent_id,
        is_present: true,
    })
}
