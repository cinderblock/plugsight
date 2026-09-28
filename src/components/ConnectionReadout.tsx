/**
 * ConnectionReadout — the right-hand end of a device row: how long it has been
 * connected ("20s", "50m", "2d", "boot"), and, for a device that has dropped
 * out and come back, a reconnect count.
 *
 * The age is quiet text in a fixed-width column; "boot" is quieter still, since
 * it's what most rows say. Hover gives the exact time. The reconnect chip only
 * appears once a device has dropped at least once, amber if the latest drop
 * was within a day; hover shows a sparkline of when. Both hovers are also in
 * the detail pane, spelled out.
 */

import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { DeviceInfo } from '~/lib/types';
import { bootTime } from '~/lib/device-store';
import { useNow } from '~/lib/clock';
import {
  BOOT_WINDOW_MS,
  connectedReadout,
  dropsOf,
  droppedRecently,
  formatMoment,
  longDuration,
  shortAge,
} from '~/lib/connection-time';
import HoverCard from './HoverCard';
import ReconnectSparkline from './ReconnectSparkline';

/** Circular-arrows icon for "reconnected". */
export const ReconnectIcon: Component<{ class?: string }> = props => (
  <svg class={props.class ?? 'w-3 h-3'} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <path d="M21 12a9 9 0 01-15.3 6.4L3 16" />
    <path d="M3 12a9 9 0 0115.3-6.4L21 8" />
    <polyline points="21 3 21 8 16 8" />
    <polyline points="3 21 3 16 8 16" />
  </svg>
);

const ConnectionReadout: Component<{ device: DeviceInfo; showAge: boolean }> = props => {
  const now = useNow();

  // Only the short text is recomputed every tick; the long text is built when
  // a card opens.
  const sinceBoot = () => {
    const arrived = props.device.arrivedAt;
    const boot = bootTime();
    return arrived !== null && boot !== null && arrived <= boot + BOOT_WINDOW_MS;
  };
  const short = () => {
    const arrived = props.device.arrivedAt;
    if (arrived === null) return null;
    return sinceBoot() ? 'boot' : shortAge(now() - arrived);
  };
  const recent = () => droppedRecently(props.device.connectionEvents, now());

  const reconnectCard = () => {
    const drops = dropsOf(props.device.connectionEvents);
    const last = drops[drops.length - 1];
    const n = props.device.reconnects;
    return (
      <div class="flex flex-col gap-1.5">
        <div>
          {n} reconnect{n === 1 ? '' : 's'}
          <Show when={last}>
            {l => (
              <span class="font-normal text-gray-300">
                {' '}
                · last dropped {longDuration(now() - l().lostAt)} ago
                {l().backAt !== null ? `, away ${longDuration(l().backAt! - l().lostAt)}` : ', still away'}
              </span>
            )}
          </Show>
        </div>
        <ReconnectSparkline events={props.device.connectionEvents} now={now()} width={200} onDark />
        <Show when={last}>{l => <div class="font-normal text-gray-300">{formatMoment(l().lostAt)}</div>}</Show>
      </div>
    );
  };

  return (
    <span class="shrink-0 flex items-center gap-1.5 pl-2">
      <Show when={props.device.reconnects > 0}>
        <HoverCard content={reconnectCard}>
          <span
            class={`inline-flex items-center gap-0.5 h-5 px-1.5 rounded-full text-xs font-semibold tabular-nums ${
              recent()
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
            }`}
            aria-label={`Reconnected ${props.device.reconnects} times`}
          >
            <ReconnectIcon />
            {props.device.reconnects}
          </span>
        </HoverCard>
      </Show>
      <Show when={props.showAge && short()}>
        {text => (
          <HoverCard
            content={() => connectedReadout(props.device.arrivedAt, bootTime(), now())?.long ?? ''}
            class="justify-end"
          >
            <span
              class={`min-w-[2.25rem] text-right text-xs tabular-nums ${
                sinceBoot() ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'
              }`}
            >
              {text()}
            </span>
          </HoverCard>
        )}
      </Show>
    </span>
  );
};

export default ConnectionReadout;
