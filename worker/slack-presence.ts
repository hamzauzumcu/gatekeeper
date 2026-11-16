// Slack presence tracking. See migrations/0036_slack_presence.sql.
//
// Slack only pushes presence changes over RTM/Socket Mode, which a Worker cannot
// hold open, so we poll instead: every cron tick refreshes the member list
// (users.list, which also carries status text/emoji) and then asks
// users.getPresence for each tracked member. Presence is recorded as "active"
// intervals, so the resolution is one tick (a minute).
//
// Needs a Slack bot token (secret SLACK_BOT_TOKEN) with the users:read and
// users:read.email scopes.

const SLACK_API = 'https://slack.com/api'

// users.getPresence is Tier 3 (~50 calls/minute). Stay below that per tick; with
// more tracked members than this, the least recently checked go first so every
// member is still covered within a few ticks.
const MAX_PRESENCE_CALLS_PER_TICK = 45

// An open interval whose last observation is older than this is treated as
// interrupted (missed ticks) and closed at that last observation.
const STALE_AFTER_MS = 5 * 60 * 1000

// Presence history is kept for two years, then deleted.
const RETENTION_DAYS = 730

type SlackMember = {
  id: string
  name: string
  deleted?: boolean
  is_bot?: boolean
  is_app_user?: boolean
  is_restricted?: boolean
  is_ultra_restricted?: boolean
  tz?: string
  profile?: {
    real_name?: string
    display_name?: string
    email?: string
    image_72?: string
    status_text?: string
    status_emoji?: string
    status_expiration?: number
  }
}

export type SlackUserRow = {
  id: string
  handle: string
  real_name: string | null
  display_name: string | null
  email: string | null
  avatar_url: string | null
  tz: string | null
  is_deleted: number
  is_tracked: number
  employee_id: number | null
  employee_name: string | null
  presence: string | null
  presence_checked_at: string | null
  last_active_at: string | null
  status_text: string | null
  status_emoji: string | null
  status_expiration: number | null
}

export type PresenceSession = {
  slack_user_id: string
  started_at: string
  ended_at: string // last_seen_at for an open interval
  open: boolean
}

export type StatusEvent = {
  slack_user_id: string
  at: string
  status_text: string | null
  status_emoji: string | null
}

class SlackError extends Error {}

async function slackGet<T>(token: string, method: string, params: Record<string, string>): Promise<T> {
  const url = `${SLACK_API}/${method}?${new URLSearchParams(params)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 429) throw new SlackError(`${method}: rate limited`)
  const data = (await res.json()) as { ok: boolean; error?: string } & T
  if (!data.ok) throw new SlackError(`${method}: ${data.error ?? 'unknown error'}`)
  return data
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

async function setMeta(db: D1Database, key: string, value: string | null): Promise<void> {
  await db
    .prepare(`INSERT INTO slack_presence_meta (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(key, value)
    .run()
}

async function getMeta(db: D1Database): Promise<Record<string, string | null>> {
  const { results } = await db.prepare(`SELECT key, value FROM slack_presence_meta`).all<{ key: string; value: string | null }>()
  return Object.fromEntries((results ?? []).map((r) => [r.key, r.value]))
}

// ── Member list ────────────────────────────────────────────────────────────

async function fetchMembers(token: string): Promise<SlackMember[]> {
  const out: SlackMember[] = []
  let cursor = ''
  for (let page = 0; page < 20; page++) {
    const params: Record<string, string> = { limit: '200' }
    if (cursor) params.cursor = cursor
    const data = await slackGet<{ members: SlackMember[]; response_metadata?: { next_cursor?: string } }>(
      token,
      'users.list',
      params,
    )
    out.push(...data.members)
    cursor = data.response_metadata?.next_cursor ?? ''
    if (!cursor) break
  }
  // Real people only: no bots, apps or Slackbot.
  return out.filter((m) => !m.is_bot && !m.is_app_user && m.id !== 'USLACKBOT')
}

// Upsert the member list and log status changes. New members start tracked
// unless they are guests; is_tracked is never overwritten afterwards, so an
// admin's choice sticks.
async function syncMembers(db: D1Database, members: SlackMember[], at: string): Promise<void> {
  const { results } = await db
    .prepare(`SELECT id, status_text, status_emoji FROM slack_users`)
    .all<{ id: string; status_text: string | null; status_emoji: string | null }>()
  const known = new Map((results ?? []).map((r) => [r.id, r]))

  const stmts: D1PreparedStatement[] = []
  for (const m of members) {
    const p = m.profile ?? {}
    const statusText = p.status_text?.trim() || null
    const statusEmoji = p.status_emoji?.trim() || null
    const guest = m.is_restricted || m.is_ultra_restricted
    stmts.push(
      db
        .prepare(
          `INSERT INTO slack_users
             (id, handle, real_name, display_name, email, avatar_url, tz, is_deleted, is_tracked,
              status_text, status_emoji, status_expiration, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             handle = excluded.handle, real_name = excluded.real_name,
             display_name = excluded.display_name, email = excluded.email,
             avatar_url = excluded.avatar_url, tz = excluded.tz, is_deleted = excluded.is_deleted,
             status_text = excluded.status_text, status_emoji = excluded.status_emoji,
             status_expiration = excluded.status_expiration, updated_at = excluded.updated_at`,
        )
        .bind(
          m.id,
          m.name,
          p.real_name || null,
          p.display_name || null,
          p.email?.toLowerCase() || null,
          p.image_72 || null,
          m.tz || null,
          m.deleted ? 1 : 0,
          m.deleted || guest ? 0 : 1,
          statusText,
          statusEmoji,
          p.status_expiration || null,
          at,
        ),
    )
    const prev = known.get(m.id)
    const changed = prev
      ? prev.status_text !== statusText || prev.status_emoji !== statusEmoji
      : statusText !== null || statusEmoji !== null
    if (changed && !m.deleted) {
      stmts.push(
        db
          .prepare(`INSERT INTO slack_status_events (slack_user_id, at, status_text, status_emoji) VALUES (?, ?, ?, ?)`)
          .bind(m.id, at, statusText, statusEmoji),
      )
    }
  }
  // Link members to employees by email, without touching existing links.
  stmts.push(
    db.prepare(
      `UPDATE slack_users
          SET employee_id = (SELECT e.id FROM employees e
                              WHERE lower(e.email) = slack_users.email AND e.is_active = 1 LIMIT 1)
        WHERE employee_id IS NULL AND email IS NOT NULL`,
    ),
  )
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50))
}

// ── Presence ───────────────────────────────────────────────────────────────

type OpenSession = { id: number; slack_user_id: string; last_seen_at: string }

function presenceStatements(
  db: D1Database,
  userId: string,
  active: boolean,
  open: OpenSession | undefined,
  at: string,
): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE slack_users
            SET presence = ?, presence_checked_at = ?,
                last_active_at = CASE WHEN ? = 'active' THEN ? ELSE last_active_at END
          WHERE id = ?`,
      )
      .bind(active ? 'active' : 'away', at, active ? 'active' : 'away', at, userId),
  ]
  const stale = open ? Date.parse(at) - Date.parse(open.last_seen_at) > STALE_AFTER_MS : false

  if (open && (stale || !active)) {
    // Close it: at the last observation when ticks were missed, otherwise now.
    stmts.push(
      db
        .prepare(`UPDATE slack_presence_sessions SET ended_at = ? WHERE id = ?`)
        .bind(stale ? open.last_seen_at : at, open.id),
    )
  }
  if (active) {
    if (open && !stale) {
      stmts.push(db.prepare(`UPDATE slack_presence_sessions SET last_seen_at = ? WHERE id = ?`).bind(at, open.id))
    } else {
      stmts.push(
        db
          // OR IGNORE + the unique open-interval index: if an overlapping poll
          // already opened one, this one keeps theirs instead of adding a second.
          .prepare(`INSERT OR IGNORE INTO slack_presence_sessions (slack_user_id, started_at, last_seen_at) VALUES (?, ?, ?)`)
          .bind(userId, at, at),
      )
    }
  }
  return stmts
}

export type PollResult = { ok: true; members: number; checked: number } | { ok: false; error: string }

// One tick: refresh members, then check presence for tracked members.
export async function pollSlackPresence(db: D1Database, token: string | undefined): Promise<PollResult> {
  if (!token) return { ok: false, error: 'SLACK_BOT_TOKEN is not configured' }
  const at = nowIso()
  try {
    const members = await fetchMembers(token)
    await syncMembers(db, members, at)

    const { results: tracked } = await db
      .prepare(
        `SELECT id FROM slack_users
          WHERE is_tracked = 1 AND is_deleted = 0
          ORDER BY presence_checked_at IS NOT NULL, presence_checked_at
          LIMIT ?`,
      )
      .bind(MAX_PRESENCE_CALLS_PER_TICK)
      .all<{ id: string }>()
    const { results: openRows } = await db
      .prepare(`SELECT id, slack_user_id, last_seen_at FROM slack_presence_sessions WHERE ended_at IS NULL`)
      .all<OpenSession>()
    const open = new Map((openRows ?? []).map((r) => [r.slack_user_id, r]))

    const stmts: D1PreparedStatement[] = []
    let checked = 0
    let rateLimited = false
    for (const { id } of tracked ?? []) {
      try {
        const data = await slackGet<{ presence: string }>(token, 'users.getPresence', { user: id })
        stmts.push(...presenceStatements(db, id, data.presence === 'active', open.get(id), at))
        checked++
      } catch (err) {
        // Rate limited: keep what we have and let the next tick continue.
        if (err instanceof SlackError && err.message.includes('rate limited')) {
          rateLimited = true
          break
        }
        // One member Slack no longer knows (removed from the workspace) must not
        // stop everyone else's check: mark them deleted and carry on.
        if (err instanceof SlackError && err.message.includes('user_not_found')) {
          stmts.push(db.prepare(`UPDATE slack_users SET is_deleted = 1 WHERE id = ?`).bind(id))
          continue
        }
        throw err
      }
    }

    // Members no longer tracked or deleted: close anything left open.
    stmts.push(
      db
        .prepare(
          `UPDATE slack_presence_sessions SET ended_at = last_seen_at
            WHERE ended_at IS NULL
              AND slack_user_id IN (SELECT id FROM slack_users WHERE is_tracked = 0 OR is_deleted = 1)`,
        ),
    )
    for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50))

    // Prune old history once an hour.
    if (new Date().getUTCMinutes() === 0) {
      await db.batch([
        db.prepare(`DELETE FROM slack_presence_sessions WHERE ended_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)`).bind(`-${RETENTION_DAYS} days`),
        // Keep each member's latest change even when it is older: it is what
        // explains a status that is still set today.
        db
          .prepare(
            `DELETE FROM slack_status_events
              WHERE at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)
                AND id NOT IN (SELECT MAX(id) FROM slack_status_events GROUP BY slack_user_id)`,
          )
          .bind(`-${RETENTION_DAYS} days`),
      ])
    }

    await setMeta(db, 'last_poll_at', at)
    await setMeta(db, 'last_error', rateLimited ? 'Slack rate limit hit; remaining members are checked next minute' : null)
    return { ok: true, members: members.length, checked }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setMeta(db, 'last_error', `${at} ${message}`)
    return { ok: false, error: message }
  }
}

// ── Read side ──────────────────────────────────────────────────────────────

// Working hours the analysis measures against. Hours are wall-clock times,
// applied in each member's own Slack time zone when perMemberTz is on (a team
// spread over several zones), otherwise in the viewer's zone.
export type WorkHours = {
  start: string // "HH:MM"
  end: string // "HH:MM"
  days: number[] // 0 = Sunday … 6 = Saturday
  perMemberTz: boolean
}

export const DEFAULT_WORK_HOURS: WorkHours = { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5], perMemberTz: true }

function isHHMM(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
}

export function parseWorkHours(raw: unknown): WorkHours | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!isHHMM(o.start) || !isHHMM(o.end) || o.start >= o.end) return null
  if (!Array.isArray(o.days) || !o.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return null
  return {
    start: o.start,
    end: o.end,
    days: [...new Set(o.days as number[])].sort(),
    perMemberTz: o.perMemberTz !== false,
  }
}

function readWorkHours(meta: Record<string, string | null>): WorkHours {
  try {
    return parseWorkHours(JSON.parse(meta.work_hours ?? 'null')) ?? DEFAULT_WORK_HOURS
  } catch {
    return DEFAULT_WORK_HOURS
  }
}

export async function saveWorkHours(db: D1Database, hours: WorkHours): Promise<void> {
  await setMeta(db, 'work_hours', JSON.stringify(hours))
}

// Approved leave of linked employees, so the analysis can leave those days out
// of the expected working time.
export type PresenceLeave = {
  employee_id: number
  start_date: string
  end_date: string
  working_days: string | null
  hours_requested: string | null
}

export type PresenceOverview = {
  configured: boolean
  lastPollAt: string | null
  lastError: string | null
  workHours: WorkHours
  users: SlackUserRow[]
  sessions: PresenceSession[]
  statusEvents: StatusEvent[]
  leaves: PresenceLeave[]
}

// Everything the Presence screen needs for [from, to): members (including
// untracked ones, so they can be re-enabled), active intervals overlapping the
// range, and status changes inside it.
export async function getPresenceOverview(
  db: D1Database,
  configured: boolean,
  from: string,
  to: string,
): Promise<PresenceOverview> {
  const [meta, users, sessions, events, leaves] = await Promise.all([
    getMeta(db),
    db
      .prepare(
        `SELECT s.id, s.handle, s.real_name, s.display_name, s.email, s.avatar_url, s.tz,
                s.is_deleted, s.is_tracked, s.employee_id, e.name AS employee_name,
                s.presence, s.presence_checked_at, s.last_active_at,
                s.status_text, s.status_emoji, s.status_expiration
           FROM slack_users s
           LEFT JOIN employees e ON e.id = s.employee_id
          WHERE s.is_deleted = 0
          ORDER BY COALESCE(e.name, s.real_name, s.handle) COLLATE NOCASE`,
      )
      .all<SlackUserRow>(),
    db
      .prepare(
        `SELECT slack_user_id, started_at, COALESCE(ended_at, last_seen_at) AS ended_at,
                ended_at IS NULL AS open
           FROM slack_presence_sessions
          WHERE started_at < ? AND COALESCE(ended_at, last_seen_at) >= ?
          ORDER BY started_at`,
      )
      .bind(to, from)
      .all<{ slack_user_id: string; started_at: string; ended_at: string; open: number }>(),
    db
      .prepare(
        // Changes inside the range, plus each member's last change before it:
        // that one is the status they already had when the range began, which
        // time-per-status needs to count the opening stretch.
        `SELECT slack_user_id, at, status_text, status_emoji
           FROM slack_status_events
          WHERE (at >= ? AND at < ?)
             OR id IN (SELECT MAX(id) FROM slack_status_events WHERE at < ? GROUP BY slack_user_id)
          ORDER BY at`,
      )
      .bind(from, to, from)
      .all<StatusEvent>(),
    db
      .prepare(
        `SELECT lr.employee_id, lr.start_date, COALESCE(lr.end_date, lr.start_date) AS end_date,
                lr.working_days, lr.hours_requested
           FROM leave_requests lr
          WHERE lr.status = 'approved'
            AND lr.employee_id IN (SELECT employee_id FROM slack_users WHERE employee_id IS NOT NULL)
            AND lr.start_date IS NOT NULL
            AND lr.start_date <= substr(?, 1, 10)
            -- Overlaps the range by its dates, or starts shortly before it: a
            -- request with a day count but no real end date spans more days than
            -- its dates say (the client derives the span from the count).
            AND (COALESCE(lr.end_date, lr.start_date) >= substr(?, 1, 10)
                 OR lr.start_date >= date(substr(?, 1, 10), '-31 days'))`,
      )
      .bind(to, from, from)
      .all<PresenceLeave>(),
  ])
  return {
    configured,
    lastPollAt: meta.last_poll_at ?? null,
    lastError: meta.last_error ?? null,
    workHours: readWorkHours(meta),
    users: users.results ?? [],
    sessions: (sessions.results ?? []).map((s) => ({ ...s, open: s.open === 1 })),
    statusEvents: events.results ?? [],
    leaves: leaves.results ?? [],
  }
}

export async function setSlackUserTracked(db: D1Database, id: string, tracked: boolean): Promise<boolean> {
  const res = await db.prepare(`UPDATE slack_users SET is_tracked = ? WHERE id = ?`).bind(tracked ? 1 : 0, id).run()
  return (res.meta.changes ?? 0) > 0
}
