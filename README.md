# PlugSight

**Device Manager++ for Windows** — see your devices the moment they connect.

A modern replacement for the Windows Device Manager, built with [Tauri v2](https://v2.tauri.app/) (Rust + SolidJS).

## Why?

The official Windows Device Manager has a fundamental UX problem: **every change refreshes the entire device tree**. You can never watch the list grow. You can never see what just disappeared. Tiny 8-pixel error overlay icons are nearly invisible. PlugSight fixes all of that.

## Key Features

### Animated Device Changes
When you plug in a USB device, you see it slide into the list with a green highlight flash. When you unplug it, it doesn't vanish — it fades into a **ghost entry** that stays visible for 30 seconds, clearly labeled "Removed 5s ago", so you can see exactly what left the system. Category headers show animated **+N / −N pills** as devices come and go.

### Ghost Entries for Removed Devices
Recently removed devices appear faded with a dashed border, a strikethrough name, and a timestamp. You can still click them to view their last-known properties. A dismiss button lets you clear individual ghosts, or clear all from the toolbar. The selector at the right of the toolbar sets how long they stay: **Off** (removed devices leave the list at once), 5 s to 1 h, or **Never**.

### Clear Status Indicators
Problem devices are marked with **large, inline status badges** — not tiny overlay icons:
- **Red badge** with exclamation for errors
- **Amber badge** with warning triangle for warnings
- **Gray badge** with slash for disabled devices
- **Yellow badge** with question mark for missing drivers

Each problem device also gets a **colored left border** (4px red/amber/gray) and the error message displayed as secondary text.

### Real-Time Updates
Uses the WinRT `DeviceWatcher` API for incremental change notifications. The UI never does a full refresh — only the affected device entry updates, with smooth CSS transitions. Backend change events are debounced (300 ms) to avoid UI thrashing during rapid hardware changes.

### Device Detail Panel
Selecting a device slides in a detail panel showing full properties — hardware IDs, instance path, manufacturer, driver info, and more. Works for both live and ghost devices (showing last-known properties).

### Grouped Tree View
Devices are organized by setup class (Display adapters, Network adapters, USB controllers, etc.) with collapsible category headers showing device counts and problem counts. Native Windows class icons are extracted from the registry and displayed alongside each category.

### Connections View
A toolbar toggle swaps the class-grouped list for a connection-topology tree (USB host controller → root hub → hub → device; PCI device → bus). The tree expands down to the physical-plug level by default — device internals (composite-device interfaces, HID stacks) start collapsed — and runs of identically-named siblings collapse into expandable ×N group rows. Windows lists every USB 3 hub twice, a USB 2 half and a USB 3 half on paired ports, so a chain of hubs normally shows up as two parallel chains. The Connections tree folds each pair into one row showing the hub's USB 3 speed, with every device under the hub it's actually plugged into; the detail panel names the other half. A half whose twin can't be found — its USB 3 side is down, say — stays its own row, where its amber chip says why. The category view keeps Windows' raw list. Every row carries the same hover actions as the category view: open Windows properties, or hide the device. Faint lines trace the wiring down the left: each expanded parent drops a line from its chevron that curves into every child, thickest at the root and thinner at each level, with neighbouring branch sets in different muted hues so it's easy to see which hub a row hangs off.

### USB Physical Nesting
The **USB controllers** category has a toggle on its header that switches it from the flat list to a tree nested by physical connection — host controller → root hub → hub → device — matching the real plugs and hubs on your machine. Runs of identical devices on the same hub still collapse into expandable group rows, and unplugged hubs keep their ghost children nested beneath them.

### Parent/Child Link Arrows
In the **Categories** view, selecting a device draws orthogonal connectors to its related devices — parent through the left gutter (amber), children through the right gutter (cyan). Hovering a different device overlays its relationships as a second, desaturated set. A toolbar button cycles the arrows through three modes: shown for selected + hovered, selected only, or hidden entirely.

The Connections view draws no arrows, and the toolbar button hides itself there: that tree's indentation already *is* the parent→child wiring, so every connector would restate the nesting it sits on.

### Link Speeds
Every USB device, PCIe endpoint, wired network adapter, and SATA drive carries a chip with the speed of its link: **480 Mbps**, **5 Gbps**, **Gen3 ×4**, **LAN 1 Gbps**, **SATA 6 Gbps**. A USB or PCIe network adapter gets two chips, bus first, so a 2.5 GbE dongle stuck on a 480 Mbps port is obvious at a glance. When a device runs below what it advertises — a USB 3 drive that came up at USB 2, an NVMe drive trained at Gen1 or with fewer lanes, a gigabit adapter that negotiated 100 Mbps, a 6 Gbps SATA drive at 3 Gbps — the chip turns amber and shows both numbers inline (**480 Mbps of 5 Gbps**), so you can walk the Connections tree and see exactly where the chain slowed down. The detail panel spells it out and says whether the port only carries USB 2 or whether the port could do better (try another cable). Search matches the chip text, so "480 mbps" or "degraded" lists the slow links.

USB speeds come from the parent hub (the same hub IOCTLs USBView uses). Windows lists a USB 3 hub as two logical hubs, one per speed; the USB 2 half advertises SuperSpeed while running at 480 Mbps, so PlugSight checks the port's SuperSpeed companion before calling a link degraded, and the detail panel says when a row is just the USB 2 side of a hub whose USB 3 side is up. PCIe comes from the `DEVPKEY_PciDevice_*Link*` device properties, which Windows only reports for endpoints — root and switch ports show no chip.

Ethernet speed comes from the IP Helper interface table; the adapter's maximum is the fastest option in its own Speed & Duplex setting, and a speed fixed by hand there is shown but not flagged. An unplugged adapter shows **LAN no link**, and the chip refreshes when a cable is plugged in or the link renegotiates. Wi-Fi gets no chip: its rate changes every few seconds, so any number shown would already be stale. SATA speed comes from the drive's IDENTIFY data (words 76 and 77) through the storage stack's protocol query, which needs no admin rights; drives too old to report their negotiated speed get no chip.

### Connected Time & Reconnect History
Every row ends with how long the device has been connected — **20s**, **50m**, **5h**, **2d**, or **boot** for devices that have been there since the machine started — with the exact time on hover. The time comes from Windows' own record of when the device arrived, so it's right even for devices that were plugged in before PlugSight started.

A device that has dropped out and come back carries a **↻ N** reconnect count, amber if the latest drop was within a day. Hover it for a sparkline of when the drops happened; the detail panel lists each one with its time and how long the device was away, and hovering a tick on its sparkline names that drop. Drops are recorded as Windows reports them, device by device, so a flaky USB device that disconnects for a fraction of a second while you're away still leaves a mark. PlugSight also fills in the latest drop Windows remembers from while it wasn't running. Restarting the machine isn't counted as a drop. History is kept for 90 days, in a SQLite database (`connection-history.sqlite3` in `%APPDATA%com.plugsight.app`) that you can open in any SQLite viewer. Versions before 0.7.2 kept it in `connection-history.json`, which is imported on first launch and then renamed to `connection-history.json.imported`.

### Serial Port Notifications
Get a **"COM5 connected"** popup the moment a serial port is plugged in or removed — an in-app toast when the PlugSight window is focused, or a native Windows notification when it's in the background. A toolbar bell button cycles what triggers a popup: off, COM/serial ports only, or every device change. The COM/LPT port name (read from the device's registry `PortName`) also appears in the detail panel.

### Search, Filter & Hide
- **Full-text search** across device names, COM/LPT port names, link speeds, descriptions, manufacturers, hardware IDs, and instance IDs. Works in both views, and matches never hide behind a collapsed category, hub, or group — including devices plugged in while the search is active.
- **"Problems only" toggle** filters the tree to show only devices with errors, warnings, or missing drivers.
- **Hide individual devices or entire categories** to declutter the view — hidden state persists across sessions. Hiding removes exactly that one row: in the Connections tree the wiring closes up around it, and anything plugged into a hidden hub reparents to the nearest ancestor still showing rather than disappearing with it.
- **Solo mode** on category headers isolates a single category, collapsing everything else.

### Persistent UI State
Search query, filter state, category expansion, and hidden devices/categories are all saved to `localStorage` and restored on next launch.

### One Window
PlugSight runs once per user. Launching it again while it's running brings the open window to the front instead of starting a second copy that would watch the same devices and raise the same notifications twice.

### In-App Auto-Updates
Installed builds (NSIS/MSI) use Tauri's native updater to download, verify, and install updates seamlessly. Portable builds fall back to polling GitHub Releases. Checks run on launch and every 30 minutes, and clicking the version number in the bottom-left corner checks right away. Everything about updates appears right beside that version number: "Checking…" while it looks, "Up to date" or "Couldn't check for updates" after a check you asked for, and an **Update to x.y.z** badge when there's a newer release — which installs in place with its download progress shown in the same spot, or, for portable builds, opens the release page.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| App Shell | Tauri v2 | Lightweight (~5 MB), uses system WebView2, Rust backend for direct Win32 API access |
| Backend | Rust | Direct bindings to SetupAPI + WinRT via `windows-rs` crate — no FFI layer needed |
| Frontend | SolidJS | Fine-grained reactivity: one device change = one DOM update, not a full tree diff |
| History | SQLite (`rusqlite`, bundled) | One small insert per connection event, safe to share between processes, readable in any SQLite viewer |
| Styling | Tailwind CSS v4 | Utility-first CSS with dark mode support |
| Animations | solid-transition-group | FLIP-based enter/exit/move animations for the device list |

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (1.80+)
- [Bun](https://bun.sh/) (1.0+)
- Windows 10/11 with WebView2 runtime (pre-installed on modern Windows)

### Development

```bash
# Install frontend dependencies
bun install

# Start development mode (hot reload for both frontend and backend)
cargo tauri dev
```

### Production Build

```bash
cargo tauri build
```

This produces an **NSIS installer**, **MSI installer**, and a **portable EXE** in `src-tauri/target/release/bundle/`.

## Release & Distribution

### CI

`ci.yml` runs on every push/PR: Rust build check, `cargo clippy`, `cargo fmt`, and frontend build.

### Releasing a New Version

```bash
# Bump version in all config files (package.json, Cargo.toml, tauri.conf.json)
bun run version:bump minor          # or: patch, major, prerelease rc, or explicit like 1.0.0

# Commit, tag, and push
git add -A && git commit -m "Bump version to v0.2.0"
git tag v0.2.0
git push && git push origin v0.2.0
```

The **Release** workflow (`release.yml`) is triggered by the tag push and:
1. Builds NSIS installer (supports per-user install, no admin required), MSI installer (for enterprise/GPO), and a portable EXE
2. Signs bundles with the Tauri updater key for in-app update verification
3. Generates a `latest.json` manifest that the app's updater checks
4. Creates a GitHub Release with all artifacts and auto-generated release notes

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `TAURI_SIGNING_PRIVATE_KEY` | Base64-encoded private key from `cargo tauri signer generate`. Used to sign update bundles. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the signing key (optional if key has no password). |

The corresponding public key is committed in `src-tauri/keys/updater.key.pub` and referenced in `tauri.conf.json`.

### Code Signing Status

**Published installers are currently unsigned** (no Windows Authenticode signature). On first download, users will see:

- A SmartScreen warning (*"Windows protected your PC — Unknown publisher"*) that requires clicking **More info → Run anyway**.
- A yellow-banner UAC dialog instead of a blue-banner "verified publisher" dialog when the MSI or system-wide NSIS installer is launched.

Updater bundles *are* signed with the Tauri minisign key above, so in-app auto-updates are integrity-verified even while code signing is pending — but that signature is for the updater client, not for Windows.

An EV code-signing certificate (DigiCert KeyLocker) is being provisioned. When it lands:

1. Add the DigiCert secrets (`SM_HOST`, `SM_API_KEY`, `SM_CLIENT_CERT_FILE_B64`, `SM_CLIENT_CERT_PASSWORD`, `SM_CODE_SIGNING_CERT_SHA1_HASH`, `SM_KEYPAIR_ALIAS`) to the repo.
2. Uncomment the KeyLocker setup steps in `.github/workflows/release.yml`.
3. Add a `bundle.windows.signCommand` entry to `src-tauri/tauri.conf.json` (see the workflow comments for the exact invocation).

EV certs earn instant SmartScreen reputation, so the "Unknown publisher" warning will disappear from the first signed release — no reputation warm-up required.

## Architecture

```
┌──────────────────────────────────────────────────┐
│              Frontend (WebView2)                   │
│  SolidJS + TypeScript + Tailwind CSS              │
│                                                    │
│  DeviceTree → DeviceCategory → DeviceEntry        │
│       ↑                                            │
│  device-store.ts (reactive state + ghost tracking)│
│       ↑  listen("device-event")                   │
├───────┼────────────────────────────────────────────┤
│       │        Tauri IPC                           │
├───────┼────────────────────────────────────────────┤
│       │      Rust Backend                          │
│       │                                            │
│  watcher.rs ──→ events ──→ frontend               │
│  (WinRT DeviceWatcher: Added/Removed/Updated)     │
│       │                                            │
│  enumerator.rs + properties.rs + link.rs          │
│  (SetupAPI: full property queries per device;     │
│   USB hub IOCTLs + PCIe DEVPKEYs for link speed)  │
│       │                                            │
│  class_icons.rs                                   │
│  (SetupAPI: extracts native Windows device-class  │
│   icons from the registry, converts to PNG)       │
│       │                                            │
│  Windows Kernel (PnP Manager)                     │
└──────────────────────────────────────────────────┘
```

The **DeviceWatcher** runs on a background thread and emits incremental change events. Each event triggers a SetupAPI property query to get the full device details, then the enriched data is sent to the frontend as a typed event. The SolidJS store applies the change to its reactive state, and only the affected DOM nodes re-render — with smooth CSS animations.

## License

[MIT](LICENSE)
