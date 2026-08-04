/**
 * Connection-topology forest: devices arranged by their logical parent→child
 * wiring toward the CPU (USB host controller → root hub → hub → device; PCI
 * device → bus → root), instead of by Windows device class.
 *
 * Pure transform over the device set + the parent/child index the store already
 * derives. Scoped to USB + PCI for v1: a node is kept only if it (or one of its
 * descendants) is a PCI/USB/HID device, so the controller chains stay intact but
 * unrelated branches (ACPI thermal zones, software devices, …) are pruned away.
 */

import type { DeviceInfo } from './types';
import { hasDeviceProblem } from './types';

export interface TopoNode {
  device: DeviceInfo;
  children: TopoNode[];
  /** Total descendants in this (pruned) subtree, excluding self. */
  descendantCount: number;
  /** Rendered de-emphasised — included only as context (e.g. an ancestor or
   *  sibling of a problem device while the problems filter is active). */
  dimmed: boolean;
  /**
   * Whether this node's children start hidden. The tree defaults to expanding
   * only down to the physical-plug level (controllers, hubs, USB devices);
   * everything inside a device — composite-device interfaces, HID stacks — is
   * detail the user asks for by expanding.
   */
  startCollapsed: boolean;
}

/** Instance-ID prefixes considered in-scope for the USB + PCI topology. */
const RELEVANT_PREFIXES = ['PCI\\', 'USB\\', 'HID\\'];

export function isTopologyRelevant(instanceId: string): boolean {
  const u = instanceId.toUpperCase();
  return RELEVANT_PREFIXES.some(p => u.startsWith(p));
}

/**
 * True for a node that is itself a whole USB device you physically plug in: a
 * hub, receiver, drive, etc. False for a device's internals — a composite
 * device's interface functions (`USB\...&MI_xx`) and the driver stacks below
 * them (`HID\…`, `SWD\…`). The default tree expansion stops *at* USB devices:
 * everything down to and including USB plugs is shown; their internals are
 * collapsed.
 */
export function isUsbPlug(instanceId: string): boolean {
  const u = instanceId.toUpperCase();
  return u.startsWith('USB\\') && !u.includes('&MI_');
}

/**
 * Whether any node strictly below this one is a USB plug (see {@link isUsbPlug}).
 * Drives the default collapse: a USB device is collapsed only when it's a true
 * leaf — nothing but its own internal functions beneath it. If a real device
 * sits deeper (e.g. a keyboard on a dock's built-in hub, reached through the
 * dock's `&MI_` hub function), the chain stays expanded so that device shows.
 */
function hasUsbPlugDescendant(children: TopoNode[]): boolean {
  return children.some(c => isUsbPlug(c.device.instanceId) || hasUsbPlugDescendant(c.children));
}

/** Whether the node or anything in its subtree has a problem. */
export function subtreeHasProblem(node: TopoNode): boolean {
  return hasDeviceProblem(node.device.status) || node.children.some(subtreeHasProblem);
}

/**
 * Build the pruned topology forest.
 *
 * @param devicesById      every device to consider, keyed by instanceId
 * @param childrenByParent parent instanceId → set of child instanceIds
 * @param parentByChild    child instanceId → resolved parent instanceId
 * @param includeLeaf      extra leaf filter — a node is kept as a leaf only if it
 *                         passes this (e.g. "has a problem"). Ancestors of a kept
 *                         node are always retained so the chain to the root stays
 *                         intact. Defaults to keeping every in-scope leaf.
 * @param dim              marks a kept node as de-emphasised context (e.g. a
 *                         non-problem device shown only because it neighbours a
 *                         problem one). Defaults to never dimming.
 */
export function buildTopologyForest(
  devicesById: Map<string, DeviceInfo>,
  childrenByParent: Map<string, Set<string>>,
  parentByChild: Map<string, string>,
  includeLeaf: (device: DeviceInfo) => boolean = () => true,
  dim: (device: DeviceInfo) => boolean = () => false,
): TopoNode[] {
  // Cache keyed by instanceId; `null` means "pruned / not buildable". The entry
  // is seeded to null before recursing so an unexpected cycle terminates.
  const built = new Map<string, TopoNode | null>();

  const build = (id: string): TopoNode | null => {
    if (built.has(id)) return built.get(id) ?? null;
    const device = devicesById.get(id);
    if (!device) {
      built.set(id, null);
      return null;
    }
    built.set(id, null); // cycle guard

    const children: TopoNode[] = [];
    const kids = childrenByParent.get(id);
    if (kids) {
      for (const kid of kids) {
        const node = build(kid);
        if (node) children.push(node);
      }
    }

    // Prune: keep a node only if it leads to something kept (has children) or is
    // itself an in-scope leaf that passes the leaf filter.
    const keptAsLeaf = isTopologyRelevant(id) && includeLeaf(device);
    if (children.length === 0 && !keptAsLeaf) {
      built.set(id, null);
      return null;
    }

    children.sort(byEldest);
    const descendantCount = children.reduce((n, c) => n + 1 + c.descendantCount, 0);
    // Collapse a node's internals only once there are no more USB plugs deeper
    // down — i.e. stop expanding exactly at leaf USB devices.
    const startCollapsed = children.length > 0 && !hasUsbPlugDescendant(children);
    const node: TopoNode = { device, children, descendantCount, dimmed: dim(device), startCollapsed };
    built.set(id, node);
    return node;
  };

  const roots: TopoNode[] = [];
  for (const id of devicesById.keys()) {
    const parent = parentByChild.get(id);
    if (parent && devicesById.has(parent)) continue; // has an in-set parent → not a root
    const node = build(id);
    if (node) roots.push(node);
  }
  roots.sort(byEldest);
  return roots;
}

/**
 * Build the topology forest narrowed to the devices passing `isMatch` (a search
 * hit, a problem device, …).
 *
 * A match is useless without the chain that places it, so every ancestor of a
 * match is kept too — rendered dimmed, since it's context rather than a hit.
 * `includeMatchChildren` additionally keeps each match's direct children, which
 * the problems filter wants (a failing hub's devices explain the failure) but a
 * search does not (non-matching children would bury the hits).
 *
 * Returning an empty forest when nothing matches is correct: the view shows its
 * "no devices match" state.
 */
export function buildFilteredTopologyForest(
  devicesById: Map<string, DeviceInfo>,
  childrenByParent: Map<string, Set<string>>,
  parentByChild: Map<string, string>,
  isMatch: (device: DeviceInfo) => boolean,
  includeMatchChildren = false,
): TopoNode[] {
  const matched = new Set<string>();
  const include = new Set<string>();

  for (const device of devicesById.values()) {
    if (!isMatch(device)) continue;
    matched.add(device.instanceId);
    include.add(device.instanceId);

    // Ancestor chain up to the root.
    let pid = parentByChild.get(device.instanceId);
    while (pid && devicesById.has(pid) && !include.has(pid)) {
      include.add(pid);
      pid = parentByChild.get(pid);
    }

    if (includeMatchChildren) {
      const kids = childrenByParent.get(device.instanceId);
      if (kids) for (const k of kids) include.add(k);
    }
  }

  return buildTopologyForest(
    devicesById,
    childrenByParent,
    parentByChild,
    d => include.has(d.instanceId),
    d => !matched.has(d.instanceId),
  );
}

/**
 * The same relation maps with every `isHidden` device elided: each one's
 * children re-attach to its nearest non-hidden ancestor, or become roots when
 * the whole chain above them is hidden.
 *
 * Hiding is categorically different from a search miss, and can't go through
 * {@link buildFilteredTopologyForest}'s predicate. That function re-adds the
 * ancestors of anything it keeps — correct for a search, where a match is
 * meaningless without the chain that places it, but wrong here: a hidden hub
 * would survive as a dimmed row, looking like the hide button did nothing.
 * Eliding first also keeps hide meaning "remove this row", never "remove this
 * branch" — matching what the category view does with the same hidden-ID set.
 *
 * Returns the inputs unchanged when nothing is hidden, so the common path
 * allocates nothing.
 */
export function elideHidden(
  devicesById: Map<string, DeviceInfo>,
  childrenByParent: Map<string, Set<string>>,
  parentByChild: Map<string, string>,
  isHidden: (device: DeviceInfo) => boolean,
): {
  devicesById: Map<string, DeviceInfo>;
  childrenByParent: Map<string, Set<string>>;
  parentByChild: Map<string, string>;
} {
  const hidden = new Set<string>();
  for (const d of devicesById.values()) {
    if (isHidden(d)) hidden.add(d.instanceId);
  }
  if (hidden.size === 0) return { devicesById, childrenByParent, parentByChild };

  const nextDevices = new Map<string, DeviceInfo>();
  for (const [id, d] of devicesById) {
    if (!hidden.has(id)) nextDevices.set(id, d);
  }

  /** Nearest ancestor that survives, walking up through hidden ones. */
  const memo = new Map<string, string | undefined>();
  const visibleParent = (id: string): string | undefined => {
    const cached = memo.get(id);
    if (cached !== undefined || memo.has(id)) return cached;
    memo.set(id, undefined); // cycle guard — resolved below
    let pid = parentByChild.get(id);
    const seen = new Set<string>([id]);
    while (pid && hidden.has(pid) && !seen.has(pid)) {
      seen.add(pid);
      pid = parentByChild.get(pid);
    }
    // A parent loop through hidden nodes can walk back around to `id` itself.
    // Rooting it there would make it its own parent, and the forest builder —
    // which only starts from nodes with no in-set parent — would never emit it
    // or anything below it.
    const result = pid && pid !== id && nextDevices.has(pid) ? pid : undefined;
    memo.set(id, result);
    return result;
  };

  const nextParent = new Map<string, string>();
  const nextChildren = new Map<string, Set<string>>();
  for (const id of nextDevices.keys()) {
    const pid = visibleParent(id);
    if (!pid) continue;
    nextParent.set(id, pid);
    let kids = nextChildren.get(pid);
    if (!kids) nextChildren.set(pid, (kids = new Set()));
    kids.add(id);
  }

  return { devicesById: nextDevices, childrenByParent: nextChildren, parentByChild: nextParent };
}

/** Eldest (largest subtree) first, then alphabetical by name. */
function byEldest(a: TopoNode, b: TopoNode): number {
  if (b.descendantCount !== a.descendantCount) return b.descendantCount - a.descendantCount;
  return a.device.name.localeCompare(b.device.name);
}

/** A renderable row within one sibling level of the topology tree. */
export type TopoRow =
  { kind: 'node'; key: string; node: TopoNode } | { kind: 'group'; key: string; name: string; nodes: TopoNode[] };

/**
 * Collapse runs of identically-named siblings into group rows, mirroring the
 * category view's identical-device grouping.
 *
 * Only nodes whose subtree is hidden by default are groupable — leaves and
 * `startCollapsed` nodes (device internals). Structural nodes that start
 * expanded (hubs, controllers) never merge into a group, so grouping can't
 * obscure the plug topology. Keys are scoped by the parent's instanceId so the
 * same device name under two different hubs doesn't share expansion state.
 */
export function groupTopoSiblings(nodes: TopoNode[], parentId: string | null, enabled: boolean): TopoRow[] {
  if (!enabled) return nodes.map(n => ({ kind: 'node', key: n.device.instanceId, node: n }));

  const keyFor = (n: TopoNode) => `topo::${parentId ?? '^'}::${n.device.name}`;
  const groupable = (n: TopoNode) => n.children.length === 0 || n.startCollapsed;

  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (!groupable(n)) continue;
    const k = keyFor(n);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const rows: TopoRow[] = [];
  const groups = new Map<string, Extract<TopoRow, { kind: 'group' }>>();
  for (const n of nodes) {
    const k = keyFor(n);
    if (groupable(n) && (counts.get(k) ?? 0) >= 2) {
      let group = groups.get(k);
      if (!group) {
        group = { kind: 'group', key: k, name: n.device.name, nodes: [] };
        groups.set(k, group);
        rows.push(group);
      }
      group.nodes.push(n);
    } else {
      rows.push({ kind: 'node', key: n.device.instanceId, node: n });
    }
  }
  return rows;
}
