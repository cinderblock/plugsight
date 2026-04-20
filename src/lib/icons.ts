/**
 * Icon registry for the device tree.
 *
 * Each `DeviceInfo` arrives from the backend with its `iconId` already resolved
 * from the class GUID via `class_meta::lookup_class`. The registry below just
 * lists every icon ID we know how to render — it's the source of truth for
 * which `<DeviceIcon name="...">` strings have a corresponding SVG.
 */

/** All known icon IDs for which we have SVG definitions. */
export const ALL_ICON_IDS = [
  'display',
  'network',
  'usb',
  'keyboard',
  'mouse',
  'audio',
  'disk',
  'storage-controller',
  'volume',
  'system',
  'hid',
  'bluetooth',
  'optical',
  'firewire',
  'port',
  'monitor',
  'printer',
  'processor',
  'battery',
  'camera',
  'software',
  'firmware',
  'legacy',
  'media',
  'security',
  'sensor',
  'imaging',
  'other',
] as const;

export type IconId = (typeof ALL_ICON_IDS)[number];
