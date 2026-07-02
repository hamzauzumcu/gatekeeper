-- Employees registry. Distinct from `users` (app logins): these are the people
-- whose time-off we track. Leave requests arrive from a Tally form / CSV with a
-- free-text name; an admin maps each request to a canonical employee here (one
-- employee can cover several name variants, e.g. "Jerson" and "Jerson Ruban").
-- annual_quota is reserved for future leave-balance reporting.
CREATE TABLE employees (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,               -- canonical display name
  email        TEXT,
  department   TEXT,
  annual_quota REAL,                                  -- annual leave entitlement in days (optional)
  is_active    INTEGER NOT NULL DEFAULT 1,            -- 0 hides from pickers
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
