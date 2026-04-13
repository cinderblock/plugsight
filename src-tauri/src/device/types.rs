use serde::{Deserialize, Serialize};

/// Unique, stable identifier for a device (the PnP instance ID).
pub type InstanceId = String;

/// Represents a single device in the system.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// PnP device instance ID — the stable unique key.
    pub instance_id: InstanceId,
    /// Human-readable name (DEVPKEY_Device_FriendlyName or fallback to DeviceDesc).
    pub name: String,
    /// Device description (DEVPKEY_Device_DeviceDesc).
    pub description: String,
    /// Manufacturer string.
    pub manufacturer: String,
    /// Setup class display name (e.g. "Display adapters").
    pub class_name: String,
    /// Setup class GUID as a string (e.g. "{4d36e968-e325-11ce-bfc1-08002be10318}").
    pub class_guid: String,
    /// Driver version string, if available.
    pub driver_version: String,
    /// Current device status.
    pub status: DeviceStatus,
    /// CM_PROB_* problem code. 0 means no problem.
    pub problem_code: u32,
    /// Hardware ID strings for identification.
    pub hardware_ids: Vec<String>,
    /// Instance ID of the parent device.
    pub parent_id: String,
    /// Whether this device is currently present (connected).
    pub is_present: bool,
}

/// The operational status of a device.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DeviceStatus {
    /// Device is working properly.
    Ok,
    /// Device has a warning (non-fatal problem).
    Warning {
        code: u32,
        message: String,
    },
    /// Device has an error (not functioning).
    Error {
        code: u32,
        message: String,
    },
    /// Device has been disabled by the user.
    Disabled,
    /// No driver is installed for this device.
    DriverNotInstalled,
    /// Status could not be determined.
    Unknown,
}

/// An incremental change event emitted from the backend to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DeviceEvent {
    /// A device was newly discovered or plugged in.
    Added { device: DeviceInfo },
    /// A device was removed / unplugged.
    Removed { instance_id: InstanceId },
    /// A device's properties changed (e.g. driver update, status change).
    Updated { device: DeviceInfo },
    /// The initial enumeration pass has completed.
    EnumerationComplete,
}

/// Metadata about a device setup class (category).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassMeta {
    /// The class GUID string.
    pub guid: String,
    /// Human-readable class name.
    pub name: String,
    /// Icon identifier for the frontend to use.
    pub icon_id: String,
}
