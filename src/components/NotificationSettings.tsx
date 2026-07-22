/**
 * NotificationSettings — a small modal for the device-change popup settings.
 *
 * Two axes:
 * - Scope (which devices are eligible): off / COM & serial ports / all devices.
 * - A matrix of how each event × focus-state is delivered: an in-app toast, a
 *   native OS notification, or nothing.
 */

import type { Component } from 'solid-js';
import { For, Show, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  notifyMode,
  setNotifyMode,
  notifyMatrix,
  setNotifyMatrixCell,
  type NotifyMatrix,
} from '~/lib/device-store';
import type { NotifyMode, NotifyDelivery } from '~/lib/notifications';

const SCOPE_OPTIONS: ReadonlyArray<{ value: NotifyMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'com', label: 'COM & serial' },
  { value: 'all', label: 'All devices' },
];

const DELIVERY_OPTIONS: ReadonlyArray<{ value: NotifyDelivery; label: string }> = [
  { value: 'inApp', label: 'In-app' },
  { value: 'native', label: 'Native' },
  { value: 'none', label: 'Off' },
];

/** Matrix rows (event) and columns (focus state), mapped to the cell keys. */
const MATRIX_ROWS: ReadonlyArray<{
  label: string;
  focused: keyof NotifyMatrix;
  background: keyof NotifyMatrix;
}> = [
  { label: 'Plugged in', focused: 'addedFocused', background: 'addedBackground' },
  { label: 'Unplugged', focused: 'removedFocused', background: 'removedBackground' },
];

const NotificationSettings: Component<{ open: boolean; onClose: () => void }> = props => {
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && props.open) {
        e.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    onCleanup(() => window.removeEventListener('keydown', onKey, true));
  });

  const scopeOff = () => notifyMode() === 'off';

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={props.onClose}
        >
          <div
            class="w-[24rem] max-w-full rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
            role="dialog"
            aria-modal="true"
            aria-label="Notification settings"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Notifications</h2>
              <button
                class="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                aria-label="Close"
                onClick={props.onClose}
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div class="space-y-4 p-4">
              {/* Scope */}
              <div>
                <div class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Notify for
                </div>
                <Segmented
                  options={SCOPE_OPTIONS}
                  value={notifyMode()}
                  onChange={v => setNotifyMode(v)}
                />
              </div>

              {/* Matrix */}
              <div classList={{ 'opacity-40 pointer-events-none': scopeOff() }}>
                <div class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  How to notify
                </div>
                <div class="grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-2">
                  {/* Column headers */}
                  <div />
                  <div class="text-center text-xs font-medium text-gray-600 dark:text-gray-300">Focused</div>
                  <div class="text-center text-xs font-medium text-gray-600 dark:text-gray-300">Background</div>

                  <For each={MATRIX_ROWS}>
                    {row => (
                      <>
                        <div class="text-xs font-medium text-gray-700 dark:text-gray-200">{row.label}</div>
                        <Segmented
                          compact
                          options={DELIVERY_OPTIONS}
                          value={notifyMatrix()[row.focused]}
                          onChange={v => setNotifyMatrixCell(row.focused, v)}
                        />
                        <Segmented
                          compact
                          options={DELIVERY_OPTIONS}
                          value={notifyMatrix()[row.background]}
                          onChange={v => setNotifyMatrixCell(row.background, v)}
                        />
                      </>
                    )}
                  </For>
                </div>
                <p class="mt-2 text-[11px] leading-snug text-gray-400 dark:text-gray-500">
                  “Native” shows a Windows notification (works when PlugSight is in the background);
                  “In-app” shows a toast inside the window.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

/** A small segmented control (radio group styled as connected buttons). */
function Segmented<T extends string>(props: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  compact?: boolean;
}) {
  return (
    <div class="inline-flex w-full overflow-hidden rounded-md border border-gray-300 dark:border-gray-600">
      <For each={props.options}>
        {(opt, i) => (
          <button
            class="flex-1 border-gray-300 transition-colors dark:border-gray-600"
            classList={{
              'border-l': i() > 0,
              'px-1.5 py-1 text-[11px]': props.compact,
              'px-3 py-1.5 text-xs': !props.compact,
              'bg-blue-600 text-white': props.value === opt.value,
              'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700':
                props.value !== opt.value,
            }}
            aria-pressed={props.value === opt.value}
            onClick={() => props.onChange(opt.value)}
          >
            {opt.label}
          </button>
        )}
      </For>
    </div>
  );
}

export default NotificationSettings;
