import { apiFetch } from './api'
// Client API for in-app notifications (currently @mentions in candidate notes).
// The current user's username is sent as a query param since auth is client-side.

export type Notification = {
  id: number
  recipient: string
  actor: string
  actor_name: string
  type: string
  note_id: number
  applicant_id: number
  applicant_name: string | null
  excerpt: string | null
  created_at: string
  read_at: string | null
}

export async function fetchNotifications(
  user: string,
): Promise<{ notifications: Notification[]; unread: number }> {
  const res = await apiFetch(`/api/notifications?user=${encodeURIComponent(user)}`)
  const data = (await res.json()) as
    | { ok: true; notifications: Notification[]; unread: number }
    | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch notifications')
  return { notifications: data.notifications, unread: data.unread }
}

// Applicant ids that have an unread mention for this user (for the list marker).
export async function fetchUnreadApplicantIds(user: string): Promise<number[]> {
  const res = await apiFetch(`/api/notifications/unread-applicants?user=${encodeURIComponent(user)}`)
  const data = (await res.json()) as { ok: true; applicantIds: number[] } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch unread')
  return data.applicantIds
}

export async function markNotificationRead(id: number, user: string): Promise<void> {
  const res = await apiFetch(`/api/notifications/${id}/read?user=${encodeURIComponent(user)}`, {
    method: 'POST',
  })
  const data = (await res.json()) as { ok: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'failed to mark read')
}

export async function markAllNotificationsRead(user: string): Promise<void> {
  const res = await apiFetch(`/api/notifications/read-all?user=${encodeURIComponent(user)}`, {
    method: 'POST',
  })
  const data = (await res.json()) as { ok: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'failed to mark all read')
}
