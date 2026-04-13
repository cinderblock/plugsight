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

// ── Version parsing and comparison ────────────────────────────────────────

/**
 * Parsed representation of a version string.
 *
 * Handles real-world version formats:
 *   "0.2.0"                → { major:0, minor:2, patch:0, pre:null,    meta:null }
 *   "v1.3.0-rc.1"          → { major:1, minor:3, patch:0, pre:"rc.1", meta:null }
 *   "0.1.0-3-gabcdef"      → { major:0, minor:1, patch:0, pre:"3-gabcdef", meta:null }
 *   "0.1.0+dirty"          → { major:0, minor:1, patch:0, pre:null,    meta:"dirty" }
 *   "0.1.0-beta.2+sha.abc" → { major:0, minor:1, patch:0, pre:"beta.2", meta:"sha.abc" }
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
  // We need to be careful: "1.2.3-rc.1" has pre="rc.1", but we want to split only
  // after the MAJOR.MINOR.PATCH portion.
  let pre: string | null = null;
  const match = s.match(/^(\d+(?:\.\d+)*)(-.+)?$/);
  let numericPart: string;
  if (match) {
    numericPart = match[1];
    if (match[2]) {
      pre = match[2].slice(1); // remove the leading "-"
    }
  } else {
    // Couldn't parse — treat the whole thing as 0.0.0 with a pre-release tag.
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
  // Both clean releases → equal.
  if (a === null && b === null) return 0;
  // Clean release beats any pre-release.
  if (a === null) return 1;
  if (b === null) return -1;

  const aParts = a.split('.');
  const bParts = b.split('.');

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    // Fewer fields = lower precedence.
    if (i >= aParts.length) return -1;
    if (i >= bParts.length) return 1;

    const aNum = /^\d+$/.test(aParts[i]) ? parseInt(aParts[i], 10) : null;
    const bNum = /^\d+$/.test(bParts[i]) ? parseInt(bParts[i], 10) : null;

    // Both numeric → compare as integers.
    if (aNum !== null && bNum !== null) {
      if (aNum !== bNum) return aNum - bNum;
      continue;
    }
    // Numeric < string.
    if (aNum !== null) return -1;
    if (bNum !== null) return 1;
    // Both strings → lexical.
    const cmp = aParts[i].localeCompare(bParts[i]);
    if (cmp !== 0) return cmp;
  }

  return 0;
}

/**
 * Returns true if `latest` is a newer release than `current`.
 *
 * Follows semver 2.0.0 precedence rules:
 *   - Compare MAJOR.MINOR.PATCH numerically.
 *   - If those are equal, a version *without* a pre-release tag is newer
 *     than one *with* a pre-release tag (e.g. "1.0.0" > "1.0.0-rc.1").
 *   - Build metadata ("+dirty", "+sha.abc") is ignored entirely.
 *
 * This correctly handles dirty builds, git-describe tags, rc/beta/alpha
 * pre-releases, and any other suffixes.
 */
function isNewer(current: string, latest: string): boolean {
  const cur = parseVersion(current);
  const lat = parseVersion(latest);

  // Compare major.minor.patch.
  if (lat.major !== cur.major) return lat.major > cur.major;
  if (lat.minor !== cur.minor) return lat.minor > cur.minor;
  if (lat.patch !== cur.patch) return lat.patch > cur.patch;

  // Same numeric version — compare pre-release.
  return comparePre(lat.pre, cur.pre) > 0;
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
