# Device Manager++ — Development Guide

## Architecture

**Tauri v2** desktop app: Rust backend + SolidJS frontend.

- **Backend** (`src-tauri/src/`): Rust code using Win32 SetupAPI and WinRT DeviceWatcher for device enumeration and real-time PnP notifications.
- **Frontend** (`src/`): SolidJS + TypeScript + Tailwind CSS v4. Receives device events from the backend and renders an animated, grouped device tree.

## Key Design Decisions

- **WinRT DeviceWatcher** provides incremental Added/Removed/Updated events — never a full list refresh. This is the core innovation over the official Windows Device Manager.
- **Ghost entries**: Removed devices stay visible (faded) for 30 seconds so the user can see what disappeared.
- **Status badges** are 28px inline elements (not tiny 8px icon overlays like the official Windows Device Manager).
- **SolidJS** was chosen over React for fine-grained reactivity: when one device changes, only that one DOM node updates.

## Commands

```bash
# Development (starts Vite dev server + Rust backend with hot reload)
cargo tauri dev

# Production build
cargo tauri build

# Check Rust code only
cd src-tauri && cargo check

# Build frontend only
bun run build
```

## Project Structure

- `src-tauri/src/device/watcher.rs` — Real-time PnP event stream (WinRT DeviceWatcher)
- `src-tauri/src/device/enumerator.rs` — Full SetupAPI device enumeration
- `src-tauri/src/device/properties.rs` — DEVPKEY property extraction helpers
- `src-tauri/src/device/class_meta.rs` — Device class GUID → name/icon mapping
- `src-tauri/src/commands.rs` — Tauri IPC commands
- `src/lib/device-store.ts` — Central SolidJS reactive store (devices, ghosts, categories)
- `src/components/DeviceEntry.tsx` — Core device row (live/ghost/error states)
- `src/components/StatusBadge.tsx` — Large, clear status indicators
- `src/styles/animations.css` — Enter/exit/highlight CSS animations

## Conventions

- **Bun** for JS package management (not npm)
- Frontend: TypeScript strict mode, Prettier formatting
- Backend: Rust 2024 edition, `cargo fmt` + `cargo clippy`
- Path alias: `~/` maps to `src/` in TypeScript imports
