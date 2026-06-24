#!/usr/bin/env bun
/**
 * collect-artifacts — collect release bundles produced by `cargo tauri build`
 * into a single directory with version-free, human-readable filenames.
 *
 * Tauri names its output files with the version number embedded
 * (e.g. "PlugSight_0.1.0_x64-setup.exe"). For distribution we prefer
 * stable filenames that don't change between releases, so download links and
 * documentation stay valid across versions. The version is still encoded in
 * the updater manifest (`latest.json`) and the GitHub release tag.
 *
 * Produces (default output dir: ./release-artifacts):
 *
 *   PlugSight Setup.exe      — NSIS installer (per-user, no admin)
 *   PlugSight Setup.exe.sig  — updater signature for NSIS installer
 *   PlugSight.msi            — MSI installer (enterprise/GPO)
 *   PlugSight.msi.sig        — updater signature for MSI installer
 *   PlugSight Portable.zip   — portable binary (zipped for distribution)
 *   latest.json                     — updater manifest
 *
 * Usage:
 *   bun run scripts/collect-artifacts.ts              # → ./release-artifacts
 *   bun run scripts/collect-artifacts.ts dist/out     # → custom dir
 */

import { execSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs';
import { basename, join, resolve } from 'path';

// ── Paths ────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '..');
const TARGET_RELEASE = resolve(ROOT, 'src-tauri', 'target', 'release');
const BUNDLE = join(TARGET_RELEASE, 'bundle');
const OUT = resolve(ROOT, process.argv[2] ?? 'release-artifacts');

/** Base filename used for all renamed artifacts. Matches productName in tauri.conf.json. */
const PRODUCT = 'PlugSight';

/** Raw Rust binary name from Cargo.toml [package].name. */
const RAW_BINARY = 'plugsight.exe';

// ── Helpers ──────────────────────────────────────────────────────────────

interface Copy {
  src: string;
  dest: string;
  /** Optional label for log output (defaults to basename of dest). */
  label?: string;
}

/**
 * Find the first file in `dir` whose name ends with `suffix`.
 * Returns null if the directory is missing or no match is found.
 */
function findFirst(dir: string, suffix: string): string | null {
  if (!existsSync(dir)) return null;
  const match = readdirSync(dir).find(f => f.endsWith(suffix));
  return match ? join(dir, match) : null;
}

function humanSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ── Plan ─────────────────────────────────────────────────────────────────

const copies: Copy[] = [];

// NSIS installer + signature.
const nsisDir = join(BUNDLE, 'nsis');
const nsisExe = findFirst(nsisDir, '-setup.exe');
const nsisSig = findFirst(nsisDir, '-setup.exe.sig');
if (nsisExe) copies.push({ src: nsisExe, dest: join(OUT, `${PRODUCT} Setup.exe`) });
if (nsisSig) copies.push({ src: nsisSig, dest: join(OUT, `${PRODUCT} Setup.exe.sig`) });

// MSI installer + signature. Tauri names them like "Product_0.1.0_x64_en-US.msi".
const msiDir = join(BUNDLE, 'msi');
const msiFile = findFirst(msiDir, '.msi');
const msiSig = findFirst(msiDir, '.msi.sig');
if (msiFile) copies.push({ src: msiFile, dest: join(OUT, `${PRODUCT}.msi`) });
if (msiSig) copies.push({ src: msiSig, dest: join(OUT, `${PRODUCT}.msi.sig`) });

// Portable EXE — zipped for distribution. The raw binary is renamed to the
// product name inside the archive so users see "PlugSight.exe" when
// they extract it.
let portableSrc: string | null = null;
const portable = join(TARGET_RELEASE, RAW_BINARY);
if (existsSync(portable)) {
  portableSrc = portable;
}

// Updater manifest. Tauri places it alongside whichever bundle was built last,
// so check both directories.
for (const dir of [nsisDir, msiDir]) {
  const manifest = join(dir, 'latest.json');
  if (existsSync(manifest)) {
    copies.push({ src: manifest, dest: join(OUT, 'latest.json') });
    break;
  }
}

// ── Execute ──────────────────────────────────────────────────────────────

if (copies.length === 0 && !portableSrc) {
  console.error(
    'No release artifacts found. Run `cargo tauri build` first to produce the bundles.',
  );
  process.exit(1);
}

// Clean the output directory so stale artifacts from a previous version
// don't accumulate.
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log(`Collecting artifacts into: ${OUT}`);
for (const { src, dest, label } of copies) {
  copyFileSync(src, dest);
  const size = humanSize(statSync(dest).size);
  console.log(`  ${label ?? basename(dest).padEnd(32)}  ${size.padStart(10)}`);
}

// Portable ZIP — stage the exe with the display name, then compress.
if (portableSrc) {
  const zipName = `${PRODUCT} Portable.zip`;
  const zipDest = join(OUT, zipName);
  const stagingDir = join(OUT, '.portable-staging');
  mkdirSync(stagingDir, { recursive: true });

  const stagedExe = join(stagingDir, `${PRODUCT}.exe`);
  copyFileSync(portableSrc, stagedExe);

  // PowerShell's Compress-Archive is always available on Windows.
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${stagedExe}' -DestinationPath '${zipDest}' -CompressionLevel Optimal"`,
    { stdio: 'pipe' },
  );

  rmSync(stagingDir, { recursive: true, force: true });

  const size = humanSize(statSync(zipDest).size);
  console.log(`  ${zipName.padEnd(32)}  ${size.padStart(10)}`);
}

// Warn if signing artifacts are missing (signing wasn't enabled).
const hasSigs = copies.some(c => c.dest.endsWith('.sig'));
const hasManifest = copies.some(c => basename(c.dest) === 'latest.json');
if (!hasSigs || !hasManifest) {
  console.warn(
    '\nWarning: updater signatures or latest.json are missing.\n' +
      'Set TAURI_SIGNING_PRIVATE_KEY_PATH (or TAURI_SIGNING_PRIVATE_KEY) before building\n' +
      'to enable in-app auto-updates for this release.',
  );
}
