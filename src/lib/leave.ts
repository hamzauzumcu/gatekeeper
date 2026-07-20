import { apiFetch } from './api'
// Client API for leave requests. Requests arrive via a Tally form / CSV export
// and are stored raw; an admin maps each to an employee, then approves/rejects.

export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export type LeaveRequest = {
  id: number
  submission_id: string | null
  respondent_id: string | null
  employee_id: number | null
  employee_name: string | null
  raw_name: string
  leave_type: string | null
  start_date: string | null
  end_date: string | null
  hours_requested: string | null
  working_days: string | null
  reason: string | null
  document_url: string | null
  submitted_at: string | null
  status: LeaveStatus
  reviewer: string | null
  reviewer_name: string | null
  reviewed_at: string | null
  created_at: string
}

// One row sent to the bulk-import endpoint (parsed from a CSV client-side).
export type LeaveImportRow = {
  submissionId?: string | null
  respondentId?: string | null
  name: string
  leaveType?: string | null
  startDate?: string | null
  endDate?: string | null
  hoursRequested?: string | null
  workingDays?: string | null
  reason?: string | null
  documentUrl?: string | null
  submittedAt?: string | null
}

export async function fetchLeaveRequests(): Promise<LeaveRequest[]> {
  const res = await apiFetch('/api/leave')
  const data = (await res.json()) as { ok: true; requests: LeaveRequest[] } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch leave requests')
  return data.requests
}

export async function importLeaveRequests(
  rows: LeaveImportRow[],
): Promise<{ inserted: number; skipped: number }> {
  const res = await apiFetch('/api/leave/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  })
  const data = (await res.json()) as
    | { ok: true; summary: { inserted: number; skipped: number } }
    | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to import')
  return data.summary
}

export async function assignEmployee(id: number, employeeId: number | null): Promise<void> {
  const res = await apiFetch(`/api/leave/${id}/assign-employee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId }),
  })
  const data = (await res.json()) as { ok: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'failed to assign employee')
}

export async function updateLeaveDuration(
  id: number,
  workingDays: string | null,
  hours: string | null,
): Promise<void> {
  const res = await apiFetch(`/api/leave/${id}/duration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workingDays, hours }),
  })
  const data = (await res.json()) as { ok: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'failed to update duration')
}

export async function updateLeaveDates(
  id: number,
  startDate: string | null,
  endDate: string | null,
): Promise<void> {
  const res = await apiFetch(`/api/leave/${id}/dates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate, endDate }),
  })
  const data = (await res.json()) as { ok: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'failed to update dates')
}

// Parse a raw duration string into a number. Handles comma decimals ("2,5"),
// Turkish half-words ("buçuk"/"yarım" → +0.5), and free text with a number
// embedded ("5 hours" → 5, "1 buçuk saat" → 1.5). Returns null if no amount.
export function parseAmount(raw: string | null | undefined): number | null {
  if (!raw) return null
  const s = raw.toLowerCase().replace(',', '.')
  const half = /bu[çc]uk|yar[ıi]m|half/.test(s) ? 0.5 : 0
  const m = s.match(/\d+(?:\.\d+)?/)
  if (!m) return half || null
  return parseFloat(m[0]) + half
}

// Trim a number for display: 3 → "3", 1.5 → "1.5".
export function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

// The calendar year a request belongs to (from its start date, then submission).
export function leaveYear(r: Pick<LeaveRequest, 'start_date' | 'submitted_at'>): string | null {
  const m = (r.start_date || r.submitted_at || '').match(/^(\d{4})/)
  return m ? m[1] : null
}

// --- Date helpers (plain YYYY-MM-DD strings, UTC math to dodge DST/timezone) ---

// Normalize a raw date to a YYYY-MM-DD key, or null if it isn't a plain ISO date.
export function isoDay(raw: string | null | undefined): string | null {
  const m = (raw ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function toUTC(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

// A YYYY-MM-DD key n days after `day` (n may be negative).
export function addDays(day: string, n: number): string {
  const dt = new Date(toUTC(day) + n * 86400000)
  const y = dt.getUTCFullYear()
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const da = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

// Whole days from a to b (b - a); negative if b precedes a.
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000)
}

// Weekday of an ISO day as 0=Monday … 6=Sunday.
export function weekdayMon(day: string): number {
  return (new Date(toUTC(day)).getUTCDay() + 6) % 7
}

// The calendar span a leave occupies. Prefer an explicit end_date; otherwise
// derive the end from working_days so a "30.03.2026 · 3 days" request with no
// (or a same-as-start) end_date still spans three cells. Returns null if the
// start date isn't a usable ISO date.
export function leaveSpan(
  r: Pick<LeaveRequest, 'start_date' | 'end_date' | 'working_days'>,
): { start: string; end: string; days: number } | null {
  const start = isoDay(r.start_date)
  if (!start) return null
  const end = isoDay(r.end_date)
  if (end && daysBetween(start, end) > 0) {
    return { start, end, days: daysBetween(start, end) + 1 }
  }
  const dur = parseAmount(r.working_days)
  const span = Math.max(1, Math.ceil(dur ?? 1))
  return { start, end: addDays(start, span - 1), days: span }
}

export async function reviewLeaveRequest(
  id: number,
  decision: 'approved' | 'rejected',
  reviewer: string,
  reviewerName: string,
): Promise<LeaveRequest> {
  const res = await apiFetch(`/api/leave/${id}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, reviewer, reviewerName }),
  })
  const data = (await res.json()) as { ok: true; request: LeaveRequest } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to review request')
  return data.request
}

// Set a request's status directly. Unlike reviewLeaveRequest this also changes
// an already-decided request, including reverting it to pending.
export async function setLeaveStatus(
  id: number,
  status: LeaveStatus,
  reviewer: string,
  reviewerName: string,
): Promise<LeaveRequest> {
  const res = await apiFetch(`/api/leave/${id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, reviewer, reviewerName }),
  })
  const data = (await res.json()) as { ok: true; request: LeaveRequest } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to update status')
  return data.request
}

// Permanently delete a leave request.
export async function deleteLeaveRequest(id: number): Promise<void> {
  const res = await apiFetch(`/api/leave/${id}`, { method: 'DELETE' })
  const data = (await res.json()) as { ok: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'failed to delete request')
}

// Parse a Tally CSV export (already parsed into row objects by PapaParse) into
// import rows. Column headers vary slightly, so we match them flexibly.
export function csvRowsToImportRows(rows: Record<string, string>[]): LeaveImportRow[] {
  const pick = (row: Record<string, string>, re: RegExp): string | null => {
    for (const [key, val] of Object.entries(row)) {
      if (re.test(key.trim())) {
        const v = (val ?? '').trim()
        if (v) return v
      }
    }
    return null
  }
  const out: LeaveImportRow[] = []
  for (const row of rows) {
    const name = pick(row, /full ?name|^name$/i)
    if (!name) continue
    // The two date columns ("Untitled date field" / "… (2)") are start/end but
    // are occasionally entered out of order — sort them so start ≤ end.
    const dates = Object.entries(row)
      .filter(([k]) => /date/i.test(k))
      .map(([, v]) => (v ?? '').trim())
      .filter(Boolean)
      .sort()
    out.push({
      submissionId: pick(row, /submission id/i),
      respondentId: pick(row, /respondent id/i),
      name,
      leaveType: pick(row, /leave detail|leave type/i),
      startDate: dates[0] ?? null,
      endDate: dates[1] ?? dates[0] ?? null,
      hoursRequested: pick(row, /hour/i),
      workingDays: pick(row, /working day|total.*day/i),
      reason: pick(row, /reason/i),
      documentUrl: pick(row, /document/i),
      submittedAt: pick(row, /submitted at/i),
    })
  }
  return out
}
