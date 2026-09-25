//! Ethernet: the speed a wired network adapter negotiated with its link
//! partner, and the fastest speed the adapter offers.
//!
//! The negotiated speed comes from the IP Helper interface table
//! (`GetIfTable2`), matched to the adapter's device node through the
//! `NetCfgInstanceId` in its driver key, which is the interface's GUID. The
//! table is read once per enumeration pass.
//!
//! The capability comes from the driver's own speed/duplex options, the list
//! behind the "Speed & Duplex" dropdown in the adapter's Advanced properties
//! (`Ndi\params\*SpeedDuplex\enum` under the driver key). The fastest option
//! is what the adapter can do. If `*SpeedDuplex` itself isn't `0` (auto
//! negotiation), someone fixed the speed by hand, which we report as `forced`
//! so a deliberately slow link isn't flagged as a fault.
//!
//! Wired 802.3 only. Wi-Fi reports a link rate too, but it moves every few
//! seconds and the tree refreshes only on events, so a Wi-Fi chip would show a
//! stale number as if it were fact.

use windows::Win32::Devices::DeviceAndDriverInstallation::{
    DICS_FLAG_GLOBAL, DIREG_DRV, HDEVINFO, SP_DEVINFO_DATA, SetupDiOpenDevRegKey,
};
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
use windows::Win32::NetworkManagement::Ndis::{
    MediaConnectStateConnected, NdisMedium802_3, NdisPhysicalMedium802_3,
};
use windows::Win32::System::Registry::{
    HKEY, KEY_READ, REG_SZ, REG_VALUE_TYPE, RegCloseKey, RegEnumValueW, RegOpenKeyExW,
    RegQueryValueExW,
};
use windows::core::{PCWSTR, PWSTR};

use super::super::types::LinkInfo;

/// `InterfaceAndOperStatusFlags` bits (netioapi.h bitfield; the crate exposes
/// it as a raw byte).
const IF_FLAG_HARDWARE_INTERFACE: u8 = 1 << 0;
const IF_FLAG_FILTER_INTERFACE: u8 = 1 << 1;

/// The facts we keep from one wired hardware interface.
struct Interface {
    /// Interface GUID, uppercase, no braces (`3E0C9FC7-09FB-...`).
    guid: String,
    connected: bool,
    speed_bps: u64,
}

/// The wired hardware interfaces, copied out of one `GetIfTable2` call.
#[derive(Default)]
pub(super) struct InterfaceTable {
    interfaces: Vec<Interface>,
}

impl InterfaceTable {
    pub(super) fn snapshot() -> Self {
        let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        let rc = unsafe { GetIfTable2(&mut table) };
        if rc != ERROR_SUCCESS || table.is_null() {
            log::debug!("GetIfTable2 failed: {rc:?}");
            return Self::default();
        }

        let interfaces = unsafe {
            let count = (*table).NumEntries as usize;
            let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), count);
            rows.iter()
                .filter(|row| {
                    let flags = row.InterfaceAndOperStatusFlags._bitfield;
                    flags & IF_FLAG_HARDWARE_INTERFACE != 0
                        && flags & IF_FLAG_FILTER_INTERFACE == 0
                        && row.MediaType == NdisMedium802_3
                        && row.PhysicalMediumType == NdisPhysicalMedium802_3
                })
                .map(|row| Interface {
                    guid: format!("{:?}", row.InterfaceGuid).to_ascii_uppercase(),
                    connected: row.MediaConnectState == MediaConnectStateConnected,
                    speed_bps: row.TransmitLinkSpeed.max(row.ReceiveLinkSpeed),
                })
                .collect()
        };
        unsafe { FreeMibTable(table as *const _) };
        Self { interfaces }
    }
}

/// The Ethernet link of a network-class device, or `None` if it isn't a
/// wired hardware adapter (Wi-Fi, Bluetooth PAN, virtual switches, VPNs).
pub(super) fn link(
    interfaces: &InterfaceTable,
    dev_info: HDEVINFO,
    dev_data: &SP_DEVINFO_DATA,
) -> Option<LinkInfo> {
    let driver_key = RegKey::open_driver_key(dev_info, dev_data)?;
    let instance_guid = driver_key.string("NetCfgInstanceId")?;
    let guid = instance_guid
        .trim_matches(|c| c == '{' || c == '}')
        .to_ascii_uppercase();
    let interface = interfaces.interfaces.iter().find(|i| i.guid == guid)?;

    // Some drivers report 0 or all-ones for "unknown" while the link is up.
    let known_speed = interface.speed_bps != 0 && interface.speed_bps != u64::MAX;
    let connected = interface.connected && known_speed;

    let forced = driver_key
        .string("*SpeedDuplex")
        .is_some_and(|v| !v.trim().is_empty() && v.trim() != "0");
    let max_bps = driver_key
        .subkey("Ndi\\params\\*SpeedDuplex\\enum")
        .and_then(|options| {
            options
                .string_values()
                .iter()
                .filter_map(|(code, label)| option_speed(code, label))
                .max()
        });

    Some(LinkInfo::Ethernet {
        speed_bps: if connected { interface.speed_bps } else { 0 },
        connected,
        max_bps,
        forced,
    })
}

/// Bits per second for one `*SpeedDuplex` option, or `None` for "Auto
/// Negotiation" and anything we can't read. The label is authoritative
/// (vendors add codes for 2.5G/5G that aren't standardized); the standardized
/// codes are the fallback for labels we can't parse, e.g. localized ones.
fn option_speed(code: &str, label: &str) -> Option<u64> {
    parse_speed_label(label).or_else(|| standard_code_speed(code))
}

/// The standardized `*SpeedDuplex` values from Microsoft's INF keyword list.
fn standard_code_speed(code: &str) -> Option<u64> {
    const M: u64 = 1_000_000;
    match code.trim() {
        "1" | "2" => Some(10 * M),
        "3" | "4" => Some(100 * M),
        "5" | "6" => Some(1_000 * M),
        "7" => Some(10_000 * M),
        _ => None,
    }
}

/// The first "<number> <G|M>b..." in a label, in bits per second:
/// "1.0 Gbps Full Duplex", "2.5 Gbps", "100 Mbps Half Duplex", "10Gbps",
/// "1,0 GBit/s Vollduplex", "1000 Mb Full".
fn parse_speed_label(label: &str) -> Option<u64> {
    let chars: Vec<char> = label.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.' || chars[i] == ',') {
            i += 1;
        }
        let number: String = chars[start..i]
            .iter()
            .map(|&c| if c == ',' { '.' } else { c })
            .collect();
        let mut j = i;
        while j < chars.len() && chars[j] == ' ' {
            j += 1;
        }
        let unit = chars.get(j).map(|c| c.to_ascii_uppercase());
        let bits = chars.get(j + 1).map(|c| c.to_ascii_uppercase());
        let scale = match (unit, bits) {
            (Some('G'), Some('B')) => 1e9,
            (Some('M'), Some('B')) => 1e6,
            _ => continue,
        };
        if let Ok(value) = number.trim_end_matches('.').parse::<f64>()
            && value > 0.0
        {
            return Some((value * scale).round() as u64);
        }
    }
    None
}

/// A registry key closed on drop.
struct RegKey(HKEY);

impl RegKey {
    /// The device's software (driver) key, where network drivers keep their
    /// configuration.
    fn open_driver_key(dev_info: HDEVINFO, dev_data: &SP_DEVINFO_DATA) -> Option<Self> {
        let key = unsafe {
            SetupDiOpenDevRegKey(
                dev_info,
                dev_data,
                DICS_FLAG_GLOBAL.0,
                0,
                DIREG_DRV,
                KEY_READ.0,
            )
        };
        key.ok().map(Self)
    }

    fn subkey(&self, path: &str) -> Option<Self> {
        let wide = to_wide(path);
        let mut key = HKEY::default();
        let rc = unsafe { RegOpenKeyExW(self.0, PCWSTR(wide.as_ptr()), 0, KEY_READ, &mut key) };
        (rc == ERROR_SUCCESS).then_some(Self(key))
    }

    /// A `REG_SZ` value, or `None` if it's missing or another type.
    fn string(&self, name: &str) -> Option<String> {
        let wide = to_wide(name);
        let mut kind = REG_VALUE_TYPE(0);
        let mut size = 0u32;
        let rc = unsafe {
            RegQueryValueExW(
                self.0,
                PCWSTR(wide.as_ptr()),
                None,
                Some(&mut kind),
                None,
                Some(&mut size),
            )
        };
        if rc != ERROR_SUCCESS || kind != REG_SZ || size == 0 {
            return None;
        }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
        let rc = unsafe {
            RegQueryValueExW(
                self.0,
                PCWSTR(wide.as_ptr()),
                None,
                Some(&mut kind),
                Some(buffer.as_mut_ptr() as *mut u8),
                Some(&mut size),
            )
        };
        (rc == ERROR_SUCCESS).then(|| from_wide(&buffer))
    }

    /// Every `REG_SZ` value in the key, as (name, data) pairs.
    fn string_values(&self) -> Vec<(String, String)> {
        let mut values = Vec::new();
        for index in 0.. {
            let mut name = [0u16; 256];
            let mut name_len = name.len() as u32;
            let mut kind = 0u32;
            let mut data = [0u16; 256];
            let mut data_size = (data.len() * 2) as u32;
            let rc = unsafe {
                RegEnumValueW(
                    self.0,
                    index,
                    PWSTR(name.as_mut_ptr()),
                    &mut name_len,
                    None,
                    Some(&mut kind),
                    Some(data.as_mut_ptr() as *mut u8),
                    Some(&mut data_size),
                )
            };
            if rc != ERROR_SUCCESS {
                // ERROR_NO_MORE_ITEMS, or a value too big for an option label.
                break;
            }
            if kind == REG_SZ.0 {
                values.push((
                    String::from_utf16_lossy(&name[..name_len as usize]),
                    from_wide(&data[..(data_size as usize / 2).min(data.len())]),
                ));
            }
        }
        values
    }
}

impl Drop for RegKey {
    fn drop(&mut self) {
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// UTF-16 up to the first NUL.
fn from_wide(buffer: &[u16]) -> String {
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    const M: u64 = 1_000_000;
    const G: u64 = 1_000_000_000;

    #[test]
    fn parses_the_labels_drivers_actually_use() {
        assert_eq!(parse_speed_label("1.0 Gbps Full Duplex"), Some(G));
        assert_eq!(parse_speed_label("2.5 Gbps Full Duplex"), Some(2_500 * M));
        assert_eq!(parse_speed_label("100 Mbps Half Duplex"), Some(100 * M));
        assert_eq!(parse_speed_label("10 Mbps Full Duplex"), Some(10 * M));
        assert_eq!(parse_speed_label("10Gbps"), Some(10 * G));
        assert_eq!(parse_speed_label("1000 Mb Full"), Some(G));
    }

    #[test]
    fn parses_a_localized_label_with_a_decimal_comma() {
        assert_eq!(parse_speed_label("1,0 GBit/s Vollduplex"), Some(G));
    }

    #[test]
    fn auto_negotiation_and_unitless_numbers_are_not_speeds() {
        assert_eq!(parse_speed_label("Auto Negotiation"), None);
        assert_eq!(parse_speed_label("IEEE 802.3 compliant"), None);
        assert_eq!(parse_speed_label(""), None);
    }

    #[test]
    fn falls_back_to_standard_codes_when_the_label_is_unreadable() {
        assert_eq!(option_speed("6", "Vitesse maximale"), Some(G));
        assert_eq!(option_speed("4", "???"), Some(100 * M));
        assert_eq!(option_speed("0", "Auto"), None);
        assert_eq!(option_speed("42", "Mystery"), None);
    }

    #[test]
    fn the_label_wins_over_a_vendor_specific_code() {
        // Vendors number their 2.5G option however they like.
        assert_eq!(
            option_speed("2500", "2.5 Gbps Full Duplex"),
            Some(2_500 * M)
        );
        assert_eq!(option_speed("7", "2.5 Gbps Full Duplex"), Some(2_500 * M));
    }
}
