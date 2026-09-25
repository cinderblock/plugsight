//! SATA: the signalling generation a drive negotiated with its controller
//! port, and the fastest generation the drive supports.
//!
//! Both come from the drive's ATA IDENTIFY DEVICE data:
//!
//! - word 76 (Serial ATA Capabilities), bits 1–3: Gen1 (1.5 Gb/s), Gen2
//!   (3 Gb/s), Gen3 (6 Gb/s) supported;
//! - word 77 (Serial ATA Additional Capabilities), bits 3:1: the generation
//!   currently negotiated. Drives older than ACS-3 leave this zero; for those
//!   there's no chip, since a maximum alone can't say whether the link is slow.
//!
//! The data is read with `IOCTL_STORAGE_QUERY_PROPERTY` /
//! `StorageDeviceProtocolSpecificProperty`, which works on a handle opened
//! with *no* access rights, so it needs no admin rights (verified on this
//! code path with an NVMe drive from a non-elevated process; no SATA drive
//! was available to exercise the ATA flavour itself). The bus type is
//! checked first so NVMe and USB disks are never asked for ATA data.

use std::ffi::c_void;

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Storage::FileSystem::{
    BusTypeSata, CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
    OPEN_EXISTING, STORAGE_BUS_TYPE,
};
use windows::Win32::System::IO::DeviceIoControl;
use windows::Win32::System::Ioctl::{
    AtaDataTypeIdentify, GUID_DEVINTERFACE_DISK, IOCTL_STORAGE_QUERY_PROPERTY,
    PropertyStandardQuery, ProtocolTypeAta, STORAGE_DEVICE_DESCRIPTOR, STORAGE_PROPERTY_ID,
    STORAGE_PROTOCOL_DATA_DESCRIPTOR, STORAGE_PROTOCOL_SPECIFIC_DATA, STORAGE_QUERY_TYPE,
    StorageDeviceProperty, StorageDeviceProtocolSpecificProperty,
};
use windows::core::PCWSTR;

use super::super::types::LinkInfo;

/// IDENTIFY DEVICE is 256 words.
const IDENTIFY_BYTES: usize = 512;

/// The SATA link of a disk-class device, or `None` if it isn't on a SATA bus
/// or doesn't report its negotiated speed.
pub(super) fn link(instance_id: &str) -> Option<LinkInfo> {
    let path = super::interface_path(instance_id, &GUID_DEVINTERFACE_DISK)?;
    let disk = Disk::open(&path)?;
    if disk.bus_type()? != BusTypeSata {
        return None;
    }
    let words = disk.identify()?;
    let (generation, max_generation) = parse_identify(&words)?;
    Some(LinkInfo::Sata {
        generation,
        max_generation,
    })
}

/// (negotiated generation, highest supported generation) from IDENTIFY
/// DEVICE words 76 and 77.
fn parse_identify(words: &[u16]) -> Option<(u32, u32)> {
    let capabilities = *words.get(76)?;
    // 0 and all-ones both mean "not reported"; bit 0 is reserved as zero.
    if capabilities == 0 || capabilities == 0xFFFF || capabilities & 1 != 0 {
        return None;
    }
    let max_generation = (1..=3u32).rev().find(|g| capabilities & (1 << g) != 0)?;
    let current = u32::from((*words.get(77)? >> 1) & 0b111);
    if !(1..=3).contains(&current) {
        return None;
    }
    Some((current, max_generation))
}

/// A disk opened for queries only (no read/write access).
struct Disk(HANDLE);

impl Disk {
    fn open(path: &[u16]) -> Option<Self> {
        let handle = unsafe {
            CreateFileW(
                PCWSTR(path.as_ptr()),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                None,
                OPEN_EXISTING,
                FILE_FLAGS_AND_ATTRIBUTES(0),
                None,
            )
        };
        handle.ok().map(Self)
    }

    fn bus_type(&self) -> Option<STORAGE_BUS_TYPE> {
        #[repr(C)]
        struct Query {
            property_id: STORAGE_PROPERTY_ID,
            query_type: STORAGE_QUERY_TYPE,
            additional: [u8; 4],
        }
        let query = Query {
            property_id: StorageDeviceProperty,
            query_type: PropertyStandardQuery,
            additional: [0; 4],
        };
        // u64 storage keeps the descriptor suitably aligned for the read.
        let mut out = [0u64; 128];
        let out_size = std::mem::size_of_val(&out) as u32;
        let mut returned = 0u32;
        unsafe {
            DeviceIoControl(
                self.0,
                IOCTL_STORAGE_QUERY_PROPERTY,
                Some(&query as *const Query as *const c_void),
                std::mem::size_of::<Query>() as u32,
                Some(out.as_mut_ptr() as *mut c_void),
                out_size,
                Some(&mut returned),
                None,
            )
        }
        .ok()?;
        if (returned as usize)
            < std::mem::offset_of!(STORAGE_DEVICE_DESCRIPTOR, RawPropertiesLength)
        {
            return None;
        }
        let descriptor = unsafe { &*(out.as_ptr() as *const STORAGE_DEVICE_DESCRIPTOR) };
        Some(descriptor.BusType)
    }

    /// The 256 IDENTIFY DEVICE words, via the storage stack's ATA protocol
    /// query rather than ATA pass-through (which would need admin rights).
    fn identify(&self) -> Option<Vec<u16>> {
        // STORAGE_PROPERTY_QUERY's variable tail carries the protocol request;
        // the driver writes a STORAGE_PROTOCOL_DATA_DESCRIPTOR back over the
        // same buffer, with the data ProtocolDataOffset bytes past the start of
        // its ProtocolSpecificData.
        #[repr(C)]
        struct Request {
            property_id: STORAGE_PROPERTY_ID,
            query_type: STORAGE_QUERY_TYPE,
            protocol: STORAGE_PROTOCOL_SPECIFIC_DATA,
            data: [u8; IDENTIFY_BYTES],
        }
        let mut request: Request = unsafe { std::mem::zeroed() };
        request.property_id = StorageDeviceProtocolSpecificProperty;
        request.query_type = PropertyStandardQuery;
        request.protocol.ProtocolType = ProtocolTypeAta;
        request.protocol.DataType = AtaDataTypeIdentify.0 as u32;
        request.protocol.ProtocolDataOffset =
            std::mem::size_of::<STORAGE_PROTOCOL_SPECIFIC_DATA>() as u32;
        request.protocol.ProtocolDataLength = IDENTIFY_BYTES as u32;

        let size = std::mem::size_of::<Request>() as u32;
        let mut returned = 0u32;
        unsafe {
            DeviceIoControl(
                self.0,
                IOCTL_STORAGE_QUERY_PROPERTY,
                Some(&request as *const Request as *const c_void),
                size,
                Some(&mut request as *mut Request as *mut c_void),
                size,
                Some(&mut returned),
                None,
            )
        }
        .ok()?;

        let reply =
            unsafe { &*(&request as *const Request as *const STORAGE_PROTOCOL_DATA_DESCRIPTOR) };
        let specific_start =
            std::mem::offset_of!(STORAGE_PROTOCOL_DATA_DESCRIPTOR, ProtocolSpecificData);
        let data_start = specific_start + reply.ProtocolSpecificData.ProtocolDataOffset as usize;
        let data_len = reply.ProtocolSpecificData.ProtocolDataLength as usize;
        let data_end = data_start.checked_add(IDENTIFY_BYTES)?;
        if data_len < IDENTIFY_BYTES || data_end > size as usize || data_end > returned as usize {
            return None;
        }
        let bytes = unsafe {
            std::slice::from_raw_parts(
                (&request as *const Request as *const u8).add(data_start),
                IDENTIFY_BYTES,
            )
        };
        let (pairs, _) = bytes.as_chunks::<2>();
        Some(pairs.iter().map(|&pair| u16::from_le_bytes(pair)).collect())
    }
}

impl Drop for Disk {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// IDENTIFY words with just 76 and 77 set.
    fn identify(word76: u16, word77: u16) -> Vec<u16> {
        let mut words = vec![0u16; 256];
        words[76] = word76;
        words[77] = word77;
        words
    }

    const GEN1: u16 = 1 << 1;
    const GEN2: u16 = 1 << 2;
    const GEN3: u16 = 1 << 3;

    /// Word 77 with the negotiated generation in bits 3:1.
    fn negotiated(generation: u16) -> u16 {
        generation << 1
    }

    #[test]
    fn a_gen3_drive_at_gen3() {
        assert_eq!(
            parse_identify(&identify(GEN1 | GEN2 | GEN3, negotiated(3))),
            Some((3, 3))
        );
    }

    #[test]
    fn a_gen3_drive_that_came_up_at_gen2() {
        assert_eq!(
            parse_identify(&identify(GEN1 | GEN2 | GEN3, negotiated(2))),
            Some((2, 3))
        );
    }

    #[test]
    fn a_gen2_drive_at_gen1() {
        assert_eq!(
            parse_identify(&identify(GEN1 | GEN2, negotiated(1))),
            Some((1, 2))
        );
    }

    #[test]
    fn other_word77_bits_do_not_leak_into_the_generation() {
        // Bit 0 is reserved, bits 4+ are unrelated capabilities.
        let word77 = negotiated(3) | 1 | (1 << 4) | (1 << 8);
        assert_eq!(
            parse_identify(&identify(GEN1 | GEN2 | GEN3, word77)),
            Some((3, 3))
        );
    }

    #[test]
    fn a_drive_that_does_not_report_its_current_speed_gets_no_link() {
        assert_eq!(parse_identify(&identify(GEN1 | GEN2 | GEN3, 0)), None);
    }

    #[test]
    fn missing_or_invalid_capability_words_get_no_link() {
        assert_eq!(parse_identify(&identify(0, negotiated(3))), None);
        assert_eq!(parse_identify(&identify(0xFFFF, negotiated(3))), None);
        assert_eq!(parse_identify(&identify(GEN3 | 1, negotiated(3))), None);
        assert_eq!(parse_identify(&[0u16; 10]), None);
    }
}
