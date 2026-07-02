// User registry queries. Backs the user picker, @mention autocomplete, login,
// and the Admin → Users management screen.

import { PERMISSIONS, resolvePermissions, toAuth, type Auth, type Permission, type UserAuthRow } from './permissions'

export type UserRow = {
  id: number
  username: string
  full_name: string
  color: string | null
}

// Full user record for the admin screen, including capability flags. Passwords
// are never returned.
export type AdminUserRow = {
  id: number
  username: string
  full_name: string
  color: string | null
  is_active: number
  is_admin: number
  permissions: Record<Permission, boolean>
  created_at: string
}

// Capability flags accepted when creating/updating a user.
export type UserPermsInput = Partial<Record<Permission, boolean>> & { is_admin?: boolean }

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

// Validate credentials against the users table. Returns the resolved auth (with
// permissions) on success, or null on a bad username/password or inactive user.
// Plain-text comparison by design (see migrations/0015_user_passwords.sql).
export async function verifyLogin(
  db: D1Database,
  username: string,
  password: string,
): Promise<Auth | null> {
  const row = await db
    .prepare(
      `SELECT id, username, full_name, color, is_admin,
              perm_view_applications, perm_view_salary, perm_manage_leave, perm_recruiting_admin
         FROM users
        WHERE username = ? AND password = ? AND is_active = 1`,
    )
    .bind(username, password)
    .first<UserAuthRow>()
  return row ? toAuth(row) : null
}

// ── Admin user management ──────────────────────────────────────────────────

// All users (active and inactive) with their capability flags, for the admin UI.
export async function listAllUsers(db: D1Database): Promise<AdminUserRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, username, full_name, color, is_active, is_admin,
              perm_view_applications, perm_view_salary, perm_manage_leave, perm_recruiting_admin,
              created_at
         FROM users
        ORDER BY is_active DESC, full_name`,
    )
    .all<UserAuthRow & { is_active: number; created_at: string }>()
  return (results ?? []).map(shapeAdminUser)
}

async function getAdminUser(db: D1Database, id: number): Promise<AdminUserRow | null> {
  const row = await db
    .prepare(
      `SELECT id, username, full_name, color, is_active, is_admin,
              perm_view_applications, perm_view_salary, perm_manage_leave, perm_recruiting_admin,
              created_at
         FROM users WHERE id = ?`,
    )
    .bind(id)
    .first<UserAuthRow & { is_active: number; created_at: string }>()
  return row ? shapeAdminUser(row) : null
}

function shapeAdminUser(row: UserAuthRow & { is_active: number; created_at: string }): AdminUserRow {
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    color: row.color,
    is_active: row.is_active,
    is_admin: row.is_admin,
    permissions: resolvePermissions(row),
    created_at: row.created_at,
  }
}

// Create a user. Returns the created row, or an error (e.g. duplicate username).
export async function createUser(
  db: D1Database,
  input: {
    username: string
    full_name: string
    password: string
    color?: string | null
    is_active?: boolean
    perms?: UserPermsInput
  },
): Promise<{ ok: true; user: AdminUserRow } | { ok: false; error: string; status?: number }> {
  const username = input.username.trim().toLowerCase()
  const fullName = input.full_name.trim()
  const password = input.password
  if (!username) return { ok: false, error: 'username required' }
  if (!fullName) return { ok: false, error: 'full name required' }
  if (!password) return { ok: false, error: 'password required' }

  const dup = await db.prepare(`SELECT 1 FROM users WHERE username = ?`).bind(username).first()
  if (dup) return { ok: false, error: 'username already exists', status: 409 }

  const p = input.perms ?? {}
  const res = await db
    .prepare(
      `INSERT INTO users
         (username, full_name, password, color, is_active, is_admin,
          perm_view_applications, perm_view_salary, perm_manage_leave, perm_recruiting_admin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      username,
      fullName,
      password,
      input.color ?? null,
      input.is_active === false ? 0 : 1,
      p.is_admin ? 1 : 0,
      p.view_applications ? 1 : 0,
      p.view_salary ? 1 : 0,
      p.manage_leave ? 1 : 0,
      p.recruiting_admin ? 1 : 0,
    )
    .run()
  const user = await getAdminUser(db, Number(res.meta.last_row_id))
  if (!user) return { ok: false, error: 'failed to load created user', status: 500 }
  return { ok: true, user }
}

// Update a user. Only provided fields change. Password is updated only when a
// non-empty string is supplied (so the editor can leave it blank to keep it).
export async function updateUser(
  db: D1Database,
  id: number,
  input: {
    full_name?: string
    password?: string
    color?: string | null
    is_active?: boolean
    perms?: UserPermsInput
  },
): Promise<{ ok: true; user: AdminUserRow } | { ok: false; error: string; status?: number }> {
  const existing = await getAdminUser(db, id)
  if (!existing) return { ok: false, error: 'user not found', status: 404 }

  const sets: string[] = []
  const vals: unknown[] = []
  if (input.full_name !== undefined) {
    const fullName = input.full_name.trim()
    if (!fullName) return { ok: false, error: 'full name cannot be empty' }
    sets.push('full_name = ?'); vals.push(fullName)
  }
  if (typeof input.password === 'string' && input.password.length > 0) {
    sets.push('password = ?'); vals.push(input.password)
  }
  if (input.color !== undefined) { sets.push('color = ?'); vals.push(input.color) }
  if (input.is_active !== undefined) { sets.push('is_active = ?'); vals.push(input.is_active ? 1 : 0) }

  const p = input.perms
  if (p) {
    if (p.is_admin !== undefined) { sets.push('is_admin = ?'); vals.push(p.is_admin ? 1 : 0) }
    for (const perm of PERMISSIONS) {
      if (p[perm] !== undefined) { sets.push(`perm_${perm} = ?`); vals.push(p[perm] ? 1 : 0) }
    }
  }

  if (sets.length === 0) return { ok: true, user: existing }

  vals.push(id)
  await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
  const user = await getAdminUser(db, id)
  if (!user) return { ok: false, error: 'failed to load user', status: 500 }
  return { ok: true, user }
}
