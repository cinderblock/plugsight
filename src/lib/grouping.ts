/**
 * Grouping of seemingly-identical devices within a category.
 *
 * Many categories list the same device name many times (e.g. six
 * "HID-compliant consumer control device" entries). That wastes vertical space
 * and conveys nothing. `groupRows` collapses each run of same-named devices into
 * a single expandable group row; everything else stays an individual row.
 *
 * This is a pure view transform over the already-filtered, already-sorted
 * `DisplayDevice[]` a category produces — the store remains the source of truth.
 */

import type { DisplayDevice } from './types';

/** A renderable row in a category: a lone device or a collapsed run of identical ones. */
export type DeviceRow =
  | { kind: 'single'; key: string; device: DisplayDevice }
  | { kind: 'group'; key: string; name: string; isGhost: boolean; devices: DisplayDevice[] };

/**
 * Stable key identifying a group within a category.
 *
 * Scoped by `classGuid` so the same device name under two different classes
 * doesn't share expansion state, and by ghost-state so a live group and a ghost
 * group of the same name stay distinct.
 */
export function groupKey(classGuid: string, isGhost: boolean, name: string): string {
  return `${classGuid}::${isGhost ? 'g' : 'l'}::${name}`;
}

/**
 * Collapse devices sharing the same (name, ghost-state) into groups — even when
 * they are NOT adjacent.
 *
 * Grouping deliberately does NOT rely on adjacency: the store sorts each category
 * "eldest first" (by subtree size), which interleaves same-named devices that have
 * different child counts (e.g. several "Generic USB Hub"s). We bucket by key across
 * the whole list so they still collapse into one group, anchored at the group's
 * first occurrence. Because the input is eldest-sorted, that anchor is the eldest
 * member and the members within a group stay in eldest-first order — keeping the
 * ordering consistent with the flattened topology tree.
 *
 * A key with ≥2 members becomes a `group` row; a lone device stays a `single`.
 * Visibility is handled at render time (filtered-out members still animate out and
 * the group's visible-count stays accurate). When `enabled` is false, every device
 * is returned as its own `single` row.
 */
export function groupRows(classGuid: string, devices: DisplayDevice[], enabled: boolean): DeviceRow[] {
  if (!enabled) {
    return devices.map(d => ({ kind: 'single', key: d.device.instanceId, device: d }));
  }

  // First pass: how many devices share each key? (Decides group vs single.)
  const counts = new Map<string, number>();
  for (const d of devices) {
    const k = groupKey(classGuid, d.isGhost, d.device.name);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  // Second pass: build rows in first-occurrence (eldest) order, bucketing into groups.
  const rows: DeviceRow[] = [];
  const groups = new Map<string, Extract<DeviceRow, { kind: 'group' }>>();
  for (const d of devices) {
    const k = groupKey(classGuid, d.isGhost, d.device.name);
    if ((counts.get(k) ?? 0) >= 2) {
      let group = groups.get(k);
      if (!group) {
        group = { kind: 'group', key: k, name: d.device.name, isGhost: d.isGhost, devices: [] };
        groups.set(k, group);
        rows.push(group);
      }
      group.devices.push(d);
    } else {
      rows.push({ kind: 'single', key: d.device.instanceId, device: d });
    }
  }
  return rows;
}
