/**
 * Wording for a device's links, from the facts the backend reports.
 *
 * Pure: takes a `LinkInfo`, returns strings and a degraded flag. Rendering
 * lives in `LinkBadge.tsx` (row chips) and `DeviceDetail.tsx` (spelled out).
 *
 * "Degraded" means the link runs below what the *device* advertises: a
 * SuperSpeed device negotiated at 480 Mbps, a Gen3 ×4 NVMe drive trained at
 * Gen1 or ×2, a gigabit adapter at 100 Mbps, a 6 Gbps SATA drive at 3 Gbps.
 * It doesn't compare against the other end — a USB 2 device on a USB 3 port
 * is at full speed for what it is.
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

/** Line rate and marketing name per SATA generation. */
const SATA_RATE: Record<number, string> = { 1: '1.5 Gbps', 2: '3 Gbps', 3: '6 Gbps' };
const SATA_NAME: Record<number, string> = { 1: 'SATA I', 2: 'SATA II', 3: 'SATA III' };

export function usbRate(speed: UsbSpeed): string {
  return USB_RATE[speed];
}

/** "Gen3 ×4" — the shorthand every spec sheet and BIOS uses. */
export function pcieLabel(generation: number, width: number): string {
  return `Gen${generation} ×${width}`;
}

/** Bits per second as people say it: "100 Mbps", "1 Gbps", "2.5 Gbps". */
export function formatBps(bps: number): string {
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  if (bps >= 1e9) return `${trim(bps / 1e9)} Gbps`;
  if (bps >= 1e6) return `${trim(bps / 1e6)} Mbps`;
  if (bps >= 1e3) return `${trim(bps / 1e3)} kbps`;
  return `${bps} bps`;
}

function sataRate(generation: number): string {
  return SATA_RATE[generation] ?? `Gen${generation}`;
}

export interface LinkSummary {
  /** Section heading: "USB link" / "PCIe link" / "Ethernet link" / "SATA link". */
  title: string;
  /**
   * Short bus tag shown before the speed on the chip ("LAN", "SATA"), so a row
   * with two chips — a USB network adapter, say — reads unambiguously. Null for
   * the bus a row's own position already implies (USB, PCIe).
   */
  prefix: string | null;
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
  /**
   * Whether the detail pane should show the capable speed: when degraded, but
   * also when a hand-set Ethernet speed sits below the adapter's maximum, or
   * an unplugged adapter can say what it would run at.
   */
  showCapable: boolean;
  /** One sentence on what the numbers mean for this device, or null. */
  note: string | null;
}

export function describeLink(link: LinkInfo): LinkSummary {
  switch (link.bus) {
    case 'usb': {
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
        prefix: null,
        speed: USB_RATE[link.speed],
        capable: USB_RATE[link.capable],
        speedDetail: `${USB_RATE[link.speed]} (${USB_NAME[link.speed]})`,
        capableDetail: `${USB_RATE[link.capable]} (${USB_NAME[link.capable]})`,
        degraded,
        showCapable: degraded,
        note,
      };
    }

    case 'pcie': {
      const degraded = link.generation < link.maxGeneration || link.width < link.maxWidth;
      const rate = (generation: number) => {
        const gt = PCIE_GT_PER_S[generation];
        return gt ? `${gt} GT/s per lane` : 'unknown rate';
      };
      return {
        title: 'PCIe link',
        prefix: null,
        speed: pcieLabel(link.generation, link.width),
        capable: pcieLabel(link.maxGeneration, link.maxWidth),
        speedDetail: `${pcieLabel(link.generation, link.width)} (${rate(link.generation)})`,
        capableDetail: `${pcieLabel(link.maxGeneration, link.maxWidth)} (${rate(link.maxGeneration)})`,
        degraded,
        showCapable: degraded,
        note: degraded
          ? 'The link trained below what the device supports. Some devices drop to a slower link while idle to save power; a device that is busy and still slow may be in a slot with fewer lanes or a lower generation.'
          : null,
      };
    }

    case 'ethernet': {
      const max = link.maxBps;
      const capable = max !== null ? formatBps(max) : '';
      if (!link.connected) {
        return {
          title: 'Ethernet link',
          prefix: 'LAN',
          speed: 'no link',
          capable,
          speedDetail: 'No link: the cable is unplugged, or nothing is answering at the other end',
          capableDetail: capable,
          degraded: false,
          showCapable: max !== null,
          note: null,
        };
      }
      const speed = formatBps(link.speedBps);
      const slower = max !== null && link.speedBps < max;
      // A speed someone fixed by hand is a choice, not a fault.
      const degraded = slower && !link.forced;
      let note: string | null = null;
      if (link.forced && slower) {
        note = `The adapter's Speed & Duplex setting fixes the link at ${speed}, below the ${capable} it supports.`;
      } else if (link.forced) {
        note = "The adapter's Speed & Duplex setting fixes this speed instead of negotiating it.";
      } else if (degraded) {
        note = `The adapter supports ${capable} but negotiated ${speed}. Usually the port at the other end is slower, or the cable is damaged: gigabit needs all four wire pairs, and a cable missing one drops to 100 Mbps.`;
      }
      return {
        title: 'Ethernet link',
        prefix: 'LAN',
        speed,
        capable: capable || speed,
        speedDetail: speed,
        capableDetail: capable ? `${capable} (fastest option in the adapter's Speed & Duplex setting)` : '',
        degraded,
        showCapable: slower,
        note,
      };
    }

    case 'sata': {
      const degraded = link.generation < link.maxGeneration;
      const detail = (generation: number) =>
        SATA_NAME[generation] ? `${sataRate(generation)} (${SATA_NAME[generation]})` : sataRate(generation);
      return {
        title: 'SATA link',
        prefix: 'SATA',
        speed: sataRate(link.generation),
        capable: sataRate(link.maxGeneration),
        speedDetail: detail(link.generation),
        capableDetail: detail(link.maxGeneration),
        degraded,
        showCapable: degraded,
        note: degraded
          ? `The drive supports ${sataRate(link.maxGeneration)} but the link came up at ${sataRate(link.generation)}. Either the controller port is an older generation, or a marginal cable made the link settle lower.`
          : null,
      };
    }
  }
}

/**
 * Lower-cased text a search query can match against, so "480", "gen1",
 * "100 mbps" or "degraded" finds the devices running at that speed. Empty
 * when there are no links.
 */
export function linkSearchText(links: readonly LinkInfo[]): string {
  return links
    .flatMap(link => {
      const summary = describeLink(link);
      const parts = [summary.title, summary.speed];
      // PCIe's detail says "GT/s per lane", which would make "lan" match every
      // PCIe device; offer the ASCII "gen3 x4" people actually type instead.
      parts.push(link.bus === 'pcie' ? `gen${link.generation} x${link.width}` : summary.speedDetail);
      if (summary.prefix) parts.push(summary.prefix);
      if (summary.degraded) parts.push(summary.capable, 'degraded');
      return parts;
    })
    .join(' ')
    .toLowerCase();
}
