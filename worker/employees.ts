// Employees: the people whose leave we track (distinct from app `users`). Leave
// requests are mapped to an employee here. See migrations/0017_employees.sql.

export type EmployeeRow = {
  id: number
  name: string
  email: string | null
  department: string | null
  annual_quota: number | null
  is_active: number
  created_at: string
}

// All active employees, alphabetical.
export async function listEmployees(db: D1Database): Promise<EmployeeRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, email, department, annual_quota, is_active, created_at
         FROM employees
        WHERE is_active = 1
        ORDER BY name COLLATE NOCASE`,
    )
    .all<EmployeeRow>()
  return results ?? []
}

// Create an employee. Names are unique (case-insensitively); if one already
// exists we return it rather than erroring, so "add" is idempotent.
export async function createEmployee(
  db: D1Database,
  input: { name: string; email?: string | null; department?: string | null; annualQuota?: number | null },
): Promise<{ ok: true; employee: EmployeeRow } | { ok: false; error: string }> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name required' }

  const existing = await db
    .prepare(`SELECT * FROM employees WHERE name = ? COLLATE NOCASE`)
    .bind(name)
    .first<EmployeeRow>()
  if (existing) return { ok: true, employee: existing }

  const employee = await db
    .prepare(
      `INSERT INTO employees (name, email, department, annual_quota)
       VALUES (?, ?, ?, ?)
       RETURNING id, name, email, department, annual_quota, is_active, created_at`,
    )
    .bind(name, input.email?.trim() || null, input.department?.trim() || null, input.annualQuota ?? null)
    .first<EmployeeRow>()
  if (!employee) return { ok: false, error: 'failed to create employee' }
  return { ok: true, employee }
}

// Look up an employee id by an exact (case-insensitive) name — used to auto-map
// imported leave rows to an existing employee.
export async function findEmployeeIdByName(db: D1Database, name: string): Promise<number | null> {
  const row = await db
    .prepare(`SELECT id FROM employees WHERE name = ? COLLATE NOCASE`)
    .bind(name.trim())
    .first<{ id: number }>()
  return row?.id ?? null
}
