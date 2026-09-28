/**
 * ReconnectSparkline — when a device dropped out, on a time strip ending now.
 *
 * A single-series event strip: a neutral track across the window, broken where
 * the device was away, with an amber tick at each drop. The window adapts (1h /
 * 24h / 7d / 30d / 90d, the smallest holding the earliest drop) and is labelled
 * at both ends. Colour isn't the only cue: the callers put the count and a
 * reconnect icon beside it, and the detail pane lists every drop as text.
 *
 * `interactive` adds per-drop hover: wide invisible hit targets over the ticks,
 * and a caption line naming the hovered drop's time and how long it was away.
 */

import type { Component } from 'solid-js';
import { For, Show, createMemo, createSignal } from 'solid-js';
import type { ConnEvent } from '~/lib/types';
import { formatMoment, longDuration, sparklineModel } from '~/lib/connection-time';

/** Hit-target width around each tick — well beyond the 2px mark. */
const HIT = 10;

/** A position along the strip, as an SVG length. Percentages let the strip
 *  fill whatever width its container gives it, with no measuring. */
const at = (fraction: number) => `${fraction * 100}%`;

export const ReconnectSparkline: Component<{
  events: readonly ConnEvent[];
  now: number;
  /** Fixed width in px; omitted, the strip fills its container. */
  width?: number;
  height?: number;
  /** Colours for a dark card background (the hover card) instead of the page. */
  onDark?: boolean;
  interactive?: boolean;
}> = props => {
  const height = () => props.height ?? 20;
  const model = createMemo(() => sparklineModel(props.events, props.now));
  const [hovered, setHovered] = createSignal<number | null>(null);

  const mid = () => height() / 2;

  /** The track, as the stretches where the device was connected. */
  const connected = createMemo(() => {
    const segments: [number, number][] = [];
    let from = 0;
    for (const d of model().drops) {
      if (d.from > from) segments.push([from, d.from]);
      from = Math.max(from, d.to);
    }
    if (from < 1) segments.push([from, 1]);
    return segments;
  });

  const trackClass = () => (props.onDark ? 'stroke-gray-500' : 'stroke-gray-300 dark:stroke-gray-600');
  const tickClass = () => (props.onDark ? 'stroke-amber-400' : 'stroke-amber-500 dark:stroke-amber-400');

  const caption = () => {
    const i = hovered();
    if (i === null) return null;
    const { drop } = model().drops[i];
    const away = drop.backAt === null ? 'still away' : `away ${longDuration(drop.backAt - drop.lostAt)}`;
    return `${formatMoment(drop.lostAt)} · ${away}`;
  };

  return (
    <div class="flex w-full flex-col" style={props.width ? { width: `${props.width}px` } : {}}>
      <div class="relative">
        <svg width="100%" height={height()} class="block overflow-visible" aria-hidden="true">
          <For each={connected()}>
            {([a, b]) => (
              <line
                x1={at(a)}
                x2={at(b)}
                y1={mid()}
                y2={mid()}
                stroke-width="2"
                stroke-linecap="round"
                class={trackClass()}
              />
            )}
          </For>
          <For each={model().drops}>
            {(d, i) => (
              <>
                <line
                  x1={at(d.from)}
                  x2={at(d.from)}
                  y1={2}
                  y2={height() - 2}
                  stroke-width={hovered() === i() ? 3 : 2}
                  stroke-linecap="round"
                  class={tickClass()}
                />
              </>
            )}
          </For>
        </svg>
        {/* Hit targets as plain elements over the strip: centred on each tick in
          px while the tick itself is placed in %. (An SVG rect in a nested
          viewport doesn't receive hover outside that viewport's box.) */}
        <Show when={props.interactive}>
          <For each={model().drops}>
            {(d, i) => (
              <div
                class="absolute top-0 h-full cursor-default"
                style={{ left: `calc(${at(d.from)} - ${HIT / 2}px)`, width: `${HIT}px` }}
                onMouseEnter={() => setHovered(i())}
                onMouseLeave={() => setHovered(null)}
              />
            )}
          </For>
        </Show>
      </div>
      <div
        class={`mt-0.5 flex justify-between text-[10px] leading-none tabular-nums ${
          props.onDark ? 'text-gray-300' : 'text-gray-400 dark:text-gray-500'
        }`}
      >
        <span>{model().startLabel}</span>
        <span>now</span>
      </div>
      <Show when={props.interactive}>
        <div class="mt-1 h-4 text-xs text-gray-600 dark:text-gray-300 truncate">
          {caption() ?? 'Hover a tick for when it dropped.'}
        </div>
      </Show>
    </div>
  );
};

export default ReconnectSparkline;
