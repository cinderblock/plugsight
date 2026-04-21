# Device Manager++

A modern replacement for the Windows Device Manager, built with [Tauri v2](https://v2.tauri.app/) (Rust + SolidJS).

## Why?

The official Windows Device Manager has a fundamental UX problem: **every change refreshes the entire device tree**. You can never watch the list grow. You can never see what just disappeared. Tiny 8-pixel error overlay icons are nearly invisible. Device Manager++ fixes all of that.

## Key Features

### Animated Device Changes
When you plug in a USB device, you see it slide into the list with a green highlight flash. When you unplug it, it doesn't vanish — it fades into a **ghost entry** that stays visible for 30 seconds, clearly labeled "Removed 5s ago", so you can see exactly what left the system. Category headers show animated **+N / −N pills** as devices come and go.

### Ghost Entries for Removed Devices
Recently removed devices appear faded with a dashed border, a strikethrough name, and a timestamp. You can still click them to view their last-known properties. A dismiss button lets you clear individual ghosts, or clear all from the toolbar.

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

### Search, Filter & Hide
- **Full-text search** across device names, descriptions, manufacturers, hardware IDs, and instance IDs.
- **"Problems only" toggle** filters the tree to show only devices with errors, warnings, or missing drivers.
- **Hide individual devices or entire categories** to declutter the view — hidden state persists across sessions.
- **Solo mode** on category headers isolates a single category, collapsing everything else.

### Persistent UI State
Search query, filter state, category expansion, and hidden devices/categories are all saved to `localStorage` and restored on next launch.

### In-App Auto-Updates
Installed builds (NSIS/MSI) use Tauri's native updater to download, verify, and install updates seamlessly — with a progress bar in the status bar. Portable builds fall back to polling GitHub Releases and showing a badge that opens the download page.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| App Shell | Tauri v2 | Lightweight (~5 MB), uses system WebView2, Rust backend for direct Win32 API access |
| Backend | Rust | Direct bindings to SetupAPI + WinRT via `windows-rs` crate — no FFI layer needed |
| Frontend | SolidJS | Fine-grained reactivity: one device change = one DOM update, not a full tree diff |
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
│  enumerator.rs + properties.rs                    │
│  (SetupAPI: full property queries per device)     │
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
