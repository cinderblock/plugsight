/**
 * DeviceTree — the top-level grouped list of all devices.
 *
 * Renders categories with animated transitions when categories appear/disappear.
 * Shows a loading state during initial enumeration and an empty state if no devices match.
 */

import type { Component } from 'solid-js';
import { Index, Show } from 'solid-js';
import { categories, state } from '~/lib/device-store';
import DeviceCategory from './DeviceCategory';

const DeviceTree: Component = () => {
  return (
    <div class="device-tree flex-1 overflow-y-auto py-2 px-1">
      {/* Loading state */}
      <Show when={!state.enumerationComplete}>
        <div class="flex items-center justify-center py-8 gap-3 text-gray-400 dark:text-gray-500">
          <svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" opacity="0.25" />
            <path d="M12 2a10 10 0 019.75 7.75" opacity="0.75" />
          </svg>
          <span class="text-sm">Discovering devices...</span>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={state.enumerationComplete && categories().length === 0}>
        <div class="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
          <svg class="w-12 h-12 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span class="text-sm">No devices match your search</span>
        </div>
      </Show>

      {/* Device categories */}
      <Index each={categories()}>
        {category => <DeviceCategory category={category()} />}
      </Index>
    </div>
  );
};

export default DeviceTree;
