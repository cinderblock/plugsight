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
 *   latest.json              — updater manifest (written here, not by Tauri)
 *
 * Usage:
 *   bun run scripts/collect-artifacts.ts              # → ./release-artifacts
 *   bun run scripts/collect-artifacts.ts dist/out     # → custom dir
 */

import { execSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
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

/** owner/repo the release assets are published under (for updater URLs). */
const GITHUB_REPO = 'cinderblock/plugsight';

/** Version being built, read from the canonical Tauri config. */
function version(): string {
  const conf = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')) as { version: string };
  return conf.version;
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface Copy {
  src: string;
  dest: string;
  /** Optional label for log output (defaults to basename of dest). */
  label?: string;
}

/**
 * Find the bundle in `dir` whose name ends with `suffix` and belongs to the
 * version being built.
 *
 * Tauri embeds the version in the filename and never cleans the bundle
 * directory, so after a few local builds `nsis/` holds every installer ever
 * produced. Picking the first match alphabetically would pair the *oldest*
 * installer with the *newest* signature — a manifest that every client rejects.
 * So: filter to this version, and among those take the most recently written.
 */
function findBundle(dir: string, suffix: string): string | null {
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter(f => f.endsWith(suffix) && f.includes(`_${version()}_`))
    .map(f => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

/** The updater signature sitting beside a bundle, or null if it wasn't signed. */
function sigFor(bundle: string | null): string | null {
  if (!bundle) return null;
  const sig = `${bundle}.sig`;
  return existsSync(sig) ? sig : null;
}

function humanSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ── Plan ─────────────────────────────────────────────────────────────────

const copies: Copy[] = [];

// NSIS installer + its own signature (taken from beside it, never matched
// independently — the manifest is only valid if they came from one build).
const nsisDir = join(BUNDLE, 'nsis');
const nsisExe = findBundle(nsisDir, '-setup.exe');
const nsisSig = sigFor(nsisExe);
if (nsisExe) copies.push({ src: nsisExe, dest: join(OUT, `${PRODUCT} Setup.exe`) });
if (nsisSig) copies.push({ src: nsisSig, dest: join(OUT, `${PRODUCT} Setup.exe.sig`) });

// MSI installer + signature. Tauri names them like "Product_0.1.0_x64_en-US.msi".
const msiDir = join(BUNDLE, 'msi');
const msiFile = findBundle(msiDir, '.msi');
const msiSig = sigFor(msiFile);
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

// Note: the updater manifest is NOT produced by the bundler — see
// `writeUpdaterManifest` below, which builds it after the copies are done.

// ── Execute ──────────────────────────────────────────────────────────────

if (copies.length === 0 && !portableSrc) {
  console.error('No release artifacts found. Run `cargo tauri build` first to produce the bundles.');
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

// ── Updater manifest ─────────────────────────────────────────────────────

/**
 * Write `latest.json`, the manifest the in-app updater fetches from
 * `releases/latest/download/latest.json` (see plugins.updater.endpoints in
 * tauri.conf.json).
 *
 * Tauri v2's bundler produces the update bundles and their `.sig` signatures
 * but *not* this manifest — the docs point you at tauri-action or at writing it
 * yourself. We write it here so `bun run build:release` and CI stay identical.
 *
 * `signature` is the literal contents of the `.sig` file; `url` must point at
 * the asset on the release being published. GitHub rewrites spaces in asset
 * names to dots, so the URL uses the dotted form of our renamed installer.
 */
function writeUpdaterManifest(): boolean {
  const sig = join(OUT, `${PRODUCT} Setup.exe.sig`);
  if (!existsSync(sig)) return false;

  const signature = readFileSync(sig, 'utf8').trim();

  // A signature over a *different* build verifies as tampering on the client,
  // and the only symptom is that updates silently stop working. minisign records
  // the signed filename in its trusted comment, so check it really is the
  // installer we're publishing before advertising the pair as a matched set.
  const signedName = Buffer.from(signature, 'base64')
    .toString('utf8')
    .match(/\bfile:(.+)/)?.[1]
    ?.trim();
  if (signedName && nsisExe && signedName !== basename(nsisExe)) {
    console.error(
      `\nRefusing to write latest.json: the signature is for "${signedName}" but the\n` +
        `installer being published is "${basename(nsisExe)}". These are different builds.`,
    );
    process.exit(1);
  }

  // The release tag this build will be published under. CI passes it through
  // (a tag push is the trigger); locally it's derived from the version, which
  // `bun run version:bump` keeps in sync across all three config files.
  const tag = process.env.RELEASE_TAG || `v${version()}`;
  const assetName = `${PRODUCT} Setup.exe`.replace(/ /g, '.'); // GitHub rewrites spaces to dots
  const assetUrl = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${assetName}`;

  const manifest = {
    version: tag.replace(/^v/, ''),
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': { signature, url: assetUrl },
    },
  };

  writeFileSync(join(OUT, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`  ${'latest.json'.padEnd(32)}  ${`→ ${tag}`.padStart(10)}`);
  return true;
}

const wroteManifest = writeUpdaterManifest();

// Warn if signing artifacts are missing (signing wasn't enabled).
if (!wroteManifest) {
  console.warn(
    '\nWarning: updater signatures and latest.json are missing, so this build\n' +
      'CANNOT be auto-updated to. Set TAURI_SIGNING_PRIVATE_KEY_PATH (or\n' +
      'TAURI_SIGNING_PRIVATE_KEY) before building, and make sure\n' +
      'bundle.createUpdaterArtifacts is true in tauri.conf.json.',
  );
}
