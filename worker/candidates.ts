// Aday listesi ve detay sorguları (salt-okunur).

export type CandidateListItem = {
  id: number
  full_name: string | null
  email: string | null
  phone: string | null
  country: string | null
  linkedin_url: string | null
  applications_count: number
  latest_submitted_at: string | null
  positions: string | null // group_concat
}

export type CandidateAnswer = { label: string; type: string; value: string | null }

export type CandidateApplication = {
  id: number
  position_title: string | null
  submitted_at: string | null
  status: string
  resume_url: string | null
  cover_letter: string | null
  answers: CandidateAnswer[]
}

export type CandidateDetail = {
  applicant: CandidateListItem
  applications: CandidateApplication[]
}

export type CandidateFilters = {
  countries: string[]
  positions: string[]
}

export async function getCandidateFilters(db: D1Database): Promise<CandidateFilters> {
  const [countriesRes, positionsRes] = await db.batch([
    db.prepare(`SELECT DISTINCT country FROM applicants WHERE country IS NOT NULL AND country != '' ORDER BY country`),
    db.prepare(`SELECT DISTINCT title FROM job_positions WHERE title IS NOT NULL AND title != '' ORDER BY title`),
  ])
  return {
    countries: (countriesRes.results ?? []).map((r) => (r as { country: string }).country),
    positions: (positionsRes.results ?? []).map((r) => (r as { title: string }).title),
  }
}

export async function listCandidates(
  db: D1Database,
  opts: { q?: string; countries?: string[]; position?: string; limit?: number; offset?: number }
): Promise<{ candidates: CandidateListItem[]; total: number }> {
  const q = (opts.q ?? '').trim()
  const countries = (opts.countries ?? []).filter(Boolean)
  const position = (opts.position ?? '').trim()
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)

  const conditions: string[] = []
  const bindings: string[] = []
  let idx = 0

  if (q) {
    idx++
    conditions.push(`(ap.full_name LIKE ?${idx} OR ap.email LIKE ?${idx})`)
    bindings.push(`%${q}%`)
  }

  if (countries.length > 0) {
    const placeholders = countries.map(() => `?${++idx}`).join(', ')
    conditions.push(`ap.country IN (${placeholders})`)
    bindings.push(...countries)
  }

  if (position) {
    idx++
    conditions.push(
      `EXISTS (SELECT 1 FROM applications a2 JOIN job_positions p2 ON p2.id = a2.position_id WHERE a2.applicant_id = ap.id AND p2.title = ?${idx})`
    )
    bindings.push(position)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const listSql = `
    SELECT ap.id, ap.full_name, ap.email, ap.phone, ap.country, ap.linkedin_url,
           count(a.id)            AS applications_count,
           max(a.submitted_at)    AS latest_submitted_at,
           group_concat(DISTINCT p.title) AS positions
    FROM applicants ap
    LEFT JOIN applications a ON a.applicant_id = ap.id
    LEFT JOIN job_positions p ON p.id = a.position_id
    ${where}
    GROUP BY ap.id
    ORDER BY latest_submitted_at DESC
    LIMIT ${limit} OFFSET ${offset}`

  const countSql = `SELECT count(*) AS total FROM applicants ap ${where}`

  const bind = (sql: string) =>
    bindings.length ? db.prepare(sql).bind(...bindings) : db.prepare(sql)

  const [listRes, countRes] = await db.batch<CandidateListItem | { total: number }>([
    bind(listSql),
    bind(countSql),
  ])

  const candidates = (listRes.results ?? []) as CandidateListItem[]
  const total = ((countRes.results ?? [])[0] as { total: number } | undefined)?.total ?? 0
  return { candidates, total }
}

export async function getCandidate(
  db: D1Database,
  id: number
): Promise<CandidateDetail | null> {
  const applicant = await db
    .prepare(
      `SELECT ap.id, ap.full_name, ap.email, ap.phone, ap.country, ap.linkedin_url,
              count(a.id) AS applications_count,
              max(a.submitted_at) AS latest_submitted_at,
              group_concat(DISTINCT p.title) AS positions
       FROM applicants ap
       LEFT JOIN applications a ON a.applicant_id = ap.id
       LEFT JOIN job_positions p ON p.id = a.position_id
       WHERE ap.id = ?
       GROUP BY ap.id`
    )
    .bind(id)
    .first<CandidateListItem>()
  if (!applicant) return null

  const apps = await db
    .prepare(
      `SELECT a.id, a.submitted_at, a.status, a.resume_url, a.cover_letter,
              p.title AS position_title
       FROM applications a
       LEFT JOIN job_positions p ON p.id = a.position_id
       WHERE a.applicant_id = ?
       ORDER BY a.submitted_at DESC`
    )
    .bind(id)
    .all<Omit<CandidateApplication, 'answers'>>()

  const applications = (apps.results ?? []).map((a) => ({ ...a, answers: [] as CandidateAnswer[] }))
  if (applications.length) {
    const ids = applications.map((a) => a.id)
    const placeholders = ids.map(() => '?').join(',')
    const ans = await db
      .prepare(
        `SELECT aa.application_id, q.label, q.type, q.sort_order, aa.value
         FROM application_answers aa
         JOIN position_questions q ON q.id = aa.question_id
         WHERE aa.application_id IN (${placeholders})
         ORDER BY q.sort_order`
      )
      .bind(...ids)
      .all<{ application_id: number; label: string; type: string; value: string | null }>()

    const byApp = new Map<number, CandidateAnswer[]>()
    for (const r of ans.results ?? []) {
      const list = byApp.get(r.application_id) ?? []
      list.push({ label: r.label, type: r.type, value: r.value })
      byApp.set(r.application_id, list)
    }
    for (const a of applications) a.answers = byApp.get(a.id) ?? []
  }

  return { applicant, applications }
}
