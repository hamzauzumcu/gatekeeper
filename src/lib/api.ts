// Thin fetch wrapper that attaches the logged-in user's session token so the
// Worker can enforce permissions server-side. Every internal /api call should go
// through this. The token lives in the persisted session (see lib/auth.ts).

const STORAGE_KEY = 'gk_session'

function sessionToken(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { token?: unknown }
    return typeof parsed.token === 'string' ? parsed.token : null
  } catch {
    return null
  }
}

// Drop-in replacement for fetch() that adds `Authorization: Bearer <token>` when
// a session exists. Existing Content-Type / other headers are preserved.
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = sessionToken()
  if (!token) return fetch(input, init)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}
