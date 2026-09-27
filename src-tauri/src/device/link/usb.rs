//! USB: the speed a device negotiated with its hub port.
//!
//! - USB devices know nothing about their own speed; their *hub* does. We
//!   open the parent hub's `GUID_DEVINTERFACE_USB_HUB` interface and ask it
//!   about the port the device sits on (`DEVPKEY_Device_Address`), the same
//!   way USBView does. `IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX` gives
//!   the negotiated speed up to SuperSpeed; the `_V2` variant adds the
//!   SuperSpeed / SuperSpeedPlus operating and capable flags, plus whether the
//!   port itself is wired for USB 3.
//!
//!   One wrinkle: Windows enumerates a USB 3 hub as *two* logical hubs, a
//!   USB 2 one and a USB 3 one, each on one of the connector's paired ports.
//!   The USB 2 half advertises SuperSpeed while running at 480 Mbps, which
//!   looks exactly like a hub that fell back to USB 2. To tell them apart we
//!   find the port's SuperSpeed companion (hub + port) and check whether
//!   anything is connected there. Something there means the USB 3 half is up
//!   and this row is just its USB 2 shadow; nothing there means the hub really
//!   is running slow.
//!
//!   The hub driver names the companion directly through
//!   `IOCTL_USB_GET_PORT_CONNECTOR_PROPERTIES` for some ports (root hubs, the
//!   Realtek hubs seen so far) but not others (Genesys hubs, internal ports).
//!   For those we work it out ourselves: a hub's two halves number their ports
//!   the same, so the companion of (hub2, port) is (twin of hub2, port), and
//!   the twin of hub2 is whatever hub sits on the companion of hub2's *own*
//!   upstream port. That walks up until a hub does report a companion, or
//!   until the root hub, whose upstream is a PCI controller and not a hub.
//!
//! Composite-device functions (`USB\...&MI_xx`) have the composite device as
//! their parent, not a hub, so the hub lookup finds nothing and they report no
//! link. That's intended: the link belongs to the physical device's row.

use std::collections::HashMap;
use std::ffi::c_void;

use windows::Win32::Devices::DeviceAndDriverInstallation::{
    CM_Get_DevNode_PropertyW, CM_Get_Device_ID_Size, CM_Get_Device_IDW,
    CM_Get_Device_Interface_PropertyW, CM_Get_Parent, CM_LOCATE_DEVNODE_NORMAL, CM_Locate_DevNodeW,
    CR_SUCCESS, HDEVINFO, SP_DEVINFO_DATA,
};
use windows::Win32::Devices::Properties::{DEVPROPKEY, DEVPROPTYPE};
use windows::Win32::Devices::Usb::{
    DeviceConnected, GUID_DEVINTERFACE_USB_HUB, IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX,
    IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX_V2, IOCTL_USB_GET_NODE_CONNECTION_NAME,
    IOCTL_USB_GET_PORT_CONNECTOR_PROPERTIES, USB_NODE_CONNECTION_INFORMATION_EX,
    USB_NODE_CONNECTION_INFORMATION_EX_V2, USB_NODE_CONNECTION_INFORMATION_EX_V2_FLAGS,
    USB_PIPE_INFO, USB_PROTOCOLS, UsbFullSpeed, UsbHighSpeed, UsbLowSpeed, UsbSuperSpeed,
};
use windows::Win32::Foundation::{CloseHandle, GENERIC_WRITE, HANDLE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::IO::DeviceIoControl;
use windows::core::{GUID, PCWSTR};

use super::super::properties::get_u32_property;
use super::super::types::{LinkInfo, UsbSpeed};

/// Bus-specific address; for USB devices, the hub port number (1-based).
const DEVPKEY_DEVICE_ADDRESS: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 30,
};

const DEVPROP_TYPE_UINT32: u32 = 0x0000_0007;

// ── USB_PROTOCOLS / USB_NODE_CONNECTION_INFORMATION_EX_V2_FLAGS bits ─────
// (usbioctl.h bitfields; the windows crate exposes them as a raw `ul`.)

const USB_PROTOCOL_USB300: u32 = 1 << 2;

const FLAG_OPERATING_AT_SUPER_SPEED_OR_HIGHER: u32 = 1 << 0;
const FLAG_SUPER_SPEED_CAPABLE_OR_HIGHER: u32 = 1 << 1;
const FLAG_OPERATING_AT_SUPER_SPEED_PLUS_OR_HIGHER: u32 = 1 << 2;
const FLAG_SUPER_SPEED_PLUS_CAPABLE_OR_HIGHER: u32 = 1 << 3;

/// How far up the hub chain the twin search will walk before giving up.
/// USB allows at most 5 tiers of hubs below the root.
const MAX_TWIN_DEPTH: u8 = 8;

/// Opens USB hubs on demand and keeps them open for the life of the probe,
/// so one enumeration pass opens each hub once rather than once per child.
/// Non-hub parents (composite devices) are remembered as `None` so they're
/// not looked up again either.
pub(super) struct HubProbe {
    /// Hubs opened through their PnP instance ID (upper-cased key).
    by_instance: HashMap<String, Option<HubHandle>>,
    /// Hubs opened through the symbolic link name another hub reported for
    /// them (upper-cased key).
    by_link_name: HashMap<String, Option<HubHandle>>,
    /// Symbolic link name of the SuperSpeed twin of a USB 2 hub, by the USB 2
    /// hub's instance ID (upper-cased key). `None` = no twin found.
    twin_names: HashMap<String, Option<String>>,
}

impl Default for HubProbe {
    fn default() -> Self {
        Self::new()
    }
}

impl HubProbe {
    pub fn new() -> Self {
        Self {
            by_instance: HashMap::new(),
            by_link_name: HashMap::new(),
            twin_names: HashMap::new(),
        }
    }

    /// Ask the device's parent hub what speed the device's port negotiated.
    pub(super) fn usb_link(
        &mut self,
        parent_id: &str,
        dev_info: HDEVINFO,
        dev_data: &SP_DEVINFO_DATA,
    ) -> Option<LinkInfo> {
        if parent_id.is_empty() {
            return None;
        }
        let port = get_u32_property(dev_info, dev_data, &DEVPKEY_DEVICE_ADDRESS)?;
        if port == 0 {
            return None;
        }
        let hub = self.open_by_instance(parent_id)?;
        let (mut link, companion) = port_link(hub, port)?;

        if let LinkInfo::Usb {
            speed,
            capable,
            port_usb3,
            companion_connected,
            companion_id,
        } = &mut link
        {
            if companion.is_some() {
                *port_usb3 = true;
            }
            // Only a device that advertises more than it's getting needs the
            // companion check; everything else is what it looks like.
            if capable > speed {
                let twin_port = match companion {
                    Some((link_name, companion_port)) => {
                        self.open_by_name(&link_name).map(|h| (h, companion_port))
                    }
                    None => self.twin_hub(parent_id, 0).map(|h| (h, port)),
                };
                if let Some((twin_hub, twin_port)) = twin_port
                    && port_connected(twin_hub, twin_port)
                {
                    *companion_connected = true;
                    *port_usb3 = true;
                    // What sits on the companion port is this hub's USB 3 half;
                    // name it so the Connections tree can fold the pair into
                    // one row. Only hubs have a node name, which is exactly the
                    // case that has two halves.
                    *companion_id = hub_name_at_port(twin_hub, twin_port)
                        .and_then(|name| instance_id_of_interface(&name));
                }
                log::debug!("USB link {parent_id} port {port}: {link:?}");
            }
        }
        Some(link)
    }

    fn open_by_instance(&mut self, instance_id: &str) -> Option<HANDLE> {
        self.by_instance
            .entry(instance_id.to_ascii_uppercase())
            .or_insert_with(|| HubHandle::open_instance(instance_id))
            .as_ref()
            .map(|h| h.0)
    }

    fn open_by_name(&mut self, link_name: &str) -> Option<HANDLE> {
        self.by_link_name
            .entry(link_name.to_ascii_uppercase())
            .or_insert_with(|| HubHandle::open_link_name(link_name))
            .as_ref()
            .map(|h| h.0)
    }

    /// The SuperSpeed twin of a USB 2 hub: the logical hub that shares its
    /// silicon and its port numbering. Found by looking at what sits on the
    /// companion of the hub's own upstream port.
    fn twin_hub(&mut self, hub_id: &str, depth: u8) -> Option<HANDLE> {
        let key = hub_id.to_ascii_uppercase();
        let name = match self.twin_names.get(&key) {
            Some(cached) => cached.clone(),
            None => {
                let found = self.find_twin_name(hub_id, depth);
                self.twin_names.insert(key, found.clone());
                found
            }
        };
        self.open_by_name(&name?)
    }

    fn find_twin_name(&mut self, hub_id: &str, depth: u8) -> Option<String> {
        if depth >= MAX_TWIN_DEPTH {
            return None;
        }
        let (parent_id, port) = upstream_of(hub_id)?;
        // Not a hub (the root hub's parent is the host controller): no twin.
        let parent = self.open_by_instance(&parent_id)?;
        let (twin_parent, twin_port) = match companion_port(parent, port) {
            Some((name, companion_port)) => (self.open_by_name(&name)?, companion_port),
            None => (self.twin_hub(&parent_id, depth + 1)?, port),
        };
        hub_name_at_port(twin_parent, twin_port)
    }
}

/// An open handle to a USB hub's device interface.
struct HubHandle(HANDLE);

impl HubHandle {
    /// Open the hub interface of the device with this instance ID, or `None`
    /// if it isn't a hub (no interface of that class) or can't be opened.
    fn open_instance(instance_id: &str) -> Option<Self> {
        let path = super::interface_path(instance_id, &GUID_DEVINTERFACE_USB_HUB)?;
        Self::open_path(&path, instance_id)
    }

    /// Open a hub by the symbolic link name another hub reported for it
    /// (`USB#VID_...#{guid}`, no prefix), the form USBView opens as `\\.\` + name.
    fn open_link_name(link_name: &str) -> Option<Self> {
        let path: Vec<u16> = "\\\\.\\"
            .encode_utf16()
            .chain(link_name.encode_utf16())
            .chain(std::iter::once(0))
            .collect();
        Self::open_path(&path, link_name)
    }

    fn open_path(path: &[u16], what: &str) -> Option<Self> {
        // GENERIC_WRITE + FILE_SHARE_WRITE is what the hub driver expects for
        // its IOCTLs (and what USBView uses); no admin rights needed.
        let handle = unsafe {
            CreateFileW(
                PCWSTR(path.as_ptr()),
                GENERIC_WRITE.0,
                FILE_SHARE_WRITE,
                None,
                OPEN_EXISTING,
                FILE_FLAGS_AND_ATTRIBUTES(0),
                None,
            )
        };
        match handle {
            Ok(h) => Some(Self(h)),
            Err(e) => {
                log::debug!("Could not open USB hub {what}: {e}");
                None
            }
        }
    }
}

impl Drop for HubHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// The EX struct ends in a variable-length pipe list; the driver fills as
/// many as fit. We only want the header, but give it room for a typical
/// device's pipes so it doesn't have to truncate.
#[repr(C)]
struct ConnectionInfoEx {
    info: USB_NODE_CONNECTION_INFORMATION_EX,
    _more_pipes: [USB_PIPE_INFO; 31],
}

/// Whether anything is connected on `port` of `hub`.
fn port_connected(hub: HANDLE, port: u32) -> bool {
    connection_info(hub, port).is_some()
}

/// Connection info for a port that has a device on it; `None` for an empty
/// port, a device that failed enumeration, or an IOCTL failure.
fn connection_info(hub: HANDLE, port: u32) -> Option<ConnectionInfoEx> {
    let mut ex: ConnectionInfoEx = unsafe { std::mem::zeroed() };
    ex.info.ConnectionIndex = port;
    let ex_size = std::mem::size_of::<ConnectionInfoEx>() as u32;
    let mut returned = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            hub,
            IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX,
            Some(&ex as *const ConnectionInfoEx as *const c_void),
            ex_size,
            Some(&mut ex as *mut ConnectionInfoEx as *mut c_void),
            ex_size,
            Some(&mut returned),
            None,
        )
    };
    // The crate marks the struct packed, so copy fields out rather than
    // borrowing them in place.
    let status = ex.info.ConnectionStatus;
    if ok.is_err() || status != DeviceConnected {
        return None;
    }
    Some(ex)
}

/// Speed facts for one downstream port (1-based `ConnectionIndex`), plus the
/// port's SuperSpeed companion if the hub driver names one. The returned
/// link's `companion_connected` is `false`; the caller decides whether it's
/// worth opening the other hub to find out.
fn port_link(hub: HANDLE, port: u32) -> Option<(LinkInfo, Option<(String, u32)>)> {
    let ex = connection_info(hub, port)?;
    let raw_speed = ex.info.Speed;

    // The EX speed byte tops out at SuperSpeed; the V2 flags refine it.
    let mut speed = match i32::from(raw_speed) {
        s if s == UsbLowSpeed.0 => UsbSpeed::Low,
        s if s == UsbFullSpeed.0 => UsbSpeed::Full,
        s if s == UsbHighSpeed.0 => UsbSpeed::High,
        s if s == UsbSuperSpeed.0 => UsbSpeed::Super,
        _ => return None,
    };
    let mut capable = speed;
    let mut port_usb3 = speed >= UsbSpeed::Super;

    let mut v2 = USB_NODE_CONNECTION_INFORMATION_EX_V2 {
        ConnectionIndex: port,
        Length: std::mem::size_of::<USB_NODE_CONNECTION_INFORMATION_EX_V2>() as u32,
        // On input this tells the driver which protocols the caller
        // understands; on output it's what the port supports.
        SupportedUsbProtocols: USB_PROTOCOLS {
            ul: USB_PROTOCOL_USB300,
        },
        Flags: USB_NODE_CONNECTION_INFORMATION_EX_V2_FLAGS { ul: 0 },
    };
    let v2_size = v2.Length;
    let mut returned = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            hub,
            IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX_V2,
            Some(&v2 as *const USB_NODE_CONNECTION_INFORMATION_EX_V2 as *const c_void),
            v2_size,
            Some(&mut v2 as *mut USB_NODE_CONNECTION_INFORMATION_EX_V2 as *mut c_void),
            v2_size,
            Some(&mut returned),
            None,
        )
    };
    if ok.is_ok() {
        let flags = unsafe { v2.Flags.ul };
        let protocols = unsafe { v2.SupportedUsbProtocols.ul };
        if flags & FLAG_OPERATING_AT_SUPER_SPEED_PLUS_OR_HIGHER != 0 {
            speed = UsbSpeed::SuperPlus;
        } else if flags & FLAG_OPERATING_AT_SUPER_SPEED_OR_HIGHER != 0 {
            speed = UsbSpeed::Super;
        }
        capable = if flags & FLAG_SUPER_SPEED_PLUS_CAPABLE_OR_HIGHER != 0 {
            UsbSpeed::SuperPlus
        } else if flags & FLAG_SUPER_SPEED_CAPABLE_OR_HIGHER != 0 {
            UsbSpeed::Super
        } else {
            speed
        };
        port_usb3 = protocols & USB_PROTOCOL_USB300 != 0;
    }

    let link = LinkInfo::Usb {
        speed,
        capable: capable.max(speed),
        port_usb3,
        companion_connected: false,
        companion_id: None,
    };
    Some((link, companion_port(hub, port)))
}

/// The PnP instance ID behind a device interface symbolic link name, as the
/// hub IOCTLs report it (`USB#VID_...#{guid}`, no `\\?\` prefix). Asked of
/// Windows rather than derived by rewriting `#` to `\`: nothing guarantees an
/// instance ID is free of `#`.
fn instance_id_of_interface(link_name: &str) -> Option<String> {
    const DEVPKEY_DEVICE_INSTANCE_ID: DEVPROPKEY = DEVPROPKEY {
        fmtid: GUID::from_u128(0x78c34fc8_104a_4aca_9ea4_524d52996e57),
        pid: 256,
    };
    const DEVPROP_TYPE_STRING: u32 = 0x0000_0012;

    let path: Vec<u16> = "\\\\?\\"
        .encode_utf16()
        .chain(link_name.encode_utf16())
        .chain(std::iter::once(0))
        .collect();
    // Instance IDs are capped at 200 characters (MAX_DEVICE_ID_LEN).
    let mut buffer = [0u16; 256];
    let mut size = std::mem::size_of_val(&buffer) as u32;
    let mut prop_type = DEVPROPTYPE(0);
    let cr = unsafe {
        CM_Get_Device_Interface_PropertyW(
            PCWSTR(path.as_ptr()),
            &DEVPKEY_DEVICE_INSTANCE_ID,
            &mut prop_type,
            Some(buffer.as_mut_ptr() as *mut u8),
            &mut size,
            0,
        )
    };
    if cr != CR_SUCCESS || prop_type.0 != DEVPROP_TYPE_STRING {
        log::debug!("No instance ID for USB hub interface {link_name}: {cr:?}");
        return None;
    }
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    (end > 0).then(|| String::from_utf16_lossy(&buffer[..end]))
}

/// The SuperSpeed companion of a port, as the hub driver reports it: the
/// other hub's symbolic link name and the port number there. `None` when the
/// driver doesn't pair this port (USB 2-only connectors, but also some hubs
/// and internal ports it simply doesn't know about).
fn companion_port(hub: HANDLE, port: u32) -> Option<(String, u32)> {
    // USB_PORT_CONNECTOR_PROPERTIES is packed and ends in a variable-length
    // name, so work on a raw buffer: ConnectionIndex u32 @0, ActualLength u32
    // @4, UsbPortProperties u32 @8, CompanionIndex u16 @12, CompanionPortNumber
    // u16 @14, CompanionHubSymbolicLinkName u16[] @16.
    const HEADER: usize = 16;
    let bytes = name_ioctl(hub, IOCTL_USB_GET_PORT_CONNECTOR_PROPERTIES, port, HEADER)?;
    let companion_port = u32::from(u16::from_le_bytes([bytes[14], bytes[15]]));
    if companion_port == 0 {
        return None;
    }
    let name = wide_string_at(&bytes, HEADER)?;
    Some((name, companion_port))
}

/// The symbolic link name of the hub plugged into `port` of `hub`, or `None`
/// if the device there isn't a hub (or the port is empty).
fn hub_name_at_port(hub: HANDLE, port: u32) -> Option<String> {
    // USB_NODE_CONNECTION_NAME: ConnectionIndex u32 @0, ActualLength u32 @4,
    // NodeName u16[] @8.
    const HEADER: usize = 8;
    let bytes = name_ioctl(hub, IOCTL_USB_GET_NODE_CONNECTION_NAME, port, HEADER)?;
    wide_string_at(&bytes, HEADER)
}

/// Issue one of the hub IOCTLs whose output is a fixed header followed by a
/// NUL-terminated UTF-16 name. Returns the bytes the driver filled.
fn name_ioctl(hub: HANDLE, ioctl: u32, port: u32, header: usize) -> Option<Vec<u8>> {
    const NAME_CAPACITY: usize = 512;
    let mut buffer = vec![0u32; (header + NAME_CAPACITY * 2).div_ceil(4)];
    buffer[0] = port;
    let size = (buffer.len() * 4) as u32;
    let mut returned = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            hub,
            ioctl,
            Some(buffer.as_ptr() as *const c_void),
            size,
            Some(buffer.as_mut_ptr() as *mut c_void),
            size,
            Some(&mut returned),
            None,
        )
    };
    if let Err(e) = ok {
        log::debug!("Hub IOCTL {ioctl:#x} for port {port} failed: {e}");
        return None;
    }
    let returned = (returned as usize).min(buffer.len() * 4);
    if returned < header + 2 {
        return None;
    }
    Some(
        buffer
            .iter()
            .flat_map(|w| w.to_le_bytes())
            .take(returned)
            .collect(),
    )
}

/// The NUL-terminated UTF-16 string starting at byte `offset`, if non-empty.
fn wide_string_at(bytes: &[u8], offset: usize) -> Option<String> {
    let (pairs, _) = bytes.get(offset..)?.as_chunks::<2>();
    let name: Vec<u16> = pairs
        .iter()
        .map(|&pair| u16::from_le_bytes(pair))
        .take_while(|&c| c != 0)
        .collect();
    if name.is_empty() {
        return None;
    }
    Some(String::from_utf16_lossy(&name))
}

/// A device's parent instance ID and the port number it occupies there, from
/// the PnP tree (not from SetupAPI, so it works for devices we're not
/// currently enumerating).
fn upstream_of(instance_id: &str) -> Option<(String, u32)> {
    let wide_id: Vec<u16> = instance_id
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let mut devinst = 0u32;
        if CM_Locate_DevNodeW(
            &mut devinst,
            PCWSTR(wide_id.as_ptr()),
            CM_LOCATE_DEVNODE_NORMAL,
        ) != CR_SUCCESS
        {
            return None;
        }

        let mut prop_type = DEVPROPTYPE(0);
        let mut port = [0u8; 4];
        let mut size = port.len() as u32;
        let cr = CM_Get_DevNode_PropertyW(
            devinst,
            &DEVPKEY_DEVICE_ADDRESS,
            &mut prop_type,
            Some(port.as_mut_ptr()),
            &mut size,
            0,
        );
        if cr != CR_SUCCESS || prop_type.0 != DEVPROP_TYPE_UINT32 {
            return None;
        }
        let port = u32::from_le_bytes(port);
        if port == 0 {
            return None;
        }

        let mut parent = 0u32;
        if CM_Get_Parent(&mut parent, devinst, 0) != CR_SUCCESS {
            return None;
        }
        let mut len = 0u32;
        if CM_Get_Device_ID_Size(&mut len, parent, 0) != CR_SUCCESS || len == 0 {
            return None;
        }
        let mut buffer = vec![0u16; len as usize + 1];
        if CM_Get_Device_IDW(parent, &mut buffer, 0) != CR_SUCCESS {
            return None;
        }
        let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
        Some((String::from_utf16_lossy(&buffer[..end]), port))
    }
}
