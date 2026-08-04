# RelationArrows recompute storm — UI freezes ~20s after any layout change

## Goal

Fix the bug where any UI change that alters row layout (clearing filters, changing
row density, expanding a category) applies visually, then locks the whole app for
~20 seconds.

## Environment / context

- PlugSight, Tauri v2 + SolidJS, `C:\Users\camer\git\Personal Projects\new device manager`
- Repro machine enumerates the full present-device set — typically 300–700 rows
  (`src-tauri/src/device/enumerator.rs:26` uses `DIGCF_ALLCLASSES | DIGCF_PRESENT`),
  plus up to `MAX_GHOSTS = 100` ghosts (`src/lib/device-store.ts:77`).
- No virtualization anywhere: filtered-out rows stay in the DOM with a
  `visible: false` flag (`device-store.ts:549-571`) and are animated to zero
  height, so the DOM is *always* at full size regardless of filtering.

## Root cause

Two lines conspire:

1. `src/components/RelationArrows.tsx:313` registers a `transitionend` listener on
   the **entire tree container**, and each event synchronously runs the full
   `recompute()`.
2. `src/components/DeviceEntry.tsx:102` puts `transition-all duration-200` on
   every device row.

`transition-all` means a density change animates `padding-top`/`padding-bottom` on
every row, and `transitionend` fires **once per animated property per element** —
all bubbling up to the container.

So one density toggle produces roughly `rows × properties` ≈ 1000+ events, each
triggering a `recompute()` that:

- `querySelectorAll('[data-instance-id], [data-arrow-row]')` over the whole tree
  (`RelationArrows.tsx:191`) — ~500 elements,
- calls `measure()` on each (`:164-187`): a rect for the row, a `querySelector` +
  rect for `[data-role="label-end"]`, a `querySelectorAll` + 2 rects per
  `[data-arrow-extent]`,
- and `visibleHeight()` (`:128-139`) which **walks every ancestor up to the
  container calling `getBoundingClientRect()` on each** — 5–10 levels deep given
  the category → drawer → group → drawer → entry nesting.

That is ~10 layout reads per row × ~500 rows × ~1000 events ≈ millions of forced
synchronous reflows, while CSS transitions are dirtying layout every frame.
Effectively O(N²) reflow. Hence: the change paints fine, then the main thread is
gone for ~20s.

**Why it doesn't always reproduce:** `recompute()` early-outs cheaply at `:107`
when nothing is selected or hovered (`!sel && !hov`). The freeze needs a selected
or hovered device — i.e. the normal workflow of clicking a device and then
changing something.

`scroll` (`:312`) and the `ResizeObserver` (`:314`) feed the same un-coalesced path.

## Decisions already made (don't re-ask)

- Fix the recompute storm rather than removing the arrows feature.
- Density changes should be **instant**, not animated. Animating padding on
  hundreds of rows has no UX value and is the storm's main trigger.
- Keep the drawer `grid-template-rows` open/close animations — they're wanted, and
  once recompute is coalesced they're affordable.
- Virtualization is out of scope for this fix (see "Not doing now").

## Plan / steps

1. **Coalesce `recompute()` to one run per animation frame.** Collapses ~1000
   synchronous sweeps into 1–3. Behaviour is unchanged: `transitionend` fires at
   the *end* of a transition anyway, so arrows already only snapped into place
   after the animation — they were never live during it.
2. **Cache layout reads within a single sweep.** Add a per-sweep
   `getBoundingClientRect` cache. The whole body of `recompute()` is read-only
   w.r.t. layout (it only writes via `setDims`/`setSegments` at the very end), so
   caching is sound. Kills the repeated ancestor-walk rect reads that `visibleHeight`
   does for every row, and the double-`measure` of anchor/related rows.
3. **Narrow `transition-all` → `transition-colors`** on the row button. Everything
   that genuinely wants animating there is a color (hover/selected background,
   status border, ring). Stops padding from animating at all, so a density change
   emits no `transitionend` at all.

## Findings / gotchas

- `measure()` results get mutated after the fact — `boxesFor` sets `b.proxy = el !== src`
  (`:230`). A naive memo on `measure` would leak `proxy` into the shared obstacles
  entry for the same element. Any measure cache must hand back a copy.
- Solid memos are eager, so `topologyForest` (`device-store.ts:595`) rebuilds on
  every keystroke even when the Connections view isn't mounted. Real waste, but
  milliseconds — not the freeze. Separate cleanup.
- The `.device-enter/.device-exit` comments in `DeviceEntry.tsx:9` and
  `DeviceCategory.tsx:186` claiming a parent `TransitionGroup` are **stale** —
  `solid-transition-group` is only used by `ToastHost.tsx:23`.

## Progress log

- [x] Traced filter/render path, ruled out icon resolution (`icon-cache.ts:39` is a
      single object lookup) and the store's `localeCompare` sorts as the cause of a
      *20-second* stall — they're per-keystroke milliseconds.
- [x] Confirmed root cause: `transitionend` × full-tree measure sweep.
- [x] Step 1 — rAF-coalesce recompute (`schedule()` wraps every trigger:
      the reactive effect, `scroll`, `transitionend`, `ResizeObserver`).
- [x] Step 2 — per-sweep `rectOf` cache + memoized `measure` (copies handed out,
      because `boxesFor` mutates `proxy` on the result).
- [x] Step 3 — row button now uses an explicit paint-only property list
      `transition-[color,background-color,border-color,box-shadow,opacity]`.
      Verified in the built CSS that the generated rule contains no `padding`.
- [x] `bun run typecheck`, `bun run test` (8 pass), `bun run build` all clean;
      Prettier reports all three files unchanged.
- [ ] **Verify in the running app** — not yet done. Needs `cargo tauri dev` on a
      machine with the full device set: select a device (the arrows early-out at
      `RelationArrows.tsx:107` means an unselected list never reproduced the
      freeze), then toggle density and clear filters.

## Things not to do

- Don't remove the `transitionend` listener outright — arrows must re-anchor after
  drawers open/close, or they point at stale positions.
- Don't animate padding/layout properties on per-row elements. Any `transition-all`
  on something that exists N-hundred times is a trap.
- Don't add new listeners to the tree container that do synchronous full-tree
  measurement.

## Not doing now (follow-ups)

- **Virtualization.** The DOM is permanently at full size (300–700 rows × ~50 nodes
  = 15k–35k nodes) because filtered-out rows are kept and merely collapsed. Every
  measure pass and style recalc pays for all of it. The real long-term fix.
- Unmemoized `rows()`/`visibleDevices()` in `DeviceCategory.tsx:41-47`.
- `topologyForest` depending on `searchTerm()` regardless of active view.
- `TopologyView.tsx:73,157` still use `transition-all` on per-row elements — the
  same trap. Harmless *today* only because `RelationArrows` is mounted solely by
  `DeviceTree.tsx:46` (Categories view), so nothing listens for the bubbled
  `transitionend` there. Worth narrowing before the Connections view ever gets an
  overlay.
