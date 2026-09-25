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
    /// Setup class display name (e.g. "Display adapters"). Resolved via
    /// `class_meta::lookup_class` from the GUID, with the SetupAPI class name
    /// used as a fallback when the GUID isn't in our known table.
    pub class_name: String,
    /// Setup class GUID as a string (e.g. "{4d36e968-e325-11ce-bfc1-08002be10318}").
    pub class_guid: String,
    /// Semantic icon identifier (e.g. "display", "network") that the frontend
    /// maps to its SVG icon set. Resolved via `class_meta::lookup_class`;
    /// falls back to "other" for unknown class GUIDs.
    pub icon_id: String,
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
    /// Serial/parallel port name (e.g. "COM5", "LPT1") for devices in the
    /// Ports (COM & LPT) class; `None` for everything else.
    pub port_name: Option<String>,
    /// Speed of the device's upstream link (USB hub port or PCIe link), when
    /// the bus has such a notion and Windows reports it; `None` otherwise.
    pub link: Option<LinkInfo>,
    /// Whether this device is currently present (connected).
    pub is_present: bool,
}

/// What a device's upstream link is running at, and what it could run at.
///
/// The backend reports facts; the frontend decides how to word them and
/// whether the gap between actual and capable is worth flagging.
// `rename_all` on the enum only renames the variants; each struct variant
// needs its own so the fields come out camelCase too.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "bus", rename_all = "camelCase")]
pub enum LinkInfo {
    /// A USB device's connection to its hub port.
    #[serde(rename_all = "camelCase")]
    Usb {
        /// Speed the port negotiated with the device.
        speed: UsbSpeed,
        /// Fastest speed the device advertises. Equal to `speed` unless the
        /// device is running below what it can do.
        capable: UsbSpeed,
        /// Whether the hub port itself carries USB 3 (SuperSpeed) signalling.
        /// A SuperSpeed-capable device on a `false` port is slow because of the
        /// port, not the cable or the device.
        port_usb3: bool,
        /// Something is also connected on this port's SuperSpeed companion
        /// port. Windows enumerates a USB 3 hub as two logical hubs — a USB 2
        /// one and a USB 3 one — on a connector's paired ports, so this is the
        /// USB 2 half of a hub whose USB 3 half is its own row, not a hub that
        /// fell back to USB 2.
        companion_connected: bool,
    },
    /// A PCI Express endpoint's link to its upstream port.
    #[serde(rename_all = "camelCase")]
    Pcie {
        /// Current link generation (1 = 2.5 GT/s, 2 = 5, 3 = 8, 4 = 16, 5 = 32, 6 = 64).
        generation: u32,
        /// Current lane count.
        width: u32,
        /// Highest generation the device supports.
        max_generation: u32,
        /// Widest link the device supports.
        max_width: u32,
    },
}

/// USB signalling rates, slowest to fastest.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum UsbSpeed {
    /// 1.5 Mbit/s (USB 1.x low-speed).
    Low,
    /// 12 Mbit/s (USB 1.x full-speed).
    Full,
    /// 480 Mbit/s (USB 2.0 high-speed).
    High,
    /// 5 Gbit/s (USB 3.x SuperSpeed).
    Super,
    /// 10 Gbit/s (USB 3.1+ SuperSpeedPlus).
    SuperPlus,
}

/// The operational status of a device.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DeviceStatus {
    /// Device is working properly.
    Ok,
    /// Device has a warning (non-fatal problem).
    Warning { code: u32, message: String },
    /// Device has an error (not functioning).
    Error { code: u32, message: String },
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
