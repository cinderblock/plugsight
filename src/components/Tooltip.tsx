/**
 * Tooltip — a floating label shown on hover or keyboard focus.
 *
 * A real element, deliberately NOT an HTML `title=` attribute: those are
 * invisible on touch devices and bury the text behind a hover. This one is
 * `aria-hidden` and purely visual — the wrapped trigger keeps its own
 * `aria-label`, so a screen reader isn't told the same thing twice.
 *
 * It appears after a short hover delay (so brushing past a control doesn't
 * flash it) but fades out immediately on leave; focus reveals it with no delay.
 * The label sizes to its content (`w-max`) up to a max width, wrapping longer
 * text. Tune placement so it never opens off-screen:
 *
 * - `placement="top"` for controls near the window's bottom edge (e.g. the
 *   status bar) so the label opens upward.
 * - `align="right"` for controls near the right edge so it grows leftward.
 */

import type { Component, JSX } from 'solid-js';

export const Tooltip: Component<{
  text: string;
  align?: 'center' | 'right';
  placement?: 'top' | 'bottom';
  children: JSX.Element;
}> = props => (
  <span class="group/tt relative inline-flex">
    {props.children}
    <span
      aria-hidden="true"
      class="pointer-events-none absolute z-50 w-max max-w-[15rem] whitespace-normal rounded-md bg-gray-900/95 px-2 py-1 text-center text-xs font-medium leading-snug text-white opacity-0 shadow-lg ring-1 ring-black/5 transition-opacity delay-0 duration-150 group-hover/tt:opacity-100 group-hover/tt:delay-300 group-focus-within/tt:opacity-100 dark:bg-gray-700/95"
      classList={{
        'top-full mt-2': props.placement !== 'top',
        'bottom-full mb-2': props.placement === 'top',
        'left-1/2 -translate-x-1/2': props.align !== 'right',
        'right-0': props.align === 'right',
      }}
    >
      {props.text}
    </span>
  </span>
);

export default Tooltip;
