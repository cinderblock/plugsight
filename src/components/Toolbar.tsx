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
  groupIdentical,
  toggleGroupIdentical,
  viewMode,
  toggleViewMode,
  linkMode,
  cycleLinkMode,
  type LinkMode,
  notifyMode,
} from '~/lib/device-store';
import type { NotifyMode } from '~/lib/notifications';
import { scanForHardwareChanges } from '~/lib/tauri';
import Tooltip from './Tooltip';
import NotificationSettings from './NotificationSettings';

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

/** Human-readable labels for each relation-arrow mode. */
const LINK_MODE_LABELS: Record<LinkMode, string> = {
  all: 'shown for selected and hovered devices',
  selected: 'shown for the selected device only',
  none: 'hidden',
};

/** Tooltip description for each notification mode. */
const NOTIFY_MODE_LABELS: Record<NotifyMode, string> = {
  off: 'off',
  com: 'COM/serial ports only',
  all: 'all device changes',
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
  const [notifOpen, setNotifOpen] = createSignal(false);

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
    <>
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
          label="Expand all"
          onClick={expandAllCategories}
          icon={
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          }
        />
        <ToolbarButton
          label="Collapse all"
          onClick={collapseAllCategories}
          icon={
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          }
        />

        <ToolbarButton
          label={`Row density: ${DENSITY_LABELS[density()]} — click for ${DENSITY_NEXT_LABEL[density()]}`}
          onClick={cycleDensity}
          icon={<DensityIcon level={density()} />}
        />

        <ToolbarButton
          label={`Group identical devices: ${groupIdentical() ? 'on' : 'off'}`}
          active={groupIdentical()}
          onClick={toggleGroupIdentical}
          icon={
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="13" height="13" rx="1.5" />
              <path d="M21 8v11a2 2 0 01-2 2H8" />
            </svg>
          }
        />

        <ToolbarButton
          label={
            viewMode() === 'connections'
              ? 'View: Connections (USB/PCI tree) — click for Categories'
              : 'View: Categories — click for Connections (USB/PCI tree)'
          }
          active={viewMode() === 'connections'}
          onClick={toggleViewMode}
          icon={
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="2" width="6" height="5" rx="1" />
              <rect x="2" y="17" width="6" height="5" rx="1" />
              <rect x="16" y="17" width="6" height="5" rx="1" />
              <path d="M12 7v3M5 17v-2a2 2 0 012-2h10a2 2 0 012 2v2" />
            </svg>
          }
        />

        <ToolbarButton
          label={`Parent/child link arrows: ${LINK_MODE_LABELS[linkMode()]}`}
          onClick={cycleLinkMode}
          icon={<LinkModeIcon mode={linkMode()} />}
        />

        <ToolbarButton
          label={`Notification settings (currently: ${NOTIFY_MODE_LABELS[notifyMode()]})`}
          active={notifyMode() !== 'off'}
          onClick={() => setNotifOpen(true)}
          icon={<NotifyIcon mode={notifyMode()} />}
        />

        <div class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />

        <ToolbarButton
          label={isScanning() ? 'Scanning…' : 'Scan for hardware changes'}
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
          <Tooltip text="Clear all filters (search, hidden items, problems only)">
            <button
              class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/50 transition-colors cursor-pointer"
              aria-label="Clear all filters (search, hidden items, problems only)"
              onClick={clearAllFilters}
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Clear filters
            </button>
          </Tooltip>
        </Show>

        <Show when={counts().ghosts > 0}>
          <div class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />
          <ToolbarButton
            label="Clear all removed device history"
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
        <Tooltip text="Clear all removed devices" align="right">
          <button
            class="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-colors cursor-pointer"
            aria-label="Clear all removed devices"
            onClick={clearAllGhosts}
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
        </Tooltip>
        <label>
          <select
            value={ghostTimeoutMs()}
            aria-label="How long removed devices stay visible"
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
    <NotificationSettings open={notifOpen()} onClose={() => setNotifOpen(false)} />
    </>
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

/**
 * Miniature of the relation-arrow overlay: three device rows with elbow
 * connectors through the side gutters (parent up the left, child down the
 * right). `selected` fills the middle row — links only for the selected
 * device; `none` drops the connectors and strikes the icon through.
 */
const LinkModeIcon: Component<{ mode: LinkMode }> = props => (
  <svg
    class="w-4 h-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <line x1="9" x2="15" y1="5" y2="5" />
    <Show when={props.mode === 'selected'} fallback={<line x1="9" x2="15" y1="12" y2="12" />}>
      <rect x="8" y="9.5" width="8" height="5" rx="1.5" fill="currentColor" stroke="none" />
    </Show>
    <line x1="9" x2="15" y1="19" y2="19" />
    <Show when={props.mode !== 'none'}>
      <path d="M9 12 H5 V5 H9" />
      <path d="M15 12 h4 v7 h-4" />
    </Show>
    <Show when={props.mode === 'none'}>
      <line x1="4" y1="4" x2="20" y2="20" />
    </Show>
  </svg>
);

/**
 * A bell whose state reflects the notification mode: struck-through when off, a
 * plain bell for COM-only, and a bell with a filled "all" dot for every device.
 */
const NotifyIcon: Component<{ mode: NotifyMode }> = props => (
  <svg
    class="w-4 h-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 01-3.46 0" />
    <Show when={props.mode === 'all'}>
      <circle cx="18" cy="5" r="3" fill="currentColor" stroke="none" />
    </Show>
    <Show when={props.mode === 'off'}>
      <line x1="3" y1="3" x2="21" y2="21" />
    </Show>
  </svg>
);

/** A small toolbar icon button. Pass `loading` to spin the icon and disable the button. */
const ToolbarButton: Component<{
  /** Doubles as the button's `aria-label` and its hover/focus tooltip text. */
  label: string;
  onClick: () => void;
  icon: any;
  loading?: boolean;
  /** Render in an "active/on" highlighted state (for toggle buttons). */
  active?: boolean;
  /** Tooltip alignment; use 'right' near the right edge to avoid clipping. */
  align?: 'center' | 'right';
}> = props => (
  <Tooltip text={props.label} align={props.align}>
    <button
      class="p-1.5 rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      classList={{
        'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/50':
          props.active,
        'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200':
          !props.active,
      }}
      aria-label={props.label}
      onClick={props.onClick}
      disabled={props.loading}
    >
      <div classList={{ 'animate-spin': !!props.loading }}>{props.icon}</div>
    </button>
  </Tooltip>
);

export default Toolbar;
