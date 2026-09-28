# Merge the two halves of a USB 3 hub into one row

## Goal

Windows enumerates every USB 3 hub as two logical hubs: a USB 2 half (e.g.
"Generic USB Hub", `VID_0BDA&PID_5411`) and a USB 3 half ("Generic
SuperSpeed USB Hub", `VID_0BDA&PID_0411`). The Connections tree therefore
shows two parallel chains for one physical chain of hubs, with USB 2 devices
under one and USB 3 devices under the other. Folding each pair into one row
makes the tree match the hardware on the desk, which is the point of the
view. Cameron asked "can/should we combine them?" during the v0.4.0 release
and said "keep going" after v0.5.0; the recommendation in
`plans/link-speeds.md` (open question 1) is what's being built.

## Environment / context

- Repo: PlugSight, `C:\Users\camer\git\Personal Projects\new device manager`.
- Link-speed work that this builds on: `plans/link-speeds.md` (v0.5.0).
- `src-tauri/src/device/link/usb.rs` already finds each USB 2 half's
  SuperSpeed companion port (driver-reported via
  `IOCTL_USB_GET_PORT_CONNECTOR_PROPERTIES`, or derived by walking up to a
  hub that reports one) and sets `companion_connected`.
- Topology transforms are pure functions in `src/lib/topology.ts`, composed
  in `device-store.ts`'s `topologyForest` memo (`elideHidden` first, then
  build / filtered build).

## Decisions already made (don't re-ask)

- Merge only in the Connections tree (and the USB category's nested mode if
  it's a clean fit). The category view's flat lists stay raw: that view
  mirrors Windows' own device list.
- The USB 3 half is the row (primary); the USB 2 half folds into it (twin).
- Merge only when the twin is positively identified. A half whose companion
  can't be found, or whose USB 3 side is down, stays a separate row — that
  is exactly the case the amber chips exist to expose.
- The row shows the USB 3 half's speed chip only (Cameron, 2026-09-28: "the
  fast is enough"; it first shipped with both in v0.6.0); children of
  both halves hang under it, each with its own chip.
- Status shown is the worse of the two halves. Search and the problems
  filter match either half. Hide hides both. Selection highlights the row if
  either half is selected.
- Detail pane on a merged row: an extra section describing the USB 2 half
  (name, speed, instance ID).
- No toggle for now; the category view is the raw view.

## Plan / steps

1. [x] Backend: `companion_id: Option<String>` on `LinkInfo::Usb` — the
       instance ID of the device on the companion port, resolved from the
       hub's symbolic link name via `CM_Get_Device_Interface_PropertyW`
       (`DEVPKEY_Device_InstanceId`), not by string-munging the link name.
2. [x] `topology.ts`: `mergeUsbHubTwins(devicesById, childrenByParent,
       parentByChild)` → same maps + `twins: Map<primaryId, DeviceInfo>`;
       `TopoNode.twin`; `subtreeHasProblem` considers twins. Tests.
3. [x] Store: apply after `elideHidden`; attach twins to nodes; search and
       problems predicates consider the twin; export a twin lookup for the
       detail pane.
4. [x] UI: `TopologyView` row (chips, status, selection, hide both);
       `DeviceDetail` twin section.
5. [x] USB nested category mode: **skipped, not clean** (see Findings).
6. [x] Verified live on this machine's hub chains; README; committed.

## Findings / gotchas

- The USB category's nested mode renders through `DeviceEntry`, the same row
  as the flat category view, and `RelationArrows` finds rows there by
  `data-instance-id`. Dropping the USB 2 half's row would leave arrows to or
  from it with no target. That view is the "Windows' raw list" side of the
  app anyway, so it stays unfolded.
- Live: every USB 2 hub half on this machine (Realtek 5411, Genesys 0610,
  and a TI and a Microchip hub found via the root hub's companion ports) got a
  `companion_id`. Searching "hub" in Connections now shows one chain of
  "Generic SuperSpeed USB Hub" rows with `5 Gbps` `480 Mbps` chips instead of
  two parallel chains; a USB 2 receiver that sat under the USB 2 half sits
  under the folded row. Detail pane shows the "USB 2 side of this hub" section.
- Caught live: with the detail pane open, deep rows lost their names entirely
  — two chips plus the invisible hover buttons (in-flow, `opacity-0`) took the
  whole width. Fix in `TopologyView`: the name has `min-w-[5rem]` and shrinks
  first, chips sit in an `overflow-hidden` wrapper and clip, and the hover
  actions float (`absolute`, backed) over the right edge instead of reserving
  width. Verified: names show as "Generic Su…", hover buttons appear over the
  chips.
- Not verified live: hide-both on a folded row (it persists hidden state; the
  logic is two calls), selection highlighting when the USB 2 half is selected
  from the category view.
- The USB 2 half's link note used to say "the USB 3 side is its own row";
  reworded, since in the Connections tree it no longer is.

## Progress log

- [x] 2026-09-26: design written.
- [x] Backend `companion_id` (clippy clean); `pairUsbHubTwins`,
      `mergeUsbHubTwins`, `attachTwins`, `worseStatus`; 6 new tests (52 total
      pass); store, Connections row, detail pane; README.
- [x] Live verification + row layout fix; committed as `1ce35d9`.
- [x] Released in **v0.6.0** (`a2bf6c4`, 2026-09-28), together with another
      session's curved Connections-tree lines (`1418609`). `main` pushed and
      CI green before tagging; release run 36474704946 published all six
      assets; manifest checked (version 0.6.0, trusted comment
      `file:PlugSight_0.6.0_x64-setup.exe` / `version:0.6.0`, installer URL 200).

## Open questions for the user

1. The orphan tags v0.4.0 and v0.4.1 (no releases attached) are still on
   GitHub. Deleting them removes pushed refs, so it needs an explicit yes.

## Things not to do

- Don't derive instance IDs by rewriting `USB#VID..#inst#{guid}` into
  `USB\VID..\inst`: instance IDs aren't guaranteed to be free of `#`. Ask
  Windows.
- Don't merge in the category view.
- Don't add `title=` attributes.
