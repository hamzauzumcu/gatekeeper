-- Emoji reactions and threaded replies on candidate notes.
--
-- Replies are ordinary candidate_notes rows that point at the note they answer
-- via parent_id, so they keep authorship, attachments, mentions and editing for
-- free. NULL parent_id means a top-level note.
ALTER TABLE candidate_notes ADD COLUMN parent_id INTEGER REFERENCES candidate_notes(id) ON DELETE CASCADE;

CREATE INDEX idx_notes_parent ON candidate_notes(parent_id);

-- One row per (note, emoji, user): a user can react with many emojis to the
-- same note but only once with each. user_name is the display name captured at
-- reaction time, used for the "who reacted" tooltip.
CREATE TABLE note_reactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id    INTEGER NOT NULL REFERENCES candidate_notes(id) ON DELETE CASCADE,
  emoji      TEXT    NOT NULL,
  username   TEXT    NOT NULL,
  user_name  TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (note_id, emoji, username)
);

CREATE INDEX idx_note_reactions_note ON note_reactions(note_id);

-- Widen candidate_events.event_type with note_replied (same table-rebuild dance
-- as 0023, since SQLite can't alter a CHECK constraint in place).
PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE candidate_events_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id   INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  event_type     TEXT    NOT NULL CHECK (event_type IN (
                   'fit_status_changed', 'pipeline_status_changed', 'note_added', 'note_replied',
                   'note_deleted', 'scorecard_submitted', 'scorecard_updated'
                 )),
  from_value     TEXT,
  to_value       TEXT,
  application_id  INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  metadata       TEXT,
  actor          TEXT    NOT NULL,
  actor_name     TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO candidate_events_new (
  id, applicant_id, event_type, from_value, to_value, application_id, metadata, actor, actor_name, created_at
)
SELECT id, applicant_id, event_type, from_value, to_value, application_id, metadata, actor, actor_name, created_at
FROM candidate_events;

DROP TABLE candidate_events;
ALTER TABLE candidate_events_new RENAME TO candidate_events;

CREATE INDEX idx_events_applicant ON candidate_events(applicant_id, created_at);
