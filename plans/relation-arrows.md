# Relation Arrows — routing cleanup

## Goal

SolidWorks-style parent/child connectors (`src/components/RelationArrows.tsx`)
must not overlap row content, and every arrow tip needs a visible horizontal
shaft. Reported against a narrow-window screenshot (2026-07-16).

## Problems reported

1. Arrows overlap important visuals (badges, counts, hover icons, text).
2. The horizontal segment at each arrow tip can be nearly zero-length (bus
   hugged content at 8px and the 6px corner radius ate most of it).
3. Vertical buses ran over the names of rows *between* the anchor and its
   targets (only involved rows were considered when placing the bus).

## Fix (implemented 2026-07-16)

- **Obstacle clearance**: every row-like element is measured as an obstacle —
  device rows (`data-instance-id`) plus category/group headers, which now carry
  `data-arrow-row`. A bus spanning y-range must clear the left/right content
  extent of every row whose midY falls in that range.
- **Row extent measurement** (`measure()` in RelationArrows):
  - Name line: up to the zero-width `data-role="label-end"` marker, which sits
    *after* inline badges (StatusBadge in DeviceEntry; ×N + problem badge in
    DeviceGroup; count pills in DeviceCategory).
  - Secondary line: wrapped in `<span data-arrow-extent>` so actual text width
    is measurable (the div itself is full-width). Extents are clamped to their
    parent box so truncated text doesn't over-report.
  - Category problem badge (far right) also tagged `data-arrow-extent`.
  - Rows without any marker fall back to their full bounding box (safe: bus
    clears the whole row).
- **Minimum tip length**: `MIN_TIP = 12` straight px before the corner radius;
  `HUG_GAP = MIN_TIP + RADIUS` so the bus placement guarantees it. If the bus
  gets clamped at the container edge, endpoints are pulled in (`tipX`) rather
  than letting the shaft shrink below MIN_TIP.
- Also removed `title=` attributes in the three touched components per global
  UI rule (replaced with `aria-label` on icon-only buttons).

## Round 2 (same day): anchor shaft crossed the row's own hover icons

User screenshot: the anchor's outgoing child segment left the row at its label
end and crossed the row's ↗/👁 hover-action icons — which are visible exactly
when the pointer is on that row (the common case right after clicking it).
Any shaft from label end to a bus that clears the icons MUST cross them, so:

- **Anchor departs from the row's right edge** (`rowRight` in RowBox = row
  bounding right + PAD), outside the icon cluster. Arrowheads still point at
  target label ends.
- This puts the child bus at the right edge routinely, so the primary set now
  **reserves a SET_GAP lane** (rightClamp param) when a hover set will nest
  outside it — otherwise both buses clamp to the same X and overlap.
- DeviceTree side padding widened `pl-5 pr-6` → `pl-6 pr-8` to serve as bus
  gutter space.

## Round 3 (same day): arrows pointed at devices hidden in collapsed drawers

User screenshots: arrows aimed "not quite at" group/category rows — e.g. a
shaft crossing the "USB controllers" header's badge and eye icons. Root cause:
the grid `0fr` + `overflow-hidden` collapse trick only *clips* rows; a hidden
row's `getBoundingClientRect()` still reports natural height, so the old
`height > 3` skip never fired and arrows targeted invisible rows stacked at
the collapsed drawer.

- `visibleHeight()` intersects a row's rect with every `overflow-hidden`
  ancestor up to the container — hidden rows now measure ~0.
- `representative()` redirects a hidden device to its collapsed drawer's
  visible header row (×N group row or category header; walks up through
  nested collapses). Multiple hidden devices sharing a header dedupe to one
  arrow. No visible representative (whole category hidden) → skipped.
- Header stand-ins are approached from *outside* their right edge
  (`proxy` → tip at `rowRight`): a header's right side holds count pills,
  problem badges, and eye icons that a shaft must not cross.
- Obstacle measurement uses `visibleHeight` too, so stacked hidden rows no
  longer push the buses around.

## Known accepted trade-offs

- A *target* row's incoming tip still crosses that row's hover icons while the
  pointer is on it (selected-set arrow into the row you're hovering). Rare and
  transient; fixing it would mean tips no longer reach labels.
- In ultra-narrow windows the right bus clamps to the container edge; min tip
  length wins over never-touch-text in that degenerate case (endpoints pull in
  via tipX instead).

## Status

- [x] RelationArrows obstacle clearance + min tip
- [x] Markers/tags in DeviceEntry, DeviceGroup, DeviceCategory
- [x] Round 2: anchor departs row edge; two-set lane reservation; wider gutters
- [x] tsc + vite build pass
- [ ] Visual verification by user (rebuild + reinstall done same session)

Not committed: the whole topology/arrows feature is uncommitted working-tree
state shared with other threads; not staging others' WIP.
