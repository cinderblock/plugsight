/**
 * DeviceEntry — the core visual element for a single device in the tree.
 *
 * Renders differently based on state:
 * - **Live (ok)**: Full opacity, clean design
 * - **Live (problem)**: Prominent status badge + colored left border
 * - **Ghost**: Reduced opacity, dashed border, "(Removed)" label, dismiss button
 *
 * The component uses CSS classes for animated transitions managed by the parent TransitionGroup.
 */

import type { Component } from 'solid-js';
import { Show, createMemo } from 'solid-js';
import type { DisplayDevice } from '~/lib/types';
import { hasDeviceProblem, statusLabel } from '~/lib/types';
import { selectedId, setSelectedId, recentChanges, dismissGhost, hideDevice } from '~/lib/device-store';
import StatusBadge from './StatusBadge';
import DeviceIcon from './DeviceIcon';
import { CLASS_ICON_MAP } from '~/lib/icons';

interface DeviceEntryProps {
  displayDevice: DisplayDevice;
}

const DeviceEntry: Component<DeviceEntryProps> = props => {
  const device = () => props.displayDevice.device;
  const isGhost = () => props.displayDevice.isGhost;
  const isVisible = () => props.displayDevice.visible;
  const isSelected = () => selectedId() === device().instanceId;
  const isRecentChange = () => recentChanges().has(device().instanceId);
  const hasProblem = () => hasDeviceProblem(device().status);
  const iconId = () => CLASS_ICON_MAP[device().classGuid.toLowerCase()] ?? 'other';

  const ghostTimeAgo = createMemo(() => {
    if (!props.displayDevice.ghostRemovedAt) return '';
    const seconds = Math.floor((Date.now() - props.displayDevice.ghostRemovedAt) / 1000);
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  });

  /** Colored left border based on status. */
  const borderClass = () => {
    if (isGhost()) return 'border-l-4 border-l-gray-400 dark:border-l-gray-600';
    switch (device().status.kind) {
      case 'error':
        return 'border-l-4 border-l-red-500';
      case 'warning':
        return 'border-l-4 border-l-amber-500';
      case 'disabled':
        return 'border-l-4 border-l-gray-400';
      case 'driverNotInstalled':
        return 'border-l-4 border-l-yellow-500';
      default:
        return 'border-l-4 border-l-transparent';
    }
  };

  return (
    <div
      class="grid transition-[grid-template-rows] duration-300 ease-out"
      style={{ "grid-template-rows": isVisible() ? "1fr" : "0fr" }}
    >
    <div class="overflow-hidden">
    <button
      class={`device-entry group w-full text-left flex items-center gap-3 px-3 py-1 rounded-r-lg transition-all duration-200
        ${borderClass()}
        ${isGhost() ? 'opacity-45 bg-gray-50 dark:bg-gray-800/30' : ''}
        ${isSelected() ? 'bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-300 dark:ring-blue-700' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}
        ${isRecentChange() ? 'device-entry--highlight' : ''}
      `}
      onClick={() => setSelectedId(device().instanceId)}
    >
      {/* Device icon */}
      <div class={`shrink-0 ${isGhost() ? 'text-gray-400 dark:text-gray-600' : hasProblem() ? 'text-red-500 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
        <DeviceIcon iconId={iconId()} classGuid={device().classGuid} class="w-6 h-6" />
      </div>

      {/* Device name and metadata */}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span
            class={`text-sm font-medium truncate ${
              isGhost()
                ? 'text-gray-400 dark:text-gray-500 line-through decoration-gray-300 dark:decoration-gray-600'
                : 'text-gray-900 dark:text-gray-100'
            }`}
          >
            {device().name}
          </span>

          {/* Status badge (inline, next to name — NOT overlaid on icon!) */}
          <StatusBadge status={device().status} compact />
        </div>

        {/* Secondary info line */}
        <div class="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
          <Show when={isGhost()}>
            <span class="text-gray-400 dark:text-gray-500 italic">
              Removed {ghostTimeAgo()}
            </span>
          </Show>
          <Show when={!isGhost() && hasProblem()}>
            <span class={
              device().status.kind === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-amber-600 dark:text-amber-400'
            }>
              {statusLabel(device().status)}
            </span>
          </Show>
          <Show when={!isGhost() && !hasProblem()}>
            {device().manufacturer}
          </Show>
        </div>
      </div>

      {/* Action buttons (visible on hover) — use div, not button, to avoid nesting inside parent <button> */}
      <div class="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Hide button */}
        <div
          role="button"
          class="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer"
          title="Hide this device"
          onClick={e => {
            e.stopPropagation();
            hideDevice(device().instanceId);
          }}
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </div>

        {/* Ghost dismiss button */}
        <Show when={isGhost()}>
          <div
            role="button"
            class="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer"
            title="Dismiss"
            onClick={e => {
              e.stopPropagation();
              dismissGhost(device().instanceId);
            }}
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
        </Show>
      </div>
    </button>
    </div>
    </div>
  );
};

export default DeviceEntry;
