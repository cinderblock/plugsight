//! Safe wrappers around SetupAPI device property extraction.
//!
//! Each function queries a specific DEVPKEY from a device information set
//! and returns a Rust-friendly type.

use windows::Win32::Devices::DeviceAndDriverInstallation::*;
use windows::Win32::Devices::Properties::*;
use windows::core::GUID;

use super::types::DeviceStatus;

// ── DEVPKEY GUIDs and PIDs ──────────────────────────────────────────────
// These are defined in devpkey.h. The `windows` crate exposes some, but
// not all, so we define them manually for reliability.

const DEVPKEY_DEVICE_CATEGORY: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 2, // DEVPKEY_Device_DeviceDesc
};

const DEVPKEY_DEVICE_FRIENDLY_NAME: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 14,
};

const DEVPKEY_DEVICE_MANUFACTURER: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 13,
};

const DEVPKEY_DEVICE_CLASS: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 9,
};

const DEVPKEY_DEVICE_CLASS_GUID: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 10,
};

// The driver version key lives in a different FMTID from the other device properties.
const DEVPKEY_DEVICE_DRIVER_VERSION: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0xa8b865dd_2e3d_4094_ad97_e593a70c75d6),
    pid: 3,
};

const DEVPKEY_DEVICE_INSTANCE_ID: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0x78c34fc8_104a_4aca_9ea4_524d52996e57),
    pid: 256,
};

const DEVPKEY_DEVICE_HARDWARE_IDS: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 3,
};

const DEVPKEY_DEVICE_PARENT: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0x4340a6c5_93fa_4706_972c_7b648008a5a7),
    pid: 8,
};

const DEVPKEY_DEVICE_PROBLEM_CODE: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0x4340a6c5_93fa_4706_972c_7b648008a5a7),
    pid: 3,
};

const DEVPKEY_DEVICE_DEVNODE_STATUS: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0x4340a6c5_93fa_4706_972c_7b648008a5a7),
    pid: 2,
};

// DEVPROP_TYPE constants
const DEVPROP_TYPE_STRING: u32 = 0x00000012;
const DEVPROP_TYPE_STRING_LIST: u32 = 0x00002012;
const DEVPROP_TYPE_UINT32: u32 = 0x00000007;
const DEVPROP_TYPE_GUID: u32 = 0x0000000D;

// DN_* status flags
const DN_HAS_PROBLEM: u32 = 0x00000400;
const DN_STARTED: u32 = 0x00000008;

// ── Property reading helpers ────────────────────────────────────────────

/// Read a string property from a device. Returns None if the property is absent.
pub fn get_string_property(
    dev_info: HDEVINFO,
    dev_data: &SP_DEVINFO_DATA,
    key: &DEVPROPKEY,
) -> Option<String> {
    unsafe {
        let mut prop_type: DEVPROPTYPE = DEVPROPTYPE(0);
        let mut required_size: u32 = 0;

        // First call: get required buffer size.
        let _ = SetupDiGetDevicePropertyW(
            dev_info,
            dev_data,
            key,
            &mut prop_type,
            None,
            Some(&mut required_size),
            0,
        );

        if required_size == 0 {
            return None;
        }

        let mut buffer = vec![0u8; required_size as usize];

        let result = SetupDiGetDevicePropertyW(
            dev_info,
            dev_data,
            key,
            &mut prop_type,
            Some(&mut buffer),
            Some(&mut required_size),
            0,
        );

        if result.is_err() {
            return None;
        }

        if prop_type.0 != DEVPROP_TYPE_STRING {
            return None;
        }

        // Buffer is UTF-16LE, null-terminated.
        let wide: &[u16] =
            std::slice::from_raw_parts(buffer.as_ptr() as *const u16, buffer.len() / 2);

        // Trim trailing null.
        let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
        Some(String::from_utf16_lossy(&wide[..len]))
    }
}

/// Read a multi-string (REG_MULTI_SZ) property. Returns a Vec of strings.
pub fn get_string_list_property(
    dev_info: HDEVINFO,
    dev_data: &SP_DEVINFO_DATA,
    key: &DEVPROPKEY,
) -> Vec<String> {
    unsafe {
        let mut prop_type: DEVPROPTYPE = DEVPROPTYPE(0);
        let mut required_size: u32 = 0;

        let _ = SetupDiGetDevicePropertyW(
            dev_info,
            dev_data,
            key,
            &mut prop_type,
            None,
            Some(&mut required_size),
            0,
        );

        if required_size == 0 {
            return Vec::new();
        }

        let mut buffer = vec![0u8; required_size as usize];

        let result = SetupDiGetDevicePropertyW(
            dev_info,
            dev_data,
            key,
            &mut prop_type,
            Some(&mut buffer),
            Some(&mut required_size),
            0,
        );

        if result.is_err() || prop_type.0 != DEVPROP_TYPE_STRING_LIST {
            return Vec::new();
        }

        // Multi-string: each string null-terminated, final string double-null-terminated.
        let wide: &[u16] =
            std::slice::from_raw_parts(buffer.as_ptr() as *const u16, buffer.len() / 2);

        let mut strings = Vec::new();
        let mut start = 0;
        for (i, &ch) in wide.iter().enumerate() {
            if ch == 0 {
                if i > start {
                    strings.push(String::from_utf16_lossy(&wide[start..i]));
                }
                start = i + 1;
            }
        }
        strings
    }
}

/// Read a u32 property.
pub fn get_u32_property(
    dev_info: HDEVINFO,
    dev_data: &SP_DEVINFO_DATA,
    key: &DEVPROPKEY,
) -> Option<u32> {
    unsafe {
        let mut prop_type: DEVPROPTYPE = DEVPROPTYPE(0);
        let mut buffer = [0u8; 4];
        let mut required_size: u32 = 0;

        let result = SetupDiGetDevicePropertyW(
            dev_info,
            dev_data,
            key,
            &mut prop_type,
            Some(&mut buffer),
            Some(&mut required_size),
            0,
        );

        if result.is_err() || prop_type.0 != DEVPROP_TYPE_UINT32 {
            return None;
        }

        Some(u32::from_le_bytes(buffer))
    }
}

/// Read a GUID property and return it as a string.
pub fn get_guid_property(
    dev_info: HDEVINFO,
    dev_data: &SP_DEVINFO_DATA,
    key: &DEVPROPKEY,
) -> Option<String> {
    unsafe {
        let mut prop_type: DEVPROPTYPE = DEVPROPTYPE(0);
        let mut buffer = [0u8; 16];
        let mut required_size: u32 = 0;

        let result = SetupDiGetDevicePropertyW(
            dev_info,
            dev_data,
            key,
            &mut prop_type,
            Some(&mut buffer),
            Some(&mut required_size),
            0,
        );

        if result.is_err() || prop_type.0 != DEVPROP_TYPE_GUID {
            return None;
        }

        // GUID is stored as { u32 LE, u16 LE, u16 LE, [u8; 8] }.
        let data1 = u32::from_le_bytes([buffer[0], buffer[1], buffer[2], buffer[3]]);
        let data2 = u16::from_le_bytes([buffer[4], buffer[5]]);
        let data3 = u16::from_le_bytes([buffer[6], buffer[7]]);
        let data4: [u8; 8] = buffer[8..16].try_into().unwrap();
        let _guid = GUID::from_values(data1, data2, data3, data4);
        Some(format!(
            "{{{:08x}-{:04x}-{:04x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}}}",
            data1, data2, data3,
            data4[0], data4[1], data4[2], data4[3],
            data4[4], data4[5], data4[6], data4[7],
        ))
    }
}

// ── High-level device property accessors ────────────────────────────────

pub fn get_device_desc(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> String {
    get_string_property(dev_info, dev_data, &DEVPKEY_DEVICE_CATEGORY)
        .unwrap_or_else(|| "(Unknown device)".to_string())
}

pub fn get_friendly_name(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> Option<String> {
    get_string_property(dev_info, dev_data, &DEVPKEY_DEVICE_FRIENDLY_NAME)
}

pub fn get_manufacturer(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> String {
    get_string_property(dev_info, dev_data, &DEVPKEY_DEVICE_MANUFACTURER)
        .unwrap_or_else(|| "(Unknown)".to_string())
}

pub fn get_class_name(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> String {
    get_string_property(dev_info, dev_data, &DEVPKEY_DEVICE_CLASS)
        .unwrap_or_else(|| "Other devices".to_string())
}

pub fn get_class_guid(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> String {
    get_guid_property(dev_info, dev_data, &DEVPKEY_DEVICE_CLASS_GUID)
        .or_else(|| get_string_property(dev_info, dev_data, &DEVPKEY_DEVICE_CLASS_GUID))
        .unwrap_or_default()
}

pub fn get_driver_version(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> String {
    get_string_property(dev_info, dev_data, &DEVPKEY_DEVICE_DRIVER_VERSION)
        .unwrap_or_default()
}

pub fn get_instance_id(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> String {
    get_string_property(dev_info, dev_data, &DEVPKEY_DEVICE_INSTANCE_ID)
        .unwrap_or_default()
}

pub fn get_hardware_ids(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> Vec<String> {
    get_string_list_property(dev_info, dev_data, &DEVPKEY_DEVICE_HARDWARE_IDS)
}

pub fn get_parent_id(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> String {
    get_string_property(dev_info, dev_data, &DEVPKEY_DEVICE_PARENT)
        .unwrap_or_default()
}

pub fn get_problem_code(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> u32 {
    get_u32_property(dev_info, dev_data, &DEVPKEY_DEVICE_PROBLEM_CODE).unwrap_or(0)
}

pub fn get_devnode_status(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> u32 {
    get_u32_property(dev_info, dev_data, &DEVPKEY_DEVICE_DEVNODE_STATUS).unwrap_or(0)
}

/// Derive a high-level DeviceStatus from the devnode status flags and problem code.
pub fn derive_device_status(
    dev_info: HDEVINFO,
    dev_data: &SP_DEVINFO_DATA,
) -> (DeviceStatus, u32) {
    let status_flags = get_devnode_status(dev_info, dev_data);
    let problem_code = get_problem_code(dev_info, dev_data);

    let status = if problem_code == 0 && (status_flags & DN_STARTED) != 0 {
        DeviceStatus::Ok
    } else if problem_code == 22 {
        // CM_PROB_DISABLED
        DeviceStatus::Disabled
    } else if problem_code == 28 {
        // CM_PROB_FAILED_INSTALL (no driver)
        DeviceStatus::DriverNotInstalled
    } else if problem_code != 0 && (status_flags & DN_HAS_PROBLEM) != 0 {
        DeviceStatus::Error {
            code: problem_code,
            message: problem_code_to_message(problem_code),
        }
    } else if problem_code != 0 {
        DeviceStatus::Warning {
            code: problem_code,
            message: problem_code_to_message(problem_code),
        }
    } else {
        // Not started but no problem code — might be a non-startable device (e.g. legacy).
        DeviceStatus::Ok
    };

    (status, problem_code)
}

/// Map well-known CM_PROB_* codes to human-readable messages.
fn problem_code_to_message(code: u32) -> String {
    match code {
        1 => "Device is not configured correctly.".into(),
        3 => "The driver for this device might be corrupted.".into(),
        9 => "Windows cannot identify this hardware.".into(),
        10 => "This device cannot start.".into(),
        12 => "This device cannot find enough free resources.".into(),
        14 => "This device cannot work properly until you restart your computer.".into(),
        16 => "Windows cannot identify all the resources this device uses.".into(),
        18 => "Reinstall the drivers for this device.".into(),
        19 => "Windows cannot start this hardware device (registry problem).".into(),
        21 => "Windows is removing this device.".into(),
        22 => "This device is disabled.".into(),
        24 => "This device is not present or was not recognized.".into(),
        28 => "The drivers for this device are not installed.".into(),
        29 => "This device is disabled (firmware did not give it resources).".into(),
        31 => "This device is not working properly (Windows cannot load required drivers).".into(),
        32 => "A driver for this device was not required and has been disabled.".into(),
        33 => "Windows cannot determine which resources are required.".into(),
        34 => "Windows cannot determine the settings for this device.".into(),
        35 => "The system firmware does not have enough information to configure this device.".into(),
        36 => "This device is requesting a PCI interrupt.".into(),
        37 => "Windows cannot initialize the device driver.".into(),
        38 => "Windows cannot load the device driver (already loaded in memory).".into(),
        39 => "Windows cannot load the device driver (corrupted or missing).".into(),
        40 => "Windows cannot access this hardware (service key missing or invalid).".into(),
        41 => "Windows successfully loaded the device driver but cannot find the hardware.".into(),
        42 => "A duplicate device was detected.".into(),
        43 => "Windows has stopped this device because it has reported problems.".into(),
        44 => "An application or service has shut down this hardware device.".into(),
        45 => "Currently, this hardware device is not connected to the computer.".into(),
        46 => "Windows cannot gain access to this hardware device (OS is shutting down).".into(),
        47 => "Windows cannot use this device (prepared for safe removal).".into(),
        48 => "The software for this device has been blocked.".into(),
        49 => "Windows cannot start new hardware devices (system hive too large).".into(),
        50 => "Windows cannot apply all properties for this device.".into(),
        51 => "This device is currently waiting on another device.".into(),
        52 => "Windows cannot verify the digital signature for the drivers.".into(),
        53 => "This device has been reserved for use by the Windows kernel debugger.".into(),
        54 => "This device has failed and is undergoing a reset.".into(),
        _ => format!("Unknown problem (code {code})."),
    }
}
