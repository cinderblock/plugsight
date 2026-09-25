//! PCIe: the link an endpoint trained with its upstream port.
//!
//! Endpoints carry `DEVPKEY_PciDevice_{Current,Max}Link{Speed,Width}` as
//! ordinary device properties. Root ports and switch ports don't report them
//! (observed on Windows 11), so only endpoints get a link.

use windows::Win32::Devices::DeviceAndDriverInstallation::{HDEVINFO, SP_DEVINFO_DATA};
use windows::Win32::Devices::Properties::DEVPROPKEY;
use windows::core::GUID;

use super::super::properties::get_u32_property;
use super::super::types::LinkInfo;

// ── DEVPKEYs (pciprop.h / devpkey.h) ─────────────────────────────────────

const PCI_DEVICE_FMTID: GUID = GUID::from_u128(0x3ab22e31_8264_4b4e_9af5_a8d2d8e33e62);

const DEVPKEY_PCI_DEVICE_CURRENT_LINK_SPEED: DEVPROPKEY = DEVPROPKEY {
    fmtid: PCI_DEVICE_FMTID,
    pid: 9,
};
const DEVPKEY_PCI_DEVICE_CURRENT_LINK_WIDTH: DEVPROPKEY = DEVPROPKEY {
    fmtid: PCI_DEVICE_FMTID,
    pid: 10,
};
const DEVPKEY_PCI_DEVICE_MAX_LINK_SPEED: DEVPROPKEY = DEVPROPKEY {
    fmtid: PCI_DEVICE_FMTID,
    pid: 11,
};
const DEVPKEY_PCI_DEVICE_MAX_LINK_WIDTH: DEVPROPKEY = DEVPROPKEY {
    fmtid: PCI_DEVICE_FMTID,
    pid: 12,
};

/// PCIe link from the endpoint's own properties. All four must be present:
/// a current speed without a max (or vice versa) can't say whether the link
/// is degraded, and partial data would render as a confident-looking chip.
pub(super) fn link(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> Option<LinkInfo> {
    let generation = get_u32_property(dev_info, dev_data, &DEVPKEY_PCI_DEVICE_CURRENT_LINK_SPEED)?;
    let width = get_u32_property(dev_info, dev_data, &DEVPKEY_PCI_DEVICE_CURRENT_LINK_WIDTH)?;
    let max_generation = get_u32_property(dev_info, dev_data, &DEVPKEY_PCI_DEVICE_MAX_LINK_SPEED)?;
    let max_width = get_u32_property(dev_info, dev_data, &DEVPKEY_PCI_DEVICE_MAX_LINK_WIDTH)?;
    if generation == 0 || width == 0 || max_generation == 0 || max_width == 0 {
        return None;
    }
    Some(LinkInfo::Pcie {
        generation,
        width,
        max_generation,
        max_width,
    })
}
