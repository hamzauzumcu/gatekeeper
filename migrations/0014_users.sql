-- Users registry. Until now users were hardcoded in src/lib/auth.ts; this table
-- makes them a first-class DB entity so features like @mentions can resolve a
-- handle to a real user. Login stays client-side for now (passwords remain in
-- src/lib/auth.ts) — this table is the identity/metadata source of truth that
-- existing username references (candidate_notes.created_by, daily_activity,
-- account_settings, saved_filters.created_by) point at.
CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT    NOT NULL UNIQUE,
  full_name  TEXT    NOT NULL,
  color      TEXT,                                  -- accent color for avatar/mention chip
  is_active  INTEGER NOT NULL DEFAULT 1,            -- 0 hides the user from pickers/mentions
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Seed the existing hardcoded users (keep usernames in sync with src/lib/auth.ts).
INSERT INTO users (username, full_name, color) VALUES
  ('hamza', 'Hamza Üzümcü', '#2563eb'),
  ('kadir', 'Kadir Can Boyacıoğlu', '#16a34a');
