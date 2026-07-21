# Serial Port Notifier

## Goal

When a COM port is plugged in or removed, show a popup: e.g. **"COM5 connected"**.
This was requested before but never implemented — the app only refreshes the
device tree on COM changes (via `CM_Register_Notification`), with no popup.

## Decisions already made (don't re-ask)

- **Popup style: Both.** In-app toast when the PlugSight window is focused; a
  native Windows OS notification when it's backgrounded. Avoids double-notifying.
- **Trigger scope: user-controllable.** A persisted setting `notifyMode` with a
  toolbar cycle button: `off` → `com` (COM/serial ports only) → `all` (every
  device add/remove) → back to `off`. Default: `com`.
- Both directions (connect + disconnect) notify.

## Environment / context

- Tauri v2, Rust backend + SolidJS frontend. `bun` for JS.
- COM port name source (backend): the device's `DIREG_DEV` registry key,
  `PortName` value (e.g. `COM5` / `LPT1`) — the canonical source Device Manager
  uses. Only read for devices in the **Ports (COM & LPT)** class GUID
  `{4d36e978-e325-11ce-bfc1-08002be10318}` to keep enumeration fast.
- `Win32_System_Registry` is already enabled in the windows crate features.
- Persisted UI state lives in `localStorage` key `plugsight:ui-state`, managed in
  `src/lib/device-store.ts` (`PersistedState` + a `createEffect` auto-save).
- Toolbar cycle-button pattern: see density / linkMode buttons in `Toolbar.tsx`.

## Plan / steps

1. **Backend — port name extraction**
   - `properties.rs`: add `get_port_name()` — open `DIREG_DEV` key, read `PortName`.
   - `types.rs`: add `port_name: Option<String>` to `DeviceInfo`.
   - `enumerator.rs`: populate it, gated on the Ports class GUID.
2. **Backend — native notification plugin**
   - `Cargo.toml`: add `tauri-plugin-notification = "2"`.
   - `lib.rs`: register the plugin.
   - `capabilities/default.json`: add `notification:default`.
   - `package.json`: `bun add @tauri-apps/plugin-notification`.
3. **Frontend**
   - `types.ts`: add `portName: string | null`.
   - New `src/lib/notifications.ts`: toast signal store + native-send + focus
     routing + `NotifyMode` type. No import of device-store (avoid cycle).
   - `device-store.ts`: `notifyMode` signal, persist it, `cycleNotifyMode`,
     and `maybeNotify()` wired into `handleDeviceAdded`/`handleDeviceRemoved`
     (gated on `enumerationComplete` so startup enumeration doesn't flood).
   - New `src/components/ToastHost.tsx`: bottom-right stack; click selects device.
   - `App.tsx`: mount `<ToastHost/>`.
   - `Toolbar.tsx`: notifications cycle button (bell icon) + labels.
4. **Verify**: `cargo check`, `bun run build` (tsc), then `cargo tauri dev` and
   plug/unplug a serial adapter both focused and backgrounded.

## Findings / gotchas

- `handleDeviceAdded` runs for every device during initial enumeration (the
  `getAllDevices()` loop), so notifications MUST be gated behind
  `state.enumerationComplete` — same guard the highlight/pill flash already uses.
- Removed-device notification must read the device object BEFORE it's deleted
  from `state.devices` (the `portName` lives on that object).

## Progress log

- [x] Backend port name extraction (`get_port_name`, gated on Ports class) — `cargo check` passes
- [x] Native notification plugin wiring (Cargo, lib.rs, capability, bun package)
- [x] Frontend notifications module (`notifications.ts`) + toast host (`ToastHost.tsx`)
- [x] Store wiring (`notifyMode` persisted, `maybeNotify`) + toolbar bell button
- [x] Port name shown in DeviceDetail
- [x] `bun run build` (tsc) + `cargo check` + prettier + cargo fmt all clean
- [ ] Physical plug-test (COM adapter, focused + backgrounded) — NOT yet done;
      can't drive real hardware from here. This is the final confirmation.

## Gotcha found during build

- `SetupDiOpenDevRegKey`'s `scope` param is a bare `u32` → pass `DICS_FLAG_GLOBAL.0`,
  but `DIREG_DEV` is already a `u32` (no `.0`).

## Things not to do

- Don't read `PortName` for every device class — gate on the Ports class GUID.
- Don't fire notifications during initial enumeration.
