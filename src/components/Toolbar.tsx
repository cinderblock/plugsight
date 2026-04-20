/**
 * Toolbar — top bar with search and actions.
 *
 * Device counts and version info are shown in the StatusBar (footer) instead.
 */

import type { Component } from 'solid-js';
import { Show, createSignal } from 'solid-js';
import {
  searchQuery,
  setSearchQuery,
  counts,
  expandAllCategories,
  collapseAllCategories,
  clearAllGhosts,
  hasActiveFilters,
  clearAllFilters,
  ghostTimeoutMs,
  setGhostTimeoutMs,
  GHOST_TIMEOUT_INDEFINITE,
  pulseAllDevices,
  density,
  cycleDensity,
  type DensityLevel,
} from '~/lib/device-store';
import { scanForHardwareChanges } from '~/lib/tauri';

/** Human-readable labels for each density level. */
const DENSITY_LABELS: Record<DensityLevel, string> = {
  normal: 'Normal',
  compact: 'Compact',
  dense: 'Dense',
};

/** Label of the level the cycle button will advance to next — shown in the tooltip. */
const DENSITY_NEXT_LABEL: Record<DensityLevel, string> = {
  normal: 'Compact',
  compact: 'Dense',
  dense: 'Normal',
};

/** Presets for the ghost timeout selector (ms). 0 = keep indefinitely. */
const GHOST_TIMEOUT_PRESETS: ReadonlyArray<{ ms: number; label: string }> = [
  { ms: 5_000, label: '5s' },
  { ms: 10_000, label: '10s' },
  { ms: 30_000, label: '30s' },
  { ms: 60_000, label: '1m' },
  { ms: 5 * 60_000, label: '5m' },
  { ms: 15 * 60_000, label: '15m' },
  { ms: 60 * 60_000, label: '1h' },
  { ms: GHOST_TIMEOUT_INDEFINITE, label: 'Never' },
];

const Toolbar: Component = () => {
  const [isScanning, setIsScanning] = createSignal(false);

  const handleScan = async () => {
    // Guard against queuing multiple scans while one is in flight.
    if (isScanning()) return;
    setIsScanning(true);
    try {
      // Backend re-emits Added/Removed/Updated for anything that actually
      // changed. The pulse flashes every device row so the user sees the
      // scan ran even when nothing changed.
      await scanForHardwareChanges();
      pulseAllDevices();
    } catch (e) {
      console.error('Hardware scan failed:', e);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div class="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0">
      {/* Search box */}
      <div class="relative flex-1 max-w-sm">
        <svg
          class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search devices..."
          value={searchQuery()}
          onInput={e => setSearchQuery(e.currentTarget.value)}
          class="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors"
        />
        <Show when={searchQuery()}>
          <button
            class="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400"
            onClick={() => setSearchQuery('')}
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </Show>
      </div>

      {/* Action buttons */}
      <div class="flex items-center gap-1">
        <ToolbarButton
          title="Expand all"
          onClick={expandAllCategories}
          icon={
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          }
        />
        <ToolbarButton
          title="Collapse all"
          onClick={collapseAllCategories}
          icon={
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          }
        />

        <ToolbarButton
          title={`Row density: ${DENSITY_LABELS[density()]} — click for ${DENSITY_NEXT_LABEL[density()]}`}
          onClick={cycleDensity}
          icon={<DensityIcon level={density()} />}
        />

        <div class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />

        <ToolbarButton
          title={isScanning() ? 'Scanning…' : 'Scan for hardware changes'}
          onClick={handleScan}
          loading={isScanning()}
          icon={
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
          }
        />

        <Show when={hasActiveFilters()}>
          <div class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />
          <button
            class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/50 transition-colors cursor-pointer"
            title="Clear all filters (search, hidden items, problems only)"
            onClick={clearAllFilters}
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Clear filters
          </button>
        </Show>

        <Show when={counts().ghosts > 0}>
          <div class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />
          <ToolbarButton
            title="Clear all removed device history"
            onClick={clearAllGhosts}
            icon={
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            }
          />
        </Show>
      </div>

      {/* Ghost timeout selector — pinned to the right edge. */}
      <div class="ml-auto flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        {/* Clock icon — click to clear all ghost devices */}
        <button
          class="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-colors cursor-pointer"
          title="Clear all removed devices"
          onClick={clearAllGhosts}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </button>
        <label
          title={
            ghostTimeoutMs() === GHOST_TIMEOUT_INDEFINITE
              ? 'Removed devices are kept indefinitely'
              : `Removed devices disappear after ${formatTimeout(ghostTimeoutMs())}`
          }
        >
          <select
            value={ghostTimeoutMs()}
            onChange={e => setGhostTimeoutMs(Number(e.currentTarget.value))}
            class="text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors cursor-pointer tabular-nums"
          >
            {/* If the persisted value isn't a preset, include it as an extra option so the select shows it. */}
            <Show when={!GHOST_TIMEOUT_PRESETS.some(p => p.ms === ghostTimeoutMs())}>
              <option value={ghostTimeoutMs()}>{formatTimeout(ghostTimeoutMs())}</option>
            </Show>
            {GHOST_TIMEOUT_PRESETS.map(p => (
              <option value={p.ms}>{p.label}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
};

/** Format a timeout in ms as a short human string (e.g. "30s", "5m", "1h"). */
function formatTimeout(ms: number): string {
  if (ms === GHOST_TIMEOUT_INDEFINITE) return 'never';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / (60 * 60_000))}h`;
}

/**
 * Three horizontal lines whose spacing shrinks with the density level —
 * a visual cue for the current setting that updates the moment you click.
 */
const DensityIcon: Component<{ level: DensityLevel }> = props => {
  // Lines are centered around y=12 in a 24-unit viewBox. Tighter levels pull
  // the outer lines toward the middle.
  const offsets: Record<DensityLevel, number> = {
    normal: 7,
    compact: 4,
    dense: 2,
  };
  const offset = () => offsets[props.level];
  return (
    <svg
      class="w-4 h-4 transition-[stroke-width] duration-150"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    >
      <line x1="4" x2="20" y1={12 - offset()} y2={12 - offset()} />
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1={12 + offset()} y2={12 + offset()} />
    </svg>
  );
};

/** A small toolbar icon button. Pass `loading` to spin the icon and disable the button. */
const ToolbarButton: Component<{
  title: string;
  onClick: () => void;
  icon: any;
  loading?: boolean;
}> = props => (
  <button
    class="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    title={props.title}
    onClick={props.onClick}
    disabled={props.loading}
  >
    <div classList={{ 'animate-spin': !!props.loading }}>{props.icon}</div>
  </button>
);

export default Toolbar;
