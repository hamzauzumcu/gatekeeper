// Canonical leave types, shared by the worker (validation) and the UI (dropdown,
// totals).
//
// Requests arrive from the Tally form with a free-text type ("Sick Leave",
// "Annual Leave", …) which is kept raw in leave_requests.leave_type. A reviewer
// can override it with one of the keys below (leave_requests.leave_kind),
// because what someone files is not always what the company books it as — a
// request submitted as sick leave may be approved as personal leave.
//
// `counts` decides whether an APPROVED request is deducted from the employee's
// annual entitlement. Sick leave is tracked and shown, but never deducted.

export type LeaveTypeKey =
  | 'general'
  | 'emergency'
  | 'annual'
  | 'sick'
  | 'personal'
  | 'parental'
  | 'other'

export type LeaveTypeDef = {
  key: LeaveTypeKey
  label: string
  counts: boolean // deducted from the annual entitlement when approved
  match: RegExp // matches the raw submitted type, for rows with no override
}

// Order matters twice: it is the dropdown order, and inference takes the first
// match — so narrower patterns come before broader ones.
export const LEAVE_TYPES: LeaveTypeDef[] = [
  { key: 'general', label: 'General', counts: true, match: /general/i },
  { key: 'emergency', label: 'Emergency', counts: true, match: /emergen|urgent/i },
  { key: 'annual', label: 'Annual Leave', counts: true, match: /annual|yearly|vacation|holiday/i },
  { key: 'sick', label: 'Sick Leave', counts: false, match: /sick|illness|medical/i },
  { key: 'personal', label: 'Personal Leave', counts: true, match: /personal/i },
  {
    key: 'parental',
    label: 'Maternity/Paternity Leave',
    counts: true,
    match: /matern|patern|parental|birth/i,
  },
  { key: 'other', label: 'Other', counts: true, match: /other|misc/i },
]

export const LEAVE_TYPE_KEYS: LeaveTypeKey[] = LEAVE_TYPES.map((t) => t.key)

export function isLeaveTypeKey(value: unknown): value is LeaveTypeKey {
  return typeof value === 'string' && LEAVE_TYPE_KEYS.includes(value as LeaveTypeKey)
}

// Annual entitlement in working days when an employee has no explicit quota.
export const DEFAULT_ANNUAL_QUOTA_DAYS = 14

// The type a request is booked as: the reviewer's override if there is one,
// otherwise inferred from the raw submitted text, falling back to 'other'.
export function resolveLeaveType(
  kind: string | null | undefined,
  rawType: string | null | undefined,
): LeaveTypeKey {
  if (isLeaveTypeKey(kind)) return kind
  const raw = (rawType ?? '').trim()
  if (raw) {
    for (const t of LEAVE_TYPES) if (t.match.test(raw)) return t.key
  }
  return 'other'
}

export function leaveTypeDef(key: LeaveTypeKey): LeaveTypeDef {
  return LEAVE_TYPES.find((t) => t.key === key) ?? LEAVE_TYPES[LEAVE_TYPES.length - 1]
}

export function leaveTypeLabel(key: LeaveTypeKey): string {
  return leaveTypeDef(key).label
}
