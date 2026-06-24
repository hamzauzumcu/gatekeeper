// User registry queries. Backs the user picker and @mention autocomplete.

export type UserRow = {
  id: number
  username: string
  full_name: string
  color: string | null
}

// Active users, ordered by display name — used for mention/assignee pickers.
export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, username, full_name, color
         FROM users
        WHERE is_active = 1
        ORDER BY full_name`,
    )
    .all<UserRow>()
  return results ?? []
}

// Validate credentials against the users table. Returns the user (without the
// password) on success, or null on a bad username/password or inactive user.
// Plain-text comparison by design (see migrations/0015_user_passwords.sql).
export async function verifyLogin(
  db: D1Database,
  username: string,
  password: string,
): Promise<UserRow | null> {
  const row = await db
    .prepare(
      `SELECT id, username, full_name, color
         FROM users
        WHERE username = ? AND password = ? AND is_active = 1`,
    )
    .bind(username, password)
    .first<UserRow>()
  return row ?? null
}
