-- Candidate timeline / audit log. One append-only row per meaningful action on
-- a candidate so the detail panel can show a chronological history:
--   - fit_status_changed    (applicant-level: maybe -> good_fit)
--   - pipeline_status_changed (per application: outreach -> interviewing)
--   - note_added / note_deleted
--
-- This is distinct from daily_activity (which only counts distinct candidates
-- per user per day for the progress widget). Events are never updated; we only
-- INSERT and read them back ordered by created_at.
--
-- from_value/to_value hold the old/new state for status changes (null when a
-- value was first set or cleared). application_id ties a pipeline event to the
-- application it happened on (and is set null if that application is later
-- deleted, so the event survives). metadata is free-form JSON for extra display
-- context (position_title, note_id, note excerpt). actor/actor_name identify who
-- did it, mirroring candidate_notes.created_by/created_by_name.
CREATE TABLE candidate_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id   INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  event_type     TEXT    NOT NULL CHECK (event_type IN (
                   'fit_status_changed', 'pipeline_status_changed', 'note_added', 'note_deleted'
                 )),
  from_value     TEXT,
  to_value       TEXT,
  application_id  INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  metadata       TEXT,
  actor          TEXT    NOT NULL,
  actor_name     TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_events_applicant ON candidate_events(applicant_id, created_at);
