-- Global app settings (key/value). First use: the interview-notes prompt
-- template shared across all positions. A missing row means "use the built-in
-- default" (worker/interview-notes.ts), so resetting to default is a DELETE.

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
