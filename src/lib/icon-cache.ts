/**
 * Icon cache — loads and caches real Windows device class icons.
 *
 * Fetches icons from the Rust backend (which extracts them via SetupAPI)
 * and stores them as base64 data URLs in a reactive signal. Components
 * read from this cache to display real system icons with an SVG fallback.
 */

import { createSignal } from 'solid-js';
import { getClassIcons } from './tauri';

// ── State ────────────────────────────────────────────────────────────────

const [iconMap, setIconMap] = createSignal<Record<string, string>>({});

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Load icons for the given class GUIDs. Only fetches GUIDs not already cached.
 * Call this after initial device enumeration completes.
 */
export async function loadClassIcons(classGuids: string[]): Promise<void> {
  const current = iconMap();
  const needed = classGuids.filter(guid => !(guid in current));
  if (needed.length === 0) return;

  try {
    const icons = await getClassIcons(needed);
    setIconMap(prev => ({ ...prev, ...icons }));
  } catch (e) {
    console.warn('Failed to load class icons:', e);
  }
}

/**
 * Get the data URL for a class GUID's icon.
 * Returns undefined if the icon hasn't been loaded or extraction failed.
 */
export function getClassIconUrl(classGuid: string): string | undefined {
  const url = iconMap()[classGuid];
  // Empty string means extraction failed — treat as unavailable.
  return url || undefined;
}
