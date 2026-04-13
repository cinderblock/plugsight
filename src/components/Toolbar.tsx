/**
 * Toolbar — top bar with search and actions.
 *
 * Device counts and version info are shown in the StatusBar (footer) instead.
 */

import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import {
  searchQuery,
  setSearchQuery,
  counts,
  expandAllCategories,
  collapseAllCategories,
  clearAllGhosts,
} from '~/lib/device-store';
import { scanForHardwareChanges } from '~/lib/tauri';

const Toolbar: Component = () => {
  const handleScan = async () => {
    try {
      await scanForHardwareChanges();
    } catch (e) {
      console.error('Hardware scan failed:', e);
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

        <div class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />

        <ToolbarButton
          title="Scan for hardware changes"
          onClick={handleScan}
          icon={
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
          }
        />

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
    </div>
  );
};

/** A small toolbar icon button. */
const ToolbarButton: Component<{ title: string; onClick: () => void; icon: any }> = props => (
  <button
    class="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
    title={props.title}
    onClick={props.onClick}
  >
    {props.icon}
  </button>
);

export default Toolbar;
