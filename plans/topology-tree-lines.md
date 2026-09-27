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

- **CSS borders, not an SVG overlay.** An elbow is a div with `border-left` +
  `border-bottom` + `border-bottom-left-radius`; the trunk is a `border-left` strip.
  They live inside the row / children container, so they follow collapse, filtering and
  ghost fades for free and never need `getBoundingClientRect` (unlike `RelationArrows`).
- **Trunk origin is the parent's chevron.** The line drops from just under the chevron
  glyph, so it reads as "the thing you clicked to open these".
- **Half-height positioning, no fixed row height.** Elbow is `top:0; height:calc(50% + w/2)`;
  trunk continuation starts where the curve peels off (`top: calc(50% + w/2 - R)`) and
  runs to the row bottom, then `top:0; bottom:0` on the child's own children container.
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

- Don't measure DOM rects for these lines — they are structural, not overlay.
- Don't change the 16 px per-level indent to make room; the 8 px arc fits as is.
