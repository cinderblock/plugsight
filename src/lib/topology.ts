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
