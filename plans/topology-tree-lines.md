# Connections view: parent→child tree lines

## Goal

In the Connections (topology) view, draw a faint line from each expanded parent down
the left indentation area, branching in a smooth curve into each child row. Root-level
parents get the thickest lines; each deeper level is thinner. Neighbouring branch sets
use different muted colours so adjacent trunks are easy to tell apart without competing
with the row content.

## Environment / context

- Repo: `C:\Users\camer\git\Personal Projects\new device manager` (PlugSight, Tauri v2 + SolidJS + Tailwind v4).
- Tree renderer: `src/components/TopologyView.tsx` (`TopologyNode`, `TopoGroup`, `TopoRows`).
- Rows are not nested boxes: every row shares the same left edge and indents with
  `padding-left: depth*16 + 8` px behind a 4 px `border-l-4` accent. So a parent at depth
  `d` has its chevron centred at `x = 16d + 20`, which equals `16*childDepth + 4`.
- Dark mode is the OS `prefers-color-scheme` (Tailwind v4 default `dark:` variant).
- No browser-only mock of the device backend: visual checks need `cargo tauri dev`.

## Decisions already made (don't re-ask)

- **Per-row SVG, not CSS boxes and not an overlay** (revised 2026-09-28; see
  "Redraw" below). Each row carries one small SVG, positioned over the row's border box,
  that draws every line crossing that row: pass-through *rails* for ancestor trunks, the
  *elbow* from its parent's trunk (plus the trunk's continuation unless last), and the
  *stub* under its own chevron when open. Still no DOM measurement (unlike
  `RelationArrows`): rows abut, so a trunk is a stack of per-row segments at one x.
- **Trunk origin is the parent's chevron.** The line drops from just under the chevron
  glyph, so it reads as "the thing you clicked to open these".
- **Midline origin, no fixed row height.** The row SVG nests an inner `<svg y="50%"
  overflow="visible">`, so paths are laid out from the row's midline; vertical runs are
  drawn ±1000px long and the outer SVG (`overflow: hidden`) clips them to the row plus a
  1px bleed into each neighbour, so stacked segments overlap instead of meeting at an
  anti-aliased seam.
- **Opaque muted colours, not alpha.** The elbow's arc and the trunk continuation overlap
  by a sliver at the tangent; with translucent strokes that showed as a darker notch.
  Opaque `oklch(0.8 0.05 H)` (light) / `oklch(0.5 0.05 H)` (dark) sidesteps it entirely.
- **Colour per branch set.** All lines from one parent share a colour. A node's own
  colour is chosen from the palette *excluding its parent's colour*, indexed by sibling
  position — so a trunk never matches the trunk it hangs from, and consecutive siblings
  always differ. Palette = 5 low-chroma oklch hues defined as CSS variables in
  `src/app.css` with a dark-mode override.
- **Thickness by parent depth:** 3 px at depth 0, 2 px at depth 1, 1 px from depth 2 on.
  Integer widths only: Chromium snaps border widths to device pixels, so 2.25/1.5 would
  just render as 2/1 at 100% DPI anyway.
- **Scope = Connections view only.** The USB category's physical-nesting mode keeps its
  drawer-style straight border, matching the rest of the category view.

## Progress log

- [x] Plan written
- [x] Lines implemented in `TopologyView.tsx` + palette vars in `app.css`
- [x] Typecheck / tests / Prettier (52 tests pass)
- [x] Visual check in `cargo tauri dev` (light + dark, via CDP colour-scheme emulation)
- [x] README Connections section mentions the lines
- [x] Committed on `main`: "Trace the Connections tree's wiring with curved parent-to-child lines"

## Redraw (2026-09-28): the lines didn't line up

Cameron: "the line segments don't line up for some reason. are you using text/font
glyphs to make the arrows? can we draw them instead?" — No glyphs (the chevrons are SVG
icons); the CSS version was the cause. Zoomed screenshots showed every trunk jogging
**4px** sideways where a piece positioned inside a row (elbow, lower trunk, stub) handed
off to a strip in the children container.

Root cause: an absolutely positioned child is placed from its containing block's
**padding** box. The rows have a 4px `border-l-4` accent, so pieces inside a row were
offset from its padding box, 4px right of the strips in the (borderless) children
container, which used the same x formula from their border box. `trunkX` added the 4px
border and was right for one frame and wrong for the other.

Fix: `TreeLines` draws everything per row in one frame. The SVG sits in a wrapper
`div.relative` that is the row's border box (the row is its only in-flow child), placed
*after* the row so the lines paint over its hover/selected background, and outside the
row's `opacity-40` so a trunk doesn't dim and brighten as it passes dimmed context rows.
`railX(level) = 16·level + 20` (border-box chevron centre). Odd stroke widths sit on
half-pixel x/y so 1px and 3px lines cover whole device pixels. Rails are passed down as
`{level, hue, through}`: a node's children see its rails plus the trunk it hangs from,
`through = !branch.last` (`railsBelow`).

Verified at 100% scaling with 5–8x nearest-neighbour zooms of window captures: trunks
continuous through every row, elbows and stubs meet exactly, no row-boundary seams; ×N
group rows and collapsed nodes correct; lines at full strength through dimmed rows.

## Findings / gotchas

- Row `class` uses `relative` already (for the hover action tray), so absolutely
  positioned line pieces can be dropped straight in.
- A group row (×N identical siblings) is both a child (gets an elbow) and a parent (its
  members hang from its chevron), so it takes the same `branch` prop and hands its own
  colour down.
- The chevron glyph occupies x 6–10 px of its 16 px box, so the elbow can run 2 px past
  the box edge and still stop clear of the glyph.
- `tsc` on Windows resolves the parent dir as `C:/Users/...` while the repo path has a
  space; fine, but run scripts from the repo root with quotes.

- **Seeing light mode on a dark-themed machine without touching the OS theme:**
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is ignored because Tauri/wry already sets
  `AdditionalBrowserArguments` (`--disable-features=msWebOOUI,...`), which overrides the
  env var. What works: temporarily add to the window in `tauri.conf.json`
  `"additionalBrowserArgs": "--remote-debugging-port=9222 --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"`
  (the dev CLI restarts the app on config change), then over CDP send
  `Emulation.setEmulatedMedia {features:[{name:'prefers-color-scheme',value:'light'}]}`
  and `Page.captureScreenshot`. Helper scripts used: `%LOCALAPPDATA%\Temp\claude\plugsight-cdp.ts`
  (bun) and `plugsight-shot.ps1` (window screenshot via `Get-Process plugsight` main
  window handle — `FindWindow` by title did not find it). Revert the config line after.
- `git status` shows `src-tauri/Cargo.toml` and `tauri.conf.json` as modified after a
  `cargo tauri dev` run, but `git diff` is empty: autocrlf line-ending noise only. Don't
  stage them.

## Things not to do

- Don't position line pieces from two different containing blocks. Everything a row
  draws is in that row's border-box frame; nothing lives in children containers.
- Don't take window screenshots of the dev app and then click near a row's right edge
  to "move focus": the hover tray floats there, and the click hides a device. (It did,
  once; "Clear filters" restored it, since nothing had been hidden before.) Toolbar
  toggles clicked via synthetic input also didn't always register one-to-one; verify the
  resulting state in the tree, not the button styling.

- Don't measure DOM rects for these lines — they are structural, not overlay.
- Don't change the 16 px per-level indent to make room; the 8 px arc fits as is.
