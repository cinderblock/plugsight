/**
 * LinkBadge — a device's upstream link speed as an inline chip.
 *
 * Healthy links are a quiet neutral pill ("5 Gbps", "Gen3 ×4") so the tree
 * reads as a speed map without shouting. A degraded link — the device runs
 * below what it advertises — turns amber and shows both numbers inline
 * ("480 Mbps of 5 Gbps"), so the reason is on the row itself rather than
 * behind a hover. The detail pane spells out the rest.
 */

import type { Component } from 'solid-js';
import { Show, createMemo } from 'solid-js';
import type { LinkInfo } from '~/lib/types';
import { describeLink } from '~/lib/link-speed';

const LinkBadge: Component<{ link: LinkInfo | null }> = props => {
  const summary = createMemo(() => (props.link ? describeLink(props.link) : null));

  return (
    <Show when={summary()}>
      {s => (
        <span
          class={`shrink-0 inline-flex items-center gap-1 h-5 px-1.5 rounded-full text-xs font-semibold tabular-nums whitespace-nowrap ${
            s().degraded
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
          }`}
        >
          {s().speed}
          <Show when={s().degraded}>
            <span class="font-normal opacity-75">of {s().capable}</span>
          </Show>
        </span>
      )}
    </Show>
  );
};

export default LinkBadge;
