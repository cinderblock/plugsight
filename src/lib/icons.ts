/**
 * Maps device class GUIDs (lowercase) to icon identifiers.
 *
 * These IDs are used in the frontend to select which SVG icon to display
 * for each device category. The actual SVG rendering happens in DeviceIcon.tsx.
 */

export const CLASS_ICON_MAP: Record<string, string> = {
  '{4d36e968-e325-11ce-bfc1-08002be10318}': 'display',
  '{4d36e972-e325-11ce-bfc1-08002be10318}': 'network',
  '{36fc9e60-c465-11cf-8056-444553540000}': 'usb',
  '{4d36e96b-e325-11ce-bfc1-08002be10318}': 'keyboard',
  '{4d36e96f-e325-11ce-bfc1-08002be10318}': 'mouse',
  '{4d36e96c-e325-11ce-bfc1-08002be10318}': 'audio',
  '{4d36e967-e325-11ce-bfc1-08002be10318}': 'disk',
  '{4d36e96a-e325-11ce-bfc1-08002be10318}': 'storage-controller',
  '{71a27cdd-812a-11d0-bec7-08002be2092f}': 'volume',
  '{4d36e97b-e325-11ce-bfc1-08002be10318}': 'storage-controller',
  '{4d36e97d-e325-11ce-bfc1-08002be10318}': 'system',
  '{4d36e97e-e325-11ce-bfc1-08002be10318}': 'usb',
  '{745a17a0-74d3-11d0-b6fe-00a0c90f57da}': 'hid',
  '{50906cb8-ba12-11d1-bf5d-0000f805f530}': 'bluetooth',
  '{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}': 'bluetooth',
  '{4d36e965-e325-11ce-bfc1-08002be10318}': 'optical',
  '{6bdd1fc1-810f-11d0-bec7-08002be2092f}': 'firewire',
  '{4d36e978-e325-11ce-bfc1-08002be10318}': 'port',
  '{4d36e971-e325-11ce-bfc1-08002be10318}': 'monitor',
  '{4d36e979-e325-11ce-bfc1-08002be10318}': 'printer',
  '{4d36e97c-e325-11ce-bfc1-08002be10318}': 'processor',
  '{c166523c-fe0c-4a94-a586-f1a80cfbbf3e}': 'battery',
  '{ca3e7ab9-b4c3-4ae6-8251-579ef933890f}': 'camera',
  '{48d3ebc4-4cf8-48ff-b869-9c68ad42eb9f}': 'software',
  '{5c4c3332-344d-483c-8739-259e934c9cc8}': 'firmware',
  '{8ecc055d-047f-11d1-a537-0000f8753ed1}': 'legacy',
  '{4d36e964-e325-11ce-bfc1-08002be10318}': 'media',
  '{62f9c741-b25a-46ce-b54c-9bccce08b6f2}': 'security',
  '{533c5b84-ec70-11d2-9505-00c04f79deaf}': 'storage-controller',
  '{88bae032-5a81-49f0-bc3d-a4ff138216d6}': 'sensor',
  '{7ebefbc0-3200-11d2-b4c2-00a0c9697d07}': 'imaging',
};

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
