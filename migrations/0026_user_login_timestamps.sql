-- Track sign-in and activation times for users, surfaced on the Admin screen.
-- last_login_at is stamped on every successful login. activated_at is set when
-- the account is created active and re-stamped whenever is_active flips 0 -> 1.
-- Existing rows are backfilled with created_at (accounts were created active).

ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN activated_at TEXT;

UPDATE users SET activated_at = created_at;
