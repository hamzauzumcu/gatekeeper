-- Denormalized interview final score on applications, for list columns,
-- filtering, and sorting without recomputing the aggregate per row.
--
-- Source of truth stays interview_scorecard_scores; these columns are a cache
-- refreshed on every write path that can change the aggregate:
--   - an interviewer submits/updates a scorecard (worker/interview-scorecards.ts)
--   - the position's template changes — weights edited, criteria added/archived/
--     removed, or the scorecard cleared (recompute across the position's
--     applications, wired in the PUT /api/admin/scorecards route)
--
-- interview_score is REAL at full precision (rounding happens in the UI).
-- NULL = no submissions (or no template). interview_score_complete mirrors the
-- guide's rule: 1 only when every active criterion has at least one numeric
-- score, i.e. the final score is decision-ready rather than partial.
--
-- No backfill: the scorecard feature ships in the same release, so no
-- submissions can predate these columns.

ALTER TABLE applications ADD COLUMN interview_score REAL;
ALTER TABLE applications ADD COLUMN interview_score_complete INTEGER NOT NULL DEFAULT 0;
