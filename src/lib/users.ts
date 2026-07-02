import { apiFetch } from './api'
// Client-side access to the user registry (GET /api/users). Use this for the
// user picker and the @mention autocomplete instead of the hardcoded auth list.

export type AppUser = {
  id: number
  username: string
  full_name: string
  color: string | null
}

let cache: Promise<AppUser[]> | null = null

// Fetch active users. Cached for the session; pass force to refetch.
export function fetchUsers(force = false): Promise<AppUser[]> {
  if (!cache || force) {
    cache = apiFetch('/api/users')
      .then((res) => res.json() as Promise<{ ok: boolean; users?: AppUser[] }>)
      .then((data) => data.users ?? [])
      .catch(() => {
        cache = null // allow retry on next call
        return []
      })
  }
  return cache
}
