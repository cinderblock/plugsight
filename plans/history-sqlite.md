# Connection history in SQLite, and one PlugSight at a time

## Goal

The connection history (`device/history.rs`) was a JSON file loaded into memory
and rewritten whole on every change. That has two real problems:

- **Two running copies overwrite each other.** Each loads the file once and
  saves its own in-memory view, so the last writer wins and the other copy's
  events are lost. Two v0.7.0 copies were running on 2026-09-29.
- **Every recorded event rewrites the whole file.** 64 KB today; at the caps
  (400 events per device, 90 days) potentially several MB, rewritten on every
  refresh pass while a device flaps — exactly the case the feature is for.

The user approved (2026-09-30): allow a single running instance, move the
history to SQLite with a one-time import of the JSON file, and release as v0.7.2.

## Environment / context

- History file today: `%APPDATA%\com.plugsight.app\connection-history.json`
  (`{"version":1,"devices":{"<ID>":[{"t":ms,"kind":"arrive"|"remove"}]}}`;
  v0.7.0 files have no `version`).
- A pre-fix backup, `connection-history.before-reboot-fix.json`, is in the same
  folder (from `plans/stale-removed-devices.md`); leave it alone.
- Tauri v2, Rust 2024 edition. Releases go through `.github/workflows/release.yml`
  on a `v*` tag; never publish from the CLI.

## Decisions already made (don't re-ask)

- **SQLite via `rusqlite` with the `bundled` feature**: no system SQLite
  dependency on Windows; about 1 MB more binary.
- **The database is the source of truth, with no in-memory copy.** Every
  read-modify-write runs in a `BEGIN IMMEDIATE` transaction, so two processes
  can't interleave, even though single-instance should prevent that anyway.
- **WAL journal + `synchronous=NORMAL` + a busy timeout**: cheap commits,
  readers never block the writer.
- **The reconcile/record rules stay as they are** (arrival counts only after a
  removal, a restart is a new baseline, etc.); only storage changes. Tests run
  against an in-memory database.
- **The JSON file is imported once**, when the database is first created, with
  the v0 repair (`forget_restart_drops`) applied, then **renamed** to
  `connection-history.json.imported`, not deleted.
- **Single instance via `tauri-plugin-single-instance`**, registered first. A
  second launch focuses the existing window.
- `kind` is stored as TEXT (`'arrive'`/`'remove'`) so the database stays
  readable in the `sqlite3` CLI or a database viewer.

## Plan / steps

1. [x] Single-instance plugin, focusing the existing window (commit cb1ea7b).
2. [x] `history.rs` on SQLite: schema + `user_version` migrations, the same
   rules, JSON import, pruning at most hourly, in-memory fallback when the
   file can't be opened.
3. [x] Drop `save_if_dirty` callers (writes are immediate now).
4. [x] Tests (40 Rust tests in all): existing behaviour tests ported to an
   in-memory DB; import (v0 repair, v1 as-is, once only, bad JSON left alone);
   persistence across reopen; two connections to one file; a failed
   transaction leaves nothing behind.
5. [x] Time `decorate` on a real-size database (import of the user's file).
6. [x] Live check in a dev run: import happens, events recorded, second launch
   focuses the first.
7. [x] README / CLAUDE.md updates.
8. [x] Committed (cb1ea7b single instance, e0beed7 SQLite) and released
   v0.7.2 through CI (release commit 433674d). Published 2026-09-30T21:37Z with
   Setup.exe, MSI, portable zip, both `.sig` files, and a `latest.json`
   advertising 0.7.2. The installers grew ~0.75–0.95 MB (bundled SQLite).

## Findings / gotchas

- **rusqlite 0.40 has no `usize` ToSql/FromSql.** Convert at the boundary
  (`user_version` and the per-device cap are bound as `i64`).
- **`journal_mode` returns a row**, so set it with `pragma_update_and_check`,
  not `pragma_update`.
- **Speed on real data** (the user's pre-fix JSON, 391 devices, release build):
  import 14 ms; a whole `decorate` pass 1.1–2.4 ms (enumeration is ~500 ms); a
  single recorded event ~0.1 ms; prune 2 ms.
- **Live dev run, 2026-09-30:** imported 1,168 events, renamed the JSON to
  `.imported`, `user_version` 1, WAL on. COM20 arrive/remove were written live
  and readable from a second process (`bun:sqlite`) while the app had the file
  open. 35 devices with reconnects, matching the v0.7.1 repair count.
- **Single instance, live:** launching the debug exe a second time exited with
  code 0, left one process, and the first one's window was in the foreground.
- **Splitting the two features into commits:** the lockfile for the
  single-instance commit came from removing the `rusqlite` line and running
  `cargo metadata --offline`, which prunes the lock without re-resolving
  anything else. Back up the full `Cargo.toml`/`Cargo.lock` first.
- Backups in `%APPDATA%\com.plugsight.app`:
  `connection-history.before-sqlite.json` (made just before the first import)
  and `connection-history.before-reboot-fix.json`.

## Progress log

- [x] Single instance
- [x] SQLite history
- [x] Verified (tests, timing, live dev run)
- [x] Released as v0.7.2

## Open questions for the user

(carried over from `plans/stale-removed-devices.md`; both approved and done)
1. ~~"Off" choice for the removed-device timeout?~~ Commit 63ef668.
2. ~~Fix `bun run version:bump --tag`?~~ Commit f745afa: `--tag` now commits
   "Release vX.Y.Z" (the four version files, including `Cargo.lock`) and tags
   that commit, refusing if those files are dirty or the tag exists.
3. ~~Release the Off choice as v0.7.3?~~ Approved and released 2026-10-01
   (release commit 5deed92, published 23:19Z, `latest.json` advertises 0.7.3).
   First release cut with the fixed `version:bump --tag`. The script's commit
   has no Co-Authored-By trailer, so the commit was amended to add it and the
   still-local tag moved with `git tag -f` before pushing.

## Things not to do

- Don't delete the old JSON file; rename it.
- Don't publish from the CLI; push the tag.
