-- Add an 'offer_sent' pipeline stage between 'interviewed' and 'hired'.
--
-- 'offer_sent' marks a candidate who has received an offer but hasn't yet
-- accepted (→ 'hired') or declined (→ 'rejected'). The stage order is defined
-- client-side in lib/candidates.ts PIPELINE_STAGES; this migration only widens
-- the DB CHECK so the value is writable.
--
-- SQLite can't ALTER a CHECK in place, so this is the same table-rebuild +
-- answer-stash dance as 0010/0011. Unlike 0011, existing status values are
-- preserved verbatim — this only adds a newly-allowed value.

PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE applications_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id         INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  position_id          INTEGER NOT NULL REFERENCES job_positions(id) ON DELETE CASCADE,
  resume_url           TEXT,
  cover_letter         TEXT,
  status               TEXT    NOT NULL DEFAULT 'none'
                        CHECK (status IN ('none','shortlisted','outreach','interviewing','interviewed','offer_sent','hired','rejected')),
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
  id, applicant_id, position_id, resume_url, cover_letter, status, submitted_at, created_at,
  tally_submission_id, resume_text, resume_parsed, resume_parse_version,
  ai_score, ai_score_reasoning, ai_score_version, ai_scored_at, ai_scored_prompt_at
FROM applications;

CREATE TABLE application_answers_bak AS SELECT * FROM application_answers;
DROP TABLE application_answers;

DROP TABLE applications;
ALTER TABLE applications_new RENAME TO applications;

CREATE INDEX idx_applications_position  ON applications(position_id);
CREATE INDEX idx_applications_applicant ON applications(applicant_id);
CREATE INDEX idx_applications_status    ON applications(status);

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
