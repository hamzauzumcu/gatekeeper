// Client API for Admin → Users. All endpoints are admin-only server-side.

import { apiFetch } from './api'
import type { PermissionMap } from './permissions'

export type AdminUser = {
  id: number
  username: string
  full_name: string
  color: string | null
  is_active: number
  is_admin: number
  permissions: PermissionMap
  created_at: string
}

// Payload for create/update. Password blank on update = keep existing.
export type AdminUserInput = {
  full_name: string
  username?: string
  password?: string
  color?: string | null
  is_active: boolean
  is_admin: boolean
  permissions: PermissionMap
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const res = await apiFetch('/api/admin/users')
  if (!res.ok) throw new Error('Failed to load users')
  const data = (await res.json()) as { ok: boolean; users?: AdminUser[] }
  return data.users ?? []
}

export async function createAdminUser(input: AdminUserInput): Promise<AdminUser> {
  const res = await apiFetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(serialize(input, true)),
  })
  const data = (await res.json()) as { ok: boolean; user?: AdminUser; error?: string }
  if (!res.ok || !data.ok || !data.user) throw new Error(data.error ?? 'Failed to create user')
  return data.user
}

export async function updateAdminUser(id: number, input: AdminUserInput): Promise<AdminUser> {
  const res = await apiFetch(`/api/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(serialize(input, false)),
  })
  const data = (await res.json()) as { ok: boolean; user?: AdminUser; error?: string }
  if (!res.ok || !data.ok || !data.user) throw new Error(data.error ?? 'Failed to update user')
  return data.user
}

// Shape the input for the API. On update, only send a password when one was typed.
function serialize(input: AdminUserInput, isCreate: boolean) {
  const body: Record<string, unknown> = {
    full_name: input.full_name,
    color: input.color ?? null,
    is_active: input.is_active,
    permissions: { ...input.permissions, is_admin: input.is_admin },
  }
  if (isCreate) body.username = input.username
  if (input.password) body.password = input.password
  return body
}
