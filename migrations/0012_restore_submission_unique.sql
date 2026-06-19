-- Restore the UNIQUE index on applications.tally_submission_id.
--
-- 0002 created `idx_applications_submission` to make tally_submission_id the
-- import idempotency key. The table rebuilds in 0010 and 0011 recreated the
-- position/applicant/status indexes but dropped this UNIQUE index. Without it,
-- the import's `INSERT ... ON CONFLICT(tally_submission_id) DO UPDATE` fails:
--   D1_ERROR: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint
--
-- Defensively dedup any rows that slipped in while the constraint was absent
-- (keep the lowest id per submission), then recreate the UNIQUE index.
-- NULL tally_submission_id rows are untouched (SQLite allows multiple NULLs).

DELETE FROM applications
WHERE tally_submission_id IS NOT NULL
  AND id NOT IN (
    SELECT MIN(id) FROM applications
    WHERE tally_submission_id IS NOT NULL
    GROUP BY tally_submission_id
  );

CREATE UNIQUE INDEX idx_applications_submission ON applications(tally_submission_id);
