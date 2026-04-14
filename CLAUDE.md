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

# Production build (produces NSIS + MSI installers and portable EXE)
cargo tauri build

# Check Rust code only
cd src-tauri && cargo check

# Build frontend only
bun run build

# Bump version across all config files (package.json, Cargo.toml, tauri.conf.json)
bun run version:bump patch          # or: minor, major, prerelease rc, 1.0.0
bun run version:bump patch --tag    # also creates a git tag
bun run version:bump minor --dry-run  # preview without writing
```

## Project Structure

- `src-tauri/src/device/watcher.rs` — Real-time PnP event stream (WinRT DeviceWatcher)
- `src-tauri/src/device/enumerator.rs` — Full SetupAPI device enumeration
- `src-tauri/src/device/properties.rs` — DEVPKEY property extraction helpers
- `src-tauri/src/device/class_meta.rs` — Device class GUID → name/icon mapping
- `src-tauri/src/commands.rs` — Tauri IPC commands
- `src/lib/device-store.ts` — Central SolidJS reactive store (devices, ghosts, categories)
- `src/lib/updater.ts` — Update system (native Tauri updater + GitHub API fallback)
- `src/components/DeviceEntry.tsx` — Core device row (live/ghost/error states)
- `src/components/StatusBadge.tsx` — Large, clear status indicators
- `src/components/StatusBar.tsx` — Bottom bar with version, counts, update badge/progress
- `src/styles/animations.css` — Enter/exit/highlight CSS animations
- `scripts/bump-version.ts` — Version bump automation across all config files
- `src-tauri/keys/updater.key.pub` — Public key for update bundle verification

## Conventions

- **Bun** for JS package management (not npm)
- Frontend: TypeScript strict mode, Prettier formatting
- Backend: Rust 2024 edition, `cargo fmt` + `cargo clippy`
- Path alias: `~/` maps to `src/` in TypeScript imports
- **Version** is stored in three places (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`) — always use `bun run version:bump` to update them together
- **Updater signing key**: public key is in `src-tauri/keys/updater.key.pub`; private key is gitignored and stored as `TAURI_SIGNING_PRIVATE_KEY` GitHub secret
