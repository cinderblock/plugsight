# Device Manager++

A modern replacement for the Windows Device Manager, built with [Tauri v2](https://v2.tauri.app/) (Rust + SolidJS).

## Why?

The official Windows Device Manager has a fundamental UX problem: **every change refreshes the entire device tree**. You can never watch the list grow. You can never see what just disappeared. Tiny 8-pixel error overlay icons are nearly invisible. Device Manager++ fixes all of that.

## Key Features

### Animated Device Changes
When you plug in a USB device, you see it slide into the list with a green highlight flash. When you unplug it, it doesn't vanish — it fades into a **ghost entry** that stays visible for 30 seconds, clearly labeled "Removed 5s ago", so you can see exactly what left the system.

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
Uses the WinRT `DeviceWatcher` API for incremental change notifications. The UI never does a full refresh — only the affected device entry updates, with smooth CSS transitions.

### Grouped Tree View
Devices are organized by setup class (Display adapters, Network adapters, USB controllers, etc.) with collapsible category headers showing device counts and problem counts.

### Search and Filter
Full-text search across device names, descriptions, manufacturers, hardware IDs, and instance IDs.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| App Shell | Tauri v2 | Lightweight (~5MB), uses system WebView2, Rust backend for direct Win32 API access |
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

The built executable will be at `src-tauri/target/release/device-manager-pp.exe`.

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
│  Windows Kernel (PnP Manager)                     │
└──────────────────────────────────────────────────┘
```

The **DeviceWatcher** runs on a background thread and emits incremental change events. Each event triggers a SetupAPI property query to get the full device details, then the enriched data is sent to the frontend as a typed event. The SolidJS store applies the change to its reactive state, and only the affected DOM nodes re-render — with smooth CSS animations.

## License

MIT
