// Leave requests: time-off filed via a Tally form / CSV export. Fields are stored
// raw (see migrations/0018_leave_requests.sql). An admin maps each request to an
// employee, then approves or rejects it. Reviewer is an app user (users.username).

import { findEmployeeIdByName } from './employees'

export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export type LeaveRequestRow = {
  id: number
  submission_id: string | null
  respondent_id: string | null
  employee_id: number | null
  employee_name: string | null // joined from employees (NULL until mapped)
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

// One incoming leave row from a CSV import or the Tally webhook. All fields are
// raw strings; only a name is required.
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

const clean = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s || null
}

// All requests, newest submission first, with the mapped employee name joined in.
export async function listLeaveRequests(db: D1Database): Promise<LeaveRequestRow[]> {
  const { results } = await db
    .prepare(
      `SELECT lr.id, lr.submission_id, lr.respondent_id, lr.employee_id,
              e.name AS employee_name, lr.raw_name, lr.leave_type,
              lr.start_date, lr.end_date, lr.hours_requested, lr.working_days,
              lr.reason, lr.document_url, lr.submitted_at, lr.status,
              lr.reviewer, lr.reviewer_name, lr.reviewed_at, lr.created_at
         FROM leave_requests lr
         LEFT JOIN employees e ON e.id = lr.employee_id
        ORDER BY COALESCE(lr.submitted_at, lr.created_at) DESC, lr.id DESC`,
    )
    .all<LeaveRequestRow>()
  return results ?? []
}

// Insert a single leave request, auto-mapping to an existing employee by name.
// Deduped on submission_id (existing submissions are left untouched). Returns
// whether a new row was created.
export async function insertLeaveRequest(
  db: D1Database,
  row: LeaveImportRow,
): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  const name = clean(row.name)
  if (!name) return { ok: false, error: 'name required' }

  const employeeId = await findEmployeeIdByName(db, name)
  const res = await db
    .prepare(
      `INSERT INTO leave_requests
         (submission_id, respondent_id, employee_id, raw_name, leave_type,
          start_date, end_date, hours_requested, working_days, reason,
          document_url, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(submission_id) DO NOTHING`,
    )
    .bind(
      clean(row.submissionId),
      clean(row.respondentId),
      employeeId,
      name,
      clean(row.leaveType),
      clean(row.startDate),
      clean(row.endDate),
      clean(row.hoursRequested),
      clean(row.workingDays),
      clean(row.reason),
      clean(row.documentUrl),
      clean(row.submittedAt),
    )
    .run()
  return { ok: true, created: (res.meta?.changes ?? 0) > 0 }
}

// Bulk import (CSV). Auto-maps each row to an employee by name and dedupes on
// submission_id. Returns how many rows were newly inserted vs. skipped.
export async function importLeaveRequests(
  db: D1Database,
  rows: LeaveImportRow[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0
  for (const row of rows) {
    const res = await insertLeaveRequest(db, row)
    if (res.ok && res.created) inserted += 1
  }
  return { inserted, skipped: rows.length - inserted }
}

// Map (or re-map) a request to an employee. Pass null to clear the mapping.
export async function assignEmployee(
  db: D1Database,
  id: number,
  employeeId: number | null,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  if (employeeId !== null) {
    const exists = await db.prepare(`SELECT 1 FROM employees WHERE id = ?`).bind(employeeId).first()
    if (!exists) return { ok: false, error: 'employee not found', status: 404 }
  }
  const res = await db
    .prepare(`UPDATE leave_requests SET employee_id = ? WHERE id = ?`)
    .bind(employeeId, id)
    .run()
  if ((res.meta?.changes ?? 0) === 0) return { ok: false, error: 'request not found', status: 404 }
  return { ok: true }
}

// Manually correct the raw duration fields of a request (for messy legacy rows;
// new Tally submissions arrive with clean numeric day/hour fields). Either value
// may be null/empty to clear it. Stored raw, like every other duration value.
export async function updateLeaveDuration(
  db: D1Database,
  id: number,
  workingDays: string | null,
  hours: string | null,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const res = await db
    .prepare(`UPDATE leave_requests SET working_days = ?, hours_requested = ? WHERE id = ?`)
    .bind(clean(workingDays), clean(hours), id)
    .run()
  if ((res.meta?.changes ?? 0) === 0) return { ok: false, error: 'request not found', status: 404 }
  return { ok: true }
}

// Manually set (or clear) a request's start/end dates. Stored as plain
// YYYY-MM-DD strings (validated by the route); either may be null. If both are
// present and out of order they are swapped, mirroring the CSV import.
export async function updateLeaveDates(
  db: D1Database,
  id: number,
  startDate: string | null,
  endDate: string | null,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  let start = clean(startDate)
  let end = clean(endDate)
  if (start && end && start > end) [start, end] = [end, start]
  const res = await db
    .prepare(`UPDATE leave_requests SET start_date = ?, end_date = ? WHERE id = ?`)
    .bind(start, end, id)
    .run()
  if ((res.meta?.changes ?? 0) === 0) return { ok: false, error: 'request not found', status: 404 }
  return { ok: true }
}

// Load one request with its employee name joined in (the shape the UI expects).
async function getLeaveRequest(db: D1Database, id: number): Promise<LeaveRequestRow | null> {
  const row = await db
    .prepare(
      `SELECT lr.id, lr.submission_id, lr.respondent_id, lr.employee_id,
              e.name AS employee_name, lr.raw_name, lr.leave_type,
              lr.start_date, lr.end_date, lr.hours_requested, lr.working_days,
              lr.reason, lr.document_url, lr.submitted_at, lr.status,
              lr.reviewer, lr.reviewer_name, lr.reviewed_at, lr.created_at
         FROM leave_requests lr
         LEFT JOIN employees e ON e.id = lr.employee_id
        WHERE lr.id = ?`,
    )
    .bind(id)
    .first<LeaveRequestRow>()
  return row ?? null
}

// Delete a request outright. Used to clear duplicate or mistaken submissions;
// there is no soft-delete, so the row is gone for good.
export async function deleteLeaveRequest(
  db: D1Database,
  id: number,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const res = await db.prepare(`DELETE FROM leave_requests WHERE id = ?`).bind(id).run()
  if ((res.meta?.changes ?? 0) === 0) return { ok: false, error: 'request not found', status: 404 }
  return { ok: true }
}

// Set a request's status directly, unlike reviewLeaveRequest this also allows
// correcting an already-decided request or reverting it to pending. Reverting
// clears the reviewer fields so the row looks untouched again; deciding stamps
// the acting user as reviewer.
export async function setLeaveStatus(
  db: D1Database,
  id: number,
  status: LeaveStatus,
  reviewer: string,
  reviewerName: string,
): Promise<{ ok: true; request: LeaveRequestRow } | { ok: false; error: string; status?: number }> {
  const res =
    status === 'pending'
      ? await db
          .prepare(
            `UPDATE leave_requests
                SET status = 'pending', reviewer = NULL, reviewer_name = NULL, reviewed_at = NULL
              WHERE id = ?`,
          )
          .bind(id)
          .run()
      : await db
          .prepare(
            `UPDATE leave_requests
                SET status = ?, reviewer = ?, reviewer_name = ?,
                    reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
              WHERE id = ?`,
          )
          .bind(status, reviewer, reviewerName, id)
          .run()
  if ((res.meta?.changes ?? 0) === 0) return { ok: false, error: 'request not found', status: 404 }

  const row = await getLeaveRequest(db, id)
  if (!row) return { ok: false, error: 'failed to load request', status: 500 }
  return { ok: true, request: row }
}

// Approve or reject a pending request. Reviewer is an app user.
export async function reviewLeaveRequest(
  db: D1Database,
  id: number,
  decision: 'approved' | 'rejected',
  reviewer: string,
  reviewerName: string,
): Promise<{ ok: true; request: LeaveRequestRow } | { ok: false; error: string; status?: number }> {
  const existing = await db
    .prepare(`SELECT status FROM leave_requests WHERE id = ?`)
    .bind(id)
    .first<{ status: string }>()
  if (!existing) return { ok: false, error: 'request not found', status: 404 }
  if (existing.status !== 'pending') return { ok: false, error: 'request already decided', status: 409 }

  await db
    .prepare(
      `UPDATE leave_requests
          SET status = ?, reviewer = ?, reviewer_name = ?,
              reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE id = ? AND status = 'pending'`,
    )
    .bind(decision, reviewer, reviewerName, id)
    .run()

  const row = await getLeaveRequest(db, id)
  if (!row) return { ok: false, error: 'failed to load request', status: 500 }
  return { ok: true, request: row }
}
