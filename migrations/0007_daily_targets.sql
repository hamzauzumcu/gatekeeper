-- Per-account daily CV-processing target + DB-based activity tracking.
-- Each user (from src/lib/auth.ts) sets their own daily target; progress is
-- derived from the actions they take each day (fit-status changes, notes).

CREATE TABLE account_settings (
  username        TEXT PRIMARY KEY,
  daily_cv_target INTEGER NOT NULL DEFAULT 20,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- One row per counted action. Daily progress = COUNT(DISTINCT applicant_id)
-- per user per day, so multiple actions on the same candidate count once.
CREATE TABLE daily_activity (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL,
  activity_date TEXT    NOT NULL,                 -- 'YYYY-MM-DD' (UTC)
  applicant_id  INTEGER NOT NULL,
  action_type   TEXT    NOT NULL CHECK (action_type IN ('fit_status_set', 'note_added')),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_daily_activity_user_date ON daily_activity (username, activity_date);
