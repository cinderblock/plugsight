/**
 * TopologyView — the main pane's "Connections" mode.
 *
 * Renders devices as a tree by their logical parent→child wiring (USB host
 * controller → root hub → hub → device; PCI device → bus), instead of grouped
 * by Windows device class. Selection, hover highlighting (amber = parent,
 * cyan = child), and double-click-to-open-properties match the category view.
 */

import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import type { TopoNode } from '~/lib/topology';
import { hasDeviceProblem } from '~/lib/types';
import {
  state,
  topologyForest,
  selectedId,
  setSelectedId,
  recentChanges,
  setHoveredId,
  isTopoCollapsed,
  toggleTopoNode,
  showProblemsOnly,
} from '~/lib/device-store';
import { openDeviceProperties } from '~/lib/tauri';
import StatusBadge from './StatusBadge';
import DeviceIcon from './DeviceIcon';
import RelationArrows from './RelationArrows';

const TopologyNode: Component<{ node: TopoNode; depth: number }> = props => {
  const device = () => props.node.device;
  const hasChildren = () => props.node.children.length > 0;
  // Force the tree open under the problems filter so the matching devices show.
  const collapsed = () => !showProblemsOnly() && isTopoCollapsed(device().instanceId);
  const isSelected = () => selectedId() === device().instanceId;
  const isRecentChange = () => recentChanges().has(device().instanceId);
  const hasProblem = () => hasDeviceProblem(device().status);

  /** Colored left accent only when there's a problem; transparent otherwise. */
  const borderClass = () => {
    switch (device().status.kind) {
      case 'error':
        return 'border-l-red-500';
      case 'warning':
        return 'border-l-amber-500';
      case 'disabled':
        return 'border-l-gray-400';
      case 'driverNotInstalled':
        return 'border-l-yellow-500';
      default:
        return 'border-l-transparent';
    }
  };

  return (
    <div>
      <div
        class={`group flex items-center gap-2 pr-2 py-1 border-l-4 rounded-r-lg cursor-pointer transition-all duration-200
        ${borderClass()}
        ${
          isSelected()
            ? 'bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-300 dark:ring-blue-700'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }
        ${isRecentChange() ? 'device-entry--highlight' : ''}
        ${props.node.dimmed ? 'opacity-40' : ''}`}
        style={{ 'padding-left': `${props.depth * 16 + 8}px` }}
        data-instance-id={device().instanceId}
        onClick={() => setSelectedId(prev => (prev === device().instanceId ? null : device().instanceId))}
        onDblClick={() => openDeviceProperties(device().instanceId)}
        onMouseEnter={() => setHoveredId(device().instanceId)}
        onMouseLeave={() => setHoveredId(null)}
      >
        {/* Expand/collapse chevron, or a spacer so leaf rows align. */}
        <Show when={hasChildren()} fallback={<div class="w-4 shrink-0" aria-hidden="true" />}>
          <div
            role="button"
            class="w-4 h-4 shrink-0 flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label={collapsed() ? 'Expand' : 'Collapse'}
            onClick={e => {
              e.stopPropagation();
              toggleTopoNode(device().instanceId);
            }}
          >
            <svg
              class={`w-4 h-4 transition-transform duration-200 ${collapsed() ? '' : 'rotate-90'}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </Show>

        {/* Device icon */}
        <div
          data-role="icon"
          class={`shrink-0 ${hasProblem() ? 'text-red-500 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}
        >
          <DeviceIcon iconId={device().iconId || 'other'} classGuid={device().classGuid} class="w-5 h-5" />
        </div>

        {/* Name */}
        <span class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{device().name}</span>

        <StatusBadge status={device().status} compact />

        {/* Child count */}
        <Show when={hasChildren()}>
          <span class="shrink-0 inline-flex items-center h-5 px-1.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 tabular-nums">
            {props.node.children.length}
          </span>
        </Show>

        {/* Zero-width marker at the end of the label, for relation connectors. */}
        <span data-role="label-end" aria-hidden="true" />
      </div>

      {/* Children */}
      <Show when={hasChildren() && !collapsed()}>
        <For each={props.node.children}>{child => <TopologyNode node={child} depth={props.depth + 1} />}</For>
      </Show>
    </div>
  );
};

const TopologyView: Component = () => {
  let containerRef!: HTMLDivElement;
  return (
    <div ref={containerRef} class="device-tree relative flex-1 overflow-y-auto py-2 pl-5 pr-6">
      {/* Loading state */}
      <Show when={!state.enumerationComplete}>
        <div class="flex items-center justify-center py-8 gap-3 text-gray-400 dark:text-gray-500">
          <svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" opacity="0.25" />
            <path d="M12 2a10 10 0 019.75 7.75" opacity="0.75" />
          </svg>
          <span class="text-sm">Discovering devices...</span>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={state.enumerationComplete && topologyForest().length === 0}>
        <div class="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
          <span class="text-sm">No USB or PCI devices found</span>
        </div>
      </Show>

      {/* Topology forest */}
      <For each={topologyForest()}>{root => <TopologyNode node={root} depth={0} />}</For>

      {/* Hover relationship connectors (overlay) */}
      <RelationArrows container={() => containerRef} />
    </div>
  );
};

export default TopologyView;
