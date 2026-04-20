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

import { createSignal, createMemo, createEffect, batch, onCleanup, onMount } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { DeviceInfo, DeviceEvent, GhostEntry, DeviceCategory, DisplayDevice } from './types';
import { hasDeviceProblem } from './types';
import { onDeviceEvent, streamInitialDevices } from './tauri';
import { loadClassIcons } from './icon-cache';

// ── Configuration ─────────────────────────────────────────────────────────

/** localStorage key for persisted filter/UI state. */
const STORAGE_KEY = 'device-manager-pp:ui-state';

/** Default duration (ms) a removed device stays visible as a ghost. */
const DEFAULT_GHOST_TIMEOUT_MS = 30_000;

/** Special value for `ghostTimeoutMs` that means "keep ghosts indefinitely". */
const GHOST_TIMEOUT_INDEFINITE = 0;

/** Maximum number of ghost entries to keep. */
const MAX_GHOSTS = 100;

/** How often (ms) to sweep expired ghosts. */
const GHOST_SWEEP_INTERVAL_MS = 2_000;

/**
 * Row density for the device list, ordered from loosest to tightest.
 *
 * The cycle button advances in this order and wraps around. `normal` is the
 * original default and is what a user sees before they've touched the setting.
 */
export type DensityLevel = 'normal' | 'compact' | 'dense';

const DENSITY_ORDER: readonly DensityLevel[] = ['normal', 'compact', 'dense'];

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

// ── Persistence ──────────────────────────────────────────────────────────

interface PersistedState {
  searchQuery: string;
  showProblemsOnly: boolean;
  hiddenDeviceIds: string[];
  hiddenClassGuids: string[];
  expandedCategories: Record<string, boolean>;
  /** Ghost retention in ms. 0 means "never expire". */
  ghostTimeoutMs: number;
  /** Row density for the device list. Missing on old installs → defaults to 'normal'. */
  density: DensityLevel;
}

function loadPersistedState(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedState>;
  } catch {
    return {};
  }
}

const _saved = loadPersistedState();

// ── Signals ───────────────────────────────────────────────────────────────

const [selectedId, setSelectedId] = createSignal<string | null>(null);
const [searchQuery, setSearchQuery] = createSignal(_saved.searchQuery ?? '');
const [showProblemsOnly, setShowProblemsOnly] = createSignal(_saved.showProblemsOnly ?? false);
const [hiddenDeviceIds, setHiddenDeviceIds] = createSignal<Set<string>>(new Set(_saved.hiddenDeviceIds ?? []));
const [hiddenClassGuids, setHiddenClassGuids] = createSignal<Set<string>>(new Set(_saved.hiddenClassGuids ?? []));
const [ghostTimeoutMs, setGhostTimeoutMs] = createSignal<number>(_saved.ghostTimeoutMs ?? DEFAULT_GHOST_TIMEOUT_MS);
const [density, setDensity] = createSignal<DensityLevel>(
  // Guard against garbage in localStorage — fall back to the default if someone
  // hand-edited the value or we removed a level in a future version.
  DENSITY_ORDER.includes(_saved.density as DensityLevel) ? (_saved.density as DensityLevel) : 'normal',
);
const [recentChanges, setRecentChanges] = createSignal<Set<string>>(new Set());
/** Recent add/remove counts per class GUID, for category header pills. */
const [recentAddsPerClass, setRecentAddsPerClass] = createSignal<Record<string, number>>({});
const [recentRemovesPerClass, setRecentRemovesPerClass] = createSignal<Record<string, number>>({});

// ── Store ─────────────────────────────────────────────────────────────────

const [state, setState] = createStore<DeviceStoreState>({
  devices: {},
  ghosts: {},
  enumerationComplete: false,
  expandedCategories: _saved.expandedCategories ?? {},
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
      // Load real Windows icons for all discovered device classes.
      {
        const uniqueGuids = [...new Set(Object.values(state.devices).map(d => d.classGuid))];
        loadClassIcons(uniqueGuids);
      }
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

    // Track recent add for category pill (skip during initial enumeration).
    if (state.enumerationComplete) {
      markRecentAdd(device.classGuid);
    }
  });
}

function handleDeviceRemoved(instanceId: string) {
  const device = state.devices[instanceId];
  if (!device) return;

  const classGuid = device.classGuid;
  const now = Date.now();

  batch(() => {
    // Move to ghosts. Expiration is computed at sweep time against the
    // current `ghostTimeoutMs()` setting, so changing the setting affects
    // existing ghosts without re-stamping.
    setState('ghosts', instanceId, {
      device: { ...device, isPresent: false },
      removedAt: now,
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

    // Track recent remove for category pill.
    markRecentRemove(classGuid);
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

/** How long (ms) the +/- pills stay visible on category headers. */
const PILL_DURATION_MS = 5_000;

function markRecentAdd(classGuid: string) {
  setRecentAddsPerClass(prev => ({ ...prev, [classGuid]: (prev[classGuid] ?? 0) + 1 }));
  setTimeout(() => {
    setRecentAddsPerClass(prev => {
      const count = (prev[classGuid] ?? 1) - 1;
      if (count <= 0) {
        const { [classGuid]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [classGuid]: count };
    });
  }, PILL_DURATION_MS);
}

function markRecentRemove(classGuid: string) {
  setRecentRemovesPerClass(prev => ({ ...prev, [classGuid]: (prev[classGuid] ?? 0) + 1 }));
  setTimeout(() => {
    setRecentRemovesPerClass(prev => {
      const count = (prev[classGuid] ?? 1) - 1;
      if (count <= 0) {
        const { [classGuid]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [classGuid]: count };
    });
  }, PILL_DURATION_MS);
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

/**
 * Sweep expired ghost entries based on the current `ghostTimeoutMs()` setting.
 *
 * When the timeout is `GHOST_TIMEOUT_INDEFINITE` (0), ghosts are never swept
 * and remain until manually dismissed or the MAX_GHOSTS cap is hit.
 */
function sweepGhosts() {
  const timeout = ghostTimeoutMs();
  if (timeout === GHOST_TIMEOUT_INDEFINITE) return;

  const now = Date.now();
  const expired = Object.entries(state.ghosts).filter(([_, g]) => now - g.removedAt >= timeout);

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
        iconId: device.iconId || 'other',
        devices: [],
        problemCount: 0,
        visible: true,
      };
      catMap.set(device.classGuid, cat);
    }
    return cat;
  };

  // Add live devices (always included, visibility determined by filters).
  for (const device of Object.values(state.devices)) {
    const cat = getCategory(device);
    const visible =
      !hiddenClasses.has(device.classGuid) &&
      !hiddenDevices.has(device.instanceId) &&
      (!query || matchesSearch(device, query)) &&
      (!problemsOnly || hasDeviceProblem(device.status));
    cat.devices.push({ device, isGhost: false, visible });
    if (visible && hasDeviceProblem(device.status)) cat.problemCount++;
  }

  // Add ghost devices (hidden when filtering to problems only).
  for (const ghost of Object.values(state.ghosts)) {
    const cat = getCategory(ghost.device);
    const visible =
      !problemsOnly &&
      !hiddenClasses.has(ghost.device.classGuid) &&
      !hiddenDevices.has(ghost.device.instanceId) &&
      (!query || matchesSearch(ghost.device, query));
    cat.devices.push({
      device: ghost.device,
      isGhost: true,
      ghostRemovedAt: ghost.removedAt,
      visible,
    });
  }

  // Sort categories by name, then devices within each category by name.
  // Mark categories as hidden if they have no visible devices.
  const result = Array.from(catMap.values());
  result.sort((a, b) => a.className.localeCompare(b.className));
  for (const cat of result) {
    cat.visible = cat.devices.some(d => d.visible);
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
  if (live) return { device: live, isGhost: false, visible: true };

  const ghost = state.ghosts[id];
  if (ghost) return { device: ghost.device, isGhost: true, ghostRemovedAt: ghost.removedAt, visible: true };

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
const hasActiveFilters = createMemo(
  () => searchQuery() !== '' || showProblemsOnly() || hiddenDeviceIds().size > 0 || hiddenClassGuids().size > 0,
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
  batch(() => {
    for (const key of Object.keys(state.expandedCategories)) {
      setState('expandedCategories', key, false);
    }
  });
}

/** Advance to the next density level in the cycle, wrapping around. */
function cycleDensity() {
  const current = density();
  const idx = DENSITY_ORDER.indexOf(current);
  const next = DENSITY_ORDER[(idx + 1) % DENSITY_ORDER.length];
  setDensity(next);
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

/**
 * Flash the "recent change" highlight on every currently-present device.
 *
 * Used as visible feedback after a manual "Scan for hardware changes". The
 * backend's forced re-enumeration emits proper Added/Removed/Updated events
 * for anything that actually changed, but when nothing changed the user would
 * otherwise see no feedback at all — this pulse makes it obvious the scan ran.
 */
function pulseAllDevices() {
  for (const id of Object.keys(state.devices)) {
    markRecentChange(id);
  }
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
  setHiddenDeviceIds(new Set<string>());
  // Auto-expand the solo'd category.
  setState('expandedCategories', classGuid, true);
}

function clearAllFilters() {
  batch(() => {
    setSearchQuery('');
    setShowProblemsOnly(false);
    setHiddenDeviceIds(new Set<string>());
    setHiddenClassGuids(new Set<string>());
  });
}

// ── Initialization ────────────────────────────────────────────────────────

/** Call this once from the root component to wire up the event listener and ghost sweeper. */
function initDeviceStore() {
  let unlisten: (() => void) | null = null;

  onMount(async () => {
    // 1. Subscribe to device events first.
    unlisten = await onDeviceEvent(handleDeviceEvent);

    // 2. Now that we're listening, ask the backend to stream the initial
    //    device list as individual Added events. The UI populates progressively
    //    as each device is discovered. An EnumerationComplete event follows.
    streamInitialDevices();
  });

  // Periodic ghost sweeper.
  const sweepTimer = setInterval(sweepGhosts, GHOST_SWEEP_INTERVAL_MS);

  // Auto-save filter/UI state to localStorage on any change.
  createEffect(() => {
    const persisted: PersistedState = {
      searchQuery: searchQuery(),
      showProblemsOnly: showProblemsOnly(),
      hiddenDeviceIds: [...hiddenDeviceIds()],
      hiddenClassGuids: [...hiddenClassGuids()],
      expandedCategories: { ...state.expandedCategories },
      ghostTimeoutMs: ghostTimeoutMs(),
      density: density(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // Storage full or unavailable — silently ignore.
    }
  });

  // Running a sweep when the timeout changes gives immediate feedback:
  // shortening the timeout purges already-expired ghosts without waiting
  // for the next periodic sweep tick.
  createEffect(() => {
    ghostTimeoutMs(); // track
    sweepGhosts();
  });

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
  ghostTimeoutMs,
  setGhostTimeoutMs,
  GHOST_TIMEOUT_INDEFINITE,
  density,
  hasActiveFilters,
  counts,
  recentChanges,
  recentAddsPerClass,
  recentRemovesPerClass,
  // Actions
  toggleCategory,
  expandAllCategories,
  collapseAllCategories,
  cycleDensity,
  dismissGhost,
  clearAllGhosts,
  pulseAllDevices,
  hideDevice,
  hideCategory,
  soloCategory,
  clearAllFilters,
};
