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
import { hasDeviceProblem, worseStatus } from '~/lib/types';
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
import LinkBadge from './LinkBadge';

/** Whether identical-sibling grouping applies (off while filtering, where the
 *  tree is forced open and grouped/dimmed-context rows would mislead). */
const groupingOn = () => groupIdentical() && !isFiltering();

/* ── Parent→child tree lines ─────────────────────────────────────────────
 *
 * Drawn, not assembled from CSS boxes. Each row carries one small SVG that
 * covers its own height and the indent to its left, and draws every line that
 * crosses it:
 *
 * - a *rail* for each ancestor trunk passing straight through (an ancestor
 *   branch whose next sibling is still further down);
 * - the *elbow* curving in from its parent's trunk toward its chevron, plus
 *   that trunk's run on below it unless this is the last sibling;
 * - the *stub* dropping from under its own chevron while its children show.
 *
 * Rows abut, so a trunk is a stack of per-row segments at one x. Every x is
 * computed in a single frame, the row's border box. The CSS version this
 * replaced placed pieces inside a row from its padding box but trunk strips
 * from the children container's border box — 4px apart, the width of the
 * row's accent border — so each trunk jogged sideways at every hand-off.
 *
 * Nothing is measured: the lines follow collapse and filtering because the
 * rows they belong to do. They sit outside the row's own opacity, so a trunk
 * doesn't fade and brighten as it passes dimmed context rows.
 */

/** Per-level indent in px; must match the row padding formula in the class. */
const INDENT = 16;
/** Number of muted hues in the palette (`--tree-line-0..N-1` in app.css). */
const LINE_HUES = 5;
/** Radius of the curve from a trunk into a child row. */
const ELBOW_R = 8;
/** Straight run past the curve toward the child's chevron. */
const ELBOW_TAIL = 4;
/** Gap between an expanded chevron's tip and the stub starting below it. */
const STUB_GAP = 5;
/**
 * How far each row's drawing reaches into its neighbours. Stacked segments
 * overlap by this much instead of meeting edge to edge, where anti-aliasing
 * at the shared boundary could leave a faint seam. The colours are opaque, so
 * the overlap itself never shows.
 */
const BLEED = 1;
/** Far enough past a row's edge that the row's own clip decides where a
 *  vertical run ends. */
const FAR = 1000;

/** How a child row hangs off its parent's line set. */
interface Branch {
  /** Palette index shared by every line from this parent. */
  hue: number;
  /** Last sibling: the trunk stops at this row's elbow instead of running on. */
  last: boolean;
}

/** An ancestor's trunk as seen by the rows below it. */
interface Rail {
  /** Depth of the ancestor that owns the trunk. */
  level: number;
  hue: number;
  /** Whether the trunk passes through these rows on its way to a later sibling. */
  through: boolean;
}

/** x (border-box px) of the trunk owned by a parent at `level`: its chevron's
 *  centre — 4px accent border + (16·level + 8) padding + half the 16px chevron. */
const railX = (level: number) => INDENT * level + 20;

/** Root-level parents draw thickest; each level down is thinner, to 1px. */
const lineWidth = (level: number) => Math.max(1, 3 - level);

/** Odd widths centred on a pixel centre, even widths on a pixel edge, so every
 *  line covers whole device pixels instead of smearing across two. */
const crisp = (width: number) => (width % 2 === 1 ? 0.5 : 0);

/** Hue for a node's own line set: cycles by sibling position, skipping the hue
 *  of the trunk it hangs from so nested trunks and adjacent siblings differ. */
const ownHue = (index: number, parentHue: number | undefined) => {
  if (parentHue === undefined) return index % LINE_HUES;
  const h = index % (LINE_HUES - 1);
  return h >= parentHue ? h + 1 : h;
};

/** The rails a node's children see: everything the node sees, plus the trunk
 *  the node itself hangs from, which runs on past its subtree unless the node
 *  is the last of its siblings. */
const railsBelow = (rails: Rail[], depth: number, branch: Branch | undefined): Rail[] =>
  branch ? [...rails, { level: depth - 1, hue: branch.hue, through: !branch.last }] : rails;

interface Segment {
  d: string;
  hue: number;
  width: number;
}

/**
 * Every tree line crossing one row, drawn in a coordinate system whose origin
 * is the row's left edge and vertical midline. The outer SVG clips to the row
 * (plus {@link BLEED}), so vertical runs are drawn long and cut to fit.
 */
const TreeLines: Component<{ depth: number; rails: Rail[]; branch?: Branch; hue: number; open: boolean }> = props => {
  const segments = (): Segment[] => {
    const out: Segment[] = [];

    for (const rail of props.rails) {
      if (!rail.through) continue;
      const width = lineWidth(rail.level);
      const x = railX(rail.level) + crisp(width);
      out.push({ d: `M${x} ${-FAR}V${FAR}`, hue: rail.hue, width });
    }

    const branch = props.branch;
    if (branch) {
      const level = props.depth - 1;
      const width = lineWidth(level);
      const c = crisp(width);
      const x = railX(level) + c;
      // Down the trunk, then a quarter turn into the row's midline.
      out.push({
        d: `M${x} ${-FAR}V${c - ELBOW_R}A${ELBOW_R} ${ELBOW_R} 0 0 0 ${x + ELBOW_R} ${c}H${x + ELBOW_R + ELBOW_TAIL}`,
        hue: branch.hue,
        width,
      });
      // The trunk carries on to the next sibling from where the curve left it.
      if (!branch.last) out.push({ d: `M${x} ${c - ELBOW_R}V${FAR}`, hue: branch.hue, width });
    }

    if (props.open) {
      const width = lineWidth(props.depth);
      const x = railX(props.depth) + crisp(width);
      out.push({ d: `M${x} ${STUB_GAP}V${FAR}`, hue: props.hue, width });
    }

    return out;
  };

  return (
    <svg
      aria-hidden="true"
      class="pointer-events-none absolute left-0 overflow-hidden"
      style={{
        top: `${-BLEED}px`,
        height: `calc(100% + ${2 * BLEED}px)`,
        width: `${railX(props.depth) + INDENT}px`,
      }}
    >
      {/* Origin on the row's midline: the curves are laid out from it. */}
      <svg y="50%" overflow="visible">
        <For each={segments()}>
          {seg => (
            <path
              d={seg.d}
              fill="none"
              style={{ stroke: `var(--tree-line-${seg.hue})`, 'stroke-width': `${seg.width}px` }}
            />
          )}
        </For>
      </svg>
    </svg>
  );
};

const TopologyNode: Component<{
  node: TopoNode;
  depth: number;
  branch?: Branch;
  hue: number;
  rails: Rail[];
}> = props => {
  const device = () => props.node.device;
  const hasChildren = () => props.node.children.length > 0;
  // Default depth comes from startCollapsed (expanded down to the physical-plug
  // level); a user toggle flips it. Forced open while filtering so the matching
  // devices show — the forest is already pruned to matches plus their ancestors.
  const collapsed = () => !isFiltering() && props.node.startCollapsed !== isTopoToggled(device().instanceId);
  /** The USB 2 half folded into this row, when it's a USB 3 hub Windows lists twice. */
  const twin = () => props.node.twin;
  /** The row stands for both halves, so it shows whichever status is worse. */
  const status = () => worseStatus(device().status, twin()?.status);
  const isSelected = () => {
    const id = selectedId();
    return id !== null && (id === device().instanceId || id === twin()?.instanceId);
  };
  const isRecentChange = () =>
    recentChanges().has(device().instanceId) || (twin() !== undefined && recentChanges().has(twin()!.instanceId));
  const hasProblem = () => hasDeviceProblem(status());
  /** Both halves' link chips: the USB 3 side first, then the USB 2 side. */
  const links = () => [...device().links, ...(twin()?.links ?? [])];

  /** Colored left accent only when there's a problem; transparent otherwise. */
  const borderClass = () => {
    switch (status().kind) {
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

  const open = () => hasChildren() && !collapsed();

  return (
    <div>
      <div class="relative">
        <div
          class={`group relative flex items-center gap-2 pr-2 py-1 border-l-4 rounded-r-lg cursor-pointer transition-all duration-200
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
          {/* The name gives up width before the chips do, but never below a few
            characters: a deep row with the detail pane open has little room,
            and a row with chips but no name says nothing. */}
          <span class="min-w-[5rem] shrink-[4] text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {device().name}
          </span>

          <StatusBadge status={status()} compact />

          {/* Child count */}
          <Show when={hasChildren()}>
            <span class="shrink-0 inline-flex items-center h-5 px-1.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 tabular-nums">
              {props.node.children.length}
            </span>
          </Show>

          {/* Upstream link speed — this is the view where a slow link's place in
            the chain is visible, so the chip sits right on the row. A folded
            USB 3 hub shows both sides: "5 Gbps" and "480 Mbps". */}
          <span class="flex min-w-0 items-center gap-1 overflow-hidden">
            <LinkBadge links={links()} />
          </span>

          {/* Action buttons (visible on hover) — div, not button, so they don't
            nest inside the clickable row. Hiding is not the same as collapsing:
            the chevron folds this node's children away, hide drops the row from
            both views and persists. */}
          {/* Floats over the row's right edge on hover instead of reserving its
            width while invisible, which starved deep rows of room for the name. */}
          <div class="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-md bg-gray-100/95 shadow-sm opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 dark:bg-gray-800/95">
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

            {/* Hide — the tree closes up around it; children reparent upward.
              A folded hub row hides both halves, or the other would pop back
              up as a row of its own. */}
            <div
              role="button"
              class="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer"
              aria-label="Hide this device"
              onClick={e => {
                e.stopPropagation();
                hideDevice(device().instanceId);
                const other = twin();
                if (other) hideDevice(other.instanceId);
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
        {/* After the row so the lines paint over its hover/selected background. */}
        <TreeLines depth={props.depth} rails={props.rails} branch={props.branch} hue={props.hue} open={open()} />
      </div>

      {/* Children — identical siblings collapse into group rows. */}
      <Show when={open()}>
        <TopoRows
          rows={groupTopoSiblings(props.node.children, device().instanceId, groupingOn())}
          depth={props.depth + 1}
          parentHue={props.hue}
          rails={railsBelow(props.rails, props.depth, props.branch)}
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
const TopoGroup: Component<{
  group: Extract<TopoRow, { kind: 'group' }>;
  depth: number;
  branch?: Branch;
  hue: number;
  rails: Rail[];
}> = props => {
  const rep = () => props.group.nodes[0].device;
  const problemCount = () => props.group.nodes.filter(subtreeHasProblem).length;
  const expanded = () => problemCount() > 0 || isGroupExpanded(props.group.key);

  return (
    <div>
      <div class="relative">
        <div
          class="group relative flex items-center gap-2 pr-2 py-1 border-l-4 border-l-transparent rounded-r-lg cursor-pointer transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
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
        {/* A group row hangs off its parent like any sibling, and its members hang off it. */}
        <TreeLines depth={props.depth} rails={props.rails} branch={props.branch} hue={props.hue} open={expanded()} />
      </div>

      {/* Members, each with its own subtree */}
      <Show when={expanded()}>
        <For each={props.group.nodes}>
          {(node, i) => (
            <TopologyNode
              node={node}
              depth={props.depth + 1}
              branch={{ hue: props.hue, last: i() === props.group.nodes.length - 1 }}
              hue={ownHue(i(), props.hue)}
              rails={railsBelow(props.rails, props.depth, props.branch)}
            />
          )}
        </For>
      </Show>
    </div>
  );
};

/** One sibling level: individual nodes interleaved with identical-run groups.
 *  `parentHue` is the colour of the trunk these rows hang from (absent at the
 *  root, where there is no trunk); `rails` are the ancestor trunks above that. */
const TopoRows: Component<{ rows: TopoRow[]; depth: number; parentHue?: number; rails: Rail[] }> = props => {
  const branchFor = (i: number): Branch | undefined =>
    props.parentHue === undefined ? undefined : { hue: props.parentHue, last: i === props.rows.length - 1 };
  return (
    <For each={props.rows}>
      {(row, i) => (
        <Switch>
          <Match when={row.kind === 'node' ? row : null}>
            {r => (
              <TopologyNode
                node={r().node}
                depth={props.depth}
                branch={branchFor(i())}
                hue={ownHue(i(), props.parentHue)}
                rails={props.rails}
              />
            )}
          </Match>
          <Match when={row.kind === 'group' ? row : null}>
            {r => (
              <TopoGroup
                group={r()}
                depth={props.depth}
                branch={branchFor(i())}
                hue={ownHue(i(), props.parentHue)}
                rails={props.rails}
              />
            )}
          </Match>
        </Switch>
      )}
    </For>
  );
};

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
      <TopoRows rows={groupTopoSiblings(topologyForest(), null, groupingOn())} depth={0} rails={[]} />
    </div>
  );
};

export default TopologyView;
