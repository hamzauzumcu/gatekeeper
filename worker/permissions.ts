// Per-user permissions + login sessions. See migrations/0019_permissions.sql.
//
// The app doesn't pass identity to API calls today, so server-side permission
// checks rely on an opaque session token issued at login and resolved to a user
// (and thus permissions) on each gated request. is_admin ("Full access") implies
// every capability AND ownership of user management.

import type { Context, MiddlewareHandler } from 'hono'

// Granular capabilities a user can be granted individually.
export const PERMISSIONS = [
  'view_applications',
  'view_salary',
  'manage_leave',
  'recruiting_admin',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export type PermissionMap = Record<Permission, boolean>

// The DB shape we read from `users` for auth decisions.
export type UserAuthRow = {
  id: number
  username: string
  full_name: string
  color: string | null
  is_admin: number
  perm_view_applications: number
  perm_view_salary: number
  perm_manage_leave: number
  perm_recruiting_admin: number
}

// Resolved identity + capabilities attached to the request context.
export type Auth = {
  username: string
  fullName: string
  isAdmin: boolean
  permissions: PermissionMap
}

const SELECT_AUTH_COLUMNS =
  `id, username, full_name, color, is_admin,
   perm_view_applications, perm_view_salary, perm_manage_leave, perm_recruiting_admin`

// Turn a users row into the boolean permission map. Admins get everything.
export function resolvePermissions(row: UserAuthRow): PermissionMap {
  const admin = row.is_admin === 1
  return {
    view_applications: admin || row.perm_view_applications === 1,
    view_salary: admin || row.perm_view_salary === 1,
    manage_leave: admin || row.perm_manage_leave === 1,
    recruiting_admin: admin || row.perm_recruiting_admin === 1,
  }
}

export function toAuth(row: UserAuthRow): Auth {
  return {
    username: row.username,
    fullName: row.full_name,
    isAdmin: row.is_admin === 1,
    permissions: resolvePermissions(row),
  }
}

// Issue a new opaque session token for a user.
export async function createSession(db: D1Database, username: string): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '')
  await db.prepare(`INSERT INTO user_sessions (token, username) VALUES (?, ?)`).bind(token, username).run()
  return token
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM user_sessions WHERE token = ?`).bind(token).run()
}

// Resolve a session token to the current auth state, re-reading permissions from
// the users table so changes take effect without forcing a re-login. Returns null
// for an unknown/expired token or a deactivated user.
export async function resolveSession(db: D1Database, token: string): Promise<Auth | null> {
  if (!token) return null
  const row = await db
    .prepare(
      `SELECT ${SELECT_AUTH_COLUMNS}
         FROM users u
         JOIN user_sessions s ON s.username = u.username
        WHERE s.token = ? AND u.is_active = 1`,
    )
    .bind(token)
    .first<UserAuthRow>()
  return row ? toAuth(row) : null
}

// Extract the bearer token from the Authorization header.
function bearerToken(c: Context): string {
  const header = c.req.header('Authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m ? m[1].trim() : ''
}

// Hono middleware: resolve the caller's session and stash it on the context as
// `auth`. Never rejects on its own — routes decide whether auth is required via
// requireAuth / requirePerm / requireAdmin. This lets open routes stay open.
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const auth = await resolveSession(c.env.DB, bearerToken(c))
  c.set('auth', auth ?? null)
  await next()
}

// Route guards. Each returns a Response (to short-circuit) or null (to proceed).
export function requireAuth(c: Context): Response | null {
  const auth = c.get('auth') as Auth | null
  if (!auth) return c.json({ ok: false, error: 'authentication required' }, 401)
  return null
}

export function requirePerm(c: Context, perm: Permission): Response | null {
  const auth = c.get('auth') as Auth | null
  if (!auth) return c.json({ ok: false, error: 'authentication required' }, 401)
  if (!auth.permissions[perm]) return c.json({ ok: false, error: 'forbidden' }, 403)
  return null
}

export function requireAdmin(c: Context): Response | null {
  const auth = c.get('auth') as Auth | null
  if (!auth) return c.json({ ok: false, error: 'authentication required' }, 401)
  if (!auth.isAdmin) return c.json({ ok: false, error: 'forbidden' }, 403)
  return null
}
