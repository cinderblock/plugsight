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
  /** Upstream link speed (USB hub port / PCIe link); null when the bus has none or Windows didn't say. */
  link: LinkInfo | null;
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
    }
  | {
      bus: 'pcie';
      /** Current link generation (1 = 2.5 GT/s … 6 = 64 GT/s). */
      generation: number;
      /** Current lane count. */
      width: number;
      maxGeneration: number;
      maxWidth: number;
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
