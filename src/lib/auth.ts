const USERS = [
  { username: 'hamza', password: 'hamza2024', fullName: 'Hamza Üzümcü' },
  { username: 'kadir', password: 'kadir2024', fullName: 'Kadir Can Boyacıoğlu' },
] as const

type User = (typeof USERS)[number]

const STORAGE_KEY = 'gk_session'

export function login(username: string, password: string): User | null {
  const user = USERS.find((u) => u.username === username && u.password === password)
  if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  return user ?? null
}

export function logout(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function getUser(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as User
    // Validate against known users to prevent stale/tampered storage
    return USERS.find((u) => u.username === parsed.username) ?? null
  } catch {
    return null
  }
}

export type { User }
