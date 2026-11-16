// Working-hours analysis of Slack presence: for each member and period, how much
// of their working hours they were online, how much they were online outside
// them, and when their working day usually started and ended.
//
// Working hours are wall-clock times ("09:00"–"18:00") applied to each calendar
// day in the member's own Slack time zone (or the viewer's, see WorkHours), so a
// teammate in Manila is measured against Manila office hours. Days covered by
// approved leave are left out of the expected time, and time that hasn't
// happened yet (later today, later this week) is not expected either.

import { activeMs, type PresenceSession, type SlackUser } from './presence'

export type WorkHours = {
  start: string // "HH:MM"
  end: string // "HH:MM"
  days: number[] // 0 = Sunday … 6 = Saturday
  perMemberTz: boolean
}

export type PresenceLeave = {
  employee_id: number
  start_date: string
  end_date: string
  working_days: string | null
  hours_requested: string | null
}

export type MemberAnalysis = {
  userId: string
  expectedMs: number // working time in the period (elapsed, minus leave)
  inHoursMs: number // online during working hours
  outsideMs: number // online outside working hours (incl. non-working days)
  workDays: number // working days elapsed in the period (minus full leave days)
  activeWorkDays: number // working days with any online time in hours
  leaveDays: number // working days fully covered by leave
  avgFirstMin: number | null // average first-active time on working days, minutes after local midnight
  avgLastMin: number | null // average last-active time on working days
  tz: string
}

const DAY_MS = 24 * 3600 * 1000
const MIN_SESSION_MS = 60 * 1000

export function viewerTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function validTz(tz: string | null): string | null {
  if (!tz) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>()

// Offset of `tz` from UTC at instant `ms`, in milliseconds.
function tzOffset(ms: number, tz: string): number {
  let f = offsetFormatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    offsetFormatters.set(tz, f)
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

// The instant at which the wall clock in `tz` reads y-m-d hh:mm.
export function zonedTime(y: number, m: number, d: number, minutes: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, 0, minutes)
  const first = guess - tzOffset(guess, tz)
  // Second pass settles days where the offset changes (DST).
  return guess - tzOffset(first, tz)
}

function hhmm(v: string): number {
  const [h, m] = v.split(':').map(Number)
  return h * 60 + m
}

// Calendar days [from, to) as {y, m, d, key, weekday}.
export type CalDay = { y: number; m: number; d: number; key: string; weekday: number }

export function calendarDays(from: Date, to: Date): CalDay[] {
  const out: CalDay[] = []
  for (let d = new Date(from); d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    const day = d.getDate()
    out.push({
      y,
      m,
      d: day,
      key: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      weekday: d.getDay(),
    })
  }
  return out
}

function parseNum(raw: string | null): number {
  if (!raw) return 0
  const m = raw.replace(',', '.').match(/\d+(\.\d+)?/)
  return m ? Number(m[0]) : 0
}

// Leave per day key: 'full', or hours of partial leave.
function leaveByDay(leaves: PresenceLeave[], workDayMs: number): Map<string, 'full' | number> {
  const out = new Map<string, 'full' | number>()
  for (const l of leaves) {
    const days = parseNum(l.working_days)
    const hours = parseNum(l.hours_requested)
    // An hours-only request shorter than a working day is partial leave on its
    // first day; anything else blocks every day it covers.
    if (!days && hours > 0 && hours * 3600 * 1000 < workDayMs) {
      const prev = out.get(l.start_date)
      if (prev !== 'full') out.set(l.start_date, (prev ?? 0) + hours)
      continue
    }
    const [a, b] = l.start_date <= l.end_date ? [l.start_date, l.end_date] : [l.end_date, l.start_date]
    const start = new Date(`${a}T00:00:00Z`)
    const end = new Date(`${b}T00:00:00Z`)
    for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
      out.set(new Date(t).toISOString().slice(0, 10), 'full')
    }
  }
  return out
}

function minutesInTz(ms: number, tz: string): number {
  const local = ms + tzOffset(ms, tz)
  return Math.floor((local % DAY_MS) / 60000)
}

export function analyzeMember(
  user: SlackUser,
  sessions: PresenceSession[],
  leaves: PresenceLeave[],
  days: CalDay[],
  hours: WorkHours,
  now: number,
): MemberAnalysis {
  const tz = (hours.perMemberTz && validTz(user.tz)) || viewerTz()
  const startMin = hhmm(hours.start)
  const endMin = hhmm(hours.end)
  const workDayMs = (endMin - startMin) * 60000
  const leave = leaveByDay(
    leaves.filter((l) => l.employee_id === user.employee_id),
    workDayMs,
  )
  const spans = sessions.map((s) => {
    const a = Date.parse(s.started_at)
    return { a, b: Math.max(Date.parse(s.ended_at), a + MIN_SESSION_MS) }
  })

  const r: MemberAnalysis = {
    userId: user.id,
    expectedMs: 0,
    inHoursMs: 0,
    outsideMs: 0,
    workDays: 0,
    activeWorkDays: 0,
    leaveDays: 0,
    avgFirstMin: null,
    avgLastMin: null,
    tz,
  }
  let firstSum = 0
  let lastSum = 0
  let firstLastCount = 0

  for (const day of days) {
    const dayStart = zonedTime(day.y, day.m, day.d, 0, tz)
    const dayEnd = zonedTime(day.y, day.m, day.d, 24 * 60, tz)
    if (dayStart >= now) break
    const total = activeMs(sessions, dayStart, dayEnd)

    const isWorkDay = hours.days.includes(day.weekday)
    const dayLeave = leave.get(day.key)
    if (!isWorkDay || dayLeave === 'full') {
      if (isWorkDay) r.leaveDays++
      r.outsideMs += total
      continue
    }

    const winStart = zonedTime(day.y, day.m, day.d, startMin, tz)
    const winEnd = zonedTime(day.y, day.m, day.d, endMin, tz)
    const inHours = activeMs(sessions, winStart, winEnd)
    // Only the part of the working day that has already happened is expected.
    const elapsed = Math.max(0, Math.min(winEnd, now) - winStart)
    const partial = typeof dayLeave === 'number' ? dayLeave * 3600 * 1000 : 0
    r.expectedMs += Math.max(0, elapsed - partial)
    r.inHoursMs += inHours
    r.outsideMs += total - inHours
    if (elapsed > 0) r.workDays++
    if (inHours > 0) r.activeWorkDays++

    // First and last activity of the local day, on days with any.
    let first = Infinity
    let last = -Infinity
    for (const s of spans) {
      if (s.b <= dayStart || s.a >= dayEnd) continue
      first = Math.min(first, Math.max(s.a, dayStart))
      last = Math.max(last, Math.min(s.b, dayEnd))
    }
    if (first !== Infinity) {
      firstSum += minutesInTz(first, tz)
      lastSum += Math.min(24 * 60, minutesInTz(last - 1, tz) + 1)
      firstLastCount++
    }
  }

  if (firstLastCount > 0) {
    r.avgFirstMin = Math.round(firstSum / firstLastCount)
    r.avgLastMin = Math.round(lastSum / firstLastCount)
  }
  return r
}

export function fmtClock(minutes: number | null): string {
  if (minutes == null) return '—'
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Periods offered in the analysis, as local-date ranges [from, to).
export type PeriodKey = 'this_week' | 'last_week' | 'this_month' | 'last_month'

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
]

export function periodRange(key: PeriodKey, today = new Date()): { from: Date; to: Date } {
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()
  // Weeks start on Monday.
  const monday = d - ((today.getDay() + 6) % 7)
  switch (key) {
    case 'this_week':
      return { from: new Date(y, m, monday), to: new Date(y, m, monday + 7) }
    case 'last_week':
      return { from: new Date(y, m, monday - 7), to: new Date(y, m, monday) }
    case 'this_month':
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1) }
    case 'last_month':
      return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) }
  }
}

// ── Time per status ────────────────────────────────────────────────────────

export type StatusChange = {
  at: string
  status_text: string | null
  status_emoji: string | null
}

export type StatusTotal = {
  emoji: string | null
  text: string | null
  ms: number
}

// How long a member spent in each Slack status during [from, to), from the log
// of status changes. Each change holds until the next one (or until `now`); the
// latest change before `from` supplies the status already set when the period
// opened. Statuses are grouped by text and emoji; "no status" is left out.
export function statusTotals(changes: StatusChange[], from: number, to: number, now: number): StatusTotal[] {
  const end = Math.min(to, now)
  const sorted = [...changes].sort((a, b) => a.at.localeCompare(b.at))
  const totals = new Map<string, StatusTotal>()
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]
    if (!c.status_text && !c.status_emoji) continue
    const a = Math.max(Date.parse(c.at), from)
    const b = Math.min(i + 1 < sorted.length ? Date.parse(sorted[i + 1].at) : end, end)
    if (b <= a) continue
    const key = `${c.status_emoji ?? ''}\u0000${(c.status_text ?? '').trim().toLowerCase()}`
    const t = totals.get(key)
    if (t) t.ms += b - a
    else totals.set(key, { emoji: c.status_emoji, text: c.status_text, ms: b - a })
  }
  return [...totals.values()].sort((x, y) => y.ms - x.ms)
}
