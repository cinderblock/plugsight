/**
 * Tests for the connection-topology transform.
 *
 * Run with `bun test`. The transform is pure — it takes the device set plus the
 * parent/child index the store derives — so it can be exercised without Tauri.
 */

import { describe, expect, test } from 'bun:test';
import type { DeviceInfo } from './types';
import { buildFilteredTopologyForest, buildTopologyForest, type TopoNode } from './topology';

/** A minimal device; only the fields the topology reads actually matter. */
function device(instanceId: string, name: string, parentId = ''): DeviceInfo {
  return {
    instanceId,
    name,
    description: name,
    manufacturer: '',
    className: '',
    classGuid: '',
    iconId: '',
    driverVersion: '',
    status: { kind: 'ok' },
    problemCode: 0,
    hardwareIds: [],
    parentId,
    portName: null,
    isPresent: true,
  };
}

/**
 * A small but realistic USB chain:
 *
 *   controller → root hub → hub ┬ keyboard
 *                               └ serial adapter (composite) → COM function
 */
const DEVICES = [
  device('PCI\\CTRL', 'USB xHCI Controller'),
  device('USB\\ROOT_HUB', 'USB Root Hub', 'PCI\\CTRL'),
  device('USB\\HUB', 'Generic USB Hub', 'USB\\ROOT_HUB'),
  device('USB\\KEYBOARD', 'USB Keyboard', 'USB\\HUB'),
  device('USB\\ADAPTER', 'USB Serial Adapter', 'USB\\HUB'),
  device('USB\\ADAPTER&MI_00', 'USB Serial Port (COM7)', 'USB\\ADAPTER'),
];

function fixture(devices: DeviceInfo[] = DEVICES) {
  const devicesById = new Map(devices.map(d => [d.instanceId, d]));
  const childrenByParent = new Map<string, Set<string>>();
  const parentByChild = new Map<string, string>();
  for (const d of devices) {
    if (!d.parentId) continue;
    parentByChild.set(d.instanceId, d.parentId);
    let kids = childrenByParent.get(d.parentId);
    if (!kids) childrenByParent.set(d.parentId, (kids = new Set()));
    kids.add(d.instanceId);
  }
  return { devicesById, childrenByParent, parentByChild };
}

/** Flatten a forest to `instanceId → node` for order-independent assertions. */
function flatten(forest: TopoNode[], into = new Map<string, TopoNode>()): Map<string, TopoNode> {
  for (const node of forest) {
    into.set(node.device.instanceId, node);
    flatten(node.children, into);
  }
  return into;
}

const matchName = (needle: string) => (d: DeviceInfo) => d.name.toLowerCase().includes(needle.toLowerCase());

describe('buildTopologyForest', () => {
  test('nests the whole chain under a single root', () => {
    const { devicesById, childrenByParent, parentByChild } = fixture();
    const forest = buildTopologyForest(devicesById, childrenByParent, parentByChild);

    expect(forest.map(n => n.device.instanceId)).toEqual(['PCI\\CTRL']);
    expect(flatten(forest).size).toBe(DEVICES.length);
  });
});

describe('buildFilteredTopologyForest', () => {
  test('keeps a match and every ancestor that places it', () => {
    const { devicesById, childrenByParent, parentByChild } = fixture();
    const nodes = flatten(
      buildFilteredTopologyForest(devicesById, childrenByParent, parentByChild, matchName('keyboard')),
    );

    expect([...nodes.keys()].sort()).toEqual(['PCI\\CTRL', 'USB\\HUB', 'USB\\ROOT_HUB', 'USB\\KEYBOARD'].sort());
  });

  test('dims the ancestors but not the match itself', () => {
    const { devicesById, childrenByParent, parentByChild } = fixture();
    const nodes = flatten(
      buildFilteredTopologyForest(devicesById, childrenByParent, parentByChild, matchName('keyboard')),
    );

    expect(nodes.get('USB\\KEYBOARD')!.dimmed).toBe(false);
    expect(nodes.get('USB\\HUB')!.dimmed).toBe(true);
    expect(nodes.get('PCI\\CTRL')!.dimmed).toBe(true);
  });

  test('drops non-matching branches', () => {
    const { devicesById, childrenByParent, parentByChild } = fixture();
    const nodes = flatten(
      buildFilteredTopologyForest(devicesById, childrenByParent, parentByChild, matchName('keyboard')),
    );

    expect(nodes.has('USB\\ADAPTER')).toBe(false);
  });

  test('finds a match nested inside a device (below the default expansion depth)', () => {
    const { devicesById, childrenByParent, parentByChild } = fixture();
    const nodes = flatten(buildFilteredTopologyForest(devicesById, childrenByParent, parentByChild, matchName('COM7')));

    expect(nodes.has('USB\\ADAPTER&MI_00')).toBe(true);
    expect(nodes.get('USB\\ADAPTER')!.dimmed).toBe(true);
  });

  test('a device added later is picked up by the same query', () => {
    // The store rebuilds this memo on every device event, so "plugged in while
    // searching" is just the same filter over a larger device set.
    const before = fixture();
    expect(flatten(buildFilteredTopologyForest(...argsOf(before), matchName('COM9'))).size).toBe(0);

    const after = fixture([...DEVICES, device('USB\\ADAPTER&MI_01', 'USB Serial Port (COM9)', 'USB\\ADAPTER')]);
    const nodes = flatten(buildFilteredTopologyForest(...argsOf(after), matchName('COM9')));

    expect(nodes.has('USB\\ADAPTER&MI_01')).toBe(true);
    expect(nodes.has('PCI\\CTRL')).toBe(true);
  });

  test('excludes non-matching children of a match unless asked for them', () => {
    const { devicesById, childrenByParent, parentByChild } = fixture();
    const search = flatten(
      buildFilteredTopologyForest(devicesById, childrenByParent, parentByChild, matchName('Serial Adapter')),
    );
    expect(search.has('USB\\ADAPTER&MI_00')).toBe(false);

    const withChildren = flatten(
      buildFilteredTopologyForest(devicesById, childrenByParent, parentByChild, matchName('Serial Adapter'), true),
    );
    expect(withChildren.has('USB\\ADAPTER&MI_00')).toBe(true);
  });

  test('matching nothing yields an empty forest', () => {
    const { devicesById, childrenByParent, parentByChild } = fixture();
    const forest = buildFilteredTopologyForest(
      devicesById,
      childrenByParent,
      parentByChild,
      matchName('no such thing'),
    );

    expect(forest).toEqual([]);
  });
});

/** Spread helper so a fixture can be passed straight into the builder. */
function argsOf(f: ReturnType<typeof fixture>) {
  return [f.devicesById, f.childrenByParent, f.parentByChild] as const;
}
