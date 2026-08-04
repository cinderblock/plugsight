/**
 * TopologyView — the main pane's "Connections" mode.
 *
 * Renders devices as a tree by their logical parent→child wiring (USB host
 * controller → root hub → hub → device; PCI device → bus), instead of grouped
 * by Windows device class. Selection and double-click-to-open-properties match
 * the category view.
 *
 * Deliberately no relation-arrow overlay: this tree's indentation *is* the
 * parent→child index the arrows draw from, so every connector would restate the
 * nesting it sits on top of. The arrows earn their keep only in the category
 * view, where nothing else shows the wiring.
 */

import type { Component } from 'solid-js';
import { For, Show, Switch, Match } from 'solid-js';
import type { TopoNode, TopoRow } from '~/lib/topology';
import { groupTopoSiblings, subtreeHasProblem } from '~/lib/topology';
import { hasDeviceProblem } from '~/lib/types';
import {
  state,
  topologyForest,
  selectedId,
  setSelectedId,
  recentChanges,
  setHoveredId,
  isTopoToggled,
  toggleTopoNode,
  isFiltering,
  hasActiveFilters,
  groupIdentical,
  isGroupExpanded,
  toggleGroup,
  hideDevice,
} from '~/lib/device-store';
import { openDeviceProperties } from '~/lib/tauri';
import StatusBadge from './StatusBadge';
import DeviceIcon from './DeviceIcon';

/** Whether identical-sibling grouping applies (off while filtering, where the
 *  tree is forced open and grouped/dimmed-context rows would mislead). */
const groupingOn = () => groupIdentical() && !isFiltering();

const TopologyNode: Component<{ node: TopoNode; depth: number }> = props => {
  const device = () => props.node.device;
  const hasChildren = () => props.node.children.length > 0;
  // Default depth comes from startCollapsed (expanded down to the physical-plug
  // level); a user toggle flips it. Forced open while filtering so the matching
  // devices show — the forest is already pruned to matches plus their ancestors.
  const collapsed = () => !isFiltering() && props.node.startCollapsed !== isTopoToggled(device().instanceId);
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

        {/* Action buttons (visible on hover) — div, not button, so they don't
            nest inside the clickable row. Hiding is not the same as collapsing:
            the chevron folds this node's children away, hide drops the row from
            both views and persists. */}
        <div class="ml-auto shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Properties — also on double-click, but nothing advertises that */}
          <div
            role="button"
            class="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer"
            aria-label="Properties"
            onClick={e => {
              e.stopPropagation();
              openDeviceProperties(device().instanceId);
            }}
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </div>

          {/* Hide — the tree closes up around it; children reparent upward */}
          <div
            role="button"
            class="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer"
            aria-label="Hide this device"
            onClick={e => {
              e.stopPropagation();
              hideDevice(device().instanceId);
            }}
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </div>
        </div>
      </div>

      {/* Children — identical siblings collapse into group rows */}
      <Show when={hasChildren() && !collapsed()}>
        <TopoRows
          rows={groupTopoSiblings(props.node.children, device().instanceId, groupingOn())}
          depth={props.depth + 1}
        />
      </Show>
    </div>
  );
};

/**
 * A collapsed run of identically-named siblings. Expanded, each member renders
 * as a full TopologyNode (with its own subtree). Forced open while any member's
 * subtree has a problem, so a group never hides something that needs attention.
 */
const TopoGroup: Component<{ group: Extract<TopoRow, { kind: 'group' }>; depth: number }> = props => {
  const rep = () => props.group.nodes[0].device;
  const problemCount = () => props.group.nodes.filter(subtreeHasProblem).length;
  const expanded = () => problemCount() > 0 || isGroupExpanded(props.group.key);

  return (
    <div>
      <div
        class="group flex items-center gap-2 pr-2 py-1 border-l-4 border-l-transparent rounded-r-lg cursor-pointer transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
        style={{ 'padding-left': `${props.depth * 16 + 8}px` }}
        onClick={() => toggleGroup(props.group.key)}
      >
        {/* Expand/collapse chevron */}
        <div class="w-4 h-4 shrink-0 flex items-center justify-center text-gray-400 dark:text-gray-500">
          <svg
            class={`w-4 h-4 transition-transform duration-200 ${expanded() ? 'rotate-90' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>

        {/* Representative icon (all members share a name, and virtually always a class) */}
        <div data-role="icon" class="shrink-0 text-gray-600 dark:text-gray-400">
          <DeviceIcon iconId={rep().iconId || 'other'} classGuid={rep().classGuid} class="w-5 h-5" />
        </div>

        {/* Shared name */}
        <span class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{props.group.name}</span>

        {/* ×N member count */}
        <span class="shrink-0 inline-flex items-center h-5 px-1.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 tabular-nums">
          ×{props.group.nodes.length}
        </span>

        {/* Problem count badge */}
        <Show when={problemCount() > 0}>
          <span class="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
            {problemCount()}
          </span>
        </Show>
      </div>

      {/* Members, each with its own subtree */}
      <Show when={expanded()}>
        <For each={props.group.nodes}>{node => <TopologyNode node={node} depth={props.depth + 1} />}</For>
      </Show>
    </div>
  );
};

/** One sibling level: individual nodes interleaved with identical-run groups. */
const TopoRows: Component<{ rows: TopoRow[]; depth: number }> = props => (
  <For each={props.rows}>
    {row => (
      <Switch>
        <Match when={row.kind === 'node' ? row : null}>
          {r => <TopologyNode node={r().node} depth={props.depth} />}
        </Match>
        <Match when={row.kind === 'group' ? row : null}>{r => <TopoGroup group={r()} depth={props.depth} />}</Match>
      </Switch>
    )}
  </For>
);

const TopologyView: Component = () => {
  return (
    <div class="device-tree flex-1 overflow-y-auto py-2 pl-5 pr-6">
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
          <span class="text-sm">
            {hasActiveFilters() ? 'No devices match your search' : 'No USB or PCI devices found'}
          </span>
        </div>
      </Show>

      {/* Topology forest — root siblings group like any other level */}
      <TopoRows rows={groupTopoSiblings(topologyForest(), null, groupingOn())} depth={0} />
    </div>
  );
};

export default TopologyView;
