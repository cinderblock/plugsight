# Removed devices stay visible forever; most devices show 1 reconnect

Two bugs reported together on 2026-09-29 against v0.7.0. The first turned
out to have two causes, one of them present since the initial commit.

## Goal

1. Devices that go away stay visible forever. Find the cause and fix it at the
   source.
2. Most devices show one reconnect, which hides the real drops. Stop counting
   whatever that is, and repair the history already saved.

## Environment / context

- Installed build: v0.7.0 at `%LOCALAPPDATA%\Programs\PlugSight\plugsight.exe`
  (two instances were running when this was investigated).
- The user was in the Connections view. The persisted ghost timeout was 30 s
  (read from the WebView2 localStorage leveldb under
  `%LOCALAPPDATA%\com.plugsight.app\EBWebView\Default\Local Storage\leveldb`).
- Connection history is at `%APPDATA%\com.plugsight.app\connection-history.json`.
  A copy from before any fix ran is at `connection-history.before-reboot-fix.json`
  in the same folder.
- The machine rebooted at 2026-09-29 13:40:38 local time (and at 13:38 just
  before). v0.7.0 was released 2026-09-28, so that was the first reboot since.

## Findings

### Bug 1: removed devices stay visible

1. **The ghost timeout setting is not the cause.** It was 30 s, and the
   frontend sweep (`sweepGhosts` every 2 s) is intact.
2. **The Connections view only draws live devices** (`topologyForest` reads
   `state.devices`, never `state.ghosts`). A removed device that stays in that
   view is one the frontend believes is still *live*, not a ghost that failed to
   expire.
3. **Primary root cause: removal events never named the device.**
   `DeviceEvent` had `#[serde(tag = "type", rename_all = "camelCase")]`, which
   renames the *variants* only. `Removed { instance_id }` went out as
   `{"type":"removed","instance_id":…}`; the frontend reads `instanceId`, got
   `undefined`, and `handleDeviceRemoved` returned early. This has been true
   since the initial commit (700a2bb): removals *never* reached the frontend.
   There were no ghosts, no "disconnected" toasts, and the live row stayed. The
   serial-port notifier was only ever verified for *connect*. Found by hooking
   `onDeviceEvent` over CDP in a dev run: every `removed` event had a null ID.
   Fixed with `rename_all_fields = "camelCase"` (commit 256805a), with a
   wire-format test.
3b. **Secondary root cause: overlapping re-enumeration passes in the backend.**
   Once removals were delivered, this race could still re-add a removed device.
   `do_reenumerate_and_diff` enumerated every device *before* taking the state
   lock, and `last_enum` was only stamped after that enumeration finished. So
   while one pass was enumerating, every new notification saw "more than
   300 ms since the last pass" and started its own pass at once, on whatever
   thread delivered the notification. When a pass that captured the device
   *before* the unplug finished *after* a newer pass, its stale snapshot was
   diffed against the newer `known` map. The device looked newly added, the
   pass emitted `Added`, and the row came back live. Nothing removed it again
   until some unrelated PnP event caused another pass.
4. **A pass takes ~500 ms on this machine**: 341 devices in 491, 462 and 551 ms,
   measured with a throwaway `#[ignore]` test around `enumerate_all_devices`.
   That is longer than the 300 ms debounce, so on a USB unplug burst (dozens of
   CM and WinRT notifications) overlap is the norm, not a fluke.
5. The immediate path also ran a full ~500 ms enumeration inline on the
   `CM_Register_Notification` callback thread, which Windows expects to return
   quickly.

### Bug 2: most devices show 1 reconnect

6. **Root cause: a reboot was read as a drop of every device.** Windows
   re-stamps every device's `LastArrivalDate` at boot but records no
   `LastRemovalDate` at shutdown. `History::reconcile_present` treated "Windows
   says it arrived later than we recorded" as a missed drop and, with no removal
   date in the gap, stamped the removal at the arrival's own millisecond.
7. Evidence from the saved history: 326 of 391 devices had a reconnect; 343
   remove→arrive pairs had *identical* millisecond timestamps, 294 of them within
   0–1 minute of the 13:40:38 boot. No device had a distinct removal date across
   the reboot, so Windows really does record nothing at shutdown.
8. Applying the repair rule (drop same-millisecond remove→arrive pairs) to that
   file leaves 35 devices with reconnects, all of them ones that really flapped
   today (Vermon DKPOC, TI hubs, GhostCOM COM20, Bluetooth LE services, etc.).

## Decisions already made

- Fix bug 1 in the backend so passes never overlap. A frontend-only workaround
  (e.g. ignoring `Added` for recently removed IDs) would hide real re-plugs.
- The user asked whether a "hide disconnected devices" checkbox is needed. It
  would not have helped: the stuck rows were live, not ghosts. The toolbar's
  ghost-timeout dropdown already controls how long ghosts stay.
- Bug 2: an arrival within 2 minutes after the current boot (the frontend's
  existing `BOOT_WINDOW_MS`), for a device last recorded arriving before the
  boot, with no Windows removal date in between, starts a new baseline instead
  of counting as a drop. A removal Windows *did* record still counts, and so
  does an arrival well after boot.
- Existing files are repaired once on load. The file gains a `version` field.
  Version 0 (v0.7.0) drops every same-millisecond remove→arrive pair, which in
  v0.7.0 only came from the no-removal-date guess.

## Plan / steps

1. [x] Diagnose bug 1.
2. [x] Bug 1: one refresh worker thread (`RefreshRequests` in `watcher.rs`).
   Callbacks only raise a flag. The worker waits out the debounce, clears the
   flag, then runs the pass, so a notification during a pass always gets
   another. The state lock is held across enumerate + diff + emit, so the manual
   scan is serialized too. A panicking pass no longer poisons the lock or kills
   the worker.
3. [x] Unit tests for the request/coalescing logic (5 tests).
4. [x] Diagnose bug 2.
5. [x] Bug 2: `reconcile_present` takes the boot time; `history::decorate`
   and `history::boot_ms` helpers; `upgrade()` + `forget_restart_drops()` on
   load; 4 new tests.
6. [x] Verified in a dev run with GhostCOM create/destroy of COM20 (below).
   This is what found the serialization bug (finding 3).
7. [x] Fix removal serialization (`types.rs`).
8. [x] Committed as three commits: 256805a (removal events), bff8f06 (reboot
   reconnects), and the watcher race + this plan.
9. [x] Released v0.7.1 (tag on release commit d2a365f, user-approved). Release workflow succeeded; published 2026-09-30T02:10Z with Setup.exe, MSI, portable zip, both `.sig` files and a `latest.json` that advertises 0.7.1 with the Setup.exe signature.

## How to inspect the running frontend (reusable)

Tauri overrides `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, so pass the debugging
port through the window config instead. It must restate the whole window entry,
since `--config` replaces the `windows` array:

```bash
RUST_LOG=plugsight_lib=debug cargo tauri dev --config '{"app":{"windows":[{"title":"PlugSight","width":680,"height":800,"minWidth":600,"minHeight":400,"resizable":true,"fullscreen":false,"additionalBrowserArgs":"--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=9229"}]}}'
```

Then `Runtime.evaluate` over the page's `webSocketDebuggerUrl` (from
`http://localhost:9229/json`) with `awaitPromise` + `returnByValue`.
`await import('/src/lib/device-store.ts')` returns the app's *own* module
instance from Vite, so `m.state`, `m.counts()` etc. are live. Hook events with
`(await import('/src/lib/tauri.ts')).onDeviceEvent(...)`.

## Live verification results (2026-09-30 00:18–00:21 UTC)

- Before the serialization fix: 5 COM20 cycles. The backend emitted 3 Removed;
  the frontend received 3 `removed` with ID `null`, and ended with COM20 live
  (344 live, 0 ghosts).
- After: the frontend received every `removed` with the ID. It ended with 343
  live and COM20 as a ghost, which expired at exactly +30 s.
- Passes are strictly sequential in the log. Notifications landing mid-pass get
  a follow-up pass. One removal pass took 1.66 s.
- The v0 history file was upgraded on load (`"version":1`; reboot pairs became
  arrive→arrive). 19 live devices show reconnects, all genuine flappers.

## Progress log

- [x] All three root causes found and evidenced.
- [x] All fixes implemented; `cargo clippy --all-targets` clean; 34 Rust tests
      pass.
- [x] Verified live
- [x] Committed
- [x] Released as v0.7.1

## Open questions for the user

1. Should the ghost-timeout dropdown gain an "Off" choice, so removed devices
   disappear at once instead of fading for at least 5 s? Recommendation: yes,
   it's cheap, but not needed for either bug.
2. ~~Cut a v0.7.1 release?~~ Approved; tagged v0.7.1.

## Release gotcha

- `bun run version:bump patch --tag` tags the *current* commit **before** the bump
  is committed, i.e. the wrong commit. Bump without `--tag`, run `cargo check` to
  refresh `Cargo.lock`, commit "Release vX.Y.Z", then `git tag` that commit.

## Things not to do

- Don't "fix" bug 1 in the frontend by ignoring `Added` events: real re-plugs
  must still show up.
- Don't run the enumeration on a PnP callback thread.
- Don't assume `LastRemovalDate` covers shutdowns: it doesn't.

## Known remaining edges (not fixed here)

- At startup the frontend's `getAllDevices` list is enumerated independently of
  the watcher's `known` snapshot. If a device is removed while that call is in
  flight, its `Removed` event can arrive before the list and be ignored, leaving
  the device live. The window is only one enumeration long, at startup.
- Resume from sleep/hibernate is not a boot. If Windows re-stamps arrival dates
  on resume without removal dates, those would still read as drops. Not
  observed; revisit if the user sees reconnects line up with wake times.
