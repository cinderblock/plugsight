/**
 * Typed wrappers around Tauri's invoke() and event listener APIs.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { DeviceEvent, DeviceInfo, ClassMeta } from './types';

/** The event name matching `watcher::DEVICE_EVENT` on the Rust side. */
const DEVICE_EVENT = 'device-event';

// ── Commands ──────────────────────────────────────────────────────────────

/** Fetch all currently present devices (full enumeration). */
export async function getAllDevices(): Promise<DeviceInfo[]> {
  return invoke<DeviceInfo[]>('get_all_devices');
}

/** Get detailed info for a single device. */
export async function getDeviceDetail(instanceId: string): Promise<DeviceInfo | null> {
  return invoke<DeviceInfo | null>('get_device_detail', { instanceId });
}

/** Get metadata for all known device setup classes. */
export async function getClassMetadata(): Promise<ClassMeta[]> {
  return invoke<ClassMeta[]>('get_class_metadata');
}

/** Trigger a hardware re-scan. */
export async function scanForHardwareChanges(): Promise<void> {
  return invoke<void>('scan_for_hardware_changes');
}

// ── Events ────────────────────────────────────────────────────────────────

/** Subscribe to real-time device change events from the backend watcher. */
export function onDeviceEvent(callback: (event: DeviceEvent) => void): Promise<UnlistenFn> {
  return listen<DeviceEvent>(DEVICE_EVENT, evt => {
    callback(evt.payload);
  });
}
