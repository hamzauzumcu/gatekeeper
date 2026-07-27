-- Restore the UNIQUE index on applications.tally_submission_id (again).
--
-- Same regression 0012 fixed: 0021's applications table rebuild recreated the
-- position/applicant/status indexes but dropped `idx_applications_submission`.
-- Without it, every import — Tally webhook and CSV alike — fails with:
--   D1_ERROR: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint
-- which the webhook surfaces as a 500 to Tally.
--
-- Defensively dedup any rows that slipped in while the constraint was absent
-- (keep the lowest id per submission), then recreate the UNIQUE index.
-- NULL tally_submission_id rows are untouched (SQLite allows multiple NULLs).
--
-- NOTE for future table rebuilds: applications carries FOUR indexes —
-- position, applicant, status, AND this UNIQUE submission index. Recreate all
-- of them after any DROP TABLE applications.

DELETE FROM applications
WHERE tally_submission_id IS NOT NULL
  AND id NOT IN (
    SELECT MIN(id) FROM applications
    WHERE tally_submission_id IS NOT NULL
    GROUP BY tally_submission_id
  );

CREATE UNIQUE INDEX idx_applications_submission ON applications(tally_submission_id);
