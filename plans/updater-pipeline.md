# In-app updater pipeline

## Goal

Make PlugSight's in-app auto-update actually work. Through v0.2.2 it never had —
every release shipped without an updater manifest, so the app silently fell back
to opening the GitHub releases page in a browser.

## Environment / context

- Repo: `cinderblock/plugsight` (GitHub), released by `.github/workflows/release.yml`
  on a `v*` tag push.
- Updater endpoint (baked into shipped binaries, `src-tauri/tauri.conf.json`):
  `https://github.com/cinderblock/plugsight/releases/latest/download/latest.json`
- Signing key: minisign, key ID `602DC0E93ABFFB14`.
  - Public: `src-tauri/keys/updater.key.pub`, also inlined as `plugins.updater.pubkey`.
  - Private: `src-tauri/keys/updater.key` (gitignored). **No password.**
  - Uploaded as the `TAURI_SIGNING_PRIVATE_KEY` repo secret on 2026-08-03.
- Frontend logic: `src/lib/updater.ts` (`tryNativeUpdater` → GitHub API fallback).
- Artifact naming/manifest: `scripts/collect-artifacts.ts`.

## Decisions already made (don't re-ask)

- **Releases only ever publish from CI.** Never `gh release create` or any CLI
  publish; the tag push is the trigger.
- **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is deliberately not set.** The key has no
  password. The workflow's `env:` block still defines the variable (as an empty
  string), which is what stops the Tauri CLI from prompting and hanging CI. Setting
  it to a real value would break signing; removing the `env:` line would risk a hang.
- **The NSIS installer is the update artifact.** `latest.json` points at
  `PlugSight.Setup.exe`; the MSI is published but not advertised for updates.

## Findings / gotchas

These are the things that cost time — all verified, not assumed.

1. **Tauri v2 does not generate `latest.json`.** The bundler produces update
   bundles and their `.sig` files only. The docs say: *"Tauri Action generates a
   static JSON file for you"* — i.e. it's the caller's job. `collect-artifacts.ts`
   had been searching the bundle dirs for a file that is never written there.
   We now build the manifest ourselves.

2. **`bundle.createUpdaterArtifacts` defaults to `false`.** Confirmed in
   `tauri-utils`: `impl Default for Updater { fn default() -> Self { Self::Bool(false) } }`.
   Without it set to `true`, no `.sig` files are produced *even when the signing
   key is present*. It is now set in `tauri.conf.json`.

3. **The repo had no Actions secrets at all.** `gh secret list` returned empty
   while holding ADMIN. The v0.2.2 build logged `TAURI_SIGNING_PRIVATE_KEY:` blank
   and printed *"Warning: updater signatures or latest.json are missing"* — then
   published anyway. Hence the workflow now hard-fails on a missing manifest.

4. **Stale bundles silently poison the manifest.** Tauri embeds the version in
   bundle filenames and never cleans `src-tauri/target/release/bundle/`. The old
   `findFirst` took the first match *alphabetically*, so `nsis/` holding 0.1.0,
   0.2.0 and 0.2.2 produced a `latest.json` advertising the **0.2.2 signature over
   the 0.1.0 installer** — which every client rejects as tampering. CI is not immune:
   `swatinem/rust-cache` can restore stale bundles into `target/`.
   Bundles are now matched by the version being built, and a `.sig` is only ever
   read from beside its own bundle.

5. **Verify the signature, not just that files exist.** The bug in (4) produced a
   perfectly well-formed `latest.json` with a matching key ID. Only real
   cryptographic verification caught it. Recipe (minisign `ED` = prehashed):
   Ed25519-verify the signature's 64-byte tail against the **blake2b-512** digest
   of the installer, using the 32-byte public key from `pubkey` (skip the 2-byte
   alg + 8-byte key ID prefix; wrap in SPKI DER `302a300506032b6570032100` for
   `crypto.createPublicKey`).

6. **Failures were invisible by construction.** `tryNativeUpdater` swallowed every
   error with a bare `catch {}`, so "no manifest" and "you're up to date" looked
   identical. It now logs before falling back. This is why nobody noticed for three
   releases.

## Progress log

- [x] Diagnosed why self-update never worked (three independent causes).
- [x] `createUpdaterArtifacts: true` (commit `b151d86`).
- [x] Generate `latest.json` in `collect-artifacts.ts`, tag-aware via `RELEASE_TAG`.
- [x] Workflow fails loudly if the manifest or signature is missing.
- [x] Verified `updater.key` is the pair of the shipped pubkey (key IDs match) and
      that it has no password.
- [x] Uploaded `TAURI_SIGNING_PRIVATE_KEY` secret.
- [x] Local signed build → signature verifies against the collected installer.
- [x] Fixed stale-bundle pairing bug + added a mismatch guard (commit `b2255f2`).
- [x] Log updater failures instead of swallowing them (commit `a093b43`).
- [x] Released v0.3.0 (commit `9b88dc7`, tag `v0.3.0`). First release ever to carry
      `latest.json` + `.sig` assets.
- [x] Verified the **published** release: downloaded `PlugSight.Setup.exe` and the
      live `latest.json`, and confirmed the manifest signature verifies under the
      pubkey read out of the v0.2.2 commit (`git show 35bba81:...tauri.conf.json`) —
      i.e. under the key an already-installed client actually holds.
- [ ] **Confirm an installed client applies it.** The signature is proven to be
      one v0.2.2 clients accept; what's still unobserved is a real install
      downloading and restarting into v0.3.0 (checks every 30 min, or on launch).

## Things not to do

- Don't set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — see Decisions above.
- Don't trust "the release has assets" as proof updates work. Check that
  `latest.json` is present *and* that its signature verifies against the installer
  it points at.
- Don't run `collect-artifacts.ts` against a dirty `bundle/` and assume the newest
  build was picked; that assumption is exactly what broke (4).
- Don't publish from a CLI, ever. Tag → CI.
