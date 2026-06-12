-- Aday notları — pozisyondan bağımsız, applicant seviyesinde tutulur.
-- created_by: auth.ts'teki username; created_by_name: görünen ad (fullName).

CREATE TABLE candidate_notes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id    INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  content         TEXT    NOT NULL,
  created_by      TEXT    NOT NULL,
  created_by_name TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_notes_applicant  ON candidate_notes(applicant_id);
CREATE INDEX idx_notes_created_at ON candidate_notes(created_at);
