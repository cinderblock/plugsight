/**
 * A shared "now" that ticks once a second, for readouts that age in place
 * ("20s" becoming "21s"). One timer for the whole app, started on first use,
 * rather than one per row.
 */

import { createSignal, type Accessor } from 'solid-js';

const [now, setNow] = createSignal(Date.now());
let started = false;

/** The current time in ms, updated every second while anything reads it. */
export function useNow(): Accessor<number> {
  if (!started) {
    started = true;
    setInterval(() => setNow(Date.now()), 1000);
  }
  return now;
}
