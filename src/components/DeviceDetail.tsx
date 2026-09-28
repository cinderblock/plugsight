/**
 * DeviceDetail — the right-hand detail panel showing properties of the selected device.
 *
 * Shows comprehensive device information including status, driver info, hardware IDs,
 * and instance ID. Adapts its appearance for ghost (removed) devices.
 */

import type { Component } from 'solid-js';
import { Show, For } from 'solid-js';
import { selectedDevice, setSelectedId, usbHubHalves, bootTime } from '~/lib/device-store';
import { openDeviceProperties } from '~/lib/tauri';
import { statusLabel, hasDeviceProblem, type DeviceInfo } from '~/lib/types';
import { describeLink } from '~/lib/link-speed';
import { connectedReadout, dropsOf, formatMoment, longDuration } from '~/lib/connection-time';
import { useNow } from '~/lib/clock';
import ReconnectSparkline from './ReconnectSparkline';
import { ReconnectIcon } from './ConnectionReadout';
import StatusBadge from './StatusBadge';
import DeviceIcon from './DeviceIcon';
import Tooltip from './Tooltip';

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
        const iconId = () => device().iconId || 'other';

        return (
          <div class={`h-full overflow-y-auto p-4 ${isGhost() ? 'opacity-60' : ''}`}>
            {/* Action buttons */}
            <div class="flex justify-end gap-1 mb-2">
              <Tooltip text="Open Windows properties" align="right">
                <button
                  class="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label="Open Windows properties"
                  onClick={() => openDeviceProperties(device().instanceId)}
                >
                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip text="Close" align="right">
                <button
                  class="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label="Close"
                  onClick={() => setSelectedId(null)}
                >
                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </Tooltip>
            </div>

            {/* Device header */}
            <div class="flex items-start gap-3 mb-4">
              <div
                class={`shrink-0 p-2 rounded-lg ${
                  hasDeviceProblem(device().status)
                    ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                <DeviceIcon iconId={iconId()} classGuid={device().classGuid} class="w-8 h-8" />
              </div>
              <div class="min-w-0">
                <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug">{device().name}</h2>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{device().className}</p>
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
                  <span class="text-sm text-green-600 dark:text-green-400 font-medium">Working properly</span>
                </Show>
              </div>
              <Show when={hasDeviceProblem(device().status)}>
                <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">{statusLabel(device().status)}</p>
              </Show>
            </div>

            <ConnectionSection device={device()} isGhost={isGhost()} />

            {/* Links: the numbers the row chips abbreviate, spelled out, one
                section per link (a USB or PCIe network adapter has two). */}
            <For each={device().links}>
              {info => {
                const link = () => describeLink(info);
                return (
                  <div class="mb-6">
                    <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                      {link().title}
                    </h3>
                    <div class="space-y-3">
                      <DetailRow label="Running at" value={link().speedDetail} />
                      <Show when={link().showCapable}>
                        <DetailRow label="Capable of" value={link().capableDetail} />
                      </Show>
                      <Show when={link().note}>
                        <p
                          class={`text-sm ${
                            link().degraded ? 'text-amber-700 dark:text-amber-400' : 'text-gray-600 dark:text-gray-300'
                          }`}
                        >
                          {link().note}
                        </p>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>

            {/* The other half of a USB 3 hub. Windows lists the hub twice, once
                per USB generation; the Connections tree folds the pair into one
                row, so say which half this is and name the other. */}
            <Show when={usbHubHalves().get(device().instanceId)}>
              {half => {
                const otherLink = () => half().other.links.find(l => l.bus === 'usb');
                return (
                  <div class="mb-6">
                    <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                      {half().otherIs === 'usb2' ? 'USB 2 side of this hub' : 'USB 3 side of this hub'}
                    </h3>
                    <p class="text-sm text-gray-600 dark:text-gray-300 mb-3">
                      Windows lists a USB 3 hub twice, once per USB generation. The Connections tree shows both as one
                      row.
                    </p>
                    <div class="space-y-3">
                      <DetailRow label="Listed as" value={half().other.name} />
                      <Show when={otherLink()}>
                        {link => <DetailRow label="Running at" value={describeLink(link()).speedDetail} />}
                      </Show>
                      <DetailRow label="Instance ID" value={half().other.instanceId} mono />
                    </div>
                  </div>
                );
              }}
            </Show>

            {/* Properties grid */}
            <div class="space-y-3">
              <Show when={device().portName}>
                <DetailRow label="Port" value={device().portName!} />
              </Show>
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

/** The most recent drops listed in the detail pane. */
const LISTED_DROPS = 20;

/**
 * When the device arrived and every time it dropped out: the row readouts,
 * spelled out. The list is the sparkline's table view.
 */
const ConnectionSection: Component<{ device: DeviceInfo; isGhost: boolean }> = props => {
  const now = useNow();
  const readout = () => connectedReadout(props.device.arrivedAt, bootTime(), now());
  const drops = () => dropsOf(props.device.connectionEvents).reverse();

  return (
    <Show when={readout() || props.device.reconnects > 0}>
      <div class="mb-6">
        <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Connection</h3>
        <div class="space-y-3">
          <Show when={!props.isGhost && props.device.arrivedAt !== null && readout()}>
            {r => (
              <DetailRow
                label={r().sinceBoot ? 'Present since boot' : 'Connected'}
                value={`${formatMoment(props.device.arrivedAt!)} (${longDuration(now() - props.device.arrivedAt!)} ago)`}
              />
            )}
          </Show>

          <div>
            <span class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Reconnects
            </span>
            <p class="text-sm mt-0.5 text-gray-800 dark:text-gray-200 flex items-center gap-1">
              <Show when={props.device.reconnects > 0} fallback="None recorded">
                <ReconnectIcon class="w-3.5 h-3.5 text-amber-500" />
                {props.device.reconnects}
              </Show>
            </p>
          </div>

          <Show when={drops().length > 0}>
            <ReconnectSparkline events={props.device.connectionEvents} now={now()} height={24} interactive />
            <ul class="space-y-0.5">
              <For each={drops().slice(0, LISTED_DROPS)}>
                {d => (
                  <li class="text-xs text-gray-700 dark:text-gray-300 tabular-nums">
                    {formatMoment(d.lostAt)}
                    <span class="text-gray-400 dark:text-gray-500">
                      {' '}
                      · {d.backAt === null ? 'still away' : `away ${longDuration(d.backAt - d.lostAt)}`}
                    </span>
                  </li>
                )}
              </For>
            </ul>
            <Show when={drops().length > LISTED_DROPS}>
              <p class="text-xs text-gray-400 dark:text-gray-500">and {drops().length - LISTED_DROPS} earlier</p>
            </Show>
          </Show>

          <p class="text-xs text-gray-400 dark:text-gray-500">
            Counted from Windows' device notifications while PlugSight runs, plus the latest drop Windows remembers from
            while it wasn't. Kept 90 days.
          </p>
        </div>
      </div>
    </Show>
  );
};

/** A single label-value row in the detail panel. */
const DetailRow: Component<{ label: string; value: string; mono?: boolean }> = props => (
  <div>
    <span class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{props.label}</span>
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
