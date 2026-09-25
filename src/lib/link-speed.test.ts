/**
 * Tests for the link-speed wording. Run with `bun test`.
 */

import { describe, expect, test } from 'bun:test';
import type { LinkInfo, UsbSpeed } from './types';
import { describeLink, linkSearchText, pcieLabel } from './link-speed';

const usb = (speed: UsbSpeed, capable: UsbSpeed = speed, portUsb3 = true, companionConnected = false): LinkInfo => ({
  bus: 'usb',
  speed,
  capable,
  portUsb3,
  companionConnected,
});

const pcie = (generation: number, width: number, maxGeneration = generation, maxWidth = width): LinkInfo => ({
  bus: 'pcie',
  generation,
  width,
  maxGeneration,
  maxWidth,
});

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
    expect(s.note).toMatch(/USB 3 side is its own row/);
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

describe('linkSearchText', () => {
  test('is empty without a link', () => {
    expect(linkSearchText(null)).toBe('');
  });

  test('matches the chip text and the spec name', () => {
    const text = linkSearchText(usb('high'));
    expect(text).toContain('480 mbps');
    expect(text).toContain('usb 2.0');
    expect(text).not.toContain('degraded');
  });

  test('a degraded link is findable as such, and by its capable speed', () => {
    const text = linkSearchText(pcie(1, 4, 3, 4));
    expect(text).toContain('degraded');
    expect(text).toContain('gen3');
  });
});
