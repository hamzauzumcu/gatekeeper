import { apiFetch } from './api'
// Client API for employees (people whose leave we track, distinct from app users).
//
// start_date is the employment start date, the constant annual-leave entitlement
// is derived from. The entitlement itself is never stored or sent by the server:
// it is computed from this date (see shared/entitlement.ts), so every edit
// re-calculates the balances on the next render.

// The entitlement rules are shared with the worker; re-exported here so UI code
// has one import.
export {
  entitlementFor,
  tierDays,
  yearsOfServiceAt,
  SENIORITY_TIERS,
  DEFAULT_ANNUAL_QUOTA_DAYS,
  type Entitlement,
} from '../../shared/entitlement'

export type Employee = {
  id: number
  name: string
  email: string | null
  department: string | null
  start_date: string | null // YYYY-MM-DD; null when not recorded yet
  annual_quota: number | null // overrides the seniority tier when set
  is_active: number
  created_at: string
}

export async function fetchEmployees(): Promise<Employee[]> {
  const res = await apiFetch('/api/employees')
  const data = (await res.json()) as { ok: true; employees: Employee[] } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch employees')
  return data.employees
}

export async function createEmployee(input: {
  name: string
  email?: string
  department?: string
  startDate?: string | null
  annualQuota?: number | null
}): Promise<Employee> {
  const res = await apiFetch('/api/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = (await res.json()) as { ok: true; employee: Employee } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to create employee')
  return data.employee
}

// Edit an employee. Only the keys passed are changed; pass null to clear one.
export async function updateEmployee(
  id: number,
  patch: {
    name?: string
    email?: string | null
    department?: string | null
    startDate?: string | null
    annualQuota?: number | null
    isActive?: boolean
  },
): Promise<Employee> {
  const res = await apiFetch(`/api/employees/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const data = (await res.json()) as { ok: true; employee: Employee } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to update employee')
  return data.employee
}
