/**
 * Update system — uses Tauri's native updater for in-app updates, with a
 * GitHub Releases API fallback for portable/uninstalled builds.
 *
 * Installed builds (NSIS/MSI):
 *   Uses @tauri-apps/plugin-updater to download and apply updates seamlessly.
 *   The update bundle is signature-verified against the pubkey in tauri.conf.json.
 *
 * Portable builds:
 *   Falls back to polling the GitHub Releases API. Shows a notification badge
 *   that opens the release page in the browser for manual download.
 *
 * ETag caching is used for GitHub API requests to avoid rate-limit consumption
 * when the release hasn't changed (304 Not Modified doesn't count against quota).
 */

import { createSignal, onCleanup, onMount } from 'solid-js';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { open } from '@tauri-apps/plugin-shell';

// ── Configuration ─────────────────────────────────────────────────────────

/** GitHub owner/repo for release checking (fallback path). */
const GITHUB_OWNER = 'cinderblock';
const GITHUB_REPO = 'device-manager';

/** How often to check for updates (ms). Default: 30 minutes. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** GitHub Releases API endpoint (fallback). */
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// ── Signals ───────────────────────────────────────────────────────────────

const [currentVersion, setCurrentVersion] = createSignal<string>('');
const [latestVersion, setLatestVersion] = createSignal<string | null>(null);
const [releaseUrl, setReleaseUrl] = createSignal<string | null>(null);
const [updateAvailable, setUpdateAvailable] = createSignal(false);
const [checking, setChecking] = createSignal(false);

/** Whether an in-app update is possible (vs. needing to open the browser). */
const [canAutoUpdate, setCanAutoUpdate] = createSignal(false);

/** Progress state for download+install. */
const [updateProgress, setUpdateProgress] = createSignal<{
  phase: 'downloading' | 'installing' | 'done';
  /** Download progress 0–100, or null if unknown. */
  percent: number | null;
} | null>(null);

// ── ETag cache for GitHub API ─────────────────────────────────────────────

let cachedEtag: string | null = null;
let cachedRelease: { tag_name: string; html_url: string } | null = null;

// ── Pending update handle ─────────────────────────────────────────────────

let pendingUpdate: Update | null = null;

// ── Version parsing and comparison ────────────────────────────────────────

/**
 * Parsed representation of a version string.
 *
 * Handles real-world version formats:
 *   "0.2.0"                -> { major:0, minor:2, patch:0, pre:null,    meta:null }
 *   "v1.3.0-rc.1"          -> { major:1, minor:3, patch:0, pre:"rc.1", meta:null }
 *   "0.1.0-3-gabcdef"      -> { major:0, minor:1, patch:0, pre:"3-gabcdef", meta:null }
 *   "0.1.0+dirty"          -> { major:0, minor:1, patch:0, pre:null,    meta:"dirty" }
 *   "0.1.0-beta.2+sha.abc" -> { major:0, minor:1, patch:0, pre:"beta.2", meta:"sha.abc" }
 */
interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release segment (after "-", before "+"). Null if this is a clean release. */
  pre: string | null;
  /** Build metadata (after "+"). Ignored in comparisons per semver spec. */
  meta: string | null;
}

/**
 * Parse a version string into its components.
 * Tolerates a leading "v", missing segments, and non-standard suffixes.
 */
function parseVersion(raw: string): ParsedVersion {
  // Strip leading "v" or "V".
  let s = raw.replace(/^[vV]/, '');

  // Split off build metadata (everything after "+").
  let meta: string | null = null;
  const plusIdx = s.indexOf('+');
  if (plusIdx !== -1) {
    meta = s.slice(plusIdx + 1) || null;
    s = s.slice(0, plusIdx);
  }

  // Split off pre-release (everything after the first "-" that follows the numeric part).
  let pre: string | null = null;
  const match = s.match(/^(\d+(?:\.\d+)*)(-.+)?$/);
  let numericPart: string;
  if (match) {
    numericPart = match[1];
    if (match[2]) {
      pre = match[2].slice(1); // remove the leading "-"
    }
  } else {
    numericPart = '0.0.0';
    pre = s || null;
  }

  const parts = numericPart.split('.').map(n => parseInt(n, 10) || 0);
  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
    pre,
    meta,
  };
}

/**
 * Compare pre-release strings per semver 2.0.0 rules:
 *   - No pre-release (null) > any pre-release (a clean release is newer).
 *   - Otherwise compare dot-separated identifiers left-to-right:
 *     numeric identifiers compared as integers, string identifiers lexically.
 *   - Fewer identifiers < more identifiers when all preceding are equal.
 *
 * Returns: negative if a < b, zero if a == b, positive if a > b.
 */
function comparePre(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const aParts = a.split('.');
  const bParts = b.split('.');

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    if (i >= aParts.length) return -1;
    if (i >= bParts.length) return 1;

    const aNum = /^\d+$/.test(aParts[i]) ? parseInt(aParts[i], 10) : null;
    const bNum = /^\d+$/.test(bParts[i]) ? parseInt(bParts[i], 10) : null;

    if (aNum !== null && bNum !== null) {
      if (aNum !== bNum) return aNum - bNum;
      continue;
    }
    if (aNum !== null) return -1;
    if (bNum !== null) return 1;
    const cmp = aParts[i].localeCompare(bParts[i]);
    if (cmp !== 0) return cmp;
  }

  return 0;
}

/**
 * Returns true if `latest` is a newer release than `current`.
 * Follows semver 2.0.0 precedence rules.
 */
function isNewer(current: string, latest: string): boolean {
  const cur = parseVersion(current);
  const lat = parseVersion(latest);

  if (lat.major !== cur.major) return lat.major > cur.major;
  if (lat.minor !== cur.minor) return lat.minor > cur.minor;
  if (lat.patch !== cur.patch) return lat.patch > cur.patch;

  return comparePre(lat.pre, cur.pre) > 0;
}

// ── Tauri native updater (primary path) ───────────────────────────────────

/**
 * Try the Tauri plugin updater first. This works for installed builds
 * (NSIS/MSI) where the updater can download and apply a signed update.
 *
 * Returns true if the native updater found an update (or handled the check).
 * Returns false if the plugin isn't available (portable build, dev mode, etc.).
 */
async function tryNativeUpdater(): Promise<boolean> {
  try {
    const update = await check();
    if (update) {
      pendingUpdate = update;
      setLatestVersion(update.version);
      setUpdateAvailable(true);
      setCanAutoUpdate(true);
      // Try to get the release URL for display purposes.
      setReleaseUrl(
        `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/v${update.version}`,
      );
      return true;
    }
    // Plugin worked but no update available.
    setUpdateAvailable(false);
    return true;
  } catch {
    // Plugin not available or endpoint unreachable — fall through to GitHub API.
    return false;
  }
}

// ── GitHub API fallback (for portable builds) ─────────────────────────────

/**
 * Poll GitHub Releases API with ETag caching to check for newer versions.
 * Used when the native Tauri updater isn't available.
 */
async function checkViaGitHub() {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };
    if (cachedEtag) {
      headers['If-None-Match'] = cachedEtag;
    }

    const response = await fetch(RELEASES_API, { headers });

    // 304 Not Modified — cached data is still valid.
    if (response.status === 304 && cachedRelease) {
      applyGitHubRelease(cachedRelease);
      return;
    }

    if (!response.ok) {
      // 404 = no releases yet, other errors = transient. Either way, ignore.
      return;
    }

    // Cache the ETag for next request.
    const etag = response.headers.get('ETag');
    if (etag) {
      cachedEtag = etag;
    }

    const release = await response.json();
    const tagName: string = release.tag_name ?? '';
    const htmlUrl: string = release.html_url ?? '';

    if (tagName) {
      cachedRelease = { tag_name: tagName, html_url: htmlUrl };
      applyGitHubRelease(cachedRelease);
    }
  } catch {
    // Network errors are silently ignored — update checking is best-effort.
  }
}

function applyGitHubRelease(release: { tag_name: string; html_url: string }) {
  setLatestVersion(release.tag_name);
  setReleaseUrl(release.html_url);
  setCanAutoUpdate(false);

  const current = currentVersion();
  if (current && isNewer(current, release.tag_name)) {
    setUpdateAvailable(true);
  } else {
    setUpdateAvailable(false);
  }
}

// ── Unified check ─────────────────────────────────────────────────────────

async function checkForUpdates() {
  if (checking()) return;
  setChecking(true);

  try {
    const handled = await tryNativeUpdater();
    if (!handled) {
      await checkViaGitHub();
    }
  } finally {
    setChecking(false);
  }
}

// ── Update actions ────────────────────────────────────────────────────────

/**
 * Install the pending update and restart the app.
 * Only works when canAutoUpdate() is true (installed builds).
 */
async function installUpdate() {
  if (!pendingUpdate) return;

  try {
    let totalBytes = 0;
    let downloadedBytes = 0;

    setUpdateProgress({ phase: 'downloading', percent: 0 });

    await pendingUpdate.downloadAndInstall(event => {
      switch (event.event) {
        case 'Started':
          totalBytes = event.data.contentLength ?? 0;
          break;
        case 'Progress':
          downloadedBytes += event.data.chunkLength;
          setUpdateProgress({
            phase: 'downloading',
            percent: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : null,
          });
          break;
        case 'Finished':
          setUpdateProgress({ phase: 'installing', percent: null });
          break;
      }
    });

    setUpdateProgress({ phase: 'done', percent: 100 });

    // Brief delay so the user sees "done" before the app restarts.
    await new Promise(resolve => setTimeout(resolve, 500));
    await relaunch();
  } catch (err) {
    console.error('Update install failed:', err);
    setUpdateProgress(null);
    // Fall back to opening the release page.
    openReleasePage();
  }
}

/** Open the GitHub release page in the user's default browser. */
async function openReleasePage() {
  const url = releaseUrl();
  if (url) {
    await open(url);
  }
}

// ── Initialization ────────────────────────────────────────────────────────

/** Call once from the root component to start version checking. */
function initUpdater() {
  onMount(async () => {
    try {
      const version = await getVersion();
      setCurrentVersion(version);
    } catch {
      // Dev mode fallback — read from Vite env if available, else hardcode.
      setCurrentVersion('0.0.0-dev');
    }

    // Initial check (delayed slightly so the UI loads first).
    setTimeout(checkForUpdates, 3000);
  });

  // Periodic checks.
  const timer = setInterval(checkForUpdates, CHECK_INTERVAL_MS);
  onCleanup(() => clearInterval(timer));
}

// ── Exports ───────────────────────────────────────────────────────────────

export {
  initUpdater,
  currentVersion,
  latestVersion,
  updateAvailable,
  canAutoUpdate,
  updateProgress,
  releaseUrl,
  openReleasePage,
  installUpdate,
  checkForUpdates,
};
