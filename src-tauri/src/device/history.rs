//! Connection history: when each device arrived and left, so a flaky device
//! that drops and comes back while nobody is watching leaves a record.
//!
//! Events come from two places:
//!
//! - **The PnP notification callback** (`watcher.rs`), which names the device
//!   instance for every removal and arrival as it happens. This is the primary
//!   source: the device list itself is refreshed on a 300 ms debounce, so a
//!   device that drops and returns inside that window never shows up as removed
//!   in a before/after comparison — exactly the flaky case this exists for.
//! - **Windows' own dates**, `DEVPKEY_Device_LastArrivalDate` and
//!   `LastRemovalDate`, reconciled on every enumeration pass. If a present
//!   device arrived later than the last arrival we recorded, it dropped and came
//!   back without us seeing it (the app wasn't running, or a notification was
//!   lost), and the dates fill in that cycle.
//!
//! An arrival only counts after a removal. A disable/enable or a driver restart
//! fires "started" without "removed", and isn't a reconnect. Nor is a restart
//! of the machine: Windows re-stamps every device's arrival date at boot but
//! records no removal at shutdown, so a device that came up with the boot and
//! has no removal on record just starts a new baseline.
//!
//! The history lives in a SQLite database in the app data dir, one row per
//! event, trimmed by age and count so a long-running machine doesn't grow it
//! without bound. The database is the only copy: every read-modify-write runs
//! in one immediate transaction, so recording an event costs one small insert
//! rather than rewriting the record, and two processes sharing the file can't
//! lose each other's events. (It used to be a JSON file rewritten whole on every
//! change, where the last of two running copies to save won; that file is
//! imported once, see [`import_legacy`].)

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::Duration;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::types::DeviceInfo;

/// Tolerance when comparing a recorded arrival with Windows' arrival date: the
/// notification and the property are stamped by different code a few
/// milliseconds apart, and must not read as two separate arrivals.
const SAME_ARRIVAL_MS: i64 = 5_000;
/// A device whose arrival date is within this long after boot came up with the
/// machine. Boot-time USB enumeration ran to ~33 s here. Matches the frontend's
/// `BOOT_WINDOW_MS`, which labels those devices "boot".
const BOOT_WINDOW_MS: i64 = 2 * 60 * 1000;
/// Oldest event kept.
const MAX_AGE_MS: i64 = 90 * 24 * 60 * 60 * 1000;
/// How often a running app trims events past [`MAX_AGE_MS`].
const PRUNE_EVERY_MS: i64 = 60 * 60 * 1000;
/// Most events kept per device.
const MAX_EVENTS: usize = 400;
/// Most events sent to the frontend per device.
const SUMMARY_EVENTS: usize = 100;
/// How long a write waits for another connection that holds the database.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// The database, next to where the JSON file used to be.
const DB_FILE: &str = "connection-history.sqlite3";
/// The JSON file v0.7.0 and v0.7.1 kept the history in.
const LEGACY_FILE: &str = "connection-history.json";
/// What the JSON file is renamed to once imported. Kept, not deleted.
const LEGACY_IMPORTED: &str = "connection-history.json.imported";

/// Schema changes, applied in order. `PRAGMA user_version` records how many
/// have run, so a database from any earlier version is brought up to date.
const MIGRATIONS: &[&str] = &["CREATE TABLE events (
        id     INTEGER PRIMARY KEY,
        device TEXT    NOT NULL, -- instance ID, upper-cased
        t      INTEGER NOT NULL, -- ms since the Unix epoch
        kind   TEXT    NOT NULL CHECK (kind IN ('arrive', 'remove'))
    );
    CREATE INDEX events_by_device ON events (device, t, id);"];

/// One arrival or removal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnEvent {
    /// Milliseconds since the Unix epoch.
    pub t: i64,
    pub kind: ConnKind,
}

/// Stored as the same words the frontend gets, so the database reads plainly in
/// the `sqlite3` shell or any database viewer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnKind {
    Arrive,
    Remove,
}

impl ConnKind {
    fn as_str(self) -> &'static str {
        match self {
            ConnKind::Arrive => "arrive",
            ConnKind::Remove => "remove",
        }
    }
}

impl ToSql for ConnKind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(self.as_str().into())
    }
}

impl FromSql for ConnKind {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "arrive" => Ok(ConnKind::Arrive),
            "remove" => Ok(ConnKind::Remove),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

/// Events are keyed by upper-cased instance ID: the PnP notification and
/// SetupAPI spell the same ID in different case.
fn key(instance_id: &str) -> String {
    instance_id.to_ascii_uppercase()
}

type Result<T> = rusqlite::Result<T>;

/// The event store. All times are passed in, so it's testable.
pub struct History {
    conn: Connection,
}

/// An open `BEGIN IMMEDIATE` transaction, rolled back if it's dropped without
/// committing (an error, or a panic in the middle of a pass).
struct WriteTxn<'a> {
    conn: &'a Connection,
    committed: bool,
}

impl WriteTxn<'_> {
    fn commit(mut self) -> Result<()> {
        self.conn.execute_batch("COMMIT")?;
        self.committed = true;
        Ok(())
    }
}

impl Drop for WriteTxn<'_> {
    fn drop(&mut self) {
        if !self.committed {
            let _ = self.conn.execute_batch("ROLLBACK");
        }
    }
}

impl History {
    /// Open the database at `path`, creating it if need be, and bring its
    /// schema up to date.
    pub fn open(path: &Path) -> Result<Self> {
        Self::setup(Connection::open(path)?)
    }

    /// A database that lives only as long as this value: for tests, and for
    /// running without an app data dir.
    pub fn open_in_memory() -> Result<Self> {
        Self::setup(Connection::open_in_memory()?)
    }

    fn setup(conn: Connection) -> Result<Self> {
        conn.busy_timeout(BUSY_TIMEOUT)?;
        // Write-ahead logging: a commit appends to the log instead of rewriting
        // pages in place, and readers never wait on the writer. With it,
        // NORMAL sync can lose only the last moment of events to a power cut,
        // never corrupt the file.
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        let history = Self { conn };
        history.migrate()?;
        Ok(history)
    }

    fn migrate(&self) -> Result<()> {
        self.write(|h| {
            let applied: i64 = h
                .conn
                .pragma_query_value(None, "user_version", |row| row.get(0))?;
            let applied = usize::try_from(applied).unwrap_or(0);
            if applied < MIGRATIONS.len() {
                for migration in &MIGRATIONS[applied..] {
                    h.conn.execute_batch(migration)?;
                }
                h.conn
                    .pragma_update(None, "user_version", MIGRATIONS.len() as i64)?;
            }
            Ok(())
        })
    }

    /// Run `f` as one write transaction. `IMMEDIATE` takes the write lock up
    /// front, so what `f` reads can't change under it before it writes, even
    /// from another process.
    fn write<R>(&self, f: impl FnOnce(&Self) -> Result<R>) -> Result<R> {
        self.conn.execute_batch("BEGIN IMMEDIATE")?;
        let txn = WriteTxn {
            conn: &self.conn,
            committed: false,
        };
        let result = f(self)?;
        txn.commit()?;
        Ok(result)
    }

    fn last(&self, instance_id: &str) -> Result<Option<ConnEvent>> {
        self.conn
            .prepare_cached(
                "SELECT t, kind FROM events WHERE device = ?1 ORDER BY t DESC, id DESC LIMIT 1",
            )?
            .query_row([key(instance_id)], |row| {
                Ok(ConnEvent {
                    t: row.get(0)?,
                    kind: row.get(1)?,
                })
            })
            .optional()
    }

    /// Every event kept for the device, oldest first.
    fn events(&self, instance_id: &str) -> Result<Vec<ConnEvent>> {
        self.conn
            .prepare_cached("SELECT t, kind FROM events WHERE device = ?1 ORDER BY t, id")?
            .query_map([key(instance_id)], |row| {
                Ok(ConnEvent {
                    t: row.get(0)?,
                    kind: row.get(1)?,
                })
            })?
            .collect()
    }

    fn push(&self, instance_id: &str, event: ConnEvent) -> Result<()> {
        let device = key(instance_id);
        // Keep order even if two sources stamp slightly out of sequence.
        let t = self
            .last(instance_id)?
            .map_or(event.t, |last| event.t.max(last.t));
        self.conn
            .prepare_cached("INSERT INTO events (device, t, kind) VALUES (?1, ?2, ?3)")?
            .execute(params![device, t, event.kind])?;
        self.conn
            .prepare_cached(
                "DELETE FROM events WHERE device = ?1 AND id NOT IN (
                    SELECT id FROM events WHERE device = ?1 ORDER BY t DESC, id DESC LIMIT ?2
                )",
            )?
            .execute(params![device, MAX_EVENTS as i64])?;
        Ok(())
    }

    /// The device arrived (enumerated or started). Counts only if it's new to
    /// us or its last recorded event was a removal.
    pub fn record_arrival(&self, instance_id: &str, now: i64) -> Result<()> {
        self.write(|h| h.arrival(instance_id, now))
    }

    fn arrival(&self, instance_id: &str, now: i64) -> Result<()> {
        match self.last(instance_id)? {
            Some(ConnEvent {
                kind: ConnKind::Arrive,
                ..
            }) => Ok(()),
            _ => self.push(
                instance_id,
                ConnEvent {
                    t: now,
                    kind: ConnKind::Arrive,
                },
            ),
        }
    }

    /// The device is gone. Ignored if we already recorded it leaving.
    pub fn record_removal(&self, instance_id: &str, now: i64) -> Result<()> {
        self.write(|h| match h.last(instance_id)? {
            Some(ConnEvent {
                kind: ConnKind::Remove,
                ..
            }) => Ok(()),
            _ => h.push(
                instance_id,
                ConnEvent {
                    t: now,
                    kind: ConnKind::Remove,
                },
            ),
        })
    }

    /// Square the record with what Windows says about a device that is present
    /// right now. `arrived_at` / `removed_at` are Windows' last arrival and
    /// removal dates; `boot` is when the machine started. The app does this for
    /// every device at once, in [`History::decorate`].
    #[cfg(test)]
    fn reconcile_present(
        &self,
        instance_id: &str,
        arrived_at: Option<i64>,
        removed_at: Option<i64>,
        now: i64,
        boot: i64,
    ) -> Result<()> {
        self.write(|h| h.reconcile(instance_id, arrived_at, removed_at, now, boot))
    }

    fn reconcile(
        &self,
        instance_id: &str,
        arrived_at: Option<i64>,
        removed_at: Option<i64>,
        now: i64,
        boot: i64,
    ) -> Result<()> {
        match self.last(instance_id)? {
            // First sighting: its arrival is the baseline, not a reconnect.
            None => self.push(
                instance_id,
                ConnEvent {
                    t: arrived_at.unwrap_or(now),
                    kind: ConnKind::Arrive,
                },
            ),
            // We saw it leave and it's back; the notification for the return was
            // missed (or hasn't been processed yet).
            Some(ConnEvent {
                kind: ConnKind::Remove,
                t,
            }) => self.push(
                instance_id,
                ConnEvent {
                    t: arrived_at.filter(|&a| a >= t).unwrap_or(now),
                    kind: ConnKind::Arrive,
                },
            ),
            // We think it's been here since `t`, but Windows says it arrived
            // later: it dropped and came back without us seeing either, or the
            // machine restarted.
            Some(ConnEvent {
                kind: ConnKind::Arrive,
                t,
            }) => {
                let Some(arrived) = arrived_at.filter(|&a| a > t + SAME_ARRIVAL_MS) else {
                    return Ok(());
                };
                let removed = removed_at.filter(|&r| r > t && r <= arrived);
                let came_with_boot = t < boot && (boot..=boot + BOOT_WINDOW_MS).contains(&arrived);
                if !(came_with_boot && removed.is_none()) {
                    self.push(
                        instance_id,
                        ConnEvent {
                            t: removed.unwrap_or(arrived),
                            kind: ConnKind::Remove,
                        },
                    )?;
                }
                // Either way it's here since `arrived`. With no drop pushed
                // above, it came up with the boot and never recorded leaving:
                // the restart, not a drop, and this is the new baseline.
                self.push(
                    instance_id,
                    ConnEvent {
                        t: arrived,
                        kind: ConnKind::Arrive,
                    },
                )
            }
        }
    }

    /// Number of times the device came back after leaving, and its most recent
    /// events (oldest first).
    pub fn summary(&self, instance_id: &str) -> Result<(u32, Vec<ConnEvent>)> {
        let mut events = self.events(instance_id)?;
        let reconnects = events
            .windows(2)
            .filter(|w| w[0].kind == ConnKind::Remove && w[1].kind == ConnKind::Arrive)
            .count() as u32;
        events.drain(..events.len().saturating_sub(SUMMARY_EVENTS));
        Ok((reconnects, events))
    }

    /// Drop events older than the retention window, and devices left with none.
    /// A device's latest event is kept whatever its age if it's an arrival, so a
    /// device that has sat connected for months still knows when it arrived.
    /// Returns how many events went.
    pub fn prune(&self, now: i64) -> Result<usize> {
        self.write(|h| {
            h.conn
                .prepare_cached(
                    "DELETE FROM events WHERE t < ?1 AND id NOT IN (
                        SELECT id FROM (
                            SELECT id, kind, ROW_NUMBER() OVER (
                                PARTITION BY device ORDER BY t DESC, id DESC
                            ) AS newest
                            FROM events
                        ) WHERE newest = 1 AND kind = 'arrive'
                    )",
                )?
                .execute([now - MAX_AGE_MS])
        })
    }

    /// Whether nothing has been recorded.
    fn is_empty(&self) -> Result<bool> {
        self.conn
            .query_row("SELECT NOT EXISTS (SELECT 1 FROM events)", [], |row| {
                row.get(0)
            })
    }

    /// Add every event from a legacy JSON file, as one transaction. Returns how
    /// many were added.
    fn import(&self, file: LegacyFile) -> Result<usize> {
        self.write(|h| {
            let mut insert = h
                .conn
                .prepare_cached("INSERT INTO events (device, t, kind) VALUES (?1, ?2, ?3)")?;
            let mut added = 0;
            for (instance_id, events) in file.into_devices() {
                let device = key(&instance_id);
                for event in events {
                    insert.execute(params![device, event.t, event.kind])?;
                    added += 1;
                }
            }
            Ok(added)
        })
    }

    /// Fill in each device's reconnect count and recent events, after squaring
    /// the record with the arrival dates Windows reports for it. One transaction
    /// for the whole pass.
    pub fn decorate(&self, devices: &mut [DeviceInfo], now: i64, boot: i64) -> Result<()> {
        self.write(|h| {
            for device in devices.iter_mut() {
                h.reconcile(
                    &device.instance_id,
                    device.arrived_at,
                    device.last_removed_at,
                    now,
                    boot,
                )?;
                let (reconnects, events) = h.summary(&device.instance_id)?;
                device.reconnects = reconnects;
                device.connection_events = events;
            }
            Ok(())
        })
    }
}

// ── The JSON file v0.7.0 and v0.7.1 used ─────────────────────────────────

/// `{"version":1,"devices":{"<INSTANCE ID>":[{"t":…,"kind":"arrive"},…]}}`.
/// v0.7.0 wrote no `version`.
#[derive(Deserialize)]
struct LegacyFile {
    #[serde(default)]
    version: u32,
    devices: HashMap<String, Vec<ConnEvent>>,
}

impl LegacyFile {
    /// Each device's events, with v0.7.0's made-up restart drops taken out.
    fn into_devices(self) -> impl Iterator<Item = (String, Vec<ConnEvent>)> {
        let repair = self.version < 1;
        self.devices.into_iter().map(move |(id, events)| {
            let events = if repair {
                forget_restart_drops(&events)
            } else {
                events
            };
            (id, events)
        })
    }
}

/// Undo the drops v0.7.0 made up. It read every arrival date later than its
/// record as a drop, and with no removal date to go on stamped the removal at
/// the arrival's own millisecond. A restart did that to every device at once.
/// Nothing else lands a removal and an arrival on the same millisecond, so each
/// such pair goes and the arrival stays, as a new baseline.
fn forget_restart_drops(events: &[ConnEvent]) -> Vec<ConnEvent> {
    events
        .iter()
        .enumerate()
        .filter(|&(i, event)| {
            let made_up = event.kind == ConnKind::Remove
                && events
                    .get(i + 1)
                    .is_some_and(|next| next.kind == ConnKind::Arrive && next.t == event.t);
            !made_up
        })
        .map(|(_, &event)| event)
        .collect()
}

/// Bring in the history from the JSON file in `dir`, if there is one and the
/// database is still empty, then rename the file so it's plainly done with.
/// The emptiness check is what makes this once only: after a successful
/// import, a rename that failed can't cause a second one.
fn import_legacy(history: &History, dir: &Path) -> Result<()> {
    let path = dir.join(LEGACY_FILE);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Ok(());
    };
    if !history.is_empty()? {
        return Ok(());
    }
    let file = match serde_json::from_str::<LegacyFile>(&text) {
        Ok(file) => file,
        Err(e) => {
            log::warn!("Not importing unreadable {}: {e}", path.display());
            return Ok(());
        }
    };
    let added = history.import(file)?;
    log::info!("Imported {added} connection events from {}", path.display());
    if let Err(e) = std::fs::rename(&path, dir.join(LEGACY_IMPORTED)) {
        log::warn!("Imported {} but could not rename it: {e}", path.display());
    }
    Ok(())
}

// ── Process-wide store ───────────────────────────────────────────────────

struct Store {
    history: History,
    /// When events past the retention window were last trimmed.
    pruned_at: i64,
}

static STORE: OnceLock<Mutex<Store>> = OnceLock::new();

/// Until [`init`] opens the file, and if it can't, the history is kept in
/// memory: the app works, the record just doesn't outlive it.
fn store() -> &'static Mutex<Store> {
    STORE.get_or_init(|| {
        Mutex::new(Store {
            history: History::open_in_memory().expect("an in-memory SQLite database opens"),
            pruned_at: 0,
        })
    })
}

/// Run `f` against the shared history, logging what fails. The history is a
/// record, not something the device list depends on, so a failure is reported
/// and the app carries on.
fn with<R>(what: &str, f: impl FnOnce(&mut Store) -> Result<R>) -> Option<R> {
    // A panic can't leave the connection mid-transaction (`WriteTxn` rolls
    // back), so a poisoned lock is safe to keep using.
    let mut store = store().lock().unwrap_or_else(PoisonError::into_inner);
    f(&mut store)
        .inspect_err(|e| log::warn!("Connection history: could not {what}: {e}"))
        .ok()
}

/// Milliseconds since the Unix epoch, now.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// When the machine booted, in milliseconds since the Unix epoch: now minus the
/// system uptime. (Fast Startup doesn't disturb this: the uptime clock and
/// Windows' recorded boot time agree.)
pub fn boot_ms() -> i64 {
    let uptime = unsafe { windows::Win32::System::SystemInformation::GetTickCount64() } as i64;
    now_ms() - uptime
}

/// Open the history database in `dir`, importing the old JSON file on first
/// run. Call once at startup, before the first enumeration.
pub fn init(dir: &Path) {
    if let Err(e) = std::fs::create_dir_all(dir) {
        log::warn!("Could not create {}: {e}", dir.display());
    }
    let path = dir.join(DB_FILE);
    let history = match History::open(&path) {
        Ok(history) => history,
        Err(e) => {
            log::warn!(
                "Could not open {}; connection history won't persist: {e}",
                path.display()
            );
            return;
        }
    };
    if let Err(e) = import_legacy(&history, dir) {
        log::warn!("Could not import the old connection history: {e}");
    }
    let mut store = store().lock().unwrap_or_else(PoisonError::into_inner);
    store.history = history;
    store.pruned_at = 0;
}

/// Fill in `devices`' reconnect counts and events from the shared history, as
/// of now ([`History::decorate`]). Also trims old events, at most hourly.
pub fn decorate(devices: &mut [DeviceInfo]) {
    let (now, boot) = (now_ms(), boot_ms());
    with("update the device list's history", |store| {
        if now - store.pruned_at >= PRUNE_EVERY_MS {
            store.history.prune(now)?;
            store.pruned_at = now;
        }
        store.history.decorate(devices, now, boot)
    });
}

/// Record a PnP arrival notification ([`History::record_arrival`]).
pub fn record_arrival(instance_id: &str, now: i64) {
    with("record an arrival", |store| {
        store.history.record_arrival(instance_id, now)
    });
}

/// Record a removal ([`History::record_removal`]).
pub fn record_removal(instance_id: &str, now: i64) {
    with("record a removal", |store| {
        store.history.record_removal(instance_id, now)
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "USB\\VID_1234&PID_5678\\SERIAL";
    const S: i64 = 1_000;
    /// Well before every test's events, so no arrival reads as coming with a boot
    /// unless a test says so.
    const BOOT: i64 = -1_000_000 * S;

    fn history() -> History {
        History::open_in_memory().unwrap()
    }

    fn summary(h: &History) -> (u32, Vec<ConnEvent>) {
        h.summary(ID).unwrap()
    }

    fn kinds(h: &History) -> Vec<ConnKind> {
        summary(h).1.iter().map(|e| e.kind).collect()
    }

    /// A database file in a fresh directory, removed (with its WAL files) at the
    /// end of the test.
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "plugsight-history-{name}-{}-{}",
                std::process::id(),
                now_ms()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn first_sighting_is_a_baseline_not_a_reconnect() {
        let h = history();
        h.reconcile_present(ID, Some(100 * S), None, 500 * S, BOOT)
            .unwrap();
        assert_eq!(
            summary(&h),
            (
                0,
                vec![ConnEvent {
                    t: 100 * S,
                    kind: ConnKind::Arrive
                }]
            )
        );
    }

    #[test]
    fn a_drop_and_return_counts_once() {
        let h = history();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S, BOOT)
            .unwrap();
        h.record_removal(ID, 200 * S).unwrap();
        h.record_arrival(ID, 201 * S).unwrap();
        assert_eq!(summary(&h).0, 1);
        assert_eq!(
            kinds(&h),
            vec![ConnKind::Arrive, ConnKind::Remove, ConnKind::Arrive]
        );
    }

    #[test]
    fn a_restart_without_removal_is_not_a_reconnect() {
        // Disable/enable or a driver restart: "started" with no "removed".
        let h = history();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S, BOOT)
            .unwrap();
        h.record_arrival(ID, 300 * S).unwrap();
        h.record_arrival(ID, 301 * S).unwrap();
        assert_eq!(summary(&h).0, 0);
        assert_eq!(kinds(&h), vec![ConnKind::Arrive]);
    }

    #[test]
    fn duplicate_removals_and_arrivals_collapse() {
        // ENUMERATED and STARTED both fire for one arrival.
        let h = history();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S, BOOT)
            .unwrap();
        h.record_removal(ID, 200 * S).unwrap();
        h.record_removal(ID, 200 * S).unwrap();
        h.record_arrival(ID, 205 * S).unwrap();
        h.record_arrival(ID, 205 * S).unwrap();
        assert_eq!(summary(&h).0, 1);
        assert_eq!(summary(&h).1.len(), 3);
    }

    #[test]
    fn windows_dates_fill_in_a_cycle_we_never_saw() {
        // Recorded arriving at 100 s; Windows now says it last arrived at 900 s
        // and was removed at 850 s — the app was closed at the time.
        let h = history();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S, BOOT)
            .unwrap();
        h.reconcile_present(ID, Some(900 * S), Some(850 * S), 1_000 * S, BOOT)
            .unwrap();
        let (reconnects, events) = summary(&h);
        assert_eq!(reconnects, 1);
        assert_eq!(
            events[1..],
            [
                ConnEvent {
                    t: 850 * S,
                    kind: ConnKind::Remove
                },
                ConnEvent {
                    t: 900 * S,
                    kind: ConnKind::Arrive
                }
            ]
        );
    }

    #[test]
    fn a_notified_arrival_and_windows_date_are_the_same_arrival() {
        let h = history();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S, BOOT)
            .unwrap();
        h.record_removal(ID, 200 * S).unwrap();
        h.record_arrival(ID, 201 * S).unwrap();
        // The next pass reads Windows' arrival date, a moment before our stamp.
        h.reconcile_present(ID, Some(201 * S - 30), Some(200 * S), 202 * S, BOOT)
            .unwrap();
        assert_eq!(summary(&h).0, 1);
    }

    #[test]
    fn a_return_whose_notification_was_missed_is_recorded_on_the_next_pass() {
        let h = history();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S, BOOT)
            .unwrap();
        h.record_removal(ID, 200 * S).unwrap();
        h.reconcile_present(ID, Some(260 * S), Some(200 * S), 300 * S, BOOT)
            .unwrap();
        let (reconnects, events) = summary(&h);
        assert_eq!(reconnects, 1);
        assert_eq!(
            events.last(),
            Some(&ConnEvent {
                t: 260 * S,
                kind: ConnKind::Arrive
            })
        );
    }

    #[test]
    fn a_removal_date_outside_the_gap_is_not_trusted() {
        let h = history();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S, BOOT)
            .unwrap();
        // A removal date from before the recorded arrival is stale.
        h.reconcile_present(ID, Some(900 * S), Some(50 * S), 1_000 * S, BOOT)
            .unwrap();
        assert_eq!(
            summary(&h).1[1],
            ConnEvent {
                t: 900 * S,
                kind: ConnKind::Remove
            }
        );
    }

    #[test]
    fn a_restart_is_not_a_drop() {
        // Here since 100 s; the machine restarts at 1000 s and Windows re-stamps
        // the arrival 30 s into the boot, with no removal on record.
        let boot = 1_000 * S;
        let h = history();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S, BOOT)
            .unwrap();
        h.reconcile_present(ID, Some(boot + 30 * S), None, boot + 60 * S, boot)
            .unwrap();
        let (reconnects, events) = summary(&h);
        assert_eq!(reconnects, 0);
        assert_eq!(kinds(&h), vec![ConnKind::Arrive, ConnKind::Arrive]);
        assert_eq!(
            events[1].t,
            boot + 30 * S,
            "the boot arrival is the new baseline"
        );

        // Later passes in the same boot leave it be.
        h.reconcile_present(ID, Some(boot + 30 * S), None, boot + 90 * S, boot)
            .unwrap();
        assert_eq!(summary(&h).1.len(), 2);
    }

    #[test]
    fn a_drop_windows_recorded_before_the_restart_still_counts() {
        let boot = 1_000 * S;
        let h = history();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S, BOOT)
            .unwrap();
        h.reconcile_present(ID, Some(boot + 30 * S), Some(500 * S), boot + 60 * S, boot)
            .unwrap();
        let (reconnects, events) = summary(&h);
        assert_eq!(reconnects, 1);
        assert_eq!(events[1].t, 500 * S);
    }

    #[test]
    fn a_return_well_after_boot_still_counts() {
        // Arrived ten minutes into the boot: it was plugged in again after the
        // machine came up, while the app wasn't watching.
        let boot = 1_000 * S;
        let h = history();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S, BOOT)
            .unwrap();
        h.reconcile_present(ID, Some(boot + 600 * S), None, boot + 700 * S, boot)
            .unwrap();
        assert_eq!(summary(&h).0, 1);
    }

    #[test]
    fn instance_ids_match_case_insensitively() {
        let h = history();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S, BOOT)
            .unwrap();
        h.record_removal(&ID.to_lowercase(), 200 * S).unwrap();
        h.record_arrival(&ID.to_lowercase(), 201 * S).unwrap();
        assert_eq!(summary(&h).0, 1);
    }

    #[test]
    fn prune_drops_old_events_but_keeps_a_long_connected_devices_arrival() {
        let day = 24 * 60 * 60 * S;
        let h = history();
        h.reconcile_present(ID, Some(0), None, 0, BOOT).unwrap();
        h.prune(200 * day).unwrap();
        assert_eq!(summary(&h).1.len(), 1, "the only (old) arrival is kept");

        h.record_removal(ID, 150 * day).unwrap();
        h.record_arrival(ID, 150 * day + S).unwrap();
        h.prune(200 * day).unwrap();
        let events = summary(&h).1;
        assert_eq!(
            events.first().unwrap().t,
            150 * day,
            "events past 90 days are gone"
        );
    }

    #[test]
    fn prune_forgets_devices_long_gone() {
        let day = 24 * 60 * 60 * S;
        let h = history();
        h.reconcile_present(ID, Some(0), None, 0, BOOT).unwrap();
        h.record_removal(ID, S).unwrap();
        assert_eq!(h.prune(200 * day).unwrap(), 2);
        assert_eq!(summary(&h), (0, Vec::new()));
        assert!(h.is_empty().unwrap());
    }

    #[test]
    fn events_are_capped_per_device() {
        let h = history();
        h.reconcile_present(ID, Some(0), None, 0, BOOT).unwrap();
        for i in 1..=500 {
            h.record_removal(ID, i * 10 * S).unwrap();
            h.record_arrival(ID, i * 10 * S + S).unwrap();
        }
        assert_eq!(h.events(ID).unwrap().len(), MAX_EVENTS);
        assert_eq!(summary(&h).1.len(), SUMMARY_EVENTS);
        assert_eq!(
            h.events(ID).unwrap().last().unwrap().t,
            500 * 10 * S + S,
            "the newest are the ones kept"
        );
    }

    #[test]
    fn persists_across_reopening() {
        let dir = TempDir::new("reopen");
        let path = dir.0.join(DB_FILE);
        {
            let h = History::open(&path).unwrap();
            h.reconcile_present(ID, Some(100 * S), None, 100 * S, BOOT)
                .unwrap();
            h.record_removal(ID, 200 * S).unwrap();
        }
        let h = History::open(&path).unwrap();
        assert_eq!(kinds(&h), vec![ConnKind::Arrive, ConnKind::Remove]);
    }

    #[test]
    fn two_connections_to_one_file_keep_each_others_events() {
        // What two running copies of the app used to get wrong: each recording
        // an event must not lose the other's.
        let dir = TempDir::new("shared");
        let path = dir.0.join(DB_FILE);
        let a = History::open(&path).unwrap();
        let b = History::open(&path).unwrap();
        a.reconcile_present(ID, Some(100 * S), None, 100 * S, BOOT)
            .unwrap();
        b.record_removal(ID, 200 * S).unwrap();
        a.record_arrival(ID, 201 * S).unwrap();
        assert_eq!(summary(&b).0, 1);
        assert_eq!(summary(&a), summary(&b));
    }

    #[test]
    fn a_failed_pass_leaves_no_half_written_events() {
        let h = history();
        let result: Result<()> = h.write(|h| {
            h.push(
                ID,
                ConnEvent {
                    t: 100 * S,
                    kind: ConnKind::Arrive,
                },
            )?;
            Err(rusqlite::Error::InvalidQuery)
        });
        assert!(result.is_err());
        assert!(h.is_empty().unwrap());
        // And the connection is usable afterwards.
        h.record_arrival(ID, 100 * S).unwrap();
        assert_eq!(summary(&h).1.len(), 1);
    }

    #[test]
    fn a_v0_file_loses_its_restart_drops_on_import() {
        // As v0.7.0 saved it: a real drop (distinct times), then a restart it
        // recorded as a removal and arrival on the same millisecond.
        let text = r#"{"devices":{"USB\\VID_1234&PID_5678\\SERIAL":[
            {"t":100000,"kind":"arrive"},
            {"t":200000,"kind":"remove"},{"t":201000,"kind":"arrive"},
            {"t":900000,"kind":"remove"},{"t":900000,"kind":"arrive"}]}}"#;
        let h = history();
        h.import(serde_json::from_str(text).unwrap()).unwrap();
        let (reconnects, events) = summary(&h);
        assert_eq!(reconnects, 1, "the real drop stays");
        assert_eq!(events.len(), 4);
        assert_eq!(events.last().unwrap().t, 900 * S);
    }

    #[test]
    fn a_v1_file_is_imported_as_is() {
        let text = r#"{"version":1,"devices":{"usb\\vid_1234&pid_5678\\serial":[
            {"t":100000,"kind":"arrive"},
            {"t":900000,"kind":"remove"},{"t":900000,"kind":"arrive"}]}}"#;
        let h = history();
        h.import(serde_json::from_str(text).unwrap()).unwrap();
        assert_eq!(
            summary(&h).0,
            1,
            "same-millisecond pairs are only repaired in v0"
        );
    }

    #[test]
    fn the_json_file_is_imported_once_and_renamed() {
        let dir = TempDir::new("import");
        let legacy = dir.0.join(LEGACY_FILE);
        std::fs::write(
            &legacy,
            r#"{"version":1,"devices":{"USB\\VID_1234&PID_5678\\SERIAL":[{"t":100000,"kind":"arrive"}]}}"#,
        )
        .unwrap();
        let h = History::open(&dir.0.join(DB_FILE)).unwrap();
        import_legacy(&h, &dir.0).unwrap();
        assert_eq!(summary(&h).1.len(), 1);
        assert!(!legacy.exists());
        assert!(dir.0.join(LEGACY_IMPORTED).exists(), "renamed, not deleted");

        // A JSON file that turns up again later isn't merged into a history
        // that's already in use.
        std::fs::copy(dir.0.join(LEGACY_IMPORTED), &legacy).unwrap();
        import_legacy(&h, &dir.0).unwrap();
        assert_eq!(summary(&h).1.len(), 1);
    }

    #[test]
    fn an_unreadable_json_file_is_left_alone() {
        let dir = TempDir::new("bad-json");
        let legacy = dir.0.join(LEGACY_FILE);
        std::fs::write(&legacy, "not json").unwrap();
        let h = History::open(&dir.0.join(DB_FILE)).unwrap();
        import_legacy(&h, &dir.0).unwrap();
        assert!(h.is_empty().unwrap());
        assert!(legacy.exists());
    }

    #[test]
    fn reopening_runs_no_migration_twice() {
        let dir = TempDir::new("migrate");
        let path = dir.0.join(DB_FILE);
        drop(History::open(&path).unwrap());
        let h = History::open(&path).unwrap();
        let version: i64 = h
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
    }
}
