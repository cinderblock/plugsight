/**
 * How long a device has been connected, and when it dropped out.
 *
 * Pure: every function takes the current time as an argument, so the row
 * readouts, hover cards and detail pane all agree and the logic is testable.
 * Rendering lives in `ConnectionReadout.tsx` and `ReconnectSparkline.tsx`.
 */

import type { ConnEvent } from './types';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A device that arrived within this long of boot reads "boot". Boot-time
 * enumeration of USB devices ran to ~33 s on the machine this was built on; two
 * minutes leaves room for slower ones. (A device plugged in during those first
 * two minutes also reads "boot" — accepted.)
 */
export const BOOT_WINDOW_MS = 2 * MINUTE;

/** Compact age for a row: "20s", "50m", "5h", "2d". */
export function shortAge(ms: number): string {
  const age = Math.max(0, ms);
  if (age < MINUTE) return `${Math.floor(age / SECOND)}s`;
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  return `${Math.floor(age / DAY)}d`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** A duration in words, to two units: "3 hours 12 minutes", "45 seconds", "1.2 seconds". */
export function longDuration(ms: number): string {
  const d = Math.max(0, ms);
  if (d < 10 * SECOND) {
    const s = Math.round(d / 100) / 10;
    return `${s} second${s === 1 ? '' : 's'}`;
  }
  const units: [number, string][] = [
    [DAY, 'day'],
    [HOUR, 'hour'],
    [MINUTE, 'minute'],
    [SECOND, 'second'],
  ];
  const i = units.findIndex(([size]) => d >= size);
  const [big, bigName] = units[i];
  const bigCount = Math.floor(d / big);
  const next = units[i + 1];
  if (!next) return plural(bigCount, bigName);
  const smallCount = Math.floor((d - bigCount * big) / next[0]);
  return smallCount > 0 ? `${plural(bigCount, bigName)} ${plural(smallCount, next[1])}` : plural(bigCount, bigName);
}

/** A moment people can place: "Mon, Sep 28, 2:14:05 PM" in the user's locale. */
export function formatMoment(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export interface ConnectedReadout {
  /** Row text: "20s" … "2d", or "boot". */
  short: string;
  /** Arrived with the machine's boot. */
  sinceBoot: boolean;
  /** Hover / detail text: when, and how long ago, in words. */
  long: string;
}

/**
 * The connected-for readout, or null when Windows didn't record an arrival.
 *
 * @param arrivedAt Windows' last arrival date for the device (ms since epoch)
 * @param bootTime  when the machine booted, or null if not known yet
 */
export function connectedReadout(
  arrivedAt: number | null,
  bootTime: number | null,
  now: number,
): ConnectedReadout | null {
  if (arrivedAt === null) return null;
  const age = now - arrivedAt;
  const sinceBoot = bootTime !== null && arrivedAt <= bootTime + BOOT_WINDOW_MS;
  return {
    short: sinceBoot ? 'boot' : shortAge(age),
    sinceBoot,
    long: sinceBoot
      ? `Here since boot: ${formatMoment(arrivedAt)} (${longDuration(age)})`
      : `Connected ${formatMoment(arrivedAt)} (${longDuration(age)} ago)`,
  };
}

/** One time the device dropped out. */
export interface Drop {
  /** When it left. */
  lostAt: number;
  /** When it came back, or null if it's still away. */
  backAt: number | null;
}

/** Every drop in the event list, oldest first. */
export function dropsOf(events: readonly ConnEvent[]): Drop[] {
  const drops: Drop[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].kind !== 'remove') continue;
    const back = events.slice(i + 1).find(e => e.kind === 'arrive');
    drops.push({ lostAt: events[i].t, backAt: back ? back.t : null });
  }
  return drops;
}

/** The windows a sparkline can span, smallest first. */
const WINDOWS: { ms: number; label: string }[] = [
  { ms: HOUR, label: '1h ago' },
  { ms: DAY, label: '24h ago' },
  { ms: 7 * DAY, label: '7d ago' },
  { ms: 30 * DAY, label: '30d ago' },
  { ms: 90 * DAY, label: '90d ago' },
];

export interface SparklineModel {
  /** Left-edge label: "24h ago", "7d ago", … */
  startLabel: string;
  /** Window start (ms since epoch); the right edge is `now`. */
  start: number;
  /** Each drop's position as fractions of the width, 0 = start, 1 = now.
   *  `to` is where it came back (or 1 while still away). */
  drops: { from: number; to: number; drop: Drop }[];
}

/**
 * Lay out drops on a time strip ending now. The window is the smallest of
 * 1h / 24h / 7d / 30d / 90d that holds the earliest drop, so the end labels
 * read in absolute terms and a recent burst isn't squashed against the edge
 * of a months-long span.
 */
export function sparklineModel(events: readonly ConnEvent[], now: number): SparklineModel {
  const drops = dropsOf(events);
  const earliest = drops.length > 0 ? drops[0].lostAt : now;
  const window = WINDOWS.find(w => now - w.ms <= earliest) ?? WINDOWS[WINDOWS.length - 1];
  const start = now - window.ms;
  const at = (t: number) => Math.min(1, Math.max(0, (t - start) / window.ms));
  return {
    startLabel: window.label,
    start,
    drops: drops.map(drop => ({ from: at(drop.lostAt), to: drop.backAt === null ? 1 : at(drop.backAt), drop })),
  };
}

/** Whether the latest drop was within the last day — the reconnect chip turns amber. */
export function droppedRecently(events: readonly ConnEvent[], now: number): boolean {
  const drops = dropsOf(events);
  return drops.length > 0 && now - drops[drops.length - 1].lostAt < DAY;
}
