/**
 * DeviceDetail — the right-hand detail panel showing properties of the selected device.
 *
 * Shows comprehensive device information including status, driver info, hardware IDs,
 * and instance ID. Adapts its appearance for ghost (removed) devices.
 */

import type { Component } from 'solid-js';
import { Show, For } from 'solid-js';
import { selectedDevice, setSelectedId } from '~/lib/device-store';
import { statusLabel, hasDeviceProblem } from '~/lib/types';
import StatusBadge from './StatusBadge';
import DeviceIcon from './DeviceIcon';
import { CLASS_ICON_MAP } from '~/lib/icons';

const DeviceDetail: Component = () => {
  const sel = selectedDevice;

  return (
    <Show
      when={sel()}
      fallback={
        <div class="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 p-6">
          <svg class="w-16 h-16 mb-4 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span class="text-sm">Select a device to view details</span>
        </div>
      }
    >
      {sel => {
        const device = () => sel().device;
        const isGhost = () => sel().isGhost;
        const iconId = () => CLASS_ICON_MAP[device().classGuid.toLowerCase()] ?? 'other';

        return (
          <div class={`h-full overflow-y-auto p-4 ${isGhost() ? 'opacity-60' : ''}`}>
            {/* Close button */}
            <div class="flex justify-end mb-2">
              <button
                class="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                onClick={() => setSelectedId(null)}
                title="Close"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Device header */}
            <div class="flex items-start gap-3 mb-4">
              <div class={`shrink-0 p-2 rounded-lg ${
                hasDeviceProblem(device().status)
                  ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
              }`}>
                <DeviceIcon iconId={iconId()} class="w-8 h-8" />
              </div>
              <div class="min-w-0">
                <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug">
                  {device().name}
                </h2>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {device().className}
                </p>
              </div>
            </div>

            {/* Ghost banner */}
            <Show when={isGhost()}>
              <div class="mb-4 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-600">
                <p class="text-sm text-gray-500 dark:text-gray-400 italic">
                  This device has been removed from the system.
                  <br />
                  Showing last known properties.
                </p>
              </div>
            </Show>

            {/* Status section */}
            <div class="mb-4">
              <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                Status
              </h3>
              <div class="flex items-center gap-2">
                <StatusBadge status={device().status} />
                <Show when={device().status.kind === 'ok'}>
                  <span class="text-sm text-green-600 dark:text-green-400 font-medium">
                    Working properly
                  </span>
                </Show>
              </div>
              <Show when={hasDeviceProblem(device().status)}>
                <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  {statusLabel(device().status)}
                </p>
              </Show>
            </div>

            {/* Properties grid */}
            <div class="space-y-3">
              <DetailRow label="Description" value={device().description} />
              <DetailRow label="Manufacturer" value={device().manufacturer} />
              <Show when={device().driverVersion}>
                <DetailRow label="Driver version" value={device().driverVersion} />
              </Show>
              <DetailRow label="Class" value={`${device().className} (${device().classGuid})`} />
              <Show when={device().parentId}>
                <DetailRow label="Parent" value={device().parentId} mono />
              </Show>
              <DetailRow label="Instance ID" value={device().instanceId} mono />

              {/* Hardware IDs */}
              <Show when={device().hardwareIds.length > 0}>
                <div>
                  <span class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Hardware IDs
                  </span>
                  <div class="mt-1 space-y-0.5">
                    <For each={device().hardwareIds}>
                      {id => (
                        <p class="text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 px-2 py-1 rounded break-all">
                          {id}
                        </p>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        );
      }}
    </Show>
  );
};

/** A single label-value row in the detail panel. */
const DetailRow: Component<{ label: string; value: string; mono?: boolean }> = props => (
  <div>
    <span class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
      {props.label}
    </span>
    <p
      class={`text-sm mt-0.5 break-words ${
        props.mono
          ? 'font-mono text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 px-2 py-1 rounded'
          : 'text-gray-800 dark:text-gray-200'
      }`}
    >
      {props.value || '\u2014'}
    </p>
  </div>
);

export default DeviceDetail;
