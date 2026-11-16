import { apiFetch } from './api'
import type { PresenceLeave, WorkHours } from './presence-analysis'
// Client API for Slack presence tracking (Employees → Presence). See
// worker/slack-presence.ts for how the data is collected.

export type SlackUser = {
  id: string
  handle: string
  real_name: string | null
  display_name: string | null
  email: string | null
  avatar_url: string | null
  tz: string | null
  is_tracked: number
  employee_id: number | null
  employee_name: string | null
  presence: 'active' | 'away' | null
  presence_checked_at: string | null
  last_active_at: string | null
  status_text: string | null
  status_emoji: string | null
  status_expiration: number | null
}

export type PresenceSession = {
  slack_user_id: string
  started_at: string
  ended_at: string
  open: boolean
}

export type StatusEvent = {
  slack_user_id: string
  at: string
  status_text: string | null
  status_emoji: string | null
}

export type PresenceOverview = {
  configured: boolean
  lastPollAt: string | null
  lastError: string | null
  workHours: WorkHours
  users: SlackUser[]
  sessions: PresenceSession[]
  statusEvents: StatusEvent[]
  leaves: PresenceLeave[]
}

async function json<T>(res: Response, fallback: string): Promise<T> {
  const data = (await res.json().catch(() => ({ ok: false, error: fallback }))) as { ok: boolean; error?: string } & T
  if (!res.ok || !data.ok) throw new Error(data.error ?? fallback)
  return data
}

export async function fetchPresenceOverview(from: Date, to: Date): Promise<PresenceOverview> {
  const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })
  return json<PresenceOverview>(await apiFetch(`/api/presence/overview?${qs}`), 'failed to load presence')
}

export async function syncPresenceNow(): Promise<{ members: number; checked: number }> {
  return json(await apiFetch('/api/presence/sync', { method: 'POST' }), 'sync failed')
}

export async function saveWorkHours(hours: WorkHours): Promise<WorkHours> {
  const data = await json<{ workHours: WorkHours }>(
    await apiFetch('/api/presence/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hours),
    }),
    'failed to save working hours',
  )
  return data.workHours
}

export async function setTracked(id: string, tracked: boolean): Promise<void> {
  await json(
    await apiFetch(`/api/presence/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_tracked: tracked }),
    }),
    'update failed',
  )
}

export function displayName(u: SlackUser): string {
  return u.employee_name || u.real_name || u.display_name || u.handle
}

// A single tick has zero length; count it as one poll interval so a member seen
// active once still registers a minute.
const MIN_SESSION_MS = 60 * 1000

// Milliseconds of active time inside [from, to), from intervals that may spill
// over either edge.
export function activeMs(sessions: PresenceSession[], from: number, to: number): number {
  let total = 0
  for (const s of sessions) {
    const start = Date.parse(s.started_at)
    const end = Math.max(Date.parse(s.ended_at), start + MIN_SESSION_MS)
    const a = Math.max(start, from)
    const b = Math.min(end, to)
    if (b > a) total += b - a
  }
  return total
}

export function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60000)
  if (mins <= 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

// Common status emoji shortcodes, rendered as the emoji itself; anything else
// (custom workspace emoji) is shown as its :shortcode:.
const EMOJI: Record<string, string> = {
  ':palm_tree:': '🌴',
  ':face_with_thermometer:': '🤒',
  ':house_with_garden:': '🏡',
  ':house:': '🏠',
  ':spiral_calendar_pad:': '🗓️',
  ':calendar:': '📆',
  ':bus:': '🚌',
  ':car:': '🚗',
  ':airplane:': '✈️',
  ':coffee:': '☕',
  ':hamburger:': '🍔',
  ':fork_and_knife:': '🍴',
  ':knife_fork_plate:': '🍽️',
  ':computer:': '💻',
  ':headphones:': '🎧',
  ':headphone:': '🎧',
  ':speech_balloon:': '💬',
  ':no_entry:': '⛔',
  ':no_entry_sign:': '🚫',
  ':zzz:': '💤',
  ':sleeping:': '😴',
  ':red_circle:': '🔴',
  ':large_green_circle:': '🟢',
  ':brb:': '🔙',
  ':baby:': '👶',
  ':hospital:': '🏥',
  ':pill:': '💊',
  ':mosque:': '🕌',
  ':pray:': '🙏',
  ':books:': '📚',
  ':video_camera:': '📹',
  ':camera:': '📷',
  ':phone:': '📞',
  ':telephone_receiver:': '📞',
  ':raised_hand:': '✋',
  ':walking:': '🚶',
  ':runner:': '🏃',
  ':tada:': '🎉',
  ':birthday:': '🎂',
  ':sun_with_face:': '🌞',
  ':crescent_moon:': '🌙',
  ':thinking_face:': '🤔',
  ':eyes:': '👀',
  ':rocket:': '🚀',
  ':construction:': '🚧',
}

export function renderEmoji(code: string | null): string {
  if (!code) return ''
  return EMOJI[code] ?? code
}
