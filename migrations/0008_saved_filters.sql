-- Shared, named candidate filter presets. Every user (from src/lib/auth.ts)
-- sees and can edit the same list — saved filters are a team-wide resource.
-- filters_json holds a serialized ActiveFilters object (src/lib/candidates.ts).

CREATE TABLE saved_filters (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  filters_json TEXT    NOT NULL,
  created_by   TEXT    NOT NULL,                 -- username who first saved it
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
