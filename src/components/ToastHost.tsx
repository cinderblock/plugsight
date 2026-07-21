/**
 * ToastHost — bottom-right stack of in-app device-change popups.
 *
 * Shown when the window is focused (backgrounded changes go to native OS
 * notifications instead — see `~/lib/notifications`). Clicking a toast selects
 * the device it refers to, if it's still present.
 */

import type { Component } from 'solid-js';
import { For } from 'solid-js';
import { TransitionGroup } from 'solid-transition-group';
import { toasts, dismissToast, type Toast } from '~/lib/notifications';
import { setSelectedId } from '~/lib/device-store';

const ToastHost: Component = () => {
  const selectDevice = (t: Toast) => {
    setSelectedId(t.instanceId);
    dismissToast(t.id);
  };

  return (
    <div class="pointer-events-none fixed bottom-14 right-4 z-50 flex w-72 flex-col gap-2">
      <TransitionGroup name="toast">
        <For each={toasts()}>
          {toast => (
            <div
              class="toast-item pointer-events-auto cursor-pointer rounded-lg border bg-white shadow-lg dark:bg-gray-800"
              classList={{
                'border-emerald-300 dark:border-emerald-700/60': toast.direction === 'connected',
                'border-gray-300 dark:border-gray-600': toast.direction === 'disconnected',
              }}
              role="status"
              onClick={() => selectDevice(toast)}
            >
              <div class="flex items-start gap-2.5 p-3">
                {/* Connected: plug-in arrow (emerald). Disconnected: plug-out (gray). */}
                <svg
                  class="mt-0.5 h-4 w-4 shrink-0"
                  classList={{
                    'text-emerald-500': toast.direction === 'connected',
                    'text-gray-400': toast.direction === 'disconnected',
                  }}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M9 2v6M15 2v6" />
                  <path d="M7 8h10v3a5 5 0 01-10 0V8z" />
                  <path d="M12 16v6" />
                </svg>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{toast.title}</div>
                  <div class="truncate text-xs text-gray-500 dark:text-gray-400">{toast.body}</div>
                </div>
                <button
                  class="-mr-1 -mt-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                  aria-label="Dismiss notification"
                  onClick={e => {
                    e.stopPropagation();
                    dismissToast(toast.id);
                  }}
                >
                  <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </For>
      </TransitionGroup>
    </div>
  );
};

export default ToastHost;
