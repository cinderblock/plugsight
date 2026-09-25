# Link speeds in the tree (USB + PCIe)

## Goal

Show each device's upstream link speed inline in both tree views, and make it
obvious where a chain degrades: a USB 3 device negotiated down to 480 Mbps, or a
PCIe device running below its own max generation / lane width. Cameron asked
for this on 2026-09-25: "see where in the chain USB3 became USB2, or if a PCIe
lane is running at a lower gen speed".

## Environment / context

- Repo: PlugSight, `C:\Users\camer\git\Personal Projects\new device manager`
  (Tauri v2, Rust backend + SolidJS). `windows` crate 0.58.
- Shared working tree: `src/components/DeviceIcon.tsx`, `src/lib/icons.ts`,
  `src/lib/updater.ts` carry another session's uncommitted edits. Don't stage
  them. Coordination file `.agent.status` (untracked, never committed).
- Data sources, verified on this machine (see Findings):
  - **PCIe**: SetupAPI properties `DEVPKEY_PciDevice_CurrentLinkSpeed` (pid 9),
    `CurrentLinkWidth` (10), `MaxLinkSpeed` (11), `MaxLinkWidth` (12), fmtid
    `3ab22e31-8264-4b4e-9af5-a8d2d8e33e62`, all UINT32. Speed encoding is the
    PCIe spec's: 1=2.5 GT/s (Gen1), 2=5 (Gen2), 3=8 (Gen3), 4=16 (Gen4),
    5=32 (Gen5), 6=64 (Gen6).
  - **USB**: no DEVPKEY carries speed. It comes from the *parent hub*: open the
    hub's `GUID_DEVINTERFACE_USB_HUB` interface and issue
    `IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX` (Speed: low/full/high/super)
    and `..._EX_V2` (SuperSpeed / SuperSpeedPlus operating + capable flags, and
    the port's supported protocols) for `ConnectionIndex` =
    `DEVPKEY_Device_Address` (pid 30) of the child. This is what USBView does.

## Decisions already made (don't re-ask)

- Backend computes the link facts; frontend formats them. New optional
  `link` field on `DeviceInfo` (`null` when the bus has no link concept).
- Composite-device function children (`USB\...&MI_xx`) get no link of their
  own: the chip belongs to the physical device row. No propagation.
- Chip is inline text (no `title=`, per the standing rule). Degraded links
  show both numbers in the chip ("480 Mbps of 5 Gbps") in amber; healthy links
  show just the speed in a neutral pill.
- Search matches the chip text too (e.g. "480 mbps", "gen1").

## Plan / steps

1. [x] Verify data sources on this machine (PowerShell probes).
2. [x] Backend: `LinkInfo` type, `link.rs` (PCIe property read + USB hub IOCTL),
       wire into `build_device_info`, include in `device_changed`.
3. [x] Frontend: `types.ts`, pure `src/lib/link-speed.ts` (+ tests),
       `LinkBadge.tsx`, rows in `DeviceEntry`/`TopologyView`, detail pane rows,
       search.
4. [x] Verify in `cargo tauri dev` against real hubs; check the false-positive
       cases listed under Findings.
5. [x] README + CLAUDE.md structure list. [x] Committed as `2282cb3` (amended to include this line).

## Findings / gotchas

- **Serde trap**: `rename_all = "camelCase"` on a tagged enum renames only the
  *variants*. Struct-variant fields need their own `#[serde(rename_all)]` on
  each variant, or they go out snake_case and the frontend silently reads
  `undefined` (first live run: every hub looked degraded for this reason).
- **Confirmed the USB 3 hub false positive**: the USB 2 logical half of every
  USB 3 hub reports `DeviceIsSuperSpeedCapableOrHigher` while running at
  High-speed. Fix: `IOCTL_USB_GET_PORT_CONNECTOR_PROPERTIES` names the port's
  SuperSpeed companion (hub symbolic link + port); if a device is connected
  there, this row is the USB 2 shadow of a hub whose USB 3 half is up
  (`companion_connected`), not a downgrade.
- The driver names companions for root-hub ports and the Realtek hubs, but
  **not** for Genesys (`VID_05E3`) hub ports or the Realtek hub's port 1
  (probably internal / not user-connectable). Fallback: a hub's two halves
  number ports identically, so the twin of hub2 = the hub sitting on the
  companion of hub2's *own* upstream port (`IOCTL_USB_GET_NODE_CONNECTION_NAME`
  gives the child hub's link name), recursing upward until a companion is
  reported or the root hub is reached (its parent is PCI, not a hub). With
  this every 2.x half on this machine resolves `companion_connected: true`.
- `DEVPKEY_Device_ContainerId` is useless for pairing the halves: all hubs
  here report the generic `{20B9CDE5-7039-E011-A935-0002A5D5C51B}`.
- Hub symbolic link names from the IOCTLs have no prefix
  (`USB#VID_...#{guid}`); open them as `\.\` + name, like USBView.
- Only PCIe **endpoints** (DeviceType 2) expose the link speed keys on this
  machine. Root ports (type 8) and switch ports (9/10) expose the other
  `PciDevice` keys but not link speed/width — the chip will be absent on
  them, which is fine: the endpoint's row says what its link runs at.
- USB composite children have `DEVPKEY_Device_Address` = interface number and
  parent = the composite device (not a hub). Asking for the hub interface of a
  non-hub parent returns an empty list; that's the "no link" signal.
- A USB 3 hub is two logical hubs in Windows (e.g. `VID_0BDA&PID_5411` "USB2.1
  Hub" and `VID_0BDA&PID_0411` "USB3.2 Hub"). A USB 3 device that falls back
  to USB 2 shows up under the 2.x logical hub. Watch for the 2.x logical hub
  itself reporting "SuperSpeed capable" — that would be a false degraded flag
  on every USB 3 hub. (Check empirically in step 4.)

## Progress log

- [x] 2026-09-25: probes run; plan written.
- [x] Backend + frontend written. `cargo check`/`clippy`/`fmt` clean; `tsc` clean;
      `bun test` 28 pass (14 new in `link-speed.test.ts`).
- [x] Gotchas hit: `gen` is a reserved word in Rust 2024 (field is `generation`);
      the crate marks `USB_NODE_CONNECTION_INFORMATION_EX` packed, so copy fields
      out before comparing (E0793).
- [x] Live verification in `cargo tauri dev` (screenshots via PrintWindow):
      Connections tree shows `480 Mbps` / `5 Gbps` / `12 Mbps` chips on hubs and
      devices, `Gen3 ×4` on the NVMe drive; category view shows chips beside
      names; detail pane shows "USB link / Running at 480 Mbps (High-speed,
      USB 2.0)" plus the two-halves note; search "NVM" / "SuperSpeed" works.
      No genuinely degraded link on this machine to photograph — the amber
      path is covered by unit tests only.
- [x] Committed (`2282cb3`), only my files staged; the other session's
      DeviceIcon.tsx / icons.ts / updater.ts left unstaged. Not pushed.

## Things not to do

- Don't add `title=` attributes. Don't touch the other session's three
  modified files. Don't commit `.agent.status`.
- Don't trust `port_usb3` alone to decide degraded-ness: the USB 2 half's
  ports report USB 2 protocols only even on a USB 3 hub. Use the companion /
  twin check.
- Don't edit repo files with Python's default (cp1252) encoding — it wrote
  `—`/`…` as single bytes into UTF-8 files once. Always `encoding='utf-8'`.
- Don't read link speed through WinRT — `DeviceInformation` has no such
  property; the SetupAPI + hub IOCTL path is the only one.
