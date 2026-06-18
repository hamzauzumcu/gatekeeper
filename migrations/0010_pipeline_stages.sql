-- Repurpose applications.status into a hiring-pipeline stage (kanban board).
--
-- The old CHECK only allowed ('new','reviewed','shortlisted','rejected'). That
-- column was never used in production, so we repurpose it into an ordered
-- recruiting pipeline:
--   shortlisted → outreach → interviewing → interviewed → hired
-- plus 'rejected' as a terminal exit state. 'shortlisted' is the entry/default
-- stage. The board renders one column per stage; the order lives in the app
-- (lib/candidates.ts PIPELINE_STAGES). Legacy 'new'/'reviewed' rows collapse
-- into 'shortlisted' on copy (see the CASE below).
--
-- SQLite can't ALTER a CHECK constraint in place, so we rebuild the table.
-- application_answers references applications(id) ON DELETE CASCADE, so we stash
-- those rows aside first — that way DROP TABLE applications has no children to
-- cascade-delete — then restore them. defer_foreign_keys keeps the FK check
-- satisfied across the swap (it's re-enabled automatically at commit).

PRAGMA defer_foreign_keys = TRUE;

-- 1) New applications table with the widened status CHECK (schema mirrors
--    0001 + the columns added by 0002/0004/0005/0006).
CREATE TABLE applications_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id         INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  position_id          INTEGER NOT NULL REFERENCES job_positions(id) ON DELETE CASCADE,
  resume_url           TEXT,
  cover_letter         TEXT,
  status               TEXT    NOT NULL DEFAULT 'shortlisted'
                        CHECK (status IN ('shortlisted','outreach','interviewing','interviewed','hired','rejected')),
  submitted_at         TEXT,
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  tally_submission_id  TEXT,
  resume_text          TEXT,
  resume_parsed        TEXT,
  resume_parse_version INTEGER NOT NULL DEFAULT 0,
  ai_score             INTEGER,
  ai_score_reasoning   TEXT,
  ai_score_version     INTEGER NOT NULL DEFAULT 0,
  ai_scored_at         TEXT,
  ai_scored_prompt_at  TEXT
);

INSERT INTO applications_new (
  id, applicant_id, position_id, resume_url, cover_letter, status, submitted_at, created_at,
  tally_submission_id, resume_text, resume_parsed, resume_parse_version,
  ai_score, ai_score_reasoning, ai_score_version, ai_scored_at, ai_scored_prompt_at
)
SELECT
  id, applicant_id, position_id, resume_url, cover_letter,
  -- Map legacy values into the new set: only 'rejected' carries over verbatim;
  -- 'new'/'reviewed'/'shortlisted' all become the 'shortlisted' entry stage.
  CASE status WHEN 'rejected' THEN 'rejected' ELSE 'shortlisted' END,
  submitted_at, created_at,
  tally_submission_id, resume_text, resume_parsed, resume_parse_version,
  ai_score, ai_score_reasoning, ai_score_version, ai_scored_at, ai_scored_prompt_at
FROM applications;

-- 2) Stash answers, drop the child so the parent swap can't cascade-delete it.
CREATE TABLE application_answers_bak AS SELECT * FROM application_answers;
DROP TABLE application_answers;

-- 3) Swap the parent table.
DROP TABLE applications;
ALTER TABLE applications_new RENAME TO applications;

CREATE INDEX idx_applications_position  ON applications(position_id);
CREATE INDEX idx_applications_applicant ON applications(applicant_id);
CREATE INDEX idx_applications_status    ON applications(status);

-- 4) Recreate application_answers exactly (0001) and restore its rows.
CREATE TABLE application_answers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id  INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  question_id     INTEGER NOT NULL REFERENCES position_questions(id) ON DELETE CASCADE,
  value           TEXT,
  UNIQUE (application_id, question_id)
);

INSERT INTO application_answers (id, application_id, question_id, value)
SELECT id, application_id, question_id, value FROM application_answers_bak;

DROP TABLE application_answers_bak;

CREATE INDEX idx_answers_application ON application_answers(application_id);
CREATE INDEX idx_answers_question    ON application_answers(question_id);
