/**
 * Tests for the connection-topology transform.
 *
 * Run with `bun test`. The transform is pure — it takes the device set plus the
 * parent/child index the store derives — so it can be exercised without Tauri.
 */

import { describe, expect, test } from 'bun:test';
import type { DeviceInfo } from './types';
import {
  attachTwins,
  buildFilteredTopologyForest,
  buildTopologyForest,
  elideHidden,
  mergeUsbHubTwins,
  subtreeHasProblem,
  type TopoNode,
} from './topology';

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
    links: [],
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

describe('elideHidden', () => {
  const hiddenIs =
    (...ids: string[]) =>
    (d: DeviceInfo) =>
      ids.includes(d.instanceId);

  test('returns the inputs untouched when nothing is hidden', () => {
    const f = fixture();
    const rel = elideHidden(...argsOf(f), () => false);

    expect(rel.devicesById).toBe(f.devicesById);
    expect(rel.childrenByParent).toBe(f.childrenByParent);
    expect(rel.parentByChild).toBe(f.parentByChild);
  });

  test('drops only the hidden row — children reparent to the ancestor above it', () => {
    const rel = elideHidden(...argsOf(fixture()), hiddenIs('USB\\HUB'));
    const nodes = flatten(buildTopologyForest(rel.devicesById, rel.childrenByParent, rel.parentByChild));

    expect(nodes.has('USB\\HUB')).toBe(false);
    // The hub's devices survive, now hanging off the root hub it plugged into.
    expect(nodes.has('USB\\KEYBOARD')).toBe(true);
    expect(
      nodes
        .get('USB\\ROOT_HUB')!
        .children.map(c => c.device.instanceId)
        .sort(),
    ).toEqual(['USB\\ADAPTER', 'USB\\KEYBOARD']);
  });

  test('a hidden device never survives as dimmed context under a search', () => {
    // The bug this exists to prevent: buildFilteredTopologyForest re-adds the
    // ancestors of any match, which would resurrect a hidden hub as a faded row.
    const rel = elideHidden(...argsOf(fixture()), hiddenIs('USB\\HUB'));
    const nodes = flatten(
      buildFilteredTopologyForest(rel.devicesById, rel.childrenByParent, rel.parentByChild, matchName('keyboard')),
    );

    expect(nodes.has('USB\\HUB')).toBe(false);
    expect(nodes.has('USB\\KEYBOARD')).toBe(true);
  });

  test('walks up through a run of hidden ancestors', () => {
    const rel = elideHidden(...argsOf(fixture()), hiddenIs('USB\\HUB', 'USB\\ROOT_HUB'));
    const nodes = flatten(buildTopologyForest(rel.devicesById, rel.childrenByParent, rel.parentByChild));

    expect(
      nodes
        .get('PCI\\CTRL')!
        .children.map(c => c.device.instanceId)
        .sort(),
    ).toEqual(['USB\\ADAPTER', 'USB\\KEYBOARD']);
  });

  test('orphaned children become roots when the whole chain above is hidden', () => {
    const rel = elideHidden(...argsOf(fixture()), hiddenIs('PCI\\CTRL', 'USB\\ROOT_HUB', 'USB\\HUB'));
    const forest = buildTopologyForest(rel.devicesById, rel.childrenByParent, rel.parentByChild);

    expect(forest.map(n => n.device.instanceId).sort()).toEqual(['USB\\ADAPTER', 'USB\\KEYBOARD']);
  });

  test('hiding a leaf leaves the rest of the tree intact', () => {
    const rel = elideHidden(...argsOf(fixture()), hiddenIs('USB\\KEYBOARD'));
    const nodes = flatten(buildTopologyForest(rel.devicesById, rel.childrenByParent, rel.parentByChild));

    expect(nodes.has('USB\\KEYBOARD')).toBe(false);
    expect(nodes.size).toBe(DEVICES.length - 1);
  });

  test('a parent cycle through a hidden node roots rather than self-parents', () => {
    // relationIndex rejects self-parenting but not a longer loop, so a bad
    // driver can report A→B→A. Walking up from A through hidden B lands back on
    // A; making A its own parent would drop A and everything under it, since
    // the forest builder only starts from nodes with no in-set parent.
    const cyclic = fixture([
      device('USB\\A', 'A', 'USB\\B'),
      device('USB\\B', 'B', 'USB\\A'),
      device('USB\\C', 'C', 'USB\\B'),
    ]);
    const rel = elideHidden(...argsOf(cyclic), hiddenIs('USB\\B'));

    expect(rel.devicesById.has('USB\\B')).toBe(false);
    expect(rel.parentByChild.get('USB\\A')).toBeUndefined();
    expect(rel.parentByChild.get('USB\\C')).toBe('USB\\A');

    const forest = buildTopologyForest(rel.devicesById, rel.childrenByParent, rel.parentByChild);
    expect(flatten(forest).size).toBe(2);
  });
});

/** Spread helper so a fixture can be passed straight into the builder. */
function argsOf(f: ReturnType<typeof fixture>) {
  return [f.devicesById, f.childrenByParent, f.parentByChild] as const;
}

/** A USB 2 hub half that the backend paired with `usb3Id` through its companion port. */
function usb2Half(instanceId: string, parentId: string, usb3Id: string): DeviceInfo {
  return {
    ...device(instanceId, 'Generic USB Hub', parentId),
    links: [
      { bus: 'usb', speed: 'high', capable: 'super', portUsb3: true, companionConnected: true, companionId: usb3Id },
    ],
  };
}

/**
 * Two USB 3 hubs, one plugged into the other, as Windows lists them — each
 * hub twice, one half per USB generation:
 *
 *   root hub ┬ hub A (USB 2 half) ┬ keyboard
 *            │                    └ hub B (USB 2 half) → mouse
 *            └ hub A (USB 3 half) ┬ SSD
 *                                 └ hub B (USB 3 half) → capture card
 */
const TWIN_DEVICES = [
  device('USB\\ROOT', 'USB Root Hub (USB 3.0)'),
  usb2Half('USB\\A2', 'USB\\ROOT', 'USB\\A3'),
  device('USB\\A3', 'Generic SuperSpeed USB Hub', 'USB\\ROOT'),
  device('USB\\KEYBOARD', 'Keyboard', 'USB\\A2'),
  device('USB\\SSD', 'Portable SSD', 'USB\\A3'),
  // Reported in a different case than the real ID: pairing is case-insensitive.
  usb2Half('USB\\B2', 'USB\\A2', 'usb\\b3'),
  device('USB\\B3', 'Generic SuperSpeed USB Hub', 'USB\\A3'),
  device('USB\\MOUSE', 'Mouse', 'USB\\B2'),
  device('USB\\CAPTURE', 'Capture Card', 'USB\\B3'),
];

describe('mergeUsbHubTwins', () => {
  const merged = () => {
    const f = fixture(TWIN_DEVICES);
    return mergeUsbHubTwins(f.devicesById, f.childrenByParent, f.parentByChild);
  };

  test('folds each USB 3 hub into one row, keeping the USB 3 half', () => {
    const m = merged();
    expect(m.devicesById.has('USB\\A2')).toBe(false);
    expect(m.devicesById.has('USB\\B2')).toBe(false);
    expect(m.twins.get('USB\\A3')?.instanceId).toBe('USB\\A2');
    expect(m.twins.get('USB\\B3')?.instanceId).toBe('USB\\B2');
  });

  test('each device ends up under the hub it is physically plugged into', () => {
    const m = merged();
    const forest = attachTwins(buildTopologyForest(m.devicesById, m.childrenByParent, m.parentByChild), m.twins);
    const nodes = flatten(forest);

    const hubA = nodes.get('USB\\A3')!;
    expect(hubA.twin?.instanceId).toBe('USB\\A2');
    expect(hubA.children.map(c => c.device.instanceId).sort()).toEqual(['USB\\B3', 'USB\\KEYBOARD', 'USB\\SSD']);

    const hubB = nodes.get('USB\\B3')!;
    expect(hubB.twin?.instanceId).toBe('USB\\B2');
    expect(hubB.children.map(c => c.device.instanceId).sort()).toEqual(['USB\\CAPTURE', 'USB\\MOUSE']);

    // One chain under the root hub, not two.
    expect(nodes.get('USB\\ROOT')!.children.map(c => c.device.instanceId)).toEqual(['USB\\A3']);
  });

  test('a USB 2 half whose twin is missing stays its own row', () => {
    // Hub A's USB 3 side is down (or hidden): nothing to fold into.
    const f = fixture(TWIN_DEVICES.filter(d => d.instanceId !== 'USB\\A3'));
    const m = mergeUsbHubTwins(f.devicesById, f.childrenByParent, f.parentByChild);
    expect(m.devicesById.has('USB\\A2')).toBe(true);
    expect(m.twins.has('USB\\A3')).toBe(false);
    expect(m.parentByChild.get('USB\\KEYBOARD')).toBe('USB\\A2');
  });

  test('returns the inputs untouched when nothing pairs', () => {
    const f = fixture();
    const m = mergeUsbHubTwins(f.devicesById, f.childrenByParent, f.parentByChild);
    expect(m.devicesById).toBe(f.devicesById);
    expect(m.twins.size).toBe(0);
  });

  test('a problem on the folded USB 2 half still flags the row', () => {
    const broken = TWIN_DEVICES.map(d =>
      d.instanceId === 'USB\\B2' ? { ...d, status: { kind: 'error' as const, code: 43, message: 'Failed' } } : d,
    );
    const f = fixture(broken);
    const m = mergeUsbHubTwins(f.devicesById, f.childrenByParent, f.parentByChild);
    const forest = attachTwins(buildTopologyForest(m.devicesById, m.childrenByParent, m.parentByChild), m.twins);
    expect(subtreeHasProblem(flatten(forest).get('USB\\B3')!)).toBe(true);
  });

  test('two halves claiming the same twin fold only once', () => {
    const f = fixture([...TWIN_DEVICES, usb2Half('USB\\ROGUE', 'USB\\ROOT', 'USB\\A3')]);
    const m = mergeUsbHubTwins(f.devicesById, f.childrenByParent, f.parentByChild);
    expect(m.twins.get('USB\\A3')?.instanceId).toBe('USB\\A2');
    expect(m.devicesById.has('USB\\ROGUE')).toBe(true);
  });
});
