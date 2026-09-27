/**
 * Tests for the link-speed wording. Run with `bun test`.
 */

import { describe, expect, test } from 'bun:test';
import type { LinkInfo, UsbSpeed } from './types';
import { describeLink, formatBps, linkSearchText, pcieLabel } from './link-speed';

const usb = (speed: UsbSpeed, capable: UsbSpeed = speed, portUsb3 = true, companionConnected = false): LinkInfo => ({
  bus: 'usb',
  speed,
  capable,
  portUsb3,
  companionConnected,
  companionId: null,
});

const pcie = (generation: number, width: number, maxGeneration = generation, maxWidth = width): LinkInfo => ({
  bus: 'pcie',
  generation,
  width,
  maxGeneration,
  maxWidth,
});

const M = 1_000_000;
const G = 1_000_000_000;

const ethernet = (speedBps: number, maxBps: number | null = speedBps, forced = false, connected = true): LinkInfo => ({
  bus: 'ethernet',
  speedBps: connected ? speedBps : 0,
  connected,
  maxBps,
  forced,
});

const sata = (generation: number, maxGeneration = generation): LinkInfo => ({ bus: 'sata', generation, maxGeneration });

describe('describeLink (USB)', () => {
  test('a device running at its own best speed is not degraded', () => {
    const s = describeLink(usb('super'));
    expect(s.speed).toBe('5 Gbps');
    expect(s.degraded).toBe(false);
    expect(s.note).toBeNull();
  });

  test('a USB 2 device on a USB 3 port is fine — it compares against the device, not the port', () => {
    const s = describeLink(usb('high', 'high', true));
    expect(s.speed).toBe('480 Mbps');
    expect(s.degraded).toBe(false);
  });

  test('a SuperSpeed device on a USB 2 port is degraded and blames the port', () => {
    const s = describeLink(usb('high', 'super', false));
    expect(s.degraded).toBe(true);
    expect(s.speed).toBe('480 Mbps');
    expect(s.capable).toBe('5 Gbps');
    expect(s.note).toMatch(/only carries USB 2/);
  });

  test('a SuperSpeed device at 480 Mbps on a USB 3 port suggests the cable', () => {
    const s = describeLink(usb('high', 'super', true));
    expect(s.degraded).toBe(true);
    expect(s.note).toMatch(/cable/);
  });

  test('the USB 2 half of a USB 3 hub is not degraded when its USB 3 half is up', () => {
    const s = describeLink(usb('high', 'super', true, true));
    expect(s.degraded).toBe(false);
    expect(s.speed).toBe('480 Mbps');
    expect(s.note).toMatch(/Windows lists such hubs twice/);
  });

  test('a USB 3 hub whose companion port is empty really did fall back', () => {
    const s = describeLink(usb('high', 'super', false, false));
    expect(s.degraded).toBe(true);
  });

  test('SuperSpeed+ capable running at SuperSpeed is degraded', () => {
    const s = describeLink(usb('super', 'superPlus'));
    expect(s.degraded).toBe(true);
    expect(s.speed).toBe('5 Gbps');
    expect(s.capable).toBe('10 Gbps');
  });

  test('detail strings carry the spec name', () => {
    expect(describeLink(usb('low')).speedDetail).toBe('1.5 Mbps (Low-speed, USB 1.x)');
    expect(describeLink(usb('full')).speedDetail).toBe('12 Mbps (Full-speed, USB 1.x)');
  });
});

describe('describeLink (PCIe)', () => {
  test('formats generation and width the way spec sheets do', () => {
    expect(pcieLabel(3, 4)).toBe('Gen3 ×4');
    const s = describeLink(pcie(3, 4));
    expect(s.speed).toBe('Gen3 ×4');
    expect(s.speedDetail).toBe('Gen3 ×4 (8 GT/s per lane)');
    expect(s.degraded).toBe(false);
  });

  test('a lower generation than the device supports is degraded', () => {
    const s = describeLink(pcie(1, 16, 4, 16));
    expect(s.degraded).toBe(true);
    expect(s.capable).toBe('Gen4 ×16');
    expect(s.note).toMatch(/idle/);
  });

  test('fewer lanes than the device supports is degraded', () => {
    const s = describeLink(pcie(3, 8, 3, 16));
    expect(s.degraded).toBe(true);
  });

  test('an unknown generation still renders without a rate', () => {
    expect(describeLink(pcie(9, 1)).speedDetail).toBe('Gen9 ×1 (unknown rate)');
  });
});

describe('describeLink (Ethernet)', () => {
  test('a gigabit adapter at gigabit is a quiet LAN chip', () => {
    const s = describeLink(ethernet(G));
    expect(s.prefix).toBe('LAN');
    expect(s.speed).toBe('1 Gbps');
    expect(s.degraded).toBe(false);
    expect(s.showCapable).toBe(false);
    expect(s.note).toBeNull();
  });

  test('a gigabit adapter that negotiated 100 Mbps is degraded and names the usual causes', () => {
    const s = describeLink(ethernet(100 * M, G));
    expect(s.degraded).toBe(true);
    expect(s.speed).toBe('100 Mbps');
    expect(s.capable).toBe('1 Gbps');
    expect(s.note).toMatch(/four wire pairs/);
  });

  test('a speed fixed by hand is shown, not flagged', () => {
    const s = describeLink(ethernet(100 * M, G, true));
    expect(s.degraded).toBe(false);
    expect(s.showCapable).toBe(true);
    expect(s.note).toMatch(/Speed & Duplex setting fixes the link at 100 Mbps/);
  });

  test('no cable is a neutral "no link", with the capable speed still on offer', () => {
    const s = describeLink(ethernet(0, 2_500 * M, false, false));
    expect(s.speed).toBe('no link');
    expect(s.degraded).toBe(false);
    expect(s.showCapable).toBe(true);
    expect(s.capable).toBe('2.5 Gbps');
  });

  test('an adapter whose options could not be read shows its speed and nothing more', () => {
    const s = describeLink(ethernet(G, null));
    expect(s.degraded).toBe(false);
    expect(s.showCapable).toBe(false);
  });
});

describe('describeLink (SATA)', () => {
  test('a 6 Gbps drive at 6 Gbps', () => {
    const s = describeLink(sata(3));
    expect(s.prefix).toBe('SATA');
    expect(s.speed).toBe('6 Gbps');
    expect(s.speedDetail).toBe('6 Gbps (SATA III)');
    expect(s.degraded).toBe(false);
  });

  test('a 6 Gbps drive that came up at 3 Gbps is degraded', () => {
    const s = describeLink(sata(2, 3));
    expect(s.degraded).toBe(true);
    expect(s.capable).toBe('6 Gbps');
    expect(s.note).toMatch(/controller port|cable/);
  });
});

describe('formatBps', () => {
  test('says speeds the way spec sheets do', () => {
    expect(formatBps(10 * M)).toBe('10 Mbps');
    expect(formatBps(100 * M)).toBe('100 Mbps');
    expect(formatBps(G)).toBe('1 Gbps');
    expect(formatBps(2_500 * M)).toBe('2.5 Gbps');
    expect(formatBps(10 * G)).toBe('10 Gbps');
  });
});

describe('linkSearchText', () => {
  test('is empty without links', () => {
    expect(linkSearchText([])).toBe('');
  });

  test('matches the chip text and the spec name', () => {
    const text = linkSearchText([usb('high')]);
    expect(text).toContain('480 mbps');
    expect(text).toContain('usb 2.0');
    expect(text).not.toContain('degraded');
  });

  test('a degraded link is findable as such, and by its capable speed', () => {
    const text = linkSearchText([pcie(1, 4, 3, 4)]);
    expect(text).toContain('degraded');
    expect(text).toContain('gen3');
  });

  test('"lan" finds network adapters, not every PCIe device with lanes', () => {
    expect(linkSearchText([pcie(3, 4)])).not.toContain('lan');
    expect(linkSearchText([ethernet(G)])).toContain('lan');
  });

  test('PCIe width is findable as typed, with an ASCII x', () => {
    expect(linkSearchText([pcie(3, 4)])).toContain('gen3 x4');
  });

  test('covers every link on a device with two', () => {
    // A USB network adapter: the USB bus link, then its Ethernet port.
    const text = linkSearchText([usb('high'), ethernet(G, 2_500 * M)]);
    expect(text).toContain('480 mbps');
    expect(text).toContain('lan');
    expect(text).toContain('1 gbps');
    expect(text).toContain('degraded');
  });
});
