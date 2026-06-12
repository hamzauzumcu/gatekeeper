// Candidate list and detail queries (read-only).

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
  salary_expectation: string | null
  latest_status: string | null
  latest_application_id: number | null
  fit_status: string | null
  notes_count: number
  extra_answers?: Record<string, string | null>
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

export type QuestionColumn = {
  id: number
  label: string
  type: 'text' | 'number' | 'boolean' | 'file'
  field_key: string
  position_id: number
  position_title: string
}

export type AnswerFilter = {
  questionId: number
  op: string
  value: string
}

const VALID_OPS = [
  'contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'is_true', 'is_false', 'is_empty', 'is_not_empty',
] as const

const NO_VALUE_OPS = new Set(['is_empty', 'is_not_empty', 'is_true', 'is_false'])

type AnswerFilterResult = { sql: string; binding?: string | number }

function buildAnswerFilterCondition(
  qId: number,
  op: string,
  value: string,
  idx: number
): AnswerFilterResult | null {
  const subq = `(SELECT aa_f.value
    FROM applications a_f
    JOIN application_answers aa_f ON aa_f.application_id = a_f.id
    WHERE a_f.applicant_id = ap.id AND aa_f.question_id = ${qId}
    ORDER BY a_f.submitted_at DESC LIMIT 1)`

  switch (op) {
    case 'contains':
      return { sql: `${subq} LIKE ?${idx}`, binding: `%${value}%` }
    case 'not_contains':
      return { sql: `${subq} NOT LIKE ?${idx}`, binding: `%${value}%` }
    case 'equals':
      return { sql: `${subq} = ?${idx}`, binding: value }
    case 'not_equals':
      return { sql: `${subq} != ?${idx}`, binding: value }
    case 'starts_with':
      return { sql: `${subq} LIKE ?${idx}`, binding: `${value}%` }
    case 'ends_with':
      return { sql: `${subq} LIKE ?${idx}`, binding: `%${value}` }
    case 'is_empty':
      return { sql: `COALESCE(${subq}, '') = ''` }
    case 'is_not_empty':
      return { sql: `COALESCE(${subq}, '') != ''` }
    case 'eq': {
      const n = Number(value); if (isNaN(n)) return null
      return { sql: `CAST(${subq} AS REAL) = ?${idx}`, binding: n }
    }
    case 'neq': {
      const n = Number(value); if (isNaN(n)) return null
      return { sql: `CAST(${subq} AS REAL) != ?${idx}`, binding: n }
    }
    case 'gt': {
      const n = Number(value); if (isNaN(n)) return null
      return { sql: `CAST(${subq} AS REAL) > ?${idx}`, binding: n }
    }
    case 'gte': {
      const n = Number(value); if (isNaN(n)) return null
      return { sql: `CAST(${subq} AS REAL) >= ?${idx}`, binding: n }
    }
    case 'lt': {
      const n = Number(value); if (isNaN(n)) return null
      return { sql: `CAST(${subq} AS REAL) < ?${idx}`, binding: n }
    }
    case 'lte': {
      const n = Number(value); if (isNaN(n)) return null
      return { sql: `CAST(${subq} AS REAL) <= ?${idx}`, binding: n }
    }
    case 'is_true':
      return { sql: `lower(COALESCE(${subq}, '')) IN ('1', 'true', 'yes')` }
    case 'is_false':
      return { sql: `lower(COALESCE(${subq}, '')) NOT IN ('1', 'true', 'yes')` }
    default:
      return null
  }
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

export async function getQuestionColumns(db: D1Database): Promise<QuestionColumn[]> {
  const res = await db
    .prepare(
      `SELECT pq.id, pq.label, pq.type, pq.field_key, pq.position_id, jp.title AS position_title
       FROM position_questions pq
       JOIN job_positions jp ON jp.id = pq.position_id
       ORDER BY jp.title, pq.sort_order`
    )
    .all<QuestionColumn>()
  return res.results ?? []
}

export async function listCandidates(
  db: D1Database,
  opts: {
    q?: string
    countries?: string[]
    position?: string
    fit_statuses?: string[]
    limit?: number
    offset?: number
    extraCols?: number[]
    answerFilters?: AnswerFilter[]
  }
): Promise<{ candidates: CandidateListItem[]; total: number }> {
  const q = (opts.q ?? '').trim()
  const countries = (opts.countries ?? []).filter(Boolean)
  const position = (opts.position ?? '').trim()
  const fit_statuses = (opts.fit_statuses ?? []).filter((s) => VALID_FIT_STATUSES.includes(s as typeof VALID_FIT_STATUSES[number]))
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)
  const extraCols = (opts.extraCols ?? []).filter((n) => Number.isInteger(n) && n > 0)
  const answerFilters = (opts.answerFilters ?? []).filter(
    (f) => Number.isInteger(f.questionId) && f.questionId > 0 && (VALID_OPS as readonly string[]).includes(f.op)
  )

  const conditions: string[] = []
  const bindings: (string | number)[] = []
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

  if (fit_statuses.length > 0) {
    const placeholders = fit_statuses.map(() => `?${++idx}`).join(', ')
    conditions.push(`ap.fit_status IN (${placeholders})`)
    bindings.push(...fit_statuses)
  }

  for (const f of answerFilters) {
    const needsBinding = !NO_VALUE_OPS.has(f.op)
    const bindingIdx = needsBinding ? idx + 1 : idx
    const res = buildAnswerFilterCondition(f.questionId, f.op, f.value, bindingIdx)
    if (!res) continue
    conditions.push(res.sql)
    if (res.binding !== undefined) {
      idx++
      bindings.push(res.binding)
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const extraColSelects = extraCols
    .map(
      (qId) =>
        `(SELECT aa_ec.value FROM applications a_ec JOIN application_answers aa_ec ON aa_ec.application_id = a_ec.id WHERE a_ec.applicant_id = ap.id AND aa_ec.question_id = ${qId} ORDER BY a_ec.submitted_at DESC LIMIT 1) AS extra_q_${qId}`
    )
    .join(',\n           ')

  const listSql = `
    SELECT ap.id, ap.full_name, ap.email, ap.phone, ap.country, ap.linkedin_url, ap.fit_status,
           count(a.id)            AS applications_count,
           max(a.submitted_at)    AS latest_submitted_at,
           group_concat(DISTINCT p.title) AS positions,
           (SELECT count(*) FROM candidate_notes cn WHERE cn.applicant_id = ap.id) AS notes_count,
           (SELECT aa.value
            FROM applications a_sal
            JOIN application_answers aa ON aa.application_id = a_sal.id
            JOIN position_questions pq ON pq.id = aa.question_id
            WHERE a_sal.applicant_id = ap.id
              AND (pq.field_key LIKE '%salary%'
                OR lower(pq.label) LIKE '%salary%'
                OR lower(pq.label) LIKE '%maaş%'
                OR lower(pq.label) LIKE '%maas%')
            ORDER BY a_sal.submitted_at DESC
            LIMIT 1) AS salary_expectation,
           (SELECT a_ls.status FROM applications a_ls
            WHERE a_ls.applicant_id = ap.id
            ORDER BY a_ls.submitted_at DESC LIMIT 1) AS latest_status,
           (SELECT a_ls.id FROM applications a_ls
            WHERE a_ls.applicant_id = ap.id
            ORDER BY a_ls.submitted_at DESC LIMIT 1) AS latest_application_id${extraCols.length ? `,\n           ${extraColSelects}` : ''}
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

  const [listRes, countRes] = await db.batch<Record<string, unknown> | { total: number }>([
    bind(listSql),
    bind(countSql),
  ])

  const candidates = (listRes.results ?? []).map((rawRow) => {
    const row = rawRow as Record<string, unknown>
    const extra_answers: Record<string, string | null> = {}
    for (const qId of extraCols) {
      extra_answers[String(qId)] = (row[`extra_q_${qId}`] as string | null | undefined) ?? null
      delete row[`extra_q_${qId}`]
    }
    return { ...row, extra_answers } as CandidateListItem
  })

  const total = ((countRes.results ?? [])[0] as { total: number } | undefined)?.total ?? 0
  return { candidates, total }
}

const VALID_STATUSES = ['new', 'reviewed', 'shortlisted', 'rejected'] as const
export const VALID_FIT_STATUSES = ['not_fit', 'good_fit', 'maybe'] as const
export type FitStatus = typeof VALID_FIT_STATUSES[number]

export async function updateApplicationStatus(
  db: D1Database,
  applicationId: number,
  status: string
): Promise<boolean> {
  if (!(VALID_STATUSES as readonly string[]).includes(status)) throw new Error('invalid status')
  const res = await db
    .prepare(`UPDATE applications SET status = ? WHERE id = ?`)
    .bind(status, applicationId)
    .run()
  return (res.meta?.changes ?? 0) > 0
}

export async function updateApplicantsFitStatus(
  db: D1Database,
  ids: number[],
  fit_status: string | null
): Promise<number> {
  if (ids.length === 0) return 0
  if (fit_status !== null && !(VALID_FIT_STATUSES as readonly string[]).includes(fit_status)) {
    throw new Error('invalid fit_status')
  }
  const placeholders = ids.map(() => '?').join(',')
  const res = await db
    .prepare(`UPDATE applicants SET fit_status = ? WHERE id IN (${placeholders})`)
    .bind(fit_status, ...ids)
    .run()
  return res.meta?.changes ?? 0
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
              group_concat(DISTINCT p.title) AS positions,
              (SELECT count(*) FROM candidate_notes cn WHERE cn.applicant_id = ap.id) AS notes_count
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
