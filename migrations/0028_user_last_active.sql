-- Replace last-login tracking with last-active tracking: the timestamp now
-- updates on any authenticated request (throttled to once per 5 minutes in
-- worker/users.ts), not just at sign-in. Existing login stamps carry over.

ALTER TABLE users RENAME COLUMN last_login_at TO last_active_at;
