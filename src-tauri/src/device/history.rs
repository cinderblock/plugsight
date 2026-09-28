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
//! fires "started" without "removed", and isn't a reconnect.
//!
//! The history is kept per instance ID, persisted as JSON in the app data dir,
//! and trimmed by age and count so a long-running machine doesn't grow it without
//! bound.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use super::types::DeviceInfo;

/// Tolerance when comparing a recorded arrival with Windows' arrival date: the
/// notification and the property are stamped by different code a few
/// milliseconds apart, and must not read as two separate arrivals.
const SAME_ARRIVAL_MS: i64 = 5_000;
/// Oldest event kept.
const MAX_AGE_MS: i64 = 90 * 24 * 60 * 60 * 1000;
/// Most events kept per device.
const MAX_EVENTS: usize = 400;
/// Most events sent to the frontend per device.
const SUMMARY_EVENTS: usize = 100;

/// One arrival or removal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnEvent {
    /// Milliseconds since the Unix epoch.
    pub t: i64,
    pub kind: ConnKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnKind {
    Arrive,
    Remove,
}

/// The pure event store. All times are passed in, so it's testable.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct History {
    /// Keyed by upper-cased instance ID; events in time order.
    devices: HashMap<String, Vec<ConnEvent>>,
    #[serde(skip)]
    dirty: bool,
}

impl History {
    fn events_mut(&mut self, instance_id: &str) -> &mut Vec<ConnEvent> {
        self.devices
            .entry(instance_id.to_ascii_uppercase())
            .or_default()
    }

    fn push(&mut self, instance_id: &str, event: ConnEvent) {
        let events = self.events_mut(instance_id);
        // Keep order even if two sources stamp slightly out of sequence.
        let t = events.last().map_or(event.t, |last| event.t.max(last.t));
        events.push(ConnEvent { t, ..event });
        if events.len() > MAX_EVENTS {
            let excess = events.len() - MAX_EVENTS;
            events.drain(..excess);
        }
        self.dirty = true;
    }

    fn last(&self, instance_id: &str) -> Option<ConnEvent> {
        self.devices
            .get(&instance_id.to_ascii_uppercase())
            .and_then(|events| events.last().copied())
    }

    /// The device arrived (enumerated or started). Counts only if it's new to
    /// us or its last recorded event was a removal.
    pub fn record_arrival(&mut self, instance_id: &str, now: i64) {
        match self.last(instance_id) {
            Some(ConnEvent {
                kind: ConnKind::Arrive,
                ..
            }) => {}
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
    pub fn record_removal(&mut self, instance_id: &str, now: i64) {
        match self.last(instance_id) {
            Some(ConnEvent {
                kind: ConnKind::Remove,
                ..
            }) => {}
            _ => self.push(
                instance_id,
                ConnEvent {
                    t: now,
                    kind: ConnKind::Remove,
                },
            ),
        }
    }

    /// Square the record with what Windows says about a device that is present
    /// right now. `arrived_at` / `removed_at` are Windows' last arrival and
    /// removal dates.
    pub fn reconcile_present(
        &mut self,
        instance_id: &str,
        arrived_at: Option<i64>,
        removed_at: Option<i64>,
        now: i64,
    ) {
        match self.last(instance_id) {
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
            // later: it dropped and came back without us seeing either.
            Some(ConnEvent {
                kind: ConnKind::Arrive,
                t,
            }) => {
                if let Some(arrived) = arrived_at
                    && arrived > t + SAME_ARRIVAL_MS
                {
                    let removed = removed_at
                        .filter(|&r| r > t && r <= arrived)
                        .unwrap_or(arrived);
                    self.push(
                        instance_id,
                        ConnEvent {
                            t: removed,
                            kind: ConnKind::Remove,
                        },
                    );
                    self.push(
                        instance_id,
                        ConnEvent {
                            t: arrived,
                            kind: ConnKind::Arrive,
                        },
                    );
                }
            }
        }
    }

    /// Number of times the device came back after leaving, and its most recent
    /// events (oldest first).
    pub fn summary(&self, instance_id: &str) -> (u32, Vec<ConnEvent>) {
        let Some(events) = self.devices.get(&instance_id.to_ascii_uppercase()) else {
            return (0, Vec::new());
        };
        let reconnects = events
            .windows(2)
            .filter(|w| w[0].kind == ConnKind::Remove && w[1].kind == ConnKind::Arrive)
            .count() as u32;
        let recent = events[events.len().saturating_sub(SUMMARY_EVENTS)..].to_vec();
        (reconnects, recent)
    }

    /// Drop events older than the retention window, and devices left with none.
    /// A device's latest event is kept whatever its age, so a device that has sat
    /// connected for months still knows when it arrived.
    pub fn prune(&mut self, now: i64) {
        let cutoff = now - MAX_AGE_MS;
        let before = self.devices.len();
        self.devices.retain(|_, events| {
            let Some(&last) = events.last() else {
                return false;
            };
            if last.t < cutoff && last.kind == ConnKind::Remove {
                return false; // gone for good
            }
            let keep_from = events
                .iter()
                .position(|e| e.t >= cutoff)
                .unwrap_or(events.len() - 1);
            if keep_from > 0 {
                events.drain(..keep_from);
            }
            true
        });
        if self.devices.len() != before {
            self.dirty = true;
        }
    }

    /// Fill in each device's reconnect count and recent events, after squaring
    /// the record with the arrival dates Windows reports for it.
    pub fn decorate(&mut self, devices: &mut [DeviceInfo], now: i64) {
        for device in devices.iter_mut() {
            self.reconcile_present(
                &device.instance_id,
                device.arrived_at,
                device.last_removed_at,
                now,
            );
            let (reconnects, events) = self.summary(&device.instance_id);
            device.reconnects = reconnects;
            device.connection_events = events;
        }
    }
}

// ── Process-wide store + persistence ─────────────────────────────────────

struct Store {
    history: History,
    path: Option<PathBuf>,
}

static STORE: OnceLock<Mutex<Store>> = OnceLock::new();

fn store() -> &'static Mutex<Store> {
    STORE.get_or_init(|| {
        Mutex::new(Store {
            history: History::default(),
            path: None,
        })
    })
}

/// Milliseconds since the Unix epoch, now.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Load the history from `dir/connection-history.json` and remember the path
/// for saving. Call once at startup, before the first enumeration.
pub fn init(dir: &Path) {
    let path = dir.join("connection-history.json");
    let mut history = match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<History>(&text).unwrap_or_else(|e| {
            log::warn!(
                "Ignoring unreadable connection history {}: {e}",
                path.display()
            );
            History::default()
        }),
        Err(_) => History::default(),
    };
    history.prune(now_ms());
    if let Ok(mut store) = store().lock() {
        store.history = history;
        store.path = Some(path);
    }
}

/// Run `f` against the shared history.
pub fn with<R>(f: impl FnOnce(&mut History) -> R) -> Option<R> {
    store().lock().ok().map(|mut store| f(&mut store.history))
}

/// Write the history out if anything changed since the last save. The write
/// goes to a temp file first so a crash mid-write can't corrupt the record.
pub fn save_if_dirty() {
    let Ok(mut store) = store().lock() else {
        return;
    };
    if !store.history.dirty {
        return;
    }
    let Some(path) = store.path.clone() else {
        return;
    };
    store.history.prune(now_ms());
    let text = match serde_json::to_string(&store.history) {
        Ok(text) => text,
        Err(e) => {
            log::warn!("Could not serialize connection history: {e}");
            return;
        }
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("json.tmp");
    match std::fs::write(&tmp, text).and_then(|_| std::fs::rename(&tmp, &path)) {
        Ok(()) => store.history.dirty = false,
        Err(e) => log::warn!("Could not save connection history {}: {e}", path.display()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "USB\\VID_1234&PID_5678\\SERIAL";
    const S: i64 = 1_000;

    fn kinds(h: &History) -> Vec<ConnKind> {
        h.summary(ID).1.iter().map(|e| e.kind).collect()
    }

    #[test]
    fn first_sighting_is_a_baseline_not_a_reconnect() {
        let mut h = History::default();
        h.reconcile_present(ID, Some(100 * S), None, 500 * S);
        let (reconnects, events) = h.summary(ID);
        assert_eq!(reconnects, 0);
        assert_eq!(
            events,
            vec![ConnEvent {
                t: 100 * S,
                kind: ConnKind::Arrive
            }]
        );
    }

    #[test]
    fn a_drop_and_return_counts_once() {
        let mut h = History::default();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S);
        h.record_removal(ID, 200 * S);
        h.record_arrival(ID, 201 * S);
        assert_eq!(h.summary(ID).0, 1);
        assert_eq!(
            kinds(&h),
            vec![ConnKind::Arrive, ConnKind::Remove, ConnKind::Arrive]
        );
    }

    #[test]
    fn a_restart_without_removal_is_not_a_reconnect() {
        // Disable/enable or a driver restart: "started" with no "removed".
        let mut h = History::default();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S);
        h.record_arrival(ID, 300 * S);
        h.record_arrival(ID, 301 * S);
        assert_eq!(h.summary(ID).0, 0);
        assert_eq!(kinds(&h), vec![ConnKind::Arrive]);
    }

    #[test]
    fn duplicate_removals_and_arrivals_collapse() {
        // ENUMERATED and STARTED both fire for one arrival.
        let mut h = History::default();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S);
        h.record_removal(ID, 200 * S);
        h.record_removal(ID, 200 * S);
        h.record_arrival(ID, 205 * S);
        h.record_arrival(ID, 205 * S);
        assert_eq!(h.summary(ID).0, 1);
        assert_eq!(h.summary(ID).1.len(), 3);
    }

    #[test]
    fn windows_dates_fill_in_a_cycle_we_never_saw() {
        // Recorded arriving at 100 s; Windows now says it last arrived at 900 s
        // and was removed at 850 s — the app was closed at the time.
        let mut h = History::default();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S);
        h.reconcile_present(ID, Some(900 * S), Some(850 * S), 1_000 * S);
        let (reconnects, events) = h.summary(ID);
        assert_eq!(reconnects, 1);
        assert_eq!(
            events[1],
            ConnEvent {
                t: 850 * S,
                kind: ConnKind::Remove
            }
        );
        assert_eq!(
            events[2],
            ConnEvent {
                t: 900 * S,
                kind: ConnKind::Arrive
            }
        );
    }

    #[test]
    fn a_notified_arrival_and_windows_date_are_the_same_arrival() {
        let mut h = History::default();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S);
        h.record_removal(ID, 200 * S);
        h.record_arrival(ID, 201 * S);
        // The next pass reads Windows' arrival date, a moment before our stamp.
        h.reconcile_present(ID, Some(201 * S - 30), Some(200 * S), 202 * S);
        assert_eq!(h.summary(ID).0, 1);
    }

    #[test]
    fn a_return_whose_notification_was_missed_is_recorded_on_the_next_pass() {
        let mut h = History::default();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S);
        h.record_removal(ID, 200 * S);
        h.reconcile_present(ID, Some(260 * S), Some(200 * S), 300 * S);
        let (reconnects, events) = h.summary(ID);
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
        let mut h = History::default();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S);
        // A removal date from before the recorded arrival is stale.
        h.reconcile_present(ID, Some(900 * S), Some(50 * S), 1_000 * S);
        assert_eq!(
            h.summary(ID).1[1],
            ConnEvent {
                t: 900 * S,
                kind: ConnKind::Remove
            }
        );
    }

    #[test]
    fn instance_ids_match_case_insensitively() {
        let mut h = History::default();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S);
        h.record_removal(&ID.to_lowercase(), 200 * S);
        h.record_arrival(&ID.to_lowercase(), 201 * S);
        assert_eq!(h.summary(ID).0, 1);
    }

    #[test]
    fn prune_drops_old_events_but_keeps_a_long_connected_devices_arrival() {
        let day = 24 * 60 * 60 * S;
        let mut h = History::default();
        h.reconcile_present(ID, Some(0), None, 0);
        h.prune(200 * day);
        assert_eq!(h.summary(ID).1.len(), 1, "the only (old) arrival is kept");

        h.record_removal(ID, 150 * day);
        h.record_arrival(ID, 150 * day + S);
        h.prune(200 * day);
        let events = h.summary(ID).1;
        assert_eq!(
            events.first().unwrap().t,
            150 * day,
            "events past 90 days are gone"
        );
    }

    #[test]
    fn prune_forgets_devices_long_gone() {
        let day = 24 * 60 * 60 * S;
        let mut h = History::default();
        h.reconcile_present(ID, Some(0), None, 0);
        h.record_removal(ID, S);
        h.prune(200 * day);
        assert_eq!(h.summary(ID), (0, Vec::new()));
    }

    #[test]
    fn events_are_capped_per_device() {
        let mut h = History::default();
        h.reconcile_present(ID, Some(0), None, 0);
        for i in 1..=500 {
            h.record_removal(ID, i * 10 * S);
            h.record_arrival(ID, i * 10 * S + S);
        }
        assert_eq!(h.devices[&ID.to_ascii_uppercase()].len(), MAX_EVENTS);
        assert_eq!(h.summary(ID).1.len(), SUMMARY_EVENTS);
    }

    #[test]
    fn round_trips_through_json() {
        let mut h = History::default();
        h.reconcile_present(ID, Some(100 * S), None, 100 * S);
        h.record_removal(ID, 200 * S);
        let text = serde_json::to_string(&h).unwrap();
        let back: History = serde_json::from_str(&text).unwrap();
        assert_eq!(back.summary(ID), h.summary(ID));
    }
}
