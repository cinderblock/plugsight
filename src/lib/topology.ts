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

export interface TopoNode {
  device: DeviceInfo;
  children: TopoNode[];
  /** Total descendants in this (pruned) subtree, excluding self. */
  descendantCount: number;
  /** Rendered de-emphasised — included only as context (e.g. an ancestor or
   *  sibling of a problem device while the problems filter is active). */
  dimmed: boolean;
}

/** Instance-ID prefixes considered in-scope for the USB + PCI topology. */
const RELEVANT_PREFIXES = ['PCI\\', 'USB\\', 'HID\\'];

export function isTopologyRelevant(instanceId: string): boolean {
  const u = instanceId.toUpperCase();
  return RELEVANT_PREFIXES.some(p => u.startsWith(p));
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
    const node: TopoNode = { device, children, descendantCount, dimmed: dim(device) };
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
