// Authentication is validated server-side against the users table
// (POST /api/login). The session (username, display name, session token, and
// resolved permissions — no password) is cached in localStorage so getUser()
// stays synchronous across the SPA.

import { emptyPermissions, type Permission, type PermissionMap } from './permissions'

type User = {
  username: string
  fullName: string
  token: string
  isAdmin: boolean
  permissions: PermissionMap
}

const STORAGE_KEY = 'gk_session'

// Validate credentials against the server. On success, persists the session and
// returns the user; returns null on bad credentials or a network error.
export async function login(username: string, password: string): Promise<User | null> {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { ok: boolean; user?: unknown }
    if (!data.ok) return null
    const user = normalizeUser(data.user)
    if (!user) return null
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    return user
  } catch {
    return null
  }
}

export async function logout(): Promise<void> {
  // Best-effort server-side invalidation; the local session is cleared regardless.
  try {
    const token = getUser()?.token
    if (token) {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    }
  } catch {
    /* ignore network errors on logout */
  }
  localStorage.removeItem(STORAGE_KEY)
}

export function getUser(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return normalizeUser(JSON.parse(raw))
  } catch {
    return null
  }
}

// Coerce an unknown blob (login response or stored session) into a User, or null
// if required fields (including the token/permissions added by the permissions
// feature) are missing — which forces a one-time re-login for stale sessions.
function normalizeUser(raw: unknown): User | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.username !== 'string' || typeof o.fullName !== 'string') return null
  if (typeof o.token !== 'string' || !o.token) return null
  const permissions = emptyPermissions()
  if (o.permissions && typeof o.permissions === 'object') {
    const p = o.permissions as Record<string, unknown>
    for (const key of Object.keys(permissions) as Permission[]) {
      if (typeof p[key] === 'boolean') permissions[key] = p[key] as boolean
    }
  }
  return {
    username: o.username,
    fullName: o.fullName,
    token: o.token,
    isAdmin: o.isAdmin === true,
    permissions,
  }
}

// Whether a user holds a capability. Admins ("Full access") always do.
export function can(user: User | null, perm: Permission): boolean {
  if (!user) return false
  if (user.isAdmin) return true
  return user.permissions[perm] === true
}

export type { User }
