/**
 * Device change notifications — the "COM5 connected" popups.
 *
 * Routing: when the PlugSight window is focused we show an in-app toast
 * (styled, clickable, can carry the device instance ID); when it's backgrounded
 * we raise a native Windows notification so the user sees it without the app up.
 * This avoids double-notifying for the same event.
 *
 * Deliberately does NOT import the device store — the store calls
 * `notifyDeviceChange()` here, so keeping the dependency one-directional avoids
 * an import cycle. The store owns the `notifyMode` setting.
 */

import { createSignal } from 'solid-js';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

/** What kinds of device changes raise a popup. Persisted by the device store. */
export type NotifyMode = 'off' | 'com' | 'all';

/** Cycle order for the toolbar button: off → COM ports → all devices → off. */
export const NOTIFY_MODE_ORDER: readonly NotifyMode[] = ['off', 'com', 'all'];

/** A transient in-app toast, shown when the window is focused. */
export interface Toast {
  id: number;
  title: string;
  body: string;
  direction: 'connected' | 'disconnected';
  /** Device instance ID, so clicking the toast can select that device. */
  instanceId: string;
}

/** The information needed to raise a popup for one device change. */
export interface DeviceChangeNotice {
  title: string;
  body: string;
  direction: 'connected' | 'disconnected';
  instanceId: string;
}

/** How long (ms) an in-app toast stays before auto-dismissing. */
const TOAST_DURATION_MS = 6_000;

const [toasts, setToasts] = createSignal<Toast[]>([]);
let nextToastId = 1;

/** Reactive list of active in-app toasts (oldest first). */
export { toasts };

/** Remove one toast by id (auto-dismiss timer or a manual close/click). */
export function dismissToast(id: number) {
  setToasts(prev => prev.filter(t => t.id !== id));
}

function pushToast(notice: DeviceChangeNotice) {
  const id = nextToastId++;
  setToasts(prev => [...prev, { id, ...notice }]);
  setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
}

// Cache the permission outcome so we don't re-prompt/re-query on every event.
let permissionState: 'unknown' | 'granted' | 'denied' = 'unknown';

async function ensurePermission(): Promise<boolean> {
  if (permissionState === 'granted') return true;
  if (permissionState === 'denied') return false;
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    permissionState = granted ? 'granted' : 'denied';
    return granted;
  } catch (e) {
    console.error('Notification permission check failed:', e);
    permissionState = 'denied';
    return false;
  }
}

/**
 * Raise a popup for a device change. Focused → in-app toast; backgrounded →
 * native OS notification (falling back to an in-app toast if the OS notification
 * can't be sent, so the event is never silently lost).
 */
export async function notifyDeviceChange(notice: DeviceChangeNotice): Promise<void> {
  if (document.hasFocus()) {
    pushToast(notice);
    return;
  }

  const granted = await ensurePermission();
  if (!granted) {
    pushToast(notice);
    return;
  }

  try {
    sendNotification({ title: notice.title, body: notice.body });
  } catch (e) {
    console.error('sendNotification failed:', e);
    pushToast(notice);
  }
}
