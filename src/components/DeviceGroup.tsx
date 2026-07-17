/**
 * DeviceGroup — a collapsed summary row standing in for a run of
 * identically-named devices within a category.
 *
 * Collapsed, it shows the shared name with a "×N" count (N = currently visible
 * members) and a problem badge if any member needs attention. Expanded, it
 * reveals each individual device with its instance ID as the distinguishing
 * detail. The group is forced open while a search or problems-filter is active,
 * or while any member has a problem, so filtering/diagnostics never hide a
 * device behind a collapsed group.
 */

import type { Component } from 'solid-js';
import { Index, Show, createMemo } from 'solid-js';
import type { DisplayDevice } from '~/lib/types';
import { hasDeviceProblem } from '~/lib/types';
import { searchQuery, showProblemsOnly, isGroupExpanded, toggleGroup } from '~/lib/device-store';
import DeviceIcon from './DeviceIcon';
import DeviceEntry from './DeviceEntry';

interface DeviceGroupProps {
  groupKey: string;
  name: string;
  isGhost: boolean;
  /** All members of the run, including any currently filtered out (visible === false). */
  devices: DisplayDevice[];
}

const DeviceGroup: Component<DeviceGroupProps> = props => {
  const visibleDevices = createMemo(() => props.devices.filter(d => d.visible));
  const visibleCount = () => visibleDevices().length;
  const problemCount = () => visibleDevices().filter(d => hasDeviceProblem(d.device.status)).length;
  const hasProblem = () => problemCount() > 0;
  // A representative member for the icon (all members share a class anyway).
  const rep = () => props.devices[0].device;

  // Force open during search/problem filtering or when a member has a problem,
  // so a collapsed group never hides something the user is looking for.
  const forceOpen = () => searchQuery() !== '' || showProblemsOnly() || hasProblem();
  const isExpanded = () => forceOpen() || isGroupExpanded(props.groupKey);

  return (
    <div
      class="grid transition-[grid-template-rows] duration-300 ease-out"
      style={{ 'grid-template-rows': visibleCount() > 0 ? '1fr' : '0fr' }}
    >
      <div class="overflow-hidden">
        {/* Group summary header */}
        <button
          class={`group/grp w-full text-left flex items-center gap-3 px-3 py-1 rounded-r-lg border-l-4 border-l-transparent transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
            props.isGhost ? 'opacity-60' : ''
          }`}
          data-arrow-row
          onClick={() => toggleGroup(props.groupKey)}
        >
          {/* Expand/collapse chevron */}
          <svg
            class={`w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
              isExpanded() ? 'rotate-90' : ''
            }`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>

          {/* Device icon */}
          <div
            class={`shrink-0 ${
              props.isGhost
                ? 'text-gray-400 dark:text-gray-600'
                : hasProblem()
                  ? 'text-red-500 dark:text-red-400'
                  : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            <DeviceIcon iconId={rep().iconId || 'other'} classGuid={rep().classGuid} class="w-6 h-6" />
          </div>

          {/* Name, count, and secondary line */}
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span
                class={`text-sm font-medium truncate ${
                  props.isGhost
                    ? 'text-gray-400 dark:text-gray-500 line-through decoration-gray-300 dark:decoration-gray-600'
                    : 'text-gray-900 dark:text-gray-100'
                }`}
              >
                {props.name}
              </span>

              {/* ×N count of visible members */}
              <span class="shrink-0 inline-flex items-center h-5 px-1.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 tabular-nums">
                ×{visibleCount()}
              </span>

              {/* Problem count badge */}
              <Show when={hasProblem()}>
                <span class="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
                  {problemCount()}
                </span>
              </Show>

              {/* Zero-width marker at the end of the name-line content, for relation connectors. */}
              <span data-role="label-end" aria-hidden="true" />
            </div>

            <div class="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
              <span data-arrow-extent>
                <Show when={isExpanded()} fallback={`${visibleCount()} identical — click to expand`}>
                  Showing individual devices
                </Show>
              </span>
            </div>
          </div>
        </button>

        {/* Children drawer — same grid-rows animation as a category body */}
        <div
          class="ml-4 pl-2 border-l border-gray-200 dark:border-gray-700/50 grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ 'grid-template-rows': isExpanded() ? '1fr' : '0fr' }}
        >
          <div class="overflow-hidden">
            <Index each={props.devices}>
              {d => <DeviceEntry displayDevice={d()} detail={d().device.instanceId} />}
            </Index>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeviceGroup;
