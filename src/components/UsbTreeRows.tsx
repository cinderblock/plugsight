/**
 * UsbTreeRows — recursive renderer for the USB category's physical-nesting mode.
 *
 * Renders the `UsbRow` forest from `usb-tree.ts`: each device is a normal
 * DeviceEntry (with an expand/collapse chevron when it has connected children),
 * children sit in the same indented drawer style as everywhere else, and runs
 * of identical childless siblings reuse DeviceGroup. Node collapse state is
 * shared with the Connections topology view (both keyed by instanceId), and
 * drawers are forced open while a search or the problems filter is active so
 * matches are never hidden behind a collapsed hub.
 */

import type { Component } from 'solid-js';
import { Index, Show, Switch, Match } from 'solid-js';
import type { UsbRow } from '~/lib/usb-tree';
import { anyVisible } from '~/lib/usb-tree';
import { isTopoToggled, toggleTopoNode, searchQuery, showProblemsOnly } from '~/lib/device-store';
import DeviceEntry from './DeviceEntry';
import DeviceGroup from './DeviceGroup';

type NodeRow = Extract<UsbRow, { kind: 'node' }>;
type GroupRow = Extract<UsbRow, { kind: 'group' }>;

const UsbNodeRow: Component<{ row: NodeRow }> = props => {
  const hasChildren = () => props.row.children.length > 0;
  const instanceId = () => props.row.device.device.instanceId;
  const forceOpen = () => searchQuery() !== '' || showProblemsOnly();
  const collapsed = () => hasChildren() && !forceOpen() && props.row.startCollapsed !== isTopoToggled(instanceId());

  // Keep a hub/controller row visible while any of its subtree passes the
  // filters, so the physical chain down to a matching device stays intact.
  const display = () => {
    const d = props.row.device;
    if (d.visible || !hasChildren() || !anyVisible(props.row.subtree)) return d;
    return { ...d, visible: true };
  };

  /** Directly connected devices (group rows count each member). */
  const connectedCount = () => props.row.children.reduce((n, c) => n + (c.kind === 'group' ? c.devices.length : 1), 0);

  return (
    <div>
      <DeviceEntry
        displayDevice={display()}
        detail={hasChildren() ? `${connectedCount()} connected` : undefined}
        onToggleChildren={hasChildren() ? () => toggleTopoNode(instanceId()) : undefined}
        childrenCollapsed={collapsed()}
      />

      {/* Children drawer — same indent + grid-rows animation as categories/groups. */}
      <Show when={hasChildren()}>
        <div
          class="ml-4 pl-2 border-l border-gray-200 dark:border-gray-700/50 grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ 'grid-template-rows': collapsed() ? '0fr' : '1fr' }}
        >
          <div class="overflow-hidden">
            <UsbTreeRows rows={props.row.children} />
          </div>
        </div>
      </Show>
    </div>
  );
};

const UsbTreeRows: Component<{ rows: UsbRow[] }> = props => (
  <Index each={props.rows}>
    {row => (
      <Switch>
        <Match when={row().kind === 'node' ? (row() as NodeRow) : null}>{node => <UsbNodeRow row={node()} />}</Match>
        <Match when={row().kind === 'group' ? (row() as GroupRow) : null}>
          {group => (
            <DeviceGroup
              groupKey={group().key}
              name={group().name}
              isGhost={group().isGhost}
              devices={group().devices}
            />
          )}
        </Match>
      </Switch>
    )}
  </Index>
);

export default UsbTreeRows;
