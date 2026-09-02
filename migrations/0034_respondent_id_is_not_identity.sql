-- Tally's respondentId identifies a browser, not a person.
--
-- A recruiter filling the public form on behalf of several candidates sends
-- every one of those submissions with the SAME respondentId. Because
-- `applicants.respondent_id` is UNIQUE, the importer's
-- `ON CONFLICT(respondent_id) DO UPDATE` overwrote the existing applicant's
-- name and email with the next person's — silently destroying the earlier
-- candidate, who then vanished from the list while their application stayed
-- behind under someone else's name.
--
-- Identity now comes from the submission's own content (email), never from the
-- transport token. The token moves to where it belongs: the submission itself,
-- as `applications.tally_respondent_id`, kept for tracing only. It never
-- decides who a candidate is.
--
-- The UNIQUE column on `applicants` stays for now — dropping it means a table
-- rebuild, and every child table (applications, candidate_notes,
-- candidate_events, notifications) cascades on DROP TABLE applicants, so that
-- rebuild needs the stash dance from 0021 and is not worth the risk here. The
-- importer simply stops writing the column; SQLite allows unlimited NULLs in a
-- unique index, so new applicants never collide. Treat the column as dead.

ALTER TABLE applications ADD COLUMN tally_respondent_id TEXT;

-- Backfill under the legacy 1:1 assumption (one respondent = one applicant).
-- Wrong for the rows that were collapsed by the bug above, which is exactly
-- what the data repair fixes; as trace metadata this is still the best record
-- of which browser sent what.
UPDATE applications
SET tally_respondent_id = (
  SELECT respondent_id FROM applicants WHERE applicants.id = applications.applicant_id
)
WHERE tally_respondent_id IS NULL;

CREATE INDEX idx_applications_respondent ON applications(tally_respondent_id);
