// Employees: the people whose leave we track (distinct from app `users`). Leave
// requests are mapped to an employee here. See migrations/0017_employees.sql.
//
// start_date is the employment start date: the constant every annual-leave
// entitlement is derived from (see shared/entitlement.ts). It is edited here and
// never cached — the entitlement is recomputed from it on every read.

export type EmployeeRow = {
  id: number
  name: string
  email: string | null
  department: string | null
  start_date: string | null
  annual_quota: number | null
  is_active: number
  created_at: string
}

// Columns returned by every employee query, so list/create/update agree.
const COLUMNS = `id, name, email, department, start_date, annual_quota, is_active, created_at`

// All active employees, alphabetical.
export async function listEmployees(db: D1Database): Promise<EmployeeRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS}
         FROM employees
        WHERE is_active = 1
        ORDER BY name COLLATE NOCASE`,
    )
    .all<EmployeeRow>()
  return results ?? []
}

// Normalize a date input to a plain YYYY-MM-DD string, or null. Anything else
// (free text, a full timestamp's time part) is rejected rather than stored, so
// the entitlement math never has to guess.
function toDay(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

// Create an employee. Names are unique (case-insensitively); if one already
// exists we return it rather than erroring, so "add" is idempotent.
export async function createEmployee(
  db: D1Database,
  input: {
    name: string
    email?: string | null
    department?: string | null
    startDate?: string | null
    annualQuota?: number | null
  },
): Promise<{ ok: true; employee: EmployeeRow } | { ok: false; error: string }> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name required' }

  const existing = await db
    .prepare(`SELECT ${COLUMNS} FROM employees WHERE name = ? COLLATE NOCASE`)
    .bind(name)
    .first<EmployeeRow>()
  if (existing) return { ok: true, employee: existing }

  const employee = await db
    .prepare(
      `INSERT INTO employees (name, email, department, start_date, annual_quota)
       VALUES (?, ?, ?, ?, ?)
       RETURNING ${COLUMNS}`,
    )
    .bind(
      name,
      input.email?.trim() || null,
      input.department?.trim() || null,
      toDay(input.startDate),
      input.annualQuota ?? null,
    )
    .first<EmployeeRow>()
  if (!employee) return { ok: false, error: 'failed to create employee' }
  return { ok: true, employee }
}

// Fields an edit may touch. An omitted key is left alone; an explicit null
// clears the column (a mistyped start date can be taken back).
export type EmployeePatch = {
  name?: string
  email?: string | null
  department?: string | null
  startDate?: string | null
  annualQuota?: number | null
  isActive?: boolean
}

// Update an employee. Returns the stored row so the caller can render the
// re-derived entitlement without a second fetch.
export async function updateEmployee(
  db: D1Database,
  id: number,
  patch: EmployeePatch,
): Promise<{ ok: true; employee: EmployeeRow } | { ok: false; error: string; status?: number }> {
  const sets: string[] = []
  const binds: unknown[] = []

  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return { ok: false, error: 'name required' }
    const clash = await db
      .prepare(`SELECT id FROM employees WHERE name = ? COLLATE NOCASE AND id <> ?`)
      .bind(name, id)
      .first<{ id: number }>()
    if (clash) return { ok: false, error: 'another employee already has that name' }
    sets.push('name = ?')
    binds.push(name)
  }
  if (patch.email !== undefined) {
    sets.push('email = ?')
    binds.push(patch.email?.trim() || null)
  }
  if (patch.department !== undefined) {
    sets.push('department = ?')
    binds.push(patch.department?.trim() || null)
  }
  if (patch.startDate !== undefined) {
    // A non-empty value that isn't a real YYYY-MM-DD day is a client bug, not a
    // reason to silently blank the field the entitlement depends on.
    const day = toDay(patch.startDate)
    if (patch.startDate && !day) return { ok: false, error: 'start date must be YYYY-MM-DD' }
    sets.push('start_date = ?')
    binds.push(day)
  }
  if (patch.annualQuota !== undefined) {
    if (patch.annualQuota !== null && !(patch.annualQuota >= 0)) {
      return { ok: false, error: 'annual quota must be a positive number of days' }
    }
    sets.push('annual_quota = ?')
    binds.push(patch.annualQuota)
  }
  if (patch.isActive !== undefined) {
    sets.push('is_active = ?')
    binds.push(patch.isActive ? 1 : 0)
  }

  if (sets.length === 0) return { ok: false, error: 'nothing to update' }

  const employee = await db
    .prepare(`UPDATE employees SET ${sets.join(', ')} WHERE id = ? RETURNING ${COLUMNS}`)
    .bind(...binds, id)
    .first<EmployeeRow>()
  if (!employee) return { ok: false, error: 'employee not found', status: 404 }
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
