-- Rework the hiring pipeline into the eleven stages recruiting actually runs:
--
--   shortlisted → outreach → hm_interview → assignment → assignment_review →
--   tech_deep_dive → final_interview → reference_check → final_evaluation →
--   offer (won) / closed (rejected, withdrawn, or on hold)
--
-- Three old stages are renamed (interviewing → hm_interview, interviewed →
-- tech_deep_dive, offer_sent → offer), five are new, and 'hired' folds into
-- 'offer' — a sent offer is the end of the funnel, so a separate won lane
-- bought nothing.
--
-- The blocker is the CHECK on applications.status (last rebuilt in 0021).
-- 0010/0011/0021 widened it by rebuilding the table, but applications now has
-- three ON DELETE CASCADE children (application_answers, ai_score_history,
-- interview_scorecards) plus candidate_events.application_id ON DELETE SET
-- NULL, and DROP TABLE fires all of those. Instead of stashing four tables, we
-- swap the column: add an unconstrained one, backfill it, drop the old one
-- (which takes its CHECK with it — same trick 0027 used on
-- applicants.fit_status), and rename into place. No table rebuild, so no
-- cascade can reach a child row.
--
-- The new column carries no CHECK: the stage list changes with the process,
-- and worker/candidates.ts VALID_STATUSES already gates every write.

ALTER TABLE applications ADD COLUMN pipeline_stage TEXT NOT NULL DEFAULT 'none';

UPDATE applications
SET pipeline_stage = CASE status
  WHEN 'interviewing' THEN 'hm_interview'
  WHEN 'interviewed'  THEN 'tech_deep_dive'
  WHEN 'offer_sent'   THEN 'offer'
  WHEN 'hired'        THEN 'offer'
  WHEN 'rejected'     THEN 'closed'
  ELSE status  -- 'none', 'shortlisted' and 'outreach' keep their value
END;

-- DROP COLUMN refuses while an index references the column, so drop it first
-- and recreate it against the renamed column afterwards.
DROP INDEX idx_applications_status;
ALTER TABLE applications DROP COLUMN status;
ALTER TABLE applications RENAME COLUMN pipeline_stage TO status;
CREATE INDEX idx_applications_status ON applications(status);

-- candidate_events rows keep the stage values that were written at the time
-- (from_value/to_value of 'pipeline_status_changed'). They are history, not
-- state, so they stay as-is; lib/candidates.ts LEGACY_STAGES maps them onto
-- the current stages when the timeline renders.
