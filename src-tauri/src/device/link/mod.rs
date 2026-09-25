//! Upstream link speed probes: how fast is the wire between a device and
//! whatever it's plugged into, and how fast could it be?
//!
//! Windows exposes this four unrelated ways, one module each:
//!
//! - [`usb`]: hub port IOCTLs on the parent hub (USBView's method).
//! - [`pcie`]: `DEVPKEY_PciDevice_*Link*` properties on PCIe endpoints.
//! - [`ethernet`]: the IP Helper interface table, matched to the adapter by
//!   its `NetCfgInstanceId`; capability from the driver's speed options.
//! - [`sata`]: ATA IDENTIFY data through the storage stack's protocol query.
//!
//! A device can have more than one link. A PCIe network card has its PCIe
//! link *and* its Ethernet link; a USB network adapter has a USB link that can
//! be the real bottleneck behind a faster Ethernet port. Bus links come first,
//! then the network or storage link.

mod ethernet;
mod pcie;
mod sata;
mod usb;

use windows::Win32::Devices::DeviceAndDriverInstallation::{
    CM_GET_DEVICE_INTERFACE_LIST_PRESENT, CM_Get_Device_Interface_List_SizeW,
    CM_Get_Device_Interface_ListW, CR_SUCCESS, HDEVINFO, SP_DEVINFO_DATA,
};
use windows::core::{GUID, PCWSTR};

use super::types::LinkInfo;

/// Setup class of network adapters.
const NET_CLASS_GUID: &str = "{4d36e972-e325-11ce-bfc1-08002be10318}";
/// Setup class of disk drives.
const DISK_CLASS_GUID: &str = "{4d36e967-e325-11ce-bfc1-08002be10318}";

/// State shared across one enumeration pass: open hub handles and one
/// snapshot of the network interface table, so neither is re-fetched per
/// device.
#[derive(Default)]
pub struct LinkProbe {
    hubs: usb::HubProbe,
    interfaces: Option<ethernet::InterfaceTable>,
}

impl LinkProbe {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every link Windows will tell us about for this device, bus link first.
    /// Empty for devices with no upstream link (root hubs, host controllers,
    /// software devices) and whenever Windows declines to say.
    pub fn links(
        &mut self,
        instance_id: &str,
        parent_id: &str,
        class_guid: &str,
        dev_info: HDEVINFO,
        dev_data: &SP_DEVINFO_DATA,
    ) -> Vec<LinkInfo> {
        let mut links = Vec::new();

        let prefix = instance_id.get(..4).map(str::to_ascii_uppercase);
        match prefix.as_deref() {
            Some("PCI\\") => links.extend(pcie::link(dev_info, dev_data)),
            Some("USB\\") => links.extend(self.hubs.usb_link(parent_id, dev_info, dev_data)),
            _ => {}
        }

        if class_guid.eq_ignore_ascii_case(NET_CLASS_GUID) {
            let interfaces = self
                .interfaces
                .get_or_insert_with(ethernet::InterfaceTable::snapshot);
            links.extend(ethernet::link(interfaces, dev_info, dev_data));
        } else if class_guid.eq_ignore_ascii_case(DISK_CLASS_GUID) {
            links.extend(sata::link(instance_id));
        }

        links
    }
}

/// The first device-interface path of class `class` that a device instance
/// exposes, as a NUL-terminated UTF-16 string. `None` when the device exposes
/// no interface of that class (a device that isn't a hub, isn't a disk, ...).
fn interface_path(instance_id: &str, class: &GUID) -> Option<Vec<u16>> {
    let wide_id: Vec<u16> = instance_id
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let mut len = 0u32;
        let cr = CM_Get_Device_Interface_List_SizeW(
            &mut len,
            class,
            PCWSTR(wide_id.as_ptr()),
            CM_GET_DEVICE_INTERFACE_LIST_PRESENT,
        );
        // An empty list is a single NUL (len 1): no interface of this class.
        if cr != CR_SUCCESS || len <= 1 {
            return None;
        }
        let mut buffer = vec![0u16; len as usize];
        let cr = CM_Get_Device_Interface_ListW(
            class,
            PCWSTR(wide_id.as_ptr()),
            &mut buffer,
            CM_GET_DEVICE_INTERFACE_LIST_PRESENT,
        );
        if cr != CR_SUCCESS {
            return None;
        }
        // Double-NUL-terminated list; take the first entry.
        let end = buffer.iter().position(|&c| c == 0)?;
        if end == 0 {
            return None;
        }
        buffer.truncate(end + 1);
        Some(buffer)
    }
}
