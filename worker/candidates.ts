// Candidate list and detail queries (read-only).

import { CV_COLUMNS } from './cv-schema'
import { logCandidateEvents } from './events'

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
  ai_score: number | null
  // Interview scorecard final score of the latest application (denormalized
  // cache, migration 0024). NULL = no submissions; complete = 0 means partial.
  interview_score: number | null
  interview_score_complete: number
  extra_answers?: Record<string, string | null>
}

export type CandidateAnswer = { question_id: number; label: string; type: string; value: string | null }

export type CandidateApplication = {
  id: number
  position_title: string | null
  submitted_at: string | null
  status: string
  resume_url: string | null
  cover_letter: string | null
  answers: CandidateAnswer[]
  resume_parsed: string | null
  resume_parse_version: number
  ai_score: number | null
  ai_score_reasoning: string | null
  // Interview scorecard availability for the detail panel: number of active
  // criteria on the position's template (0 = no scorecard, tab hidden) and how
  // many interviewers have submitted one.
  scorecard_criteria_count: number
  scorecards_count: number
  interview_score: number | null
  interview_score_complete: number
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

// Scalar subquery yielding the latest answer value for a question column.
// Negative IDs refer to CV-parsed virtual columns; positive IDs to real questions.
function answerSubquery(qId: number): string | null {
  if (qId < 0) {
    const col = CV_COLUMNS.find((c) => c.id === qId)
    if (!col) return null
    return `(SELECT json_extract(a_cv.resume_parsed, '${col.jsonPath}')
      FROM applications a_cv WHERE a_cv.applicant_id = ap.id
      ORDER BY a_cv.submitted_at DESC LIMIT 1)`
  }
  return `(SELECT aa_f.value
    FROM applications a_f
    JOIN application_answers aa_f ON aa_f.application_id = a_f.id
    WHERE a_f.applicant_id = ap.id AND aa_f.question_id = ${qId}
    ORDER BY a_f.submitted_at DESC LIMIT 1)`
}

function buildAnswerFilterCondition(
  qId: number,
  op: string,
  value: string,
  idx: number
): AnswerFilterResult | null {
  const subq = answerSubquery(qId)
  if (!subq) return null
  return buildFilterFromSubq(subq, op, value, idx)
}

// Build an ORDER BY clause from a client-supplied sort key. Unknown/empty keys
// fall back to the default (most recently submitted first). NULL/empty values
// always sort last regardless of direction so blanks don't crowd the top.
function buildOrderBy(sort: string | undefined, dir: string | undefined, sortNumeric: boolean): string {
  const direction = dir === 'asc' ? 'ASC' : 'DESC'
  const fallback = 'ORDER BY latest_submitted_at DESC'
  if (!sort) return fallback

  let expr: string | null = null
  let numeric = false
  switch (sort) {
    case 'name': expr = 'ap.full_name'; break
    case 'country': expr = 'ap.country'; break
    case 'apply_date': expr = 'latest_submitted_at'; break
    case 'score': expr = 'ai_score'; numeric = true; break
    case 'interview_score': expr = 'interview_score'; numeric = true; break
    default:
      if (sort.startsWith('q:')) {
        const qId = Number(sort.slice(2))
        if (Number.isInteger(qId) && qId !== 0) {
          const subq = answerSubquery(qId)
          if (subq) { expr = subq; numeric = sortNumeric }
        }
      }
  }
  if (!expr) return fallback

  const blanksLast = `(CASE WHEN COALESCE(${expr}, '') = '' THEN 1 ELSE 0 END)`
  if (numeric) {
    return `ORDER BY ${blanksLast}, CAST(${expr} AS REAL) ${direction}, ap.id DESC`
  }
  return `ORDER BY ${blanksLast}, ${expr} COLLATE NOCASE ${direction}, ap.id DESC`
}

function buildFilterFromSubq(subq: string, op: string, value: string, idx: number): AnswerFilterResult | null {
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

  // CV parsed alanları virtual sütun olarak başa ekle (negatif ID)
  const cvVirtual: QuestionColumn[] = CV_COLUMNS.map((c) => ({
    id: c.id,
    label: c.label,
    type: c.type,
    field_key: c.jsonPath,
    position_id: 0,
    position_title: 'AI Analysis',
  }))

  return [...cvVirtual, ...(res.results ?? [])]
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
    min_score?: string
    max_score?: string
    min_interview_score?: string
    max_interview_score?: string
    sort?: string
    dir?: string
    sortNumeric?: boolean
    canViewSalary?: boolean
  }
): Promise<{ candidates: CandidateListItem[]; total: number }> {
  // Users without the view_salary permission never receive salary figures.
  const canViewSalary = opts.canViewSalary !== false
  const q = (opts.q ?? '').trim()
  const countries = (opts.countries ?? []).filter(Boolean)
  const position = (opts.position ?? '').trim()
  const fit_statuses_raw = opts.fit_statuses ?? []
  const includeNullStatus = fit_statuses_raw.includes('none')
  const fit_statuses = fit_statuses_raw.filter((s) => VALID_FIT_STATUSES.includes(s as typeof VALID_FIT_STATUSES[number]))
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)
  const extraCols = (opts.extraCols ?? []).filter((n) => Number.isInteger(n) && n !== 0)
  const answerFilters = (opts.answerFilters ?? []).filter(
    (f) => Number.isInteger(f.questionId) && f.questionId !== 0 && (VALID_OPS as readonly string[]).includes(f.op)
  )

  const conditions: string[] = []
  const bindings: (string | number)[] = []
  let idx = 0

  if (q) {
    // A purely numeric query is treated as an applicant ID lookup, while still
    // matching name/email so e.g. "6052" finds the candidate whose id is 6052.
    const asId = /^\d+$/.test(q.trim()) ? Number(q.trim()) : null
    if (asId !== null && Number.isSafeInteger(asId)) {
      const likeIdx = ++idx
      const idIdx = ++idx
      conditions.push(`(ap.full_name LIKE ?${likeIdx} OR ap.email LIKE ?${likeIdx} OR ap.id = ?${idIdx})`)
      bindings.push(`%${q}%`, asId)
    } else {
      idx++
      conditions.push(`(ap.full_name LIKE ?${idx} OR ap.email LIKE ?${idx})`)
      bindings.push(`%${q}%`)
    }
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

  if (fit_statuses.length > 0 || includeNullStatus) {
    const parts: string[] = []
    if (fit_statuses.length > 0) {
      const placeholders = fit_statuses.map(() => `?${++idx}`).join(', ')
      parts.push(`ap.fit_status IN (${placeholders})`)
      bindings.push(...fit_statuses)
    }
    if (includeNullStatus) parts.push('ap.fit_status IS NULL')
    conditions.push(parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`)
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

  const scoreSubq = `(SELECT a_sc.ai_score FROM applications a_sc WHERE a_sc.applicant_id = ap.id ORDER BY a_sc.submitted_at DESC LIMIT 1)`
  const minScore = opts.min_score !== undefined && opts.min_score !== '' ? Number(opts.min_score) : null
  const maxScore = opts.max_score !== undefined && opts.max_score !== '' ? Number(opts.max_score) : null
  if (minScore !== null && !isNaN(minScore)) {
    conditions.push(`${scoreSubq} >= ?${++idx}`)
    bindings.push(minScore)
  }
  if (maxScore !== null && !isNaN(maxScore)) {
    conditions.push(`${scoreSubq} <= ?${++idx}`)
    bindings.push(maxScore)
  }

  const interviewScoreSubq = `(SELECT a_is.interview_score FROM applications a_is WHERE a_is.applicant_id = ap.id ORDER BY a_is.submitted_at DESC LIMIT 1)`
  const minInterviewScore =
    opts.min_interview_score !== undefined && opts.min_interview_score !== '' ? Number(opts.min_interview_score) : null
  const maxInterviewScore =
    opts.max_interview_score !== undefined && opts.max_interview_score !== '' ? Number(opts.max_interview_score) : null
  if (minInterviewScore !== null && !isNaN(minInterviewScore)) {
    conditions.push(`${interviewScoreSubq} >= ?${++idx}`)
    bindings.push(minInterviewScore)
  }
  if (maxInterviewScore !== null && !isNaN(maxInterviewScore)) {
    conditions.push(`${interviewScoreSubq} <= ?${++idx}`)
    bindings.push(maxInterviewScore)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const extraColSelects = extraCols
    .map((qId) => {
      // Negatif ID → CV parsed alan subquery
      if (qId < 0) {
        const col = CV_COLUMNS.find((c) => c.id === qId)
        if (!col) return null
        const alias = `extra_q_n${Math.abs(qId)}`
        return `(SELECT json_extract(a_ec.resume_parsed, '${col.jsonPath}') FROM applications a_ec WHERE a_ec.applicant_id = ap.id ORDER BY a_ec.submitted_at DESC LIMIT 1) AS ${alias}`
      }
      return `(SELECT aa_ec.value FROM applications a_ec JOIN application_answers aa_ec ON aa_ec.application_id = a_ec.id WHERE a_ec.applicant_id = ap.id AND aa_ec.question_id = ${qId} ORDER BY a_ec.submitted_at DESC LIMIT 1) AS extra_q_${qId}`
    })
    .filter(Boolean)
    .join(',\n           ')

  const listSql = `
    SELECT ap.id, ap.full_name, ap.email, ap.phone, ap.country, ap.linkedin_url, ap.fit_status,
           count(a.id)            AS applications_count,
           max(a.submitted_at)    AS latest_submitted_at,
           group_concat(DISTINCT p.title) AS positions,
           (SELECT count(*) FROM candidate_notes cn WHERE cn.applicant_id = ap.id) AS notes_count,
           ${canViewSalary
             ? `(SELECT aa.value
            FROM applications a_sal
            JOIN application_answers aa ON aa.application_id = a_sal.id
            JOIN position_questions pq ON pq.id = aa.question_id
            WHERE a_sal.applicant_id = ap.id
              AND (pq.field_key LIKE '%salary%'
                OR lower(pq.label) LIKE '%salary%'
                OR lower(pq.label) LIKE '%maaş%'
                OR lower(pq.label) LIKE '%maas%')
            ORDER BY a_sal.submitted_at DESC
            LIMIT 1)`
             : `NULL`} AS salary_expectation,
           (SELECT a_ls.status FROM applications a_ls
            WHERE a_ls.applicant_id = ap.id
            ORDER BY a_ls.submitted_at DESC LIMIT 1) AS latest_status,
           (SELECT a_ls.id FROM applications a_ls
            WHERE a_ls.applicant_id = ap.id
            ORDER BY a_ls.submitted_at DESC LIMIT 1) AS latest_application_id,
           (SELECT a_sc.ai_score FROM applications a_sc
            WHERE a_sc.applicant_id = ap.id
            ORDER BY a_sc.submitted_at DESC LIMIT 1) AS ai_score,
           (SELECT a_is.interview_score FROM applications a_is
            WHERE a_is.applicant_id = ap.id
            ORDER BY a_is.submitted_at DESC LIMIT 1) AS interview_score,
           (SELECT a_is.interview_score_complete FROM applications a_is
            WHERE a_is.applicant_id = ap.id
            ORDER BY a_is.submitted_at DESC LIMIT 1) AS interview_score_complete${extraCols.length ? `,\n           ${extraColSelects}` : ''}
    FROM applicants ap
    LEFT JOIN applications a ON a.applicant_id = ap.id
    LEFT JOIN job_positions p ON p.id = a.position_id
    ${where}
    GROUP BY ap.id
    ${buildOrderBy(opts.sort, opts.dir, opts.sortNumeric ?? false)}
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
      const alias = qId < 0 ? `extra_q_n${Math.abs(qId)}` : `extra_q_${qId}`
      extra_answers[String(qId)] = (row[alias] as string | null | undefined) ?? null
      delete row[alias]
    }
    return { ...row, extra_answers } as CandidateListItem
  })

  const total = ((countRes.results ?? [])[0] as { total: number } | undefined)?.total ?? 0
  return { candidates, total }
}

// Hiring-pipeline stages (kanban). Order is defined client-side in
// lib/candidates.ts PIPELINE_STAGES; here we only gate which values are writable.
// 'none' = off the board (not in the pipeline). The rest are kanban stages,
// ordered client-side in lib/candidates.ts PIPELINE_STAGES.
const VALID_STATUSES = ['none', 'shortlisted', 'outreach', 'interviewing', 'interviewed', 'offer_sent', 'hired', 'rejected'] as const
export const VALID_FIT_STATUSES = ['not_fit', 'good_fit', 'maybe'] as const
export type FitStatus = typeof VALID_FIT_STATUSES[number]

export async function updateApplicationStatus(
  db: D1Database,
  applicationId: number,
  status: string,
  actor?: string | null
): Promise<boolean> {
  if (!(VALID_STATUSES as readonly string[]).includes(status)) throw new Error('invalid status')
  // Read the prior status (and position) first so the timeline can show from→to.
  const before = await db
    .prepare(
      `SELECT a.applicant_id, a.status, p.title AS position_title
       FROM applications a
       LEFT JOIN job_positions p ON p.id = a.position_id
       WHERE a.id = ?`
    )
    .bind(applicationId)
    .first<{ applicant_id: number; status: string; position_title: string | null }>()
  if (!before) return false
  const res = await db
    .prepare(`UPDATE applications SET status = ? WHERE id = ?`)
    .bind(status, applicationId)
    .run()
  const changed = (res.meta?.changes ?? 0) > 0
  if (changed && before.status !== status) {
    await logCandidateEvents(db, actor, [
      {
        applicant_id: before.applicant_id,
        event_type: 'pipeline_status_changed',
        from_value: before.status,
        to_value: status,
        application_id: applicationId,
        metadata: before.position_title ? { position_title: before.position_title } : null,
      },
    ])
  }
  return changed
}

// Set one pipeline stage on many applications at once (bulk board add/remove).
export async function updateApplicationsStageBulk(
  db: D1Database,
  applicationIds: number[],
  status: string,
  actor?: string | null
): Promise<number> {
  if (applicationIds.length === 0) return 0
  if (!(VALID_STATUSES as readonly string[]).includes(status)) throw new Error('invalid status')
  const placeholders = applicationIds.map(() => '?').join(',')
  // Snapshot prior statuses so we only log applications that actually moved.
  const before = await db
    .prepare(
      `SELECT a.id, a.applicant_id, a.status, p.title AS position_title
       FROM applications a
       LEFT JOIN job_positions p ON p.id = a.position_id
       WHERE a.id IN (${placeholders})`
    )
    .bind(...applicationIds)
    .all<{ id: number; applicant_id: number; status: string; position_title: string | null }>()
  const res = await db
    .prepare(`UPDATE applications SET status = ? WHERE id IN (${placeholders})`)
    .bind(status, ...applicationIds)
    .run()
  const events = (before.results ?? [])
    .filter((r) => r.status !== status)
    .map((r) => ({
      applicant_id: r.applicant_id,
      event_type: 'pipeline_status_changed' as const,
      from_value: r.status,
      to_value: status,
      application_id: r.id,
      metadata: r.position_title ? { position_title: r.position_title } : null,
    }))
  await logCandidateEvents(db, actor, events)
  return res.meta?.changes ?? 0
}

export async function updateApplicantsFitStatus(
  db: D1Database,
  ids: number[],
  fit_status: string | null,
  actor?: string | null
): Promise<number> {
  if (ids.length === 0) return 0
  if (fit_status !== null && !(VALID_FIT_STATUSES as readonly string[]).includes(fit_status)) {
    throw new Error('invalid fit_status')
  }
  const placeholders = ids.map(() => '?').join(',')
  // Snapshot prior fit_status per applicant so we only log real changes.
  const before = await db
    .prepare(`SELECT id, fit_status FROM applicants WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<{ id: number; fit_status: string | null }>()
  const res = await db
    .prepare(`UPDATE applicants SET fit_status = ? WHERE id IN (${placeholders})`)
    .bind(fit_status, ...ids)
    .run()
  const events = (before.results ?? [])
    .filter((r) => (r.fit_status ?? null) !== fit_status)
    .map((r) => ({
      applicant_id: r.id,
      event_type: 'fit_status_changed' as const,
      from_value: r.fit_status,
      to_value: fit_status,
    }))
  await logCandidateEvents(db, actor, events)
  return res.meta?.changes ?? 0
}

export type ActivityType = 'fit_status_set' | 'note_added'

// Record one row per counted action so daily progress can be derived from the DB.
// Multiple actions on the same candidate the same day still count once at read time
// (COUNT(DISTINCT applicant_id)). No-ops when the user is unknown.
export async function logActivity(
  db: D1Database,
  username: string | null | undefined,
  applicantIds: number[],
  actionType: ActivityType
): Promise<void> {
  if (!username || applicantIds.length === 0) return
  const stmt = db.prepare(
    `INSERT INTO daily_activity (username, activity_date, applicant_id, action_type)
     VALUES (?, date('now'), ?, ?)`
  )
  await db.batch(applicantIds.map((id) => stmt.bind(username, id, actionType)))
}

// Today's progress (distinct candidates acted on) and the saved target for a user.
export async function getDailyProgress(
  db: D1Database,
  username: string
): Promise<{ target: number; today_count: number; date: string }> {
  const settings = await db
    .prepare(`SELECT daily_cv_target FROM account_settings WHERE username = ?`)
    .bind(username)
    .first<{ daily_cv_target: number }>()
  const row = await db
    .prepare(
      `SELECT date('now') AS date,
              COUNT(DISTINCT applicant_id) AS today_count
       FROM daily_activity
       WHERE username = ? AND activity_date = date('now')`
    )
    .bind(username)
    .first<{ date: string; today_count: number }>()
  return {
    target: settings?.daily_cv_target ?? 20,
    today_count: row?.today_count ?? 0,
    date: row?.date ?? '',
  }
}

// Per-day distinct-candidate counts for the last `days` days (most recent last),
// with empty days filled as 0 so the client can chart a continuous series.
export async function getDailyHistory(
  db: D1Database,
  username: string,
  days: number
): Promise<{ target: number; days: { date: string; count: number }[] }> {
  const settings = await db
    .prepare(`SELECT daily_cv_target FROM account_settings WHERE username = ?`)
    .bind(username)
    .first<{ daily_cv_target: number }>()
  // start is inclusive: e.g. days=30 -> from date('now','-29 days') through today.
  const startOffset = `-${days - 1} days`
  const { results } = await db
    .prepare(
      `WITH RECURSIVE series(d) AS (
         SELECT date('now', ?)
         UNION ALL
         SELECT date(d, '+1 day') FROM series WHERE d < date('now')
       )
       SELECT series.d AS date, COALESCE(a.count, 0) AS count
       FROM series
       LEFT JOIN (
         SELECT activity_date, COUNT(DISTINCT applicant_id) AS count
         FROM daily_activity
         WHERE username = ? AND activity_date >= date('now', ?)
         GROUP BY activity_date
       ) a ON a.activity_date = series.d
       ORDER BY series.d`
    )
    .bind(startOffset, username, startOffset)
    .all<{ date: string; count: number }>()
  return {
    target: settings?.daily_cv_target ?? 20,
    days: results ?? [],
  }
}

export async function setDailyTarget(
  db: D1Database,
  username: string,
  target: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO account_settings (username, daily_cv_target, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT(username) DO UPDATE SET
         daily_cv_target = excluded.daily_cv_target,
         updated_at = excluded.updated_at`
    )
    .bind(username, target)
    .run()
}

// Matches an answer that reveals a candidate's salary expectation. Kept in sync
// with the SQL heuristic in listCandidates and the client isSalary check.
const SALARY_LABEL_RE = /salary|maaş|maas|ücret|ucret|wage|compensation/i

export async function getCandidate(
  db: D1Database,
  id: number,
  canViewSalary = true
): Promise<CandidateDetail | null> {
  const applicant = await db
    .prepare(
      `SELECT ap.id, ap.full_name, ap.email, ap.phone, ap.country, ap.linkedin_url, ap.fit_status,
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
              a.resume_parsed, a.resume_parse_version,
              a.ai_score, a.ai_score_reasoning,
              a.interview_score, a.interview_score_complete,
              p.title AS position_title,
              (SELECT count(*) FROM scorecard_criteria sc
                WHERE sc.position_id = a.position_id AND sc.archived_at IS NULL) AS scorecard_criteria_count,
              (SELECT count(*) FROM interview_scorecards isc
                WHERE isc.application_id = a.id) AS scorecards_count
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
        `SELECT aa.application_id, aa.question_id, q.label, q.type, q.field_key, q.sort_order, aa.value
         FROM application_answers aa
         JOIN position_questions q ON q.id = aa.question_id
         WHERE aa.application_id IN (${placeholders})
         ORDER BY q.sort_order`
      )
      .bind(...ids)
      .all<{ application_id: number; question_id: number; label: string; type: string; field_key: string | null; value: string | null }>()

    const byApp = new Map<number, CandidateAnswer[]>()
    for (const r of ans.results ?? []) {
      // Hide salary answers from users without the view_salary permission.
      if (!canViewSalary && SALARY_LABEL_RE.test(`${r.label ?? ''} ${r.field_key ?? ''}`)) continue
      const list = byApp.get(r.application_id) ?? []
      list.push({ question_id: r.question_id, label: r.label, type: r.type, value: r.value })
      byApp.set(r.application_id, list)
    }
    for (const a of applications) a.answers = byApp.get(a.id) ?? []
  }

  return { applicant, applications }
}

// Overwrite a single application answer's raw value.
// Used by manual edits (e.g. correcting a salary entered in thousands).
// Returns true if a row was updated, false if no matching answer exists.
export async function updateAnswerValue(
  db: D1Database,
  applicationId: number,
  questionId: number,
  value: string | null
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE application_answers SET value = ?
       WHERE application_id = ? AND question_id = ?`
    )
    .bind(value, applicationId, questionId)
    .run()
  return (res.meta.changes ?? 0) > 0
}
