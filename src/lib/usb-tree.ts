/**
 * Physical-nesting transform for the "USB controllers" category.
 *
 * The flat category view lists host controllers, root hubs, hubs, and composite
 * devices as siblings — hiding which hub each one is actually plugged into. This
 * transform rebuilds the category's devices as a forest that mirrors the real
 * plug topology: host controller → root hub → hub → device.
 *
 * Nesting happens BEFORE identical-device grouping: the tree is built first,
 * then runs of identically-named *childless siblings* under the same parent
 * still collapse into a group row (a hub with its own subtree never merges into
 * a group). Like `grouping.ts`, this is a pure view transform over the
 * already-filtered, already-sorted `DisplayDevice[]` a category produces.
 */

import type { DisplayDevice } from './types';
import { isUsbPlug } from './topology';

/** A renderable row in the nested USB view. */
export type UsbRow =
  | {
      kind: 'node';
      key: string;
      device: DisplayDevice;
      /** Direct children (already grouped per-level), rendered in an indented drawer. */
      children: UsbRow[];
      /** Members of the whole subtree, self included — drives visibility & counts. */
      subtree: DisplayDevice[];
      /**
       * Whether the children drawer starts hidden: true when every child is
       * inside the device (interface functions) rather than a physical plug —
       * same default depth as the Connections topology view.
       */
      startCollapsed: boolean;
    }
  | { kind: 'group'; key: string; name: string; isGhost: boolean; devices: DisplayDevice[] };

/**
 * Stable key for a sibling group in the nested view.
 *
 * Scoped by the parent's instanceId (or `^` for roots) so identical devices
 * under two different hubs don't share expansion state, and prefixed `usb::` so
 * it can never collide with `grouping.ts` keys in the shared expansion signal.
 */
function usbGroupKey(parentId: string | null, isGhost: boolean, name: string): string {
  return `usb::${parentId ?? '^'}::${isGhost ? 'g' : 'l'}::${name}`;
}

/** True when any member of the list passes the current filters. */
export function anyVisible(devices: DisplayDevice[]): boolean {
  return devices.some(d => d.visible);
}

/**
 * Build the nested-row forest for one category's devices.
 *
 * A device nests under its nearest ancestor that is also in `devices` (walked
 * via `parentByChild`, which spans live + ghost devices); everything else is a
 * root. Input order — ghosts last, eldest first — is preserved for roots and
 * within each sibling list, keeping ordering consistent with the flat view.
 *
 * @param devices        the category's display devices, in display order
 * @param parentByChild  child instanceId → resolved parent instanceId (store's relationIndex)
 * @param groupEnabled   whether identical childless siblings collapse into group rows
 */
export function buildUsbRows(
  devices: DisplayDevice[],
  parentByChild: Map<string, string>,
  groupEnabled: boolean,
): UsbRow[] {
  const inCategory = new Map<string, DisplayDevice>();
  for (const d of devices) inCategory.set(d.device.instanceId, d);

  // Nearest in-category ancestor, skipping out-of-category intermediates.
  const nestParent = (id: string): string | null => {
    const seen = new Set<string>([id]); // cycle guard
    let cur = parentByChild.get(id);
    while (cur && !seen.has(cur)) {
      if (inCategory.has(cur)) return cur;
      seen.add(cur);
      cur = parentByChild.get(cur);
    }
    return null;
  };

  // Link children in input order so sibling order matches the flat view.
  const childrenOf = new Map<string | null, DisplayDevice[]>();
  for (const d of devices) {
    const parent = nestParent(d.device.instanceId);
    let siblings = childrenOf.get(parent);
    if (!siblings) {
      siblings = [];
      childrenOf.set(parent, siblings);
    }
    siblings.push(d);
  }

  const subtreeOf = (d: DisplayDevice): DisplayDevice[] => {
    const out: DisplayDevice[] = [d];
    for (const kid of childrenOf.get(d.device.instanceId) ?? []) out.push(...subtreeOf(kid));
    return out;
  };

  // Turn one sibling list into rows: child-bearing devices stay individual node
  // rows; childless ones collapse into groups by (name, ghost-state) when ≥2
  // share a key, anchored at the group's first occurrence.
  const rowsFor = (parentId: string | null): UsbRow[] => {
    const siblings = childrenOf.get(parentId) ?? [];

    const counts = new Map<string, number>();
    if (groupEnabled) {
      for (const d of siblings) {
        if (childrenOf.has(d.device.instanceId)) continue; // subtrees never group
        const k = usbGroupKey(parentId, d.isGhost, d.device.name);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }

    const rows: UsbRow[] = [];
    const groups = new Map<string, Extract<UsbRow, { kind: 'group' }>>();
    for (const d of siblings) {
      const id = d.device.instanceId;
      const kids = childrenOf.get(id);
      if (kids) {
        // Stop expanding at leaf USB devices: collapse only when nothing deeper
        // is itself a USB plug (matches the Connections view's default depth).
        const descendants = subtreeOf(d).slice(1);
        const startCollapsed = !descendants.some(x => isUsbPlug(x.device.instanceId));
        rows.push({ kind: 'node', key: id, device: d, children: rowsFor(id), subtree: subtreeOf(d), startCollapsed });
        continue;
      }
      const k = usbGroupKey(parentId, d.isGhost, d.device.name);
      if ((counts.get(k) ?? 0) >= 2) {
        let group = groups.get(k);
        if (!group) {
          group = { kind: 'group', key: k, name: d.device.name, isGhost: d.isGhost, devices: [] };
          groups.set(k, group);
          rows.push(group);
        }
        group.devices.push(d);
      } else {
        rows.push({ kind: 'node', key: id, device: d, children: [], subtree: [d], startCollapsed: false });
      }
    }
    return rows;
  };

  return rowsFor(null);
}
