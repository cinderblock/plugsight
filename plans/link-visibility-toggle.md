# Top-row toggles: link visibility (tri-state) + grouping

## Goal

Two toolbar ("top row") controls requested by Cameron:

1. **Link-visibility tri-state toggle** cycling: normal → hide all parent/child
   link arrows → show only the *selected* device's links (no hover set).
2. **Toggle to disable grouping** (identical-device grouping), which must NOT
   affect the USB special nesting a peer agent is adding.

## Environment / context

- Repo: PlugSight (Tauri v2 + SolidJS), shared working tree.
- **Peer agent** is concurrently implementing USB physical nesting
  (`plans/usb-physical-nesting.md`); it has uncommitted edits in
  `src/lib/device-store.ts` and `src/components/DeviceEntry.tsx`.
  Coordination happens via `./.agent.status` (untracked, do not commit).
- My files: `Toolbar.tsx`, `RelationArrows.tsx`, additive hunks in
  `device-store.ts`, this plan. I must stage ONLY my own hunks in
  `device-store.ts` when committing (peer's usbNesting hunks stay unstaged).

## Decisions already made (don't re-ask)

- **Grouping toggle already exists**: `groupIdentical` signal + toolbar button
  ("Group identical devices") shipped in commit 8ddc447. It only gates
  `groupRows()` in the category view; topology/USB nesting is untouched.
  → Request #2 needs verification + report, not new code.
- Link mode lives in the store as a persisted signal `linkMode`:
  `'all' | 'selected' | 'none'`, cycled by one toolbar button (same pattern as
  density). `'all'` = current behavior (selected vivid + hovered desaturated).
- Per Cameron's global rule: no `title=` tooltips, ever. New button uses
  `aria-label`; existing `title=` attrs in Toolbar.tsx get removed while I'm
  touching it (converted to aria-labels).

## Plan / steps

- [x] Read codebase; confirm grouping toggle already exists.
- [x] Claim task in `.agent.status`.
- [x] `device-store.ts`: add `LinkMode` type, persisted signal, `cycleLinkMode`,
      exports.
- [x] `RelationArrows.tsx`: `none` → no segments; `selected` → ignore hover.
- [x] `Toolbar.tsx`: add tri-state button with state-reflecting icon; strip
      `title=` attrs (→ aria-label).
- [x] Typecheck (tsc clean), prettier, README section on link arrows.
- [x] Verified end-to-end (see below).
- [x] Commit, update `.agent.status`. DONE.

## Verification (2026-07-17, PASS)

Drove the real UI headlessly: Vite dev server on :1430 + Playwright (Chrome
channel) with `window.__TAURI_INTERNALS__` mocked via `addInitScript` to feed a
6-device synthetic USB/HID tree (root hub → hub → composite → keyboard + 2
identical consumer-control devices). Script + screenshots:
`%TEMP%\plugsight-verify\`. Observed:

- mode `all`, composite selected → 1 amber parent + 2 cyan child arrows (one
  child arrow correctly proxied to the collapsed ×2 group header); hovering the
  root hub added a desaturated `-m` set.
- cycle → `selected`: hover set gone, selected's 3 vivid arrows stay.
- cycle → `none`: zero segments despite selection + hover.
- cycle wraps back to `all`; `localStorage plugsight:ui-state.linkMode` tracked
  each step and survived reload (persisted `none` stayed hidden after reload).
- grouping toggle: ×2 group row disappears when off; topology view still nests
  (padding 8→24→40→56px) with grouping off; link arrows also work there.

Gotchas hit (for future browser-verification of this app):
- Port 1420 is often taken by the unrelated `claude-usage` vite — use another
  port (`bun run dev -- --port 1430 --strictPort`).
- The t3-code collaborative preview tab is throttled when not visible: CSS
  grid-rows transitions freeze at 0 → rows measure as clipped and arrows
  misroute. Kill transitions with an injected `* { transition: none }` style,
  or use headless Playwright (which runs them normally).
- Playwright `channel: 'msedge'` died instantly on launch on this machine;
  `channel: 'chrome'` works.
- CSS attribute selectors on `data-instance-id` need quadruple-backslash
  escaping — use suffix matchers (`[data-instance-id$='7&RECV']`) instead.

## Findings / gotchas

- `hoveredId` is consumed ONLY by RelationArrows, so gating hover arrows there
  is complete — no other hover-relation UI exists.
- `RelationArrows.recompute` reads signals inside a `createEffect` that lists
  its deps explicitly — remember to add `linkMode()` there.
- Peer's DeviceEntry/DeviceCategory changes are irrelevant to link arrows
  (arrows locate rows via `data-instance-id` at the DOM level).

## Things not to do

- Don't commit `.agent.status`.
- Don't touch `DeviceEntry.tsx`, `DeviceCategory.tsx`, `usb-tree.ts`,
  `UsbTreeRows.tsx` (peer's).
- Don't `git add -A` / `git add .` — peer has uncommitted work in shared files.
- Don't add `title=` attributes anywhere.
