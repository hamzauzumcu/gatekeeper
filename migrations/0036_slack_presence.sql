-- Slack presence tracking (Employees → Presence).
--
-- A cron tick (every minute, see `scheduled` in worker/index.ts) reads the
-- Slack member list and each tracked member's presence. Presence is stored as
-- intervals: one row per continuous stretch of "active", so online time for any
-- day is the sum of the intervals overlapping it. Status messages (text + emoji)
-- are stored as a change log. History is kept for two years
-- (RETENTION_DAYS in worker/slack-presence.ts).

-- New capability, granted separately from leave management. Full-access admins
-- get it implicitly (worker/permissions.ts); everyone else starts without it.
ALTER TABLE users ADD COLUMN perm_view_presence INTEGER NOT NULL DEFAULT 0;

-- One row per Slack workspace member, refreshed from users.list on every tick.
CREATE TABLE slack_users (
  id                  TEXT PRIMARY KEY,               -- Slack user id (U…)
  handle              TEXT NOT NULL,                  -- Slack username
  real_name           TEXT,
  display_name        TEXT,
  email               TEXT,
  avatar_url          TEXT,
  tz                  TEXT,                           -- IANA zone from the Slack profile
  is_deleted          INTEGER NOT NULL DEFAULT 0,
  is_tracked          INTEGER NOT NULL DEFAULT 1,     -- 0 = skipped by the presence poll and hidden
  employee_id         INTEGER REFERENCES employees(id) ON DELETE SET NULL, -- matched by email
  presence            TEXT,                           -- 'active' | 'away' | NULL (never checked)
  presence_checked_at TEXT,
  last_active_at      TEXT,                           -- last tick that saw the member active
  status_text         TEXT,
  status_emoji        TEXT,
  status_expiration   INTEGER,                        -- unix seconds, 0/NULL = no expiry
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Continuous "active" stretches. ended_at is NULL while the member is still
-- active; last_seen_at moves forward on every tick that still sees them active,
-- so a stretch interrupted by a missed tick (cron outage) closes at the last
-- tick that actually observed it rather than running on.
CREATE TABLE slack_presence_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_user_id TEXT NOT NULL REFERENCES slack_users(id) ON DELETE CASCADE,
  started_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  ended_at      TEXT
);
CREATE INDEX idx_presence_sessions_user ON slack_presence_sessions (slack_user_id, started_at);
CREATE INDEX idx_presence_sessions_started ON slack_presence_sessions (started_at);
CREATE INDEX idx_presence_sessions_open ON slack_presence_sessions (slack_user_id) WHERE ended_at IS NULL;

-- Status message history: one row whenever a member's status text/emoji changes.
CREATE TABLE slack_status_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_user_id TEXT NOT NULL REFERENCES slack_users(id) ON DELETE CASCADE,
  at            TEXT NOT NULL,
  status_text   TEXT,
  status_emoji  TEXT
);
CREATE INDEX idx_status_events_user ON slack_status_events (slack_user_id, at);

-- Small key/value store for poll bookkeeping (last run, last error).
CREATE TABLE slack_presence_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
