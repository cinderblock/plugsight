# Plan: Group & collapse seemingly-identical devices within a category

Plan path: `plans/group-identical-devices.md`

## Goal
Within each category, devices that share the same display name (e.g. "HID-compliant
consumer control device" appearing 6×) waste vertical space and convey nothing. Condense
each such set into a single expandable summary row ("… ×6"). When expanded, show the
individual devices with a **differentiating detail** (the instance ID, which is the
canonical per-device unique value). Applies to **all categories**, not just HID.

## Environment / context
- Tauri v2 + SolidJS + Tailwind v4 frontend (`src/`).
- Render chain: `categories()` memo (device-store.ts) → `DeviceTree` → `DeviceCategory`
  (`Index each={cat().devices}`) → `DeviceEntry`.
- `DisplayDevice` = `{ device: DeviceInfo, isGhost, ghostRemovedAt?, visible }`.
- Devices already sorted within a category by `(isGhost asc, name asc)` — so identical
  names are **adjacent**, and live vs ghost never mix in a run.
- The detail panel (`DeviceDetail`) already shows full info for the selected device, so a
  group child only needs to be selectable to reach full detail.

## Decisions already made (don't re-ask)
1. **Grouping is a view transform in `DeviceCategory`**, not a change to the store's data
   model. Least invasive; keeps filters/counts/sort untouched. Category header counts stay
   real device counts (not group counts).
2. **Group key = `name` + ghost-state.** Matches existing sort so members are contiguous;
   live and ghost identical devices form separate groups.
3. **Threshold = 2.** A "group" of 1 renders as a normal `DeviceEntry`.
4. **Differentiator = `instanceId`** (always unique, encodes VID/PID/collection/instance).
   Shown as the child's secondary line (mono, truncated, full value on hover/title).
   Clicking a child selects it → full `DeviceDetail`.
5. **Problem children force the group open** + a red problem-count badge on the group header
   (mirrors how categories auto-expand on problems). A collapsed group must never hide a
   device that needs attention.
6. **Global toggle `groupIdentical`** (persisted, default ON) in the Toolbar, so users can
   get the old flat view back.
7. **Per-group expansion**: a store signal `Set<string>` keyed `${classGuid}::${ghost}::${name}`,
   NOT persisted (group identity is derived from transient device names).

## Plan / steps
1. `lib/grouping.ts` (new): pure `groupRows(devices: DisplayDevice[], enabled): DeviceRow[]`
   + `DeviceRow` type (`{kind:'single', device}` | `{kind:'group', key, name, isGhost, devices}`).
   Preserves input order; only collapses runs of ≥2 sharing key.
2. `device-store.ts`: add `groupIdentical` signal+setter (persist), `expandedGroups` signal
   (Set, not persisted) + `toggleGroup(key)` / `isGroupExpanded(key)`. Export them.
3. `components/DeviceGroup.tsx` (new): collapsed summary row (icon, name, "×N" count pill,
   problem badge, chevron) + drawer of child `DeviceEntry`s using the existing
   grid-rows 1fr/0fr animation. Expanded when `showProblemsOnly() || hasProblemChild ||
   isGroupExpanded(key)`.
4. `components/DeviceEntry.tsx`: add optional `detail?: string` prop; when present, render it
   (mono, truncated, title=full) instead of the manufacturer line.
5. `components/DeviceCategory.tsx`: replace the `Index each={cat().devices}` body with a map
   over `groupRows(cat().devices, groupIdentical())`, rendering `DeviceEntry` or `DeviceGroup`.
6. `components/Toolbar.tsx`: add a toggle button bound to `groupIdentical`.
7. Build (`bun run build`) + run app; verify HID condenses, expansion shows instance IDs,
   problem devices stay visible, toggle works.

## Findings / gotchas
- `<Index>` keys by position; group expansion state must live in the store (keyed by name),
  not local component state, to survive list reordering. (Decision 7.)
- Ghost runs sort after live; keep them as separate groups so the ghost styling/age line is
  not lost inside a "live" group.

## Progress log
- [x] Explore render chain + types
- [x] grouping.ts — `groupRows` + `DeviceRow` + `groupKey`
- [x] store signals — `groupIdentical` (persisted), `expandedGroups` (transient), toggles, exports
- [x] DeviceGroup.tsx — summary row + drawer; force-open on search/problems
- [x] DeviceEntry detail prop — instanceId as mono secondary line
- [x] DeviceCategory wiring — Switch/Match over `groupRows`
- [x] Toolbar toggle — `groupIdentical` button with active state
- [x] tsc --noEmit clean + `bun run build` green (31 modules)
- [ ] manual visual verify in running app (user)

## Round 2 — feedback fixes (in progress)
1. **Indentation/layering**: single rows lacked the chevron's horizontal space, so they read
   as a different level from group headers. Fix: add a chevron-width spacer to every
   `DeviceEntry` so singles align with group headers; group children sit one drawer-indent
   deeper → clear parent/child layering.
2. **No initial-flood flash**: `handleDeviceAdded` called `markRecentChange` for every device,
   including the initial enumeration stream. Guard it (and the +N pill) behind
   `state.enumerationComplete` so only genuinely-new devices flash.
3. **Deselect**: detail panel already has an X (setSelectedId(null)). Add convenience gestures:
   click a selected row again to toggle off; Escape clears selection (window keydown in App).
4. **Related devices** (parent↔child via `parentId` === another device's `instanceId`, confirmed
   in backend `get_parent_id` = DEVPKEY_DEVICE_PARENT): build a bidirectional relation map in
   the store + `hoveredId` signal; hovering a device rings its related devices (v1). Drawing
   actual connector LINES across the scrolling/collapsible tree is a larger follow-up — deferred,
   with caveats (off-screen / collapsed related nodes).

## Round 3 — relationships, sort, topology view
- **A. Parent/child hover colors** (done): hovered device's parent rings **amber**, its children
  ring **cyan** (was a single violet). Backed by directed `relationIndex` (childrenByParent,
  parentByChild) + `hoveredParents`/`hoveredChildren` memos.
- **B. "Eldest first" sort** (done): within each category, devices sort by descendant subtree
  size (desc) then name — host controllers / hubs rise to the top. `descendantCounts` memo.
- **C. Connection topology view** (in progress) — DECIDED: in-app **view toggle**
  (Categories ↔ Connections), scope **USB + PCI**.
  - `lib/topology.ts`: pure `buildTopologyForest(devicesById, childrenByParent, parentByChild)`
    → `TopoNode[]`. Roots = devices whose parent isn't in the set. Prune: keep a node only if
    its instanceId is PCI/USB/HID **or** it has a kept descendant (preserves chains to the root
    controller). Children sorted eldest-first. Live devices only for v1.
  - store: `viewMode` ('categories'|'connections', persisted) + toggle; `topologyForest` memo;
    `collapsedTopoNodes` Set (not persisted, default = all expanded) + toggle/isCollapsed.
  - `components/TopologyView.tsx`: scroll container + recursive node rows (depth indent, chevron,
    icon, name, child-count pill, status badge, selection + amber/cyan hover highlight).
  - Toolbar: Categories/Connections toggle button. App: switch DeviceTree ↔ TopologyView.
  - v1 limitations to note: search/problems filters don't prune the topology yet; ghosts excluded.
  - DONE: topology.ts, store wiring, TopologyView.tsx, toolbar toggle, App switch. tsc + build green.

## Round 3 — bugs hit & fixed
- **TDZ crash (critical)**: `createMemo` is EAGER — `categories` runs at creation and read
  `descendantCounts()`, which was declared *after* it → `ReferenceError: Cannot access
  'descendantCounts' before initialization`, blanking the UI. Fix: moved `relationIndex` +
  `descendantCounts` above `categories`. LESSON: tsc does NOT catch this; module-level memo
  dependencies must be declared before the memos that read them.
- **Dark-mode white flash on startup**: browser painted default white before the SolidJS root
  (`dark:bg-gray-900`) mounted. Fix: inline `<style>` in index.html `<head>` with
  `color-scheme: light dark` + `@media (prefers-color-scheme: dark) html { background:#111827 }`
  so the first frame is already dark. (Dark mode is driven by OS preference, no class toggle.)

## Round 4 — feedback
1. **Grouping regression** (fixed): eldest-first sort interleaved same-named devices, breaking
   the adjacency `groupRows` relied on (3+ separate "Generic USB Hub"). Rewrote `groupRows` to
   bucket by key across the whole list (first-occurrence anchored = eldest), so they regroup and
   ordering stays consistent with the flattened tree.
2. **Relationship arrows** (replaces the ring highlight): `RelationArrows.tsx` overlay draws
   SolidWorks-style orthogonal connectors on hover — **parents via the LEFT gutter, children via
   the RIGHT gutter**, arrowheads pointing into the related rows. Rows tagged `data-instance-id`;
   overlay measures them in content coords (scrolls with content), skips zero-height (collapsed)
   rows. Tree containers got `pl-5 pr-6` gutters + `relative`. Mounted in DeviceTree and TopologyView.
   - Tunable constants in RelationArrows: gutter bus X (7 / clientW-9), arrow colors (amber/cyan).

## Refinement made during implementation
- Groups force-open while `searchQuery() !== ''` or `showProblemsOnly()` or any member has a
  problem, so filtering/diagnostics never hide a match behind a collapsed group. `×N` count
  reflects *visible* members only.

## Things not to do
- Don't move grouping into the `categories()` memo / store data model (breaks the simple,
  well-tested filter/sort path).
- Don't collapse a group that contains a problem device without surfacing the problem.
- Don't persist `expandedGroups` (keys are derived from transient device names).
