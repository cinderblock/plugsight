# USB Physical Nesting Mode

## Goal

A per-category display mode for the **"USB controllers"** category (class GUID
`{36fc9e60-c465-11cf-8056-444553540000}`): instead of the flat (grouped) list, nest the
category's devices by the physical hub/controller they're plugged into — controller →
root hub → hub → device — matching the user's real physical plugs. A toggle button on
that category's header switches between the original flat mode and the nested mode.

Key requirement from the user: nesting happens **before** identical-device grouping —
i.e. build the physical tree first, then still collapse runs of identical *siblings*
within each level (the existing `groupIdentical` setting keeps applying).

## Environment / context

- Repo: `C:\Users\camer\git\Personal Projects\new device manager` (PlugSight, Tauri v2 + SolidJS).
- **Shared working tree**: another Claude agent is concurrently adding toolbar toggles and
  also plans to touch `device-store.ts` and `DeviceEntry.tsx`. Coordination file:
  `./.agent.status` (untracked; also added to `.git/info/exclude`). Apply edits on top,
  stage only my own hunks.
- Class GUIDs arrive from the backend braced + lowercase, e.g. `{36fc9e60-...}`
  (`properties.rs get_guid_property`).
- The store already derives `relationIndex()` = `{ childrenByParent, parentByChild }`
  across live + ghost devices (case-insensitive parent resolution). Reuse it — no backend
  changes needed.
- Category device lists are already sorted: ghosts last, then "eldest first" (subtree size).

## Decisions already made (don't re-ask)

- Scope = devices **within the USB controllers category only** (hubs, root hubs, host
  controllers, composite devices). Leaf devices of other classes (HID etc.) stay in their
  own categories — this mode restructures the USB category itself.
- Nesting parent = nearest **in-category** ancestor via `parentByChild` walk (skips any
  out-of-category intermediate nodes; host controllers become roots since their PCI parent
  is out-of-category).
- Grouping in nested mode applies only to **childless siblings** under the same parent
  (a hub with its own subtree can't merge into a group row); group keys are scoped per
  parent so two hubs' identical children don't share expansion state.
- Toggle button lives on the USB category header, always visible (not hover-only),
  blue/highlighted when nested mode active. **No `title=` attributes** (user rule).
- `usbNesting` is persisted in localStorage alongside the other UI state.
- Node collapse state reuses the existing `collapsedTopoNodes` signal (session-only,
  keyed by instanceId — same semantics as the Connections topology view).
- A node row stays visible when any descendant is visible (filter context), like the
  topology view's ancestor-retention.

## Plan / steps

1. [x] Explore existing grouping/topology code.
2. [x] `src/lib/usb-tree.ts` — pure transform: `buildUsbRows(displayDevices, parentByChild, groupEnabled)` → recursive `UsbRow[]` (`node` | `group`).
3. [x] `device-store.ts` — persisted `usbNesting` signal, `toggleUsbNesting()`, `USB_CONTROLLERS_CLASS_GUID` export.
4. [x] `DeviceEntry.tsx` — optional `onToggleChildren`/`childrenCollapsed` props; chevron replaces the leading spacer when present.
5. [x] `UsbTreeRows.tsx` — recursive renderer (DeviceEntry rows + DeviceGroup for sibling groups + indented drawer).
6. [x] `DeviceCategory.tsx` — nest-toggle button on USB header; render `UsbTreeRows` when active.
7. [x] Typecheck (`tsc --noEmit`), `bun run build`, Prettier, README updated.
8. [ ] Commit (stage only my files; peek `.agent.status` + `git status` first). ← current

## Findings / gotchas

- `relationIndex()` matches parents case-insensitively and includes ghosts — ghost hubs
  keep their unplugged children nested under them. Good for the "what disappeared" story.
- `groupRows()` in `grouping.ts` is flat-list-only; wrote a separate sibling-level
  grouping in `usb-tree.ts` rather than contorting it (keys deliberately scoped
  `usb::<parent>` vs `<classGuid>::` so the two modes' expansion states are distinct but
  share the same `expandedGroups` signal/actions).
- `DeviceGroup` forces itself open during search/problems filter — nested mode inherits
  that for free by reusing the component. Node drawers force open the same way.
- Eldest-first input order is preserved through the transform (two-pass: shell nodes in
  input order, then link), so sibling order matches the flat view's ordering logic.

## Progress log

- [x] Coordination entry appended to `.agent.status`; `.agent.status` added to `.git/info/exclude`.
- [x] Implementation (steps 2–6).
- [x] Typecheck + Prettier pass (no Rust changes). Drive-by: removed a `title=` from
      TopologyView's collapse chevron (standing no-tooltips rule) → `aria-label`.
- [x] README updated ("USB Physical Nesting" feature section). CLAUDE.md structure list
      doesn't enumerate grouping/topology libs, so no change needed there.
- [x] Committed as `99f1071` (only my files staged; other agent's work untouched, verified
      via post-commit `git status`). `device-store.ts` was
      mixed with the other agent's `linkMode` work — staged blob rebuilt as HEAD + my 7
      hunks via a temp script (`/tmp/usb-nest-stage/apply-usb-hunks.ts`) + `git hash-object`
      / `update-index`, leaving their hunks unstaged in the working tree.
- [ ] Not yet verified live in the running app (Tauri window; shared tree/port with the
      other agent) — needs a `cargo tauri dev` session with real hubs plugged in.

## Follow-up (2026-07-17): tree-view grouping + default collapse depth

User feedback on the Connections view: identical siblings weren't grouped there at all
(only the category view had grouping), and the tree started fully expanded.

- `topology.ts`: `TopoNode.startCollapsed` — a node's children start hidden unless some
  child is at the physical-plug level (`isPhysicalLevel`: `PCI\` or `USB\` without
  `&MI_`). So controllers/hubs/devices show; composite-device interfaces and HID stacks
  start collapsed. Also `groupTopoSiblings()`: identical-named siblings collapse into ×N
  group rows, but only leaves/`startCollapsed` nodes are groupable — structural nodes
  (hubs) never merge, so grouping can't hide plug topology. Keys `topo::<parent>::<name>`
  share the store's `expandedGroups` signal.
- Store: `collapsedTopoNodes` → `toggledTopoNodes` (set of nodes flipped from default);
  `isTopoCollapsed(id)` → `isTopoToggled(id)`; collapsed = `startCollapsed !== toggled`.
- `TopologyView.tsx`: renders sibling levels through `TopoRows`/`TopoGroup` (group row =
  chevron + rep icon + name + ×N + problem badge; forced open when a member subtree has a
  problem; grouping disabled under the problems filter since the tree is forced open).
- `usb-tree.ts`/`UsbTreeRows.tsx`: same `startCollapsed` defaults applied to the USB
  category's nested mode.
- Committed as the follow-up commit after `71461d2` (see git log).

## Things not to do

- Don't overwrite whole files — the other agent may have uncommitted hunks in
  `device-store.ts` / `DeviceEntry.tsx`. Small `Edit` hunks only, on top of current content.
- Don't commit `.agent.status`.
- Don't add `title=` attributes anywhere; remove ones encountered when touching a file.
- Don't restructure other categories (HID etc.) into the USB tree — out of scope v1.
