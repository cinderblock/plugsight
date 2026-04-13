/**
 * Update checker — polls GitHub Releases for newer versions.
 *
 * Compares the current app version (from Tauri) against the latest GitHub release tag.
 * Exposes reactive signals that the StatusBar component uses to show an update badge.
 */

import { createSignal, onCleanup, onMount } from 'solid-js';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-shell';

// ── Configuration ─────────────────────────────────────────────────────────

/**
 * GitHub owner/repo for release checking.
 * Update this when the repo is created.
 */
const GITHUB_OWNER = 'camero2734';
const GITHUB_REPO = 'device-manager';

/** How often to check for updates (ms). Default: 30 minutes. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** GitHub Releases API endpoint. */
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// ── Signals ───────────────────────────────────────────────────────────────

const [currentVersion, setCurrentVersion] = createSignal<string>('');
const [latestVersion, setLatestVersion] = createSignal<string | null>(null);
const [releaseUrl, setReleaseUrl] = createSignal<string | null>(null);
const [updateAvailable, setUpdateAvailable] = createSignal(false);
const [checking, setChecking] = createSignal(false);

// ── Version comparison ────────────────────────────────────────────────────

/**
 * Simple semver comparison. Returns true if `latest` is newer than `current`.
 * Handles versions with or without a leading "v".
 */
function isNewer(current: string, latest: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map(n => parseInt(n, 10) || 0);

  const cur = parse(current);
  const lat = parse(latest);

  for (let i = 0; i < Math.max(cur.length, lat.length); i++) {
    const c = cur[i] ?? 0;
    const l = lat[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }

  return false;
}

// ── Update check ──────────────────────────────────────────────────────────

async function checkForUpdates() {
  if (checking()) return;
  setChecking(true);

  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });

    if (!response.ok) {
      // 404 means no releases yet, or repo doesn't exist — not an error.
      return;
    }

    const release = await response.json();
    const tagName: string = release.tag_name ?? '';
    const htmlUrl: string = release.html_url ?? '';

    if (tagName) {
      setLatestVersion(tagName);
      setReleaseUrl(htmlUrl);

      const current = currentVersion();
      if (current && isNewer(current, tagName)) {
        setUpdateAvailable(true);
      } else {
        setUpdateAvailable(false);
      }
    }
  } catch {
    // Network errors are silently ignored — update checking is best-effort.
  } finally {
    setChecking(false);
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
      // Fallback if getVersion() fails (e.g. in dev mode without Tauri context).
      setCurrentVersion('0.1.0');
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
  releaseUrl,
  openReleasePage,
  checkForUpdates,
};
