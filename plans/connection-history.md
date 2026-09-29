# Connected-for readout and reconnect history

## Goal

Two per-device readouts, asked for by Cameron on 2026-09-28:

1. **How long the device has been connected**, short form on each row: `20s`, `50m`,
   `5h`, `2d`, or `boot` when it has been there since the machine started. Hover shows
   the real time. The green/red arrival/removal flashes are too brief to rely on.
2. **How many times it has disconnected and reconnected**, so a flaky USB device that
   drops while nobody is watching leaves a visible record. Hover shows a sparkline of
   when, and the detail pane has the particulars.

## Environment / context

- Repo: PlugSight, `C:\Users\camer\git\Personal Projects\new device manager`
  (Tauri v2, Rust + SolidJS). v0.6.0 released; tree-line redraw and single-chip hub
  rows committed locally on top (`ad395b0`, `16548b1`), not pushed.
- Windows records `DEVPKEY_Device_LastArrivalDate` / `LastRemovalDate`
  ({83da6326-97a6-4088-9453-a1923f573b29}, pids 102 / 103, `FILETIME`). Probe on this
  machine: boot at 2026-09-26 18:17:58 (CIM `LastBootUpTime` and `GetTickCount64`
  agree to 0.5 s); boot-present devices show arrival 2–33 s after boot (PCI ~2 s, USB
  receivers ~31–33 s). Fast Startup is on (`HiberbootEnabled=1`) and the tick-count
  boot still matches, so tick count is a fine boot clock.
- The watcher's `CM_Register_Notification` callback gets `CM_NOTIFY_EVENT_DATA` whose
  `u.DeviceInstance.InstanceId` names the device.
- GhostCOM (`~/git/playgrounds/ghostcom`, built) creates/destroys real virtual COM
  ports — a way to generate real arrivals/removals for testing. `make-port.ts`.

## Decisions already made (don't re-ask)

- **Arrival time comes from Windows** (`LastArrivalDate`), not from when the app first
  saw the device, so it's right across app restarts.
- **`boot`** = arrived within 120 s of boot. (Boot enumeration of USB devices ran to
  ~33 s here; 120 s leaves room for slower machines. A device plugged in during the
  first two minutes after boot also reads `boot`; accepted.)
- **Reconnects are recorded from the CM notification callback, per instance ID, not
  inferred from list diffs.** The list refresh is debounced 300 ms, so a device that
  drops and returns inside that window never shows up as removed in a before/after
  diff — which is exactly the flaky case this is for. Arrival is recorded on
  `ENUMERATED` or `STARTED` only when the last recorded event is a removal (so a
  disable/enable or driver restart, which fire `STARTED` without `REMOVED`, don't
  count); removal on `REMOVED`.
- **Backstop from Windows' own dates.** Each enumeration pass reconciles: if a present
  device's `LastArrivalDate` is more than 5 s after the last arrival we recorded, a
  drop happened that we didn't see (app not running, or a lost notification); record
  a removal (at `LastRemovalDate` when it falls in between) and the arrival.
- **History lives in the backend**, persisted to `connection-history.json` in the app
  data dir (atomic write, only when changed). Per device: last 400 events, 90 days;
  devices with nothing newer than 90 days are dropped.
- `DeviceInfo` gains `arrivedAt` (ms since epoch), `reconnects`, and
  `connectionEvents` (most recent 100). The list diff treats a change in any of them as
  an update, so a flap inside one debounce window still refreshes the row.
- **Row readout**: right-aligned, muted, tabular (`20s` … `boot`); a reconnect chip
  (↻ N) beside it only when N > 0, amber if the latest drop was in the last 24 h.
- **Hover details float over the page** (portal, fixed position, flips above near
  the bottom). The existing CSS `Tooltip` would be clipped by the tree's scroll
  container on the last rows. Everything in a hover is also in the detail pane,
  so nothing is hover-only.
- **Sparkline** (dataviz skill consulted): a single-series event strip — neutral
  track over the recorded span, gaps where the device was away, amber tick per drop,
  start/now labels; the count and icon sit beside it so colour isn't the only cue.
  The detail pane's list of drops is its table view.
- Category view rows float their hover actions like the Connections rows already do,
  so the new right-aligned column isn't pushed in by invisible buttons.

## Plan / steps

1. [x] Backend `history.rs`: pure store (record_arrival / record_removal / reconcile
       / summary / prune) + Rust tests; persistence; global instance initialised in
       `setup` with the app data dir.
2. [x] Enumerator reads `LastArrivalDate` / `LastRemovalDate` (FILETIME helper).
3. [x] Watcher: CM callback records ENUMERATED/STARTED/REMOVED per instance; every
       enumeration path decorates devices with history (initial stream, diff pass,
       get_all/get_device_detail); diff compares the new fields; save when dirty.
4. [x] `system_boot_time` command.
5. [x] Frontend: types; `connection-time.ts` (formatting + drop list, tested); 1 s
       clock; `HoverCard` (portal); `ConnectionReadout` + `ReconnectSparkline`;
       rows in both views; detail pane "Connection" section.
6. [x] Verify with GhostCOM create/destroy cycles and a restart of the app
       (persistence + reconcile); screenshots.
7. [x] README + CLAUDE.md; commit.

## Findings / gotchas

- **Pre-existing watcher bug found and fixed.** GhostCOM re-creating a port it
  had removed produces `CM_NOTIFY_ACTION(7)` = ENUMERATED and **no** STARTED
  (debug log: only actions 7 and 9 for `GCOM\COMPort\1&431a56f&1&20`). The watcher
  refreshed only on STARTED/REMOVED, so the re-arrival never reached the list, and
  the following removal found nothing to remove. The app showed a stale COM20
  "connected since" the first arrival with no reconnects, while the backend history
  (from the callback) had every cycle. Fix: refresh on ENUMERATED too. Real USB
  re-plugs normally send both, which is probably why this went unnoticed; the serial
  notifier had the same blind spot. Committed separately.
- The history file is only written at the end of a refresh pass, so an event
  recorded by the callback is lost if the app dies before the (≤300 ms later) pass.
  Seen once, *because* of the bug above (no pass ran). Acceptable.
- Row hover trays covered the new right-hand readout, so its hover couldn't be
  reached and the cursor landed on the hide button. The tray is now anchored just
  left of the readout group (`absolute right-full` inside a wrapper at the row's end).
- Sparkline: a fixed 280 px strip overflowed the ~240 px detail pane; positions are
  now `%` of the SVG width. SVG hit targets in a nested viewport didn't receive
  hover, so the per-tick targets are HTML elements at `calc(x% - 5px)`.
- Testing hover with Win32 mouse moves: aim in page coordinates. Window captures
  include the frame (8 px left, ~31 px top), so ticks read off a capture are offset;
  CDP `Input.dispatchMouseEvent` confirmed hover works. CDP needs
  `additionalBrowserArgs` with `--remote-debugging-port=9222` temporarily in
  `tauri.conf.json` (reverted after; see `plans/topology-tree-lines.md`).
- Light mode: "boot" in `gray-300` was ~1.5:1 on white; stepped to `gray-400` (ages
  `gray-600`), matching the app's other secondary text.

## Verification (2026-09-28)

- History file after startup: 358 devices, one baseline arrival each.
- GhostCOM COM20, 3 × (create, hold 4 s, destroy) + a held create: arrivals and
  removals recorded to the millisecond; with the ENUMERATED fix, every arrival
  emits Added and every removal Removed within ~1 s. Row shows `↻ 8` (amber) and
  the age; hover card shows count, last drop, 1 h strip, timestamp; age hover shows
  the connect time; detail pane lists all 8 drops with away durations; per-tick
  hover names the drop. After an app restart the count and history persisted.
- Boot-present rows read `boot`; two HID devices plugged in later read `32m`, `1d`.
- Rust 24 tests (13 history), frontend 67 tests (15 connection-time), clippy
  `--all-targets -D warnings`, fmt, tsc, Prettier, vite build: all pass.
- Not verified on hardware: a real USB device's flap (no one to unplug one);
  GhostCOM exercises the same notification path.

## Progress log

- [x] 2026-09-28: probes (arrival dates, boot clock), design, plan.
- [x] Implemented, verified live with GhostCOM, committed.
- [x] Released in **v0.7.0** (`fb7d49c`, 2026-09-28) with the tree-line redraw, single-speed hub rows and the ENUMERATED fix. `main` pushed and CI green before tagging; release run 36505350139 published all six assets; manifest checked (version 0.7.0, trusted comment `file:PlugSight_0.7.0_x64-setup.exe` / `version:0.7.0`, installer URL 200).

## Open questions for the user

1. Orphan tags v0.4.0 / v0.4.1 still need an explicit yes to delete (carried over).

## Things not to do

- Don't count reconnects from the debounced list diff alone.
- Don't use `title=` for the hover text (standing rule); use the floating card.
- Don't read the Kernel-PnP event log for history — the notification + Windows'
  arrival dates are enough, and the log needs parsing and is off on some machines.
