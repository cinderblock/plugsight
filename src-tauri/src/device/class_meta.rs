//! Device setup class metadata: maps class GUIDs to human-readable names and icon identifiers.
//!
//! The icon IDs are semantic names that the frontend maps to its own SVG icon set.

use std::collections::HashMap;
use std::sync::LazyLock;

use super::types::ClassMeta;

/// A pre-built lookup table of the most common Windows device setup classes.
/// Source: Microsoft's system-defined device setup classes (Devguid.h).
static CLASS_TABLE: LazyLock<HashMap<&'static str, (&'static str, &'static str)>> =
    LazyLock::new(|| {
        let mut m = HashMap::new();

        // (class_guid_lowercase, (display_name, icon_id))
        m.insert(
            "{4d36e968-e325-11ce-bfc1-08002be10318}",
            ("Display adapters", "display"),
        );
        m.insert(
            "{4d36e972-e325-11ce-bfc1-08002be10318}",
            ("Network adapters", "network"),
        );
        m.insert(
            "{36fc9e60-c465-11cf-8056-444553540000}",
            ("USB controllers", "usb"),
        );
        m.insert(
            "{4d36e96b-e325-11ce-bfc1-08002be10318}",
            ("Keyboards", "keyboard"),
        );
        m.insert(
            "{4d36e96f-e325-11ce-bfc1-08002be10318}",
            ("Mice and other pointing devices", "mouse"),
        );
        m.insert(
            "{4d36e96c-e325-11ce-bfc1-08002be10318}",
            ("Audio inputs and outputs", "audio"),
        );
        m.insert(
            "{4d36e967-e325-11ce-bfc1-08002be10318}",
            ("Disk drives", "disk"),
        );
        m.insert(
            "{4d36e96a-e325-11ce-bfc1-08002be10318}",
            ("IDE ATA/ATAPI controllers", "storage-controller"),
        );
        m.insert(
            "{71a27cdd-812a-11d0-bec7-08002be2092f}",
            ("Storage volumes", "volume"),
        );
        m.insert(
            "{4d36e97b-e325-11ce-bfc1-08002be10318}",
            ("SCSI and RAID controllers", "storage-controller"),
        );
        m.insert(
            "{4d36e97d-e325-11ce-bfc1-08002be10318}",
            ("System devices", "system"),
        );
        m.insert(
            "{4d36e97e-e325-11ce-bfc1-08002be10318}",
            ("USB devices", "usb"),
        );
        m.insert(
            "{745a17a0-74d3-11d0-b6fe-00a0c90f57da}",
            ("Human Interface Devices", "hid"),
        );
        m.insert(
            "{50906cb8-ba12-11d1-bf5d-0000f805f530}",
            ("Bluetooth", "bluetooth"),
        );
        m.insert(
            "{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}",
            ("Bluetooth", "bluetooth"),
        );
        m.insert(
            "{4d36e965-e325-11ce-bfc1-08002be10318}",
            ("DVD/CD-ROM drives", "optical"),
        );
        m.insert(
            "{4d36e966-e325-11ce-bfc1-08002be10318}",
            ("Magnetic tape units", "tape"),
        );
        m.insert(
            "{6bdd1fc1-810f-11d0-bec7-08002be2092f}",
            ("IEEE 1394 controllers", "firewire"),
        );
        m.insert(
            "{4d36e978-e325-11ce-bfc1-08002be10318}",
            ("Ports (COM & LPT)", "port"),
        );
        m.insert(
            "{4d36e969-e325-11ce-bfc1-08002be10318}",
            ("Floppy disk drives", "floppy"),
        );
        m.insert(
            "{4d36e977-e325-11ce-bfc1-08002be10318}",
            ("PCMCIA adapters", "pcmcia"),
        );
        m.insert(
            "{4d36e970-e325-11ce-bfc1-08002be10318}",
            ("Modems", "modem"),
        );
        m.insert(
            "{4d36e971-e325-11ce-bfc1-08002be10318}",
            ("Monitors", "monitor"),
        );
        m.insert(
            "{4d36e979-e325-11ce-bfc1-08002be10318}",
            ("Printers", "printer"),
        );
        m.insert(
            "{4d36e97c-e325-11ce-bfc1-08002be10318}",
            ("Processors", "processor"),
        );
        m.insert(
            "{c166523c-fe0c-4a94-a586-f1a80cfbbf3e}",
            ("Battery", "battery"),
        );
        m.insert(
            "{72631e54-78a4-11d0-bcf7-00aa00b7b32a}",
            ("Biometric devices", "biometric"),
        );
        m.insert(
            "{ca3e7ab9-b4c3-4ae6-8251-579ef933890f}",
            ("Camera", "camera"),
        );
        m.insert(
            "{d48179be-ec20-11d1-b6b8-00c04fa372a7}",
            ("SBP2 IEEE 1394 devices", "firewire"),
        );
        m.insert(
            "{6d807884-7d21-11cf-801c-08002be10318}",
            ("Infrared devices", "infrared"),
        );
        m.insert(
            "{48d3ebc4-4cf8-48ff-b869-9c68ad42eb9f}",
            ("Software devices", "software"),
        );
        m.insert(
            "{5c4c3332-344d-483c-8739-259e934c9cc8}",
            ("Firmware", "firmware"),
        );
        m.insert(
            "{8ecc055d-047f-11d1-a537-0000f8753ed1}",
            ("Non-Plug and Play drivers", "legacy"),
        );
        m.insert(
            "{4d36e964-e325-11ce-bfc1-08002be10318}",
            ("Sound, video and game controllers", "media"),
        );
        m.insert(
            "{62f9c741-b25a-46ce-b54c-9bccce08b6f2}",
            ("Security devices", "security"),
        );
        m.insert(
            "{533c5b84-ec70-11d2-9505-00c04f79deaf}",
            ("Storage controllers", "storage-controller"),
        );
        m.insert(
            "{88bae032-5a81-49f0-bc3d-a4ff138216d6}",
            ("Sensors", "sensor"),
        );
        m.insert(
            "{7ebefbc0-3200-11d2-b4c2-00a0c9697d07}",
            ("Imaging devices", "imaging"),
        );
        m.insert(
            "{d45b1c18-c8fa-11d1-9f77-0000f805f530}",
            ("Smart card readers", "smartcard"),
        );
        m.insert(
            "{268c95a1-edfe-11d3-95c3-0010dc4050a5}",
            ("Proximity devices", "proximity"),
        );
        m.insert(
            "{997b5d8d-c442-4f2e-baf3-9c8e671e9e21}",
            ("Extension", "extension"),
        );

        m
    });

/// Look up class metadata by GUID string.
///
/// Returns a `ClassMeta` with the human-readable name and icon ID.
/// Falls back to the provided `class_name_hint` (from SetupAPI) if the GUID is not in our table.
pub fn lookup_class(class_guid: &str, class_name_hint: &str) -> ClassMeta {
    let key = class_guid.to_lowercase();

    if let Some(&(name, icon_id)) = CLASS_TABLE.get(key.as_str()) {
        ClassMeta {
            guid: class_guid.to_string(),
            name: name.to_string(),
            icon_id: icon_id.to_string(),
        }
    } else {
        // Fall back to the name from SetupAPI and a generic icon.
        let name = if class_name_hint.is_empty() {
            "Other devices"
        } else {
            class_name_hint
        };
        ClassMeta {
            guid: class_guid.to_string(),
            name: name.to_string(),
            icon_id: "other".to_string(),
        }
    }
}

/// Return all known class metadata entries, plus any extras discovered at runtime.
pub fn all_known_classes() -> Vec<ClassMeta> {
    CLASS_TABLE
        .iter()
        .map(|(&guid, &(name, icon_id))| ClassMeta {
            guid: guid.to_string(),
            name: name.to_string(),
            icon_id: icon_id.to_string(),
        })
        .collect()
}
