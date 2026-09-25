/**
 * Wording for a device's upstream link, from the facts the backend reports.
 *
 * Pure: takes a `LinkInfo`, returns strings and a degraded flag. Rendering
 * lives in `LinkBadge.tsx` (row chip) and `DeviceDetail.tsx` (spelled out).
 *
 * "Degraded" means the link runs below what the *device* advertises: a
 * SuperSpeed device negotiated at 480 Mbps, a Gen3 ×4 NVMe drive trained at
 * Gen1 or ×2. It doesn't compare against the upstream port — a USB 2 device
 * on a USB 3 port is at full speed for what it is.
 */

import type { LinkInfo, UsbSpeed } from './types';

/** Signalling rate per USB speed, as people say it. */
const USB_RATE: Record<UsbSpeed, string> = {
  low: '1.5 Mbps',
  full: '12 Mbps',
  high: '480 Mbps',
  super: '5 Gbps',
  superPlus: '10 Gbps',
};

/** Spec name per USB speed, for the detail pane. */
const USB_NAME: Record<UsbSpeed, string> = {
  low: 'Low-speed, USB 1.x',
  full: 'Full-speed, USB 1.x',
  high: 'High-speed, USB 2.0',
  super: 'SuperSpeed, USB 3.x',
  superPlus: 'SuperSpeed+, USB 3.1 or later',
};

const USB_ORDER: UsbSpeed[] = ['low', 'full', 'high', 'super', 'superPlus'];

/** Per-lane transfer rate for a PCIe generation, in GT/s; unknown for anything newer than we know. */
const PCIE_GT_PER_S: Record<number, string> = { 1: '2.5', 2: '5', 3: '8', 4: '16', 5: '32', 6: '64' };

export function usbRate(speed: UsbSpeed): string {
  return USB_RATE[speed];
}

/** "Gen3 ×4" — the shorthand every spec sheet and BIOS uses. */
export function pcieLabel(generation: number, width: number): string {
  return `Gen${generation} ×${width}`;
}

export interface LinkSummary {
  /** Section heading: "USB link" / "PCIe link". */
  title: string;
  /** Short chip text for the running speed: "480 Mbps", "Gen3 ×4". */
  speed: string;
  /** Short chip text for the capable speed; only meaningful when degraded. */
  capable: string;
  /** Running speed with its spec name: "480 Mbps (High-speed, USB 2.0)". */
  speedDetail: string;
  /** Capable speed with its spec name. */
  capableDetail: string;
  /** True when the device is running below what it advertises. */
  degraded: boolean;
  /** One sentence on what the numbers mean for this device, or null. */
  note: string | null;
}

export function describeLink(link: LinkInfo): LinkSummary {
  if (link.bus === 'usb') {
    const slower = USB_ORDER.indexOf(link.capable) > USB_ORDER.indexOf(link.speed);
    // A USB 3 hub is two logical hubs; its USB 2 half advertises SuperSpeed
    // but isn't running slow — the 5 Gbps half is the row next to it.
    const degraded = slower && !link.companionConnected;
    let note: string | null = null;
    if (slower && link.companionConnected) {
      note = 'USB 2 side of a USB 3 hub. Windows lists such hubs twice; the USB 3 side is its own row.';
    } else if (degraded && !link.portUsb3) {
      note = 'This device supports USB 3, but the port it is plugged into only carries USB 2.';
    } else if (degraded) {
      note =
        'This device supports USB 3, and so does the port, but the link came up at USB 2 speed. Try another cable or port.';
    }
    return {
      title: 'USB link',
      speed: USB_RATE[link.speed],
      capable: USB_RATE[link.capable],
      speedDetail: `${USB_RATE[link.speed]} (${USB_NAME[link.speed]})`,
      capableDetail: `${USB_RATE[link.capable]} (${USB_NAME[link.capable]})`,
      degraded,
      note,
    };
  }

  const degraded = link.generation < link.maxGeneration || link.width < link.maxWidth;
  const rate = (generation: number) => {
    const gt = PCIE_GT_PER_S[generation];
    return gt ? `${gt} GT/s per lane` : 'unknown rate';
  };
  return {
    title: 'PCIe link',
    speed: pcieLabel(link.generation, link.width),
    capable: pcieLabel(link.maxGeneration, link.maxWidth),
    speedDetail: `${pcieLabel(link.generation, link.width)} (${rate(link.generation)})`,
    capableDetail: `${pcieLabel(link.maxGeneration, link.maxWidth)} (${rate(link.maxGeneration)})`,
    degraded,
    note: degraded
      ? 'The link trained below what the device supports. Some devices drop to a slower link while idle to save power; a device that is busy and still slow may be in a slot with fewer lanes or a lower generation.'
      : null,
  };
}

/**
 * Lower-cased text a search query can match against, so "480" or "gen1"
 * finds the devices running at that speed. Empty when there's no link.
 */
export function linkSearchText(link: LinkInfo | null): string {
  if (!link) return '';
  const summary = describeLink(link);
  const parts = [summary.speed, summary.speedDetail];
  if (summary.degraded) parts.push(summary.capable, 'degraded');
  return parts.join(' ').toLowerCase();
}
