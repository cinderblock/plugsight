/**
 * StatusBadge — large, clear device status indicators.
 *
 * This directly addresses the #1 complaint about the official Windows Device Manager:
 * the tiny 8x8 overlay icons are nearly invisible. Our badges are 28x28 with
 * bold colors, distinct shapes, and accompanying text.
 */

import type { Component } from 'solid-js';
import { Show, Switch, Match } from 'solid-js';
import type { DeviceStatus } from '~/lib/types';

interface StatusBadgeProps {
  status: DeviceStatus;
  /** Show as a compact inline badge (true) or full-width banner (false). */
  compact?: boolean;
}

const StatusBadge: Component<StatusBadgeProps> = props => {
  return (
    <Switch>
      <Match when={props.status.kind === 'ok'}>
        {/* No badge for healthy devices — clean UI. */}
      </Match>

      <Match when={props.status.kind === 'error'}>
        <div
          class={`inline-flex items-center gap-1.5 rounded-md font-medium ${
            props.compact
              ? 'px-1.5 py-0.5 text-xs'
              : 'px-2 py-1 text-sm'
          } bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300`}
          title={(props.status as { message: string }).message}
        >
          <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <Show when={!props.compact}>
            <span class="truncate">Error</span>
          </Show>
        </div>
      </Match>

      <Match when={props.status.kind === 'warning'}>
        <div
          class={`inline-flex items-center gap-1.5 rounded-md font-medium ${
            props.compact
              ? 'px-1.5 py-0.5 text-xs'
              : 'px-2 py-1 text-sm'
          } bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`}
          title={(props.status as { message: string }).message}
        >
          <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <Show when={!props.compact}>
            <span class="truncate">Warning</span>
          </Show>
        </div>
      </Match>

      <Match when={props.status.kind === 'disabled'}>
        <div
          class={`inline-flex items-center gap-1.5 rounded-md font-medium ${
            props.compact
              ? 'px-1.5 py-0.5 text-xs'
              : 'px-2 py-1 text-sm'
          } bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400`}
          title="This device is disabled"
        >
          <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          <Show when={!props.compact}>
            <span>Disabled</span>
          </Show>
        </div>
      </Match>

      <Match when={props.status.kind === 'driverNotInstalled'}>
        <div
          class={`inline-flex items-center gap-1.5 rounded-md font-medium ${
            props.compact
              ? 'px-1.5 py-0.5 text-xs'
              : 'px-2 py-1 text-sm'
          } bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300`}
          title="No driver installed for this device"
        >
          <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <Show when={!props.compact}>
            <span class="truncate">No driver</span>
          </Show>
        </div>
      </Match>
    </Switch>
  );
};

export default StatusBadge;
