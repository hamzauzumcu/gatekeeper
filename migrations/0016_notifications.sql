-- In-app notifications. Currently produced only by @mentions inside candidate
-- notes: when a note's content references @username (a handle from the users
-- table), the mentioned user gets a row here. read_at NULL means unread.
-- Recipient/actor reference users.username (not id) to match the existing
-- username-based references across the schema (candidate_notes.created_by, etc.).
CREATE TABLE notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient      TEXT    NOT NULL,                    -- username the notification is for
  actor          TEXT    NOT NULL,                    -- username who triggered it (note author)
  actor_name     TEXT    NOT NULL,                    -- display name of the actor at creation time
  type           TEXT    NOT NULL DEFAULT 'mention',  -- room for future kinds
  note_id        INTEGER NOT NULL,                    -- the note that mentioned the recipient
  applicant_id   INTEGER NOT NULL,                    -- where to navigate on click
  applicant_name TEXT,                                -- candidate name for the panel row
  excerpt        TEXT,                                -- short snippet of the note content
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  read_at        TEXT                                 -- NULL = unread
);

-- Drives the unread badge/poll: filter by recipient, partition by read state,
-- newest first.
CREATE INDEX idx_notifications_recipient ON notifications (recipient, read_at, created_at);

-- Speeds up cleanup when a note is edited (avoid re-notifying) or deleted.
CREATE INDEX idx_notifications_note ON notifications (note_id);
