/**
 * StatusBar — bottom bar showing app version, device counts, and update availability.
 *
 * When a new version is detected via the GitHub Releases API, an animated badge appears
 * with the new version number. Clicking it opens the release page in the default browser.
 */

import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { counts, state } from '~/lib/device-store';
import {
  currentVersion,
  latestVersion,
  updateAvailable,
  openReleasePage,
} from '~/lib/updater';

const StatusBar: Component = () => {
  return (
    <div class="h-7 px-4 flex items-center justify-between border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 shrink-0">
      {/* Left: app name + version */}
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-400 dark:text-gray-500">
          Device Manager
          <Show when={currentVersion()}>
            <span class="ml-1 tabular-nums">v{currentVersion()}</span>
          </Show>
        </span>
      </div>

      {/* Center: device counts */}
      <Show when={state.enumerationComplete}>
        <div class="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 tabular-nums">
          <span>{counts().total} devices</span>
          <Show when={counts().problems > 0}>
            <span class="text-red-500 dark:text-red-400 font-medium">
              {counts().problems} problem{counts().problems !== 1 ? 's' : ''}
            </span>
          </Show>
          <Show when={counts().ghosts > 0}>
            <span class="italic">
              {counts().ghosts} removed
            </span>
          </Show>
        </div>
      </Show>

      {/* Right: update badge */}
      <div class="flex items-center">
        <Show when={updateAvailable()}>
          <button
            class="update-badge inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors cursor-pointer"
            onClick={openReleasePage}
            title={`Update available: ${latestVersion()} (click to download)`}
          >
            {/* Download/arrow-up icon */}
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 19V5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
            <span>{latestVersion()}</span>
          </button>
        </Show>
      </div>
    </div>
  );
};

export default StatusBar;
