-- Attribute the fit statuses that predate any audit trail.
--
-- 0029 recovered the actor from candidate_events, but that timeline only starts
-- 2026-06-24 — 246 applications were judged before it existed and ended up with
-- a status and no author. daily_activity (which goes back to 2026-06-17) records
-- a fit_status_set action for 165 of them and every single one is hamza; nobody
-- else was reviewing CVs in that period, so the remainder is his too.
--
-- Only the author is filled in: fit_status_at stays NULL because the moment of
-- the change genuinely was not recorded, and a made-up timestamp would read as
-- fact. The display name is snapshotted from users, matching how the write path
-- and 0029 store it.
UPDATE applications
SET fit_status_by = 'hamza',
    fit_status_by_name = COALESCE((SELECT full_name FROM users WHERE username = 'hamza'), 'hamza')
WHERE fit_status IS NOT NULL AND fit_status_by IS NULL;
