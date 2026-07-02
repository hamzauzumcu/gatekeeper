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
