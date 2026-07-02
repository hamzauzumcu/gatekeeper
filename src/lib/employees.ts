import { apiFetch } from './api'
// Client API for employees (people whose leave we track, distinct from app users).

export type Employee = {
  id: number
  name: string
  email: string | null
  department: string | null
  annual_quota: number | null
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
  annualQuota?: number
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
