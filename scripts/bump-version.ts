#!/usr/bin/env bun
/**
 * bump-version — keep version strings in sync across the project.
 *
 * Updates version in:
 *   1. package.json            ("version" field)
 *   2. src-tauri/Cargo.toml    (package version)
 *   3. src-tauri/tauri.conf.json ("version" field)
 *
 * Usage:
 *   bun run version:bump 0.2.0          # set explicit version
 *   bun run version:bump patch          # 0.1.0 → 0.1.1
 *   bun run version:bump minor          # 0.1.0 → 0.2.0
 *   bun run version:bump major          # 0.1.0 → 1.0.0
 *   bun run version:bump prerelease rc  # 0.1.0 → 0.1.1-rc.0, or 0.1.1-rc.0 → 0.1.1-rc.1
 *
 * Options:
 *   --tag     Also commit the bump as "Release v0.2.0" and tag that commit
 *             (v0.2.0). Pushing is left to you: the tag push starts the
 *             release workflow.
 *   --dry-run Show what would change without writing files
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';

// ── Paths ────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGE_JSON = resolve(ROOT, 'package.json');
const CARGO_TOML = resolve(ROOT, 'src-tauri', 'Cargo.toml');
const TAURI_CONF = resolve(ROOT, 'src-tauri', 'tauri.conf.json');
const CARGO_LOCK = resolve(ROOT, 'src-tauri', 'Cargo.lock');

/** Everything a release commit changes. */
const RELEASE_FILES = [PACKAGE_JSON, CARGO_TOML, TAURI_CONF, CARGO_LOCK];

function git(...gitArgs: string[]): string {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf-8' }).trim();
}

// ── Parse CLI args ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));

const dryRun = flags.has('--dry-run');
const createTag = flags.has('--tag');

if (positional.length === 0) {
  console.error('Usage: bun run version:bump <version|patch|minor|major|prerelease> [pre-id] [--tag] [--dry-run]');
  process.exit(1);
}

// ── Read current version from package.json (source of truth) ─────────────

const pkgJson = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8'));
const currentVersion: string = pkgJson.version;
console.log(`Current version: ${currentVersion}`);

// ── Compute new version ──────────────────────────────────────────────────

function bumpVersion(current: string, bumpType: string, preId?: string): string {
  // Parse current version
  const preMatch = current.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z]+)\.(\d+))?$/);
  if (!preMatch) {
    throw new Error(`Cannot parse current version: "${current}"`);
  }

  let [, majorStr, minorStr, patchStr, existingPreId, existingPreNum] = preMatch;
  let major = parseInt(majorStr, 10);
  let minor = parseInt(minorStr, 10);
  let patch = parseInt(patchStr, 10);

  switch (bumpType) {
    case 'major':
      return `${major + 1}.0.0`;

    case 'minor':
      return `${major}.${minor + 1}.0`;

    case 'patch':
      // If we're on a pre-release, "patch" just drops the pre-release suffix
      if (existingPreId) {
        return `${major}.${minor}.${patch}`;
      }
      return `${major}.${minor}.${patch + 1}`;

    case 'prerelease': {
      const id = preId || existingPreId || 'rc';
      if (existingPreId === id && existingPreNum !== undefined) {
        // Same pre-release id — increment the number
        return `${major}.${minor}.${patch}-${id}.${parseInt(existingPreNum, 10) + 1}`;
      }
      // New pre-release: bump patch first if not already pre-release
      if (!existingPreId) {
        patch += 1;
      }
      return `${major}.${minor}.${patch}-${id}.0`;
    }

    default:
      // Treat as an explicit version string
      if (/^\d+\.\d+\.\d+/.test(bumpType)) {
        return bumpType;
      }
      throw new Error(
        `Unknown bump type: "${bumpType}". Use: major, minor, patch, prerelease, or an explicit version.`,
      );
  }
}

const newVersion = bumpVersion(currentVersion, positional[0], positional[1]);
console.log(`New version:     ${newVersion}`);

if (currentVersion === newVersion) {
  console.log('Version unchanged — nothing to do.');
  process.exit(0);
}

const tag = `v${newVersion}`;

// With --tag, check before touching anything that the release commit can hold
// exactly the bump: other edits in these files would be swept into it, and an
// existing tag would leave the new commit untagged.
if (createTag) {
  const dirty = RELEASE_FILES.filter(file => git('status', '--porcelain', '--', file) !== '');
  if (dirty.length > 0) {
    const names = dirty.map(file => file.slice(ROOT.length + 1)).join(', ');
    console.error(`Uncommitted changes in ${names}. Commit them first, so the release commit holds only the bump.`);
    process.exit(1);
  }
  if (git('tag', '--list', tag) !== '') {
    console.error(`Tag ${tag} already exists.`);
    process.exit(1);
  }
}

// ── Update files ─────────────────────────────────────────────────────────

function updatePackageJson(version: string) {
  const content = readFileSync(PACKAGE_JSON, 'utf-8');
  // Replace the "version" field while preserving formatting
  const updated = content.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  if (updated === content) {
    throw new Error('Failed to update version in package.json');
  }
  return updated;
}

function updateCargoToml(version: string) {
  const content = readFileSync(CARGO_TOML, 'utf-8');
  // Replace the version under [package] — it's the first `version = "..."` line
  const updated = content.replace(/^(version\s*=\s*)"[^"]*"/m, `$1"${version}"`);
  if (updated === content) {
    throw new Error('Failed to update version in Cargo.toml');
  }
  return updated;
}

function updateTauriConf(version: string) {
  const content = readFileSync(TAURI_CONF, 'utf-8');
  // Replace the top-level "version" field
  const updated = content.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  if (updated === content) {
    throw new Error('Failed to update version in tauri.conf.json');
  }
  return updated;
}

const updates = [
  { path: PACKAGE_JSON, label: 'package.json', content: updatePackageJson(newVersion) },
  { path: CARGO_TOML, label: 'src-tauri/Cargo.toml', content: updateCargoToml(newVersion) },
  { path: TAURI_CONF, label: 'src-tauri/tauri.conf.json', content: updateTauriConf(newVersion) },
];

for (const { path, label, content } of updates) {
  if (dryRun) {
    console.log(`  [dry-run] Would update ${label}`);
  } else {
    writeFileSync(path, content, 'utf-8');
    console.log(`  Updated ${label}`);
  }
}

// ── Cargo.lock ───────────────────────────────────────────────────────────

// The lockfile records the app's own version too. Refresh just that entry
// (--workspace leaves dependencies alone; --offline needs no network), so the
// next build doesn't change it after the release commit.
if (dryRun) {
  console.log('  [dry-run] Would update src-tauri/Cargo.lock');
} else {
  execFileSync('cargo', ['update', '--workspace', '--offline'], {
    cwd: resolve(ROOT, 'src-tauri'),
    stdio: 'inherit',
  });
  console.log('  Updated src-tauri/Cargo.lock');
}

// ── Optionally commit and tag ────────────────────────────────────────────

if (createTag) {
  if (dryRun) {
    console.log(`  [dry-run] Would commit "Release ${tag}" and tag it ${tag}`);
  } else {
    // Commit only the release files, whatever else is staged, then tag the new
    // commit. Tagging first would put the tag on the previous commit, which
    // still carries the old version.
    execFileSync('git', ['commit', '-m', `Release ${tag}`, '--', ...RELEASE_FILES], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    git('tag', tag);
    console.log(`  Committed "Release ${tag}" and tagged it ${tag}`);
    console.log(`\nNext step (pushing the tag starts the release workflow):`);
    console.log(`  git push && git push origin ${tag}`);
  }
} else {
  console.log(`\nTo release: commit these files as "Release ${tag}", tag that commit ${tag}, and push both.`);
  console.log('Or rerun with --tag, which commits and tags for you.');
}
