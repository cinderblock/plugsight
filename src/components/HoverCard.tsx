/**
 * HoverCard — a floating card on hover or keyboard focus, for content richer
 * than a one-line label (a sparkline, a few lines of detail).
 *
 * Unlike the CSS-only `Tooltip`, the card is portalled to the document body
 * and positioned from the trigger's on-screen rect, so it isn't clipped by the
 * scrolling tree it's opened from, and it opens *above* the trigger when there
 * isn't room below. It's anchored to the trigger's right edge because its
 * triggers sit at the right end of rows. It closes on scroll rather than
 * trying to follow.
 *
 * Not an HTML `title=` (standing rule: invisible on touch, hides text behind a
 * hover). Everything shown in a HoverCard should also be reachable without
 * hovering — here, in the device detail pane.
 */

import type { Component, JSX } from 'solid-js';
import { Show, createSignal, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';

/** Hover delay, matching `Tooltip`, so brushing past a row doesn't flash cards. */
const OPEN_DELAY_MS = 300;
/** Below this much room under the trigger, open above it instead. */
const MIN_ROOM_BELOW = 180;
const GAP = 6;
const EDGE = 8;

interface Placement {
  top?: number;
  bottom?: number;
  right: number;
  maxWidth: number;
}

export const HoverCard: Component<{
  /** Built only while the card is open, so it can be as expensive as it likes. */
  content: () => JSX.Element;
  children: JSX.Element;
  class?: string;
}> = props => {
  let trigger: HTMLSpanElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const [placement, setPlacement] = createSignal<Placement | null>(null);

  const place = () => {
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const roomBelow = window.innerHeight - r.bottom;
    const right = Math.max(EDGE, window.innerWidth - r.right);
    const maxWidth = Math.min(288, window.innerWidth - right - EDGE);
    setPlacement(
      roomBelow >= MIN_ROOM_BELOW || r.top < roomBelow
        ? { top: r.bottom + GAP, right, maxWidth }
        : { bottom: window.innerHeight - r.top + GAP, right, maxWidth },
    );
  };

  const close = () => {
    clearTimeout(timer);
    setPlacement(null);
  };
  const open = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(place, delay);
  };

  // A card positioned for where the trigger *was* is worse than no card.
  const onScroll = () => close();
  window.addEventListener('scroll', onScroll, true);
  onCleanup(() => {
    close();
    window.removeEventListener('scroll', onScroll, true);
  });

  return (
    <span
      ref={trigger}
      class={`inline-flex ${props.class ?? ''}`}
      onMouseEnter={() => open(OPEN_DELAY_MS)}
      onMouseLeave={close}
      onFocusIn={() => open(0)}
      onFocusOut={close}
    >
      {props.children}
      <Show when={placement()}>
        {p => (
          <Portal>
            <div
              aria-hidden="true"
              class="pointer-events-none fixed z-50 w-max rounded-md bg-gray-900/95 px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-lg ring-1 ring-black/5 dark:bg-gray-700/95"
              style={{
                top: p().top === undefined ? undefined : `${p().top}px`,
                bottom: p().bottom === undefined ? undefined : `${p().bottom}px`,
                right: `${p().right}px`,
                'max-width': `${p().maxWidth}px`,
              }}
            >
              {props.content()}
            </div>
          </Portal>
        )}
      </Show>
    </span>
  );
};

export default HoverCard;
