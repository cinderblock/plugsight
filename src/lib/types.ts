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
  isPresent: boolean;
}

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
