/**
 * DeviceCategory — a collapsible group header with its child device entries.
 *
 * Shows the category icon, name, device count, and problem count badge.
 * Child devices animate in/out via CSS transitions.
 */

import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import { TransitionGroup } from 'solid-transition-group';
import type { DeviceCategory as DeviceCategoryType } from '~/lib/types';
import { toggleCategory, state, showProblemsOnly, hideCategory } from '~/lib/device-store';
import DeviceIcon from './DeviceIcon';
import DeviceEntry from './DeviceEntry';

interface DeviceCategoryProps {
  category: DeviceCategoryType;
}

const DeviceCategory: Component<DeviceCategoryProps> = props => {
  const cat = () => props.category;
  const isExpanded = () => showProblemsOnly() || (state.expandedCategories[cat().classGuid] ?? false);
  const totalCount = () => cat().devices.length;
  const ghostCount = () => cat().devices.filter(d => d.isGhost).length;
  const liveCount = () => totalCount() - ghostCount();

  return (
    <div class="category-group group/cat">
      {/* Category header */}
      <div class="flex items-center">
        <button
          class="flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-colors"
          onClick={() => toggleCategory(cat().classGuid)}
        >
        {/* Expand/collapse chevron */}
        <svg
          class={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 shrink-0 ${
            isExpanded() ? 'rotate-90' : ''
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>

        {/* Category icon */}
        <div class="text-gray-500 dark:text-gray-400 shrink-0">
          <DeviceIcon iconId={cat().iconId} class="w-5 h-5" />
        </div>

        {/* Category name */}
        <span class="text-sm font-semibold text-gray-800 dark:text-gray-200 flex-1 text-left truncate">
          {cat().className}
        </span>

        {/* Counts */}
        <div class="flex items-center gap-2 shrink-0">
          {/* Problem count badge */}
          <Show when={cat().problemCount > 0}>
            <span class="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
              {cat().problemCount}
            </span>
          </Show>

          {/* Ghost count */}
          <Show when={ghostCount() > 0}>
            <span class="text-xs text-gray-400 dark:text-gray-500 italic">
              +{ghostCount()} removed
            </span>
          </Show>

          {/* Device count */}
          <span class="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
            {liveCount()}
          </span>
        </div>
      </button>

        {/* Hide category button (visible on hover) */}
        <button
          class="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 opacity-0 group-hover/cat:opacity-100 transition-all"
          title="Hide this category"
          onClick={() => hideCategory(cat().classGuid)}
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </button>
      </div>

      {/* Device entries — drawer animation via CSS grid, per-device animation via TransitionGroup */}
      <div
        class="ml-4 pl-2 border-l border-gray-200 dark:border-gray-700/50 grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ "grid-template-rows": isExpanded() ? "1fr" : "0fr" }}
      >
        <div class="overflow-hidden">
          <TransitionGroup
            enterClass="device-enter"
            enterActiveClass="device-enter-active"
            exitClass="device-exit"
            exitActiveClass="device-exit-active"
            moveClass="device-move"
          >
            <For each={cat().devices}>
              {displayDevice => <DeviceEntry displayDevice={displayDevice} />}
            </For>
          </TransitionGroup>
        </div>
      </div>
    </div>
  );
};

export default DeviceCategory;
