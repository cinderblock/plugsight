/**
 * App — root component.
 *
 * Sets up the device store listener, lays out the toolbar, device tree, and detail panel.
 */

import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { initDeviceStore, selectedDevice } from '~/lib/device-store';
import Toolbar from '~/components/Toolbar';
import DeviceTree from '~/components/DeviceTree';
import DeviceDetail from '~/components/DeviceDetail';

const App: Component = () => {
  // Wire up the event listener and ghost sweeper.
  initDeviceStore();

  return (
    <div class="h-screen flex flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 select-none">
      {/* Top toolbar */}
      <Toolbar />

      {/* Main content: tree + optional detail panel */}
      <div class="flex flex-1 min-h-0">
        {/* Device tree (takes remaining space) */}
        <DeviceTree />

        {/* Detail panel (slides in when a device is selected) */}
        <Show when={selectedDevice()}>
          <div class="w-80 shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 detail-panel-enter">
            <DeviceDetail />
          </div>
        </Show>
      </div>

      {/* Bottom status bar */}
      <div class="h-6 px-4 flex items-center border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 shrink-0">
        <span class="text-xs text-gray-400 dark:text-gray-500">Device Manager</span>
      </div>
    </div>
  );
};

export default App;
