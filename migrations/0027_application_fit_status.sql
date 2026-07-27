-- Fit status is a per-application judgment: the same person can be a good fit
-- for one position and not fit for another. Move the column from applicants
-- (added in 0003) to applications, seeding every application with the
-- applicant-level value so currently visible statuses are preserved.
ALTER TABLE applications ADD COLUMN fit_status TEXT CHECK (fit_status IN ('not_fit', 'good_fit', 'maybe'));

UPDATE applications
SET fit_status = (SELECT ap.fit_status FROM applicants ap WHERE ap.id = applications.applicant_id);

CREATE INDEX idx_applications_fit_status ON applications(fit_status);

DROP INDEX idx_applicants_fit_status;
ALTER TABLE applicants DROP COLUMN fit_status;
