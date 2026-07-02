-- Per-user permissions + login sessions. Until now every authenticated user
-- could do everything; this adds granular capability flags and a super-admin
-- ("Full access") flag, managed from a new Admin → Users screen.
--
-- Capabilities are stored as integer flags on `users`. is_admin implies ALL
-- capabilities AND ownership of user management, so the individual perm_* flags
-- are ignored for admins (resolved server-side in worker/permissions.ts).
ALTER TABLE users ADD COLUMN is_admin              INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN perm_view_applications INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN perm_view_salary       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN perm_manage_leave      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN perm_recruiting_admin  INTEGER NOT NULL DEFAULT 0;

-- Opaque login sessions. The app doesn't pass identity to API calls today, so
-- server-side permission checks need a token: issued at login, resolved to a
-- user (and thus permissions) on each gated request. Tokens are random opaque
-- strings, not hashed — consistent with the plain-text password design of this
-- internal tool.
CREATE TABLE user_sessions (
  token      TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_user_sessions_username ON user_sessions (username);

-- Seed roles for the existing users. hamza is the owner (full access); kadir is
-- a recruiter (can view applications + salary and manage leave, but not admin).
UPDATE users SET is_admin = 1 WHERE username = 'hamza';
UPDATE users
   SET perm_view_applications = 1,
       perm_view_salary       = 1,
       perm_manage_leave      = 1
 WHERE username = 'kadir';
