-- Move login credentials into the DB so authentication is validated server-side
-- against the users table instead of the hardcoded list in src/lib/auth.ts.
-- Passwords are stored in plain text by design (internal two-person tool).
ALTER TABLE users ADD COLUMN password TEXT;

-- Seed existing credentials (keep in sync with the previous src/lib/auth.ts list).
UPDATE users SET password = 'hamza2024' WHERE username = 'hamza';
UPDATE users SET password = 'kadir2024' WHERE username = 'kadir';
