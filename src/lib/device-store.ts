/**
 * Central device state management using SolidJS reactive primitives.
 *
 * Manages:
 * - Live devices (currently present in the system)
 * - Ghost entries (recently removed, shown for a configurable duration)
 * - Category grouping and expansion state
 * - Search/filter state
 * - Selection state
 */

import { createSignal, createMemo, batch, onCleanup, onMount } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { DeviceInfo, DeviceEvent, GhostEntry, DeviceCategory, DisplayDevice } from './types';
import { hasDeviceProblem } from './types';
import { onDeviceEvent, getAllDevices } from './tauri';
import { CLASS_ICON_MAP } from './icons';
import { loadClassIcons } from './icon-cache';

// ── Configuration ─────────────────────────────────────────────────────────

/** How long (ms) a removed device stays visible as a ghost. */
const GHOST_DURATION_MS = 30_000;

/** Maximum number of ghost entries to keep. */
const MAX_GHOSTS = 100;

/** How often (ms) to sweep expired ghosts. */
const GHOST_SWEEP_INTERVAL_MS = 2_000;

// ── Store types ───────────────────────────────────────────────────────────

interface DeviceStoreState {
  /** Live devices keyed by instance ID. */
  devices: Record<string, DeviceInfo>;
  /** Ghost entries keyed by instance ID. */
  ghosts: Record<string, GhostEntry>;
  /** Whether the initial enumeration has completed. */
  enumerationComplete: boolean;
  /** Category expansion state keyed by classGuid. */
  expandedCategories: Record<string, boolean>;
}

// ── Signals ───────────────────────────────────────────────────────────────

const [selectedId, setSelectedId] = createSignal<string | null>(null);
const [searchQuery, setSearchQuery] = createSignal('');
const [showProblemsOnly, setShowProblemsOnly] = createSignal(false);
const [hiddenDeviceIds, setHiddenDeviceIds] = createSignal<Set<string>>(new Set());
const [hiddenClassGuids, setHiddenClassGuids] = createSignal<Set<string>>(new Set());
const [recentChanges, setRecentChanges] = createSignal<Set<string>>(new Set());

// ── Store ─────────────────────────────────────────────────────────────────

const [state, setState] = createStore<DeviceStoreState>({
  devices: {},
  ghosts: {},
  enumerationComplete: false,
  expandedCategories: {},
});

// ── Event handling ────────────────────────────────────────────────────────

function handleDeviceEvent(event: DeviceEvent) {
  switch (event.type) {
    case 'added':
      handleDeviceAdded(event.device);
      break;
    case 'removed':
      handleDeviceRemoved(event.instanceId);
      break;
    case 'updated':
      handleDeviceUpdated(event.device);
      break;
    case 'enumerationComplete':
      setState('enumerationComplete', true);
      break;
  }
}

function handleDeviceAdded(device: DeviceInfo) {
  batch(() => {
    // If this device was a ghost, remove it from ghosts (it came back!).
    if (state.ghosts[device.instanceId]) {
      setState(
        produce(s => {
          delete s.ghosts[device.instanceId];
        }),
      );
    }

    // Add/update in the live devices map.
    setState('devices', device.instanceId, device);

    // Auto-expand the category if it contains problem devices.
    if (hasDeviceProblem(device.status)) {
      setState('expandedCategories', device.classGuid, true);
    }

    // Mark as recently changed for highlight animation.
    markRecentChange(device.instanceId);
  });
}

function handleDeviceRemoved(instanceId: string) {
  const device = state.devices[instanceId];
  if (!device) return;

  const now = Date.now();

  batch(() => {
    // Move to ghosts.
    setState('ghosts', instanceId, {
      device: { ...device, isPresent: false },
      removedAt: now,
      expiresAt: now + GHOST_DURATION_MS,
    });

    // Remove from live devices.
    setState(
      produce(s => {
        delete s.devices[instanceId];
      }),
    );

    // Enforce ghost cap.
    enforceGhostCap();

    // Mark as recently changed.
    markRecentChange(instanceId);
  });
}

function handleDeviceUpdated(device: DeviceInfo) {
  batch(() => {
    setState('devices', device.instanceId, device);
    markRecentChange(device.instanceId);
  });
}

function markRecentChange(instanceId: string) {
  setRecentChanges(prev => {
    const next = new Set(prev);
    next.add(instanceId);
    return next;
  });

  // Clear the highlight after the animation duration.
  setTimeout(() => {
    setRecentChanges(prev => {
      const next = new Set(prev);
      next.delete(instanceId);
      return next;
    });
  }, 2000);
}

function enforceGhostCap() {
  const ghosts = Object.values(state.ghosts);
  if (ghosts.length <= MAX_GHOSTS) return;

  // Remove the oldest ghosts.
  const sorted = ghosts.sort((a, b) => a.removedAt - b.removedAt);
  const toRemove = sorted.slice(0, ghosts.length - MAX_GHOSTS);

  setState(
    produce(s => {
      for (const ghost of toRemove) {
        delete s.ghosts[ghost.device.instanceId];
      }
    }),
  );
}

/** Sweep expired ghost entries. */
function sweepGhosts() {
  const now = Date.now();
  const expired = Object.entries(state.ghosts).filter(([_, g]) => g.expiresAt <= now);

  if (expired.length > 0) {
    setState(
      produce(s => {
        for (const [id] of expired) {
          delete s.ghosts[id];
        }
      }),
    );
  }
}

// ── Derived state ─────────────────────────────────────────────────────────

/** All devices grouped by category, including ghosts, filtered by search. */
const categories = createMemo<DeviceCategory[]>(() => {
  const query = searchQuery().toLowerCase().trim();
  const problemsOnly = showProblemsOnly();
  const hiddenDevices = hiddenDeviceIds();
  const hiddenClasses = hiddenClassGuids();
  const catMap = new Map<string, DeviceCategory>();

  // Helper to get or create a category.
  const getCategory = (device: DeviceInfo): DeviceCategory => {
    let cat = catMap.get(device.classGuid);
    if (!cat) {
      cat = {
        classGuid: device.classGuid,
        className: device.className || 'Other devices',
        iconId: CLASS_ICON_MAP[device.classGuid.toLowerCase()] ?? 'other',
        devices: [],
        problemCount: 0,
      };
      catMap.set(device.classGuid, cat);
    }
    return cat;
  };

  // Add live devices.
  for (const device of Object.values(state.devices)) {
    if (hiddenClasses.has(device.classGuid)) continue;
    if (hiddenDevices.has(device.instanceId)) continue;
    if (query && !matchesSearch(device, query)) continue;
    if (problemsOnly && !hasDeviceProblem(device.status)) continue;
    const cat = getCategory(device);
    cat.devices.push({ device, isGhost: false });
    if (hasDeviceProblem(device.status)) cat.problemCount++;
  }

  // Add ghost devices (excluded when filtering to problems only).
  for (const ghost of Object.values(state.ghosts)) {
    if (problemsOnly) continue;
    if (hiddenClasses.has(ghost.device.classGuid)) continue;
    if (hiddenDevices.has(ghost.device.instanceId)) continue;
    if (query && !matchesSearch(ghost.device, query)) continue;
    const cat = getCategory(ghost.device);
    cat.devices.push({
      device: ghost.device,
      isGhost: true,
      ghostRemovedAt: ghost.removedAt,
    });
  }

  // Sort categories by name, then devices within each category by name.
  const result = Array.from(catMap.values());
  result.sort((a, b) => a.className.localeCompare(b.className));
  for (const cat of result) {
    cat.devices.sort((a, b) => {
      // Ghosts sort to the end.
      if (a.isGhost !== b.isGhost) return a.isGhost ? 1 : -1;
      return a.device.name.localeCompare(b.device.name);
    });
  }

  return result;
});

function matchesSearch(device: DeviceInfo, query: string): boolean {
  return (
    device.name.toLowerCase().includes(query) ||
    device.description.toLowerCase().includes(query) ||
    device.manufacturer.toLowerCase().includes(query) ||
    device.instanceId.toLowerCase().includes(query) ||
    device.hardwareIds.some(id => id.toLowerCase().includes(query))
  );
}

/** The currently selected device (live or ghost). */
const selectedDevice = createMemo<DisplayDevice | null>(() => {
  const id = selectedId();
  if (!id) return null;

  const live = state.devices[id];
  if (live) return { device: live, isGhost: false };

  const ghost = state.ghosts[id];
  if (ghost) return { device: ghost.device, isGhost: true, ghostRemovedAt: ghost.removedAt };

  return null;
});

/** Total counts for the status bar. */
const counts = createMemo(() => {
  const devices = Object.values(state.devices);
  return {
    total: devices.length,
    problems: devices.filter(d => hasDeviceProblem(d.status)).length,
    ghosts: Object.keys(state.ghosts).length,
  };
});

/** Whether any filters are actively hiding content. */
const hasActiveFilters = createMemo(() =>
  searchQuery() !== '' ||
  showProblemsOnly() ||
  hiddenDeviceIds().size > 0 ||
  hiddenClassGuids().size > 0,
);

// ── Actions ───────────────────────────────────────────────────────────────

function toggleCategory(classGuid: string) {
  setState('expandedCategories', classGuid, prev => !prev);
}

function expandAllCategories() {
  const cats = categories();
  batch(() => {
    for (const cat of cats) {
      setState('expandedCategories', cat.classGuid, true);
    }
  });
}

function collapseAllCategories() {
  setState('expandedCategories', {});
}

function dismissGhost(instanceId: string) {
  setState(
    produce(s => {
      delete s.ghosts[instanceId];
    }),
  );
}

function clearAllGhosts() {
  setState('ghosts', {});
}

function hideDevice(instanceId: string) {
  setHiddenDeviceIds(prev => {
    const next = new Set(prev);
    next.add(instanceId);
    return next;
  });
}

function hideCategory(classGuid: string) {
  setHiddenClassGuids(prev => {
    const next = new Set(prev);
    next.add(classGuid);
    return next;
  });
}

/** Hide all categories except the given one. */
function soloCategory(classGuid: string) {
  // Collect all class GUIDs from current devices, then hide everything except the target.
  const allGuids = new Set<string>();
  for (const device of Object.values(state.devices)) {
    allGuids.add(device.classGuid);
  }
  for (const ghost of Object.values(state.ghosts)) {
    allGuids.add(ghost.device.classGuid);
  }
  allGuids.delete(classGuid);
  setHiddenClassGuids(allGuids);
  // Clear device-level hides so devices within the solo'd category aren't hidden.
  setHiddenDeviceIds(new Set());
  // Auto-expand the solo'd category.
  setState('expandedCategories', classGuid, true);
}

function clearAllFilters() {
  batch(() => {
    setSearchQuery('');
    setShowProblemsOnly(false);
    setHiddenDeviceIds(new Set());
    setHiddenClassGuids(new Set());
  });
}

// ── Initialization ────────────────────────────────────────────────────────

/** Call this once from the root component to wire up the event listener and ghost sweeper. */
function initDeviceStore() {
  let unlisten: (() => void) | null = null;

  onMount(async () => {
    // 1. Subscribe to live change events from the DeviceWatcher.
    unlisten = await onDeviceEvent(handleDeviceEvent);

    // 2. Load the initial device list via SetupAPI (reliable, full properties).
    //    The DeviceWatcher will handle incremental changes from this point on.
    try {
      const devices = await getAllDevices();
      batch(() => {
        for (const device of devices) {
          setState('devices', device.instanceId, device);
        }
        setState('enumerationComplete', true);
      });

      // Load real Windows icons for all discovered device classes.
      const uniqueGuids = [...new Set(devices.map(d => d.classGuid))];
      loadClassIcons(uniqueGuids);
    } catch (e) {
      console.error('Failed to enumerate devices:', e);
      setState('enumerationComplete', true);
    }
  });

  // Periodic ghost sweeper.
  const sweepTimer = setInterval(sweepGhosts, GHOST_SWEEP_INTERVAL_MS);

  onCleanup(() => {
    unlisten?.();
    clearInterval(sweepTimer);
  });
}

// ── Exports ───────────────────────────────────────────────────────────────

export {
  // Initialization
  initDeviceStore,
  // Reactive state
  state,
  categories,
  selectedDevice,
  selectedId,
  setSelectedId,
  searchQuery,
  setSearchQuery,
  showProblemsOnly,
  setShowProblemsOnly,
  hasActiveFilters,
  counts,
  recentChanges,
  // Actions
  toggleCategory,
  expandAllCategories,
  collapseAllCategories,
  dismissGhost,
  clearAllGhosts,
  hideDevice,
  hideCategory,
  soloCategory,
  clearAllFilters,
};
