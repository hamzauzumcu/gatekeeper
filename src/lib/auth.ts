// Authentication is validated server-side against the users table
// (POST /api/login). The session (username + display name, no password) is
// cached in localStorage so getUser() stays synchronous across the SPA.

type User = { username: string; fullName: string }

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
    const data = (await res.json()) as { ok: boolean; user?: User }
    if (!data.ok || !data.user) return null
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data.user))
    return data.user
  } catch {
    return null
  }
}

export function logout(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function getUser(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<User>
    if (typeof parsed.username !== 'string' || typeof parsed.fullName !== 'string') return null
    return { username: parsed.username, fullName: parsed.fullName }
  } catch {
    return null
  }
}

export type { User }
