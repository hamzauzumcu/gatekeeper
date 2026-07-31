-- Who set an application's fit status. The judgment needs an owner so a second
-- recruiter can review what someone else marked ("show me the good fits I did
-- not mark myself"). The timeline (candidate_events) already records every
-- change, but filtering a list against it is expensive, so the current verdict
-- carries its actor denormalized on the application.
--
-- fit_status_by is the username, fit_status_by_name a display-name snapshot
-- (mirroring candidate_events.actor/actor_name so a renamed or removed user
-- never blanks an existing row), fit_status_at the moment it was set. All three
-- are cleared together when the fit status is cleared.
ALTER TABLE applications ADD COLUMN fit_status_by TEXT;
ALTER TABLE applications ADD COLUMN fit_status_by_name TEXT;
ALTER TABLE applications ADD COLUMN fit_status_at TEXT;

-- Backfill from the timeline: the most recent per-application fit event.
UPDATE applications
SET fit_status_by = (
      SELECT e.actor FROM candidate_events e
       WHERE e.application_id = applications.id AND e.event_type = 'fit_status_changed'
       ORDER BY e.created_at DESC, e.id DESC LIMIT 1),
    fit_status_by_name = (
      SELECT e.actor_name FROM candidate_events e
       WHERE e.application_id = applications.id AND e.event_type = 'fit_status_changed'
       ORDER BY e.created_at DESC, e.id DESC LIMIT 1),
    fit_status_at = (
      SELECT e.created_at FROM candidate_events e
       WHERE e.application_id = applications.id AND e.event_type = 'fit_status_changed'
       ORDER BY e.created_at DESC, e.id DESC LIMIT 1)
WHERE fit_status IS NOT NULL;

-- Fit status was applicant-level before 0027, so those older events carry no
-- application_id. Fall back to the applicant's latest such event, and only when
-- it agrees with the status the application ended up with.
UPDATE applications
SET fit_status_by = (
      SELECT e.actor FROM candidate_events e
       WHERE e.applicant_id = applications.applicant_id
         AND e.event_type = 'fit_status_changed'
         AND e.to_value = applications.fit_status
       ORDER BY e.created_at DESC, e.id DESC LIMIT 1),
    fit_status_by_name = (
      SELECT e.actor_name FROM candidate_events e
       WHERE e.applicant_id = applications.applicant_id
         AND e.event_type = 'fit_status_changed'
         AND e.to_value = applications.fit_status
       ORDER BY e.created_at DESC, e.id DESC LIMIT 1),
    fit_status_at = (
      SELECT e.created_at FROM candidate_events e
       WHERE e.applicant_id = applications.applicant_id
         AND e.event_type = 'fit_status_changed'
         AND e.to_value = applications.fit_status
       ORDER BY e.created_at DESC, e.id DESC LIMIT 1)
WHERE fit_status IS NOT NULL AND fit_status_by IS NULL;

CREATE INDEX idx_applications_fit_status_by ON applications(fit_status_by);
