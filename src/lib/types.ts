/** Mirrors the Rust `DeviceInfo` struct. */
export interface DeviceInfo {
  instanceId: string;
  name: string;
  description: string;
  manufacturer: string;
  /** Canonical class name (resolved from the class GUID on the backend). */
  className: string;
  classGuid: string;
  /** Semantic icon ID for the frontend's SVG icon set (resolved on the backend). */
  iconId: string;
  driverVersion: string;
  status: DeviceStatus;
  problemCode: number;
  hardwareIds: string[];
  parentId: string;
  /** Serial/parallel port name (e.g. "COM5", "LPT1") for Ports-class devices; null otherwise. */
  portName: string | null;
  /**
   * Link speeds, bus link first (USB hub port / PCIe), then Ethernet or SATA.
   * A USB or PCIe network adapter has two. Empty when Windows reports none.
   */
  links: LinkInfo[];
  isPresent: boolean;
}

/** Mirrors the Rust `UsbSpeed` enum, slowest to fastest. */
export type UsbSpeed = 'low' | 'full' | 'high' | 'super' | 'superPlus';

/**
 * Mirrors the Rust `LinkInfo` enum: what a device's upstream link runs at and
 * what it could run at. Facts only — wording and the degraded call live in
 * `link-speed.ts`.
 */
export type LinkInfo =
  | {
      bus: 'usb';
      /** Speed the hub port negotiated with the device. */
      speed: UsbSpeed;
      /** Fastest speed the device advertises; equals `speed` unless it's running slow. */
      capable: UsbSpeed;
      /** Whether the hub port itself carries USB 3 signalling. */
      portUsb3: boolean;
      /**
       * Something is also connected on this port's SuperSpeed companion port:
       * this is the USB 2 half of a USB 3 hub whose USB 3 half is its own row.
       */
      companionConnected: boolean;
      /**
       * Instance ID of this USB 2 hub half's USB 3 twin, when the backend could
       * name it. The Connections tree folds the pair into one row.
       */
      companionId: string | null;
    }
  | {
      bus: 'pcie';
      /** Current link generation (1 = 2.5 GT/s … 6 = 64 GT/s). */
      generation: number;
      /** Current lane count. */
      width: number;
      maxGeneration: number;
      maxWidth: number;
    }
  | {
      bus: 'ethernet';
      /** Negotiated speed in bits per second; 0 when there's no link. */
      speedBps: number;
      /** A cable is plugged in and the link is up. */
      connected: boolean;
      /** Fastest option in the adapter's Speed & Duplex setting, if readable. */
      maxBps: number | null;
      /** The speed was fixed by hand rather than auto-negotiated. */
      forced: boolean;
    }
  | {
      bus: 'sata';
      /** Negotiated generation (1 = 1.5 Gbps, 2 = 3 Gbps, 3 = 6 Gbps). */
      generation: number;
      maxGeneration: number;
    };

/** Mirrors the Rust `DeviceStatus` enum. */
export type DeviceStatus =
  | { kind: 'ok' }
  | { kind: 'warning'; code: number; message: string }
  | { kind: 'error'; code: number; message: string }
  | { kind: 'disabled' }
  | { kind: 'driverNotInstalled' }
  | { kind: 'unknown' };

/** Mirrors the Rust `DeviceEvent` enum. */
export type DeviceEvent =
  | { type: 'added'; device: DeviceInfo }
  | { type: 'removed'; instanceId: string }
  | { type: 'updated'; device: DeviceInfo }
  | { type: 'enumerationComplete' };

/** Mirrors the Rust `ClassMeta` struct. */
export interface ClassMeta {
  guid: string;
  name: string;
  iconId: string;
}

/**
 * A device that has been removed but is shown as a "ghost" for a period.
 *
 * Expiration is computed dynamically from `removedAt + ghostTimeoutMs()` at
 * sweep time, so changing the timeout setting immediately affects existing
 * ghosts without having to re-stamp them.
 */
export interface GhostEntry {
  device: DeviceInfo;
  removedAt: number;
}

/** Represents a device in the UI — either live or ghost. */
export interface DisplayDevice {
  device: DeviceInfo;
  isGhost: boolean;
  ghostRemovedAt?: number;
  /** Whether this device passes the current filters (false = collapsed/hidden). */
  visible: boolean;
}

/** A category group for the device tree. */
export interface DeviceCategory {
  classGuid: string;
  className: string;
  iconId: string;
  devices: DisplayDevice[];
  /** Number of devices with problems in this category. */
  problemCount: number;
  /** Whether this category passes the current filters (false = collapsed/hidden). */
  visible: boolean;
}

/** Returns true if the device has a problem. */
export function hasDeviceProblem(status: DeviceStatus): boolean {
  return (
    status.kind === 'error' ||
    status.kind === 'warning' ||
    status.kind === 'disabled' ||
    status.kind === 'driverNotInstalled'
  );
}

/** How urgent a status is, for picking the one to show when a row stands for two devices. */
const STATUS_SEVERITY: Record<DeviceStatus['kind'], number> = {
  ok: 0,
  unknown: 1,
  disabled: 2,
  driverNotInstalled: 3,
  warning: 4,
  error: 5,
};

/** The more urgent of two statuses; `a` when there's no `b` or they tie. */
export function worseStatus(a: DeviceStatus, b?: DeviceStatus): DeviceStatus {
  return b && STATUS_SEVERITY[b.kind] > STATUS_SEVERITY[a.kind] ? b : a;
}

/** Returns a human-readable label for a status. */
export function statusLabel(status: DeviceStatus): string {
  switch (status.kind) {
    case 'ok':
      return 'Working properly';
    case 'warning':
      return status.message;
    case 'error':
      return status.message;
    case 'disabled':
      return 'Disabled';
    case 'driverNotInstalled':
      return 'Driver not installed';
    case 'unknown':
      return 'Unknown status';
  }
}
