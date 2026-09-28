/**
 * Tests for the connected-for readout and drop history. Run with `bun test`.
 */

import { describe, expect, test } from 'bun:test';
import type { ConnEvent } from './types';
import {
  BOOT_WINDOW_MS,
  connectedReadout,
  droppedRecently,
  dropsOf,
  longDuration,
  shortAge,
  sparklineModel,
} from './connection-time';

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

const arrive = (t: number): ConnEvent => ({ t, kind: 'arrive' });
const remove = (t: number): ConnEvent => ({ t, kind: 'remove' });

describe('shortAge', () => {
  test('uses the largest whole unit, as in "20s", "50m", "2d"', () => {
    expect(shortAge(20 * S)).toBe('20s');
    expect(shortAge(59 * S + 999)).toBe('59s');
    expect(shortAge(50 * M)).toBe('50m');
    expect(shortAge(5 * H + 59 * M)).toBe('5h');
    expect(shortAge(2 * D + 3 * H)).toBe('2d');
  });

  test('never goes negative when clocks disagree by a moment', () => {
    expect(shortAge(-500)).toBe('0s');
  });
});

describe('longDuration', () => {
  test('gives two units, dropping a zero second unit', () => {
    expect(longDuration(3 * H + 12 * M + 5 * S)).toBe('3 hours 12 minutes');
    expect(longDuration(2 * D)).toBe('2 days');
    expect(longDuration(1 * M + 1 * S)).toBe('1 minute 1 second');
    expect(longDuration(45 * S)).toBe('45 seconds');
  });

  test('keeps a tenth of a second for short gaps — the flaky-device case', () => {
    expect(longDuration(1234)).toBe('1.2 seconds');
    expect(longDuration(1000)).toBe('1 second');
  });
});

describe('connectedReadout', () => {
  const boot = 1_000 * D;

  test('reads "boot" for a device that arrived with the boot', () => {
    const r = connectedReadout(boot + 33 * S, boot, boot + 2 * D)!;
    expect(r.short).toBe('boot');
    expect(r.sinceBoot).toBe(true);
    expect(r.long).toMatch(/^Here since boot:/);
  });

  test('reads an age for a device plugged in after boot', () => {
    const r = connectedReadout(boot + BOOT_WINDOW_MS + S, boot, boot + BOOT_WINDOW_MS + S + 20 * S)!;
    expect(r.short).toBe('20s');
    expect(r.sinceBoot).toBe(false);
    expect(r.long).toMatch(/^Connected .*\(20 seconds ago\)$/);
  });

  test('reads an age while the boot time is still unknown', () => {
    expect(connectedReadout(boot + 33 * S, null, boot + 50 * M)!.short).toBe('49m');
  });

  test('is null when Windows recorded no arrival', () => {
    expect(connectedReadout(null, boot, boot + D)).toBeNull();
  });
});

describe('dropsOf', () => {
  test('pairs each removal with the arrival that followed it', () => {
    const events = [arrive(0), remove(100 * S), arrive(101 * S), remove(200 * S)];
    expect(dropsOf(events)).toEqual([
      { lostAt: 100 * S, backAt: 101 * S },
      { lostAt: 200 * S, backAt: null },
    ]);
  });

  test('is empty for a device that never dropped', () => {
    expect(dropsOf([arrive(0)])).toEqual([]);
  });
});

describe('sparklineModel', () => {
  const now = 1_000 * D;

  test('picks the smallest window holding the earliest drop', () => {
    expect(sparklineModel([arrive(0), remove(now - 30 * M), arrive(now - 29 * M)], now).startLabel).toBe('1h ago');
    expect(sparklineModel([arrive(0), remove(now - 3 * H), arrive(now - 3 * H + S)], now).startLabel).toBe('24h ago');
    expect(sparklineModel([arrive(0), remove(now - 3 * D), arrive(now - 3 * D + S)], now).startLabel).toBe('7d ago');
  });

  test('places drops as fractions of the window, ending at now', () => {
    const m = sparklineModel([arrive(0), remove(now - 12 * H), arrive(now - 6 * H)], now);
    expect(m.startLabel).toBe('24h ago');
    expect(m.drops[0].from).toBeCloseTo(0.5);
    expect(m.drops[0].to).toBeCloseTo(0.75);
  });

  test('a device still away runs its gap to the right edge', () => {
    const m = sparklineModel([arrive(0), remove(now - 30 * M)], now);
    expect(m.drops[0].to).toBe(1);
  });

  test('drops older than the widest window are clamped to the left edge', () => {
    const m = sparklineModel([arrive(0), remove(now - 200 * D), arrive(now - 199 * D)], now);
    expect(m.startLabel).toBe('90d ago');
    expect(m.drops[0].from).toBe(0);
  });
});

describe('droppedRecently', () => {
  const now = 1_000 * D;

  test('is true only when the latest drop was within a day', () => {
    expect(droppedRecently([arrive(0), remove(now - 2 * H), arrive(now - H)], now)).toBe(true);
    expect(droppedRecently([arrive(0), remove(now - 3 * D), arrive(now - 3 * D + S)], now)).toBe(false);
    expect(droppedRecently([arrive(0)], now)).toBe(false);
  });
});
