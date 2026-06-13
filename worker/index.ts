import { Hono } from 'hono'
import { deepseekChat } from './deepseek'
import { importApplications, type ImportPayload } from './import'
import { listCandidates, getCandidate, getCandidateFilters, getQuestionColumns, updateApplicationStatus, updateApplicantsFitStatus, updateAnswerValue } from './candidates'
import { handleTallyWebhook } from './tally-webhook'
import { parseAndStoreResume } from './cv-parser'
import { PARSE_VERSION } from './cv-schema'
import { getPositionsWithPrompts, upsertScoringPrompt, scoreApplication, PENDING_SCORES_FROM_WHERE } from './ai-scorer'
import { SyncJobDO } from './sync-job-do'

export { SyncJobDO }

type Env = {
  Bindings: {
    DEEPSEEK_API_KEY: string
    OPENAI_API_KEY?: string
    DB: D1Database
    RESUMES: R2Bucket
    R2_PUBLIC_URL: string
    TALLY_WEBHOOK_SECRET?: string
    SYNC_JOB: DurableObjectNamespace<SyncJobDO>
  }
}

const app = new Hono<Env>()

app.get('/api/health', (c) => c.json({ ok: true, service: 'gatekeeper' }))

// Temporary test endpoint to verify the key works
app.get('/api/llm/ping', async (c) => {
  const reply = await deepseekChat(c.env.DEEPSEEK_API_KEY, [
    { role: 'user', content: 'Just write "pong", nothing else.' },
  ])
  return c.json({ ok: true, reply })
})

// Live FX rates (USD base). Used to show an estimated USD salary on the
// candidate detail page. Cached at the edge for 24h — rates barely move and the
// upstream is a free, key-less endpoint.
app.get('/api/fx', async (c) => {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      cf: { cacheTtl: 86400, cacheEverything: true },
    })
    const data = (await res.json()) as {
      result?: string
      rates?: Record<string, number>
      time_last_update_unix?: number
    }
    if (data.result !== 'success' || !data.rates) {
      return c.json({ ok: false, error: 'fx upstream error' }, 502)
    }
    return c.json({
      ok: true,
      base: 'USD',
      rates: data.rates,
      fetched_at: data.time_last_update_unix ?? null,
    })
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'fx error' }, 502)
  }
})

// CSV import — browser sends normalized rows in chunks.
// NOTE: no auth for now (admin tool). Shared secret / Access will be added in prod.
app.post('/api/import', async (c) => {
  let payload: ImportPayload
  try {
    payload = await c.req.json<ImportPayload>()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  try {
    const summary = await importApplications(c.env.DB, payload, c.env.RESUMES, c.env.R2_PUBLIC_URL)
    return c.json({ ok: true, summary })
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'import error' }, 400)
  }
})

// Filter options (country + position lists)
app.get('/api/candidates/filters', async (c) => {
  const filters = await getCandidateFilters(c.env.DB)
  return c.json({ ok: true, ...filters })
})

// Question columns available for extra display + filtering
app.get('/api/candidates/question-columns', async (c) => {
  const questions = await getQuestionColumns(c.env.DB)
  return c.json({ ok: true, questions })
})

// Candidate list + search + filter
app.get('/api/candidates', async (c) => {
  const q = c.req.query('q') ?? ''
  const countries = c.req.queries('country') ?? []
  const position = c.req.query('position') ?? ''
  const fit_statuses = c.req.queries('fit_status') ?? []
  const limit = Number(c.req.query('limit') ?? '50')
  const offset = Number(c.req.query('offset') ?? '0')
  const extraCols = (c.req.queries('extra_col') ?? []).map(Number).filter((n) => Number.isInteger(n) && n !== 0)
  const afQ = (c.req.queries('af_q') ?? []).map(Number)
  const afOp = c.req.queries('af_op') ?? []
  const afV = c.req.queries('af_v') ?? []
  const answerFilters = afQ
    .map((questionId, i) => ({ questionId, op: afOp[i] ?? '', value: afV[i] ?? '' }))
    .filter((f) => Number.isInteger(f.questionId) && f.op)
  const min_score = c.req.query('min_score') ?? ''
  const max_score = c.req.query('max_score') ?? ''
  const sort = c.req.query('sort') ?? ''
  const dir = c.req.query('dir') ?? ''
  const sortNumeric = c.req.query('sort_numeric') === '1'
  const data = await listCandidates(c.env.DB, { q, countries, position, fit_statuses, limit, offset, extraCols, answerFilters, min_score, max_score, sort, dir, sortNumeric })
  return c.json({ ok: true, ...data })
})

// Candidate detail (applications + answers)
app.get('/api/candidates/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400)
  const detail = await getCandidate(c.env.DB, id)
  if (!detail) return c.json({ ok: false, error: 'candidate not found' }, 404)
  return c.json({ ok: true, ...detail })
})

// Update application status
app.patch('/api/applications/:id/status', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  let body: { status: string }
  try {
    body = await c.req.json<{ status: string }>()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  try {
    const updated = await updateApplicationStatus(c.env.DB, id, body.status)
    if (!updated) return c.json({ ok: false, error: 'application not found' }, 404)
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'update failed' }, 400)
  }
})

// Edit a single application answer's value (e.g. correct a salary entered in thousands)
app.patch('/api/applications/:id/answers/:questionId', async (c) => {
  const id = Number(c.req.param('id'))
  const questionId = Number(c.req.param('questionId'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid application id' }, 400)
  if (!Number.isInteger(questionId) || questionId <= 0) return c.json({ ok: false, error: 'invalid question id' }, 400)
  let body: { value: string | null }
  try {
    body = await c.req.json<{ value: string | null }>()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  try {
    const updated = await updateAnswerValue(c.env.DB, id, questionId, body.value)
    if (!updated) return c.json({ ok: false, error: 'answer not found' }, 404)
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'update failed' }, 400)
  }
})

// Bulk update candidate fit status (multi-select)
app.patch('/api/applicants/fit-status', async (c) => {
  let body: { ids: number[]; fit_status: string | null }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ ok: false, error: 'ids cannot be empty' }, 400)
  }
  try {
    const updated = await updateApplicantsFitStatus(c.env.DB, body.ids, body.fit_status ?? null)
    return c.json({ ok: true, updated })
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'update failed' }, 400)
  }
})

// Candidate notes — GET
app.get('/api/candidates/:id/notes', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const { results } = await c.env.DB.prepare(
    `SELECT id, applicant_id, content, created_by, created_by_name, created_at
     FROM candidate_notes WHERE applicant_id = ? ORDER BY created_at DESC`
  ).bind(id).all()
  return c.json({ ok: true, notes: results ?? [] })
})

// Candidate notes — POST (add new note)
app.post('/api/candidates/:id/notes', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  let body: { content: string; created_by: string; created_by_name: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  if (!body.content?.trim()) return c.json({ ok: false, error: 'note cannot be empty' }, 400)
  if (!body.created_by) return c.json({ ok: false, error: 'user required' }, 400)
  const result = await c.env.DB.prepare(
    `INSERT INTO candidate_notes (applicant_id, content, created_by, created_by_name)
     VALUES (?, ?, ?, ?)`
  ).bind(id, body.content.trim(), body.created_by, body.created_by_name).run()
  const note = await c.env.DB.prepare(
    `SELECT id, applicant_id, content, created_by, created_by_name, created_at
     FROM candidate_notes WHERE id = ?`
  ).bind(result.meta.last_row_id).first()
  return c.json({ ok: true, note })
})

// Edit note — PATCH (update content)
app.patch('/api/notes/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  let body: { content: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  if (!body.content?.trim()) return c.json({ ok: false, error: 'note cannot be empty' }, 400)
  const result = await c.env.DB.prepare(
    `UPDATE candidate_notes SET content = ? WHERE id = ?`
  ).bind(body.content.trim(), id).run()
  if ((result.meta?.changes ?? 0) === 0) return c.json({ ok: false, error: 'note not found' }, 404)
  const note = await c.env.DB.prepare(
    `SELECT id, applicant_id, content, created_by, created_by_name, created_at
     FROM candidate_notes WHERE id = ?`
  ).bind(id).first()
  return c.json({ ok: true, note })
})

// Delete note — DELETE
app.delete('/api/notes/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const result = await c.env.DB.prepare(`DELETE FROM candidate_notes WHERE id = ?`).bind(id).run()
  if ((result.meta?.changes ?? 0) === 0) return c.json({ ok: false, error: 'note not found' }, 404)
  return c.json({ ok: true })
})

// Pending CVs — returns all application IDs that need CV parsing (parse_version outdated).
app.get('/api/admin/pending-cvs', async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT id FROM applications WHERE resume_url IS NOT NULL AND resume_parse_version < ? LIMIT 1000`)
    .bind(PARSE_VERSION)
    .all<{ id: number }>()
  return c.json({ ok: true, ids: results.map((r) => r.id), parse_version: PARSE_VERSION })
})

// Parse a single CV by application ID.
app.post('/api/admin/parse-cv/:id', async (c) => {
  if (!c.env.DEEPSEEK_API_KEY) return c.json({ ok: false, error: 'DEEPSEEK_API_KEY not set' }, 500)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)

  const row = await c.env.DB
    .prepare(`SELECT resume_url FROM applications WHERE id = ? AND resume_url IS NOT NULL`)
    .bind(id)
    .first<{ resume_url: string }>()
  if (!row) return c.json({ ok: false, error: 'not found or no resume' }, 404)

  try {
    await parseAndStoreResume(c.env.DB, id, row.resume_url, c.env.DEEPSEEK_API_KEY, c.env.RESUMES, c.env.R2_PUBLIC_URL, c.env.OPENAI_API_KEY)
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'parse failed' }, 500)
  }
})

// CV parsing sync — re-parses CVs whose parse_version < PARSE_VERSION.
// dryRun: true returns the count of affected rows without processing.
// limit: max CVs to process per call (default 10, max 50).
app.post('/api/admin/sync-cv', async (c) => {
  if (!c.env.DEEPSEEK_API_KEY) return c.json({ ok: false, error: 'DEEPSEEK_API_KEY not set' }, 500)

  let body: { limit?: number; dryRun?: boolean } = {}
  try { body = await c.req.json() } catch { /* body opsiyonel */ }

  const limit = Math.min(body.limit ?? 10, 50)
  const dryRun = body.dryRun ?? false

  const { results } = await c.env.DB
    .prepare(
      `SELECT id, resume_url FROM applications
       WHERE resume_url IS NOT NULL AND resume_parse_version < ?
       LIMIT ?`,
    )
    .bind(PARSE_VERSION, limit)
    .all<{ id: number; resume_url: string }>()

  if (dryRun) return c.json({ ok: true, pending: results.length, parse_version: PARSE_VERSION })

  let processed = 0
  let failed = 0
  const errors: { id: number; error: string }[] = []

  for (const row of results) {
    try {
      await parseAndStoreResume(c.env.DB, row.id, row.resume_url, c.env.DEEPSEEK_API_KEY, c.env.RESUMES, c.env.R2_PUBLIC_URL, c.env.OPENAI_API_KEY)
      processed++
    } catch (e) {
      failed++
      errors.push({ id: row.id, error: e instanceof Error ? e.message : 'unknown error' })
    }
  }

  const { results: rem } = await c.env.DB
    .prepare(`SELECT COUNT(*) as n FROM applications WHERE resume_url IS NOT NULL AND resume_parse_version < ?`)
    .bind(PARSE_VERSION)
    .all<{ n: number }>()

  return c.json({ ok: true, processed, failed, remaining: rem[0]?.n ?? 0, errors })
})

// Scoring prompts — list all positions with their prompts
app.get('/api/admin/scoring-prompts', async (c) => {
  const positions = await getPositionsWithPrompts(c.env.DB)
  return c.json({ ok: true, positions })
})

// Scoring prompts — upsert prompt for a position
app.put('/api/admin/scoring-prompts/:positionId', async (c) => {
  const positionId = Number(c.req.param('positionId'))
  if (!Number.isInteger(positionId) || positionId <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  let body: { prompt: string }
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid JSON' }, 400) }
  if (!body.prompt?.trim()) return c.json({ ok: false, error: 'prompt cannot be empty' }, 400)
  await upsertScoringPrompt(c.env.DB, positionId, body.prompt.trim())
  return c.json({ ok: true })
})

// Pending scores — returns application IDs that need scoring
app.get('/api/admin/pending-scores', async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT a.id ${PENDING_SCORES_FROM_WHERE} LIMIT 1000`)
    .all<{ id: number }>()
  return c.json({ ok: true, ids: results.map((r) => r.id) })
})

// Score a single application by ID
app.post('/api/admin/score-application/:id', async (c) => {
  if (!c.env.DEEPSEEK_API_KEY) return c.json({ ok: false, error: 'DEEPSEEK_API_KEY not set' }, 500)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  try {
    await scoreApplication(c.env.DB, id, c.env)
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'score failed' }, 500)
  }
})

// Sync AI scores — score applications that have a prompt but no current score
app.post('/api/admin/sync-scores', async (c) => {
  if (!c.env.DEEPSEEK_API_KEY) return c.json({ ok: false, error: 'DEEPSEEK_API_KEY not set' }, 500)
  let body: { limit?: number; dryRun?: boolean } = {}
  try { body = await c.req.json() } catch { /* body optional */ }
  const limit = Math.min(body.limit ?? 10, 50)
  const dryRun = body.dryRun ?? false

  const { results } = await c.env.DB
    .prepare(`SELECT a.id ${PENDING_SCORES_FROM_WHERE} LIMIT ?`)
    .bind(limit)
    .all<{ id: number }>()

  if (dryRun) return c.json({ ok: true, pending: results.length })

  let processed = 0
  let failed = 0
  for (const row of results) {
    try {
      await scoreApplication(c.env.DB, row.id, c.env)
      processed++
    } catch {
      failed++
    }
  }

  const { results: remaining } = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n ${PENDING_SCORES_FROM_WHERE}`)
    .all<{ n: number }>()

  return c.json({ ok: true, processed, failed, remaining: remaining[0]?.n ?? 0 })
})

// ── Cloud sync jobs (Durable Object) ───────────────────────────────────────
// A single server-side job per kind ('scores' | 'cv') that the browser starts,
// polls, and can stop. The job keeps running even if the tab closes.

function resolveSyncKind(raw: string): 'scores' | 'cv' | null {
  return raw === 'scores' || raw === 'cv' ? raw : null
}

function syncStub(c: { env: Env['Bindings'] }, kind: 'scores' | 'cv') {
  return c.env.SYNC_JOB.get(c.env.SYNC_JOB.idFromName(kind))
}

// Start (or restart) a sync job
app.post('/api/admin/sync/:kind/start', async (c) => {
  if (!c.env.DEEPSEEK_API_KEY) return c.json({ ok: false, error: 'DEEPSEEK_API_KEY not set' }, 500)
  const kind = resolveSyncKind(c.req.param('kind'))
  if (!kind) return c.json({ ok: false, error: 'invalid kind' }, 400)
  let body: { batchSize?: number; positionId?: number | null } = {}
  try { body = await c.req.json() } catch { /* body optional */ }
  const positionId = body.positionId != null ? Number(body.positionId) : null
  const state = await syncStub(c, kind).start(
    kind,
    Number(body.batchSize) || 5,
    Number.isFinite(positionId as number) ? (positionId as number) : null,
  )
  return c.json({ ok: true, state })
})

// Live status of a sync job
app.get('/api/admin/sync/:kind/status', async (c) => {
  const kind = resolveSyncKind(c.req.param('kind'))
  if (!kind) return c.json({ ok: false, error: 'invalid kind' }, 400)
  const state = await syncStub(c, kind).status()
  return c.json({ ok: true, state })
})

// Request a sync job to stop
app.post('/api/admin/sync/:kind/stop', async (c) => {
  const kind = resolveSyncKind(c.req.param('kind'))
  if (!kind) return c.json({ ok: false, error: 'invalid kind' }, 400)
  const state = await syncStub(c, kind).stop()
  return c.json({ ok: true, state })
})

// Force-reset a wedged sync job back to idle (escape hatch when stop won't take)
app.post('/api/admin/sync/:kind/reset', async (c) => {
  const kind = resolveSyncKind(c.req.param('kind'))
  if (!kind) return c.json({ ok: false, error: 'invalid kind' }, 400)
  const state = await syncStub(c, kind).reset()
  return c.json({ ok: true, state })
})

// Danger Zone — destructive data operations
app.delete('/api/admin/data', async (c) => {
  let body: { scope: string }
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid JSON' }, 400) }

  if (body.scope === 'cv_data') {
    const result = await c.env.DB.prepare(
      `UPDATE applications SET resume_text = NULL, resume_parsed = NULL, resume_parse_version = 0`
    ).run()
    return c.json({ ok: true, updated: result.meta.changes ?? 0 })
  }

  if (body.scope === 'scores') {
    const result = await c.env.DB.prepare(
      `UPDATE applications SET ai_score = NULL, ai_score_reasoning = NULL, ai_score_version = 0,
        ai_scored_prompt_at = NULL, ai_scored_at = NULL`
    ).run()
    return c.json({ ok: true, updated: result.meta.changes ?? 0 })
  }

  if (body.scope === 'all_candidates') {
    const result = await c.env.DB.prepare(`DELETE FROM applicants`).run()
    return c.json({ ok: true, deleted: result.meta.changes ?? 0 })
  }

  return c.json({ ok: false, error: 'invalid scope' }, 400)
})

// Tally webhook — new form responses arrive automatically
app.post('/api/webhook/tally', async (c) => {
  const rawBody = await c.req.text()
  const sig = c.req.header('tally-signature') ?? null
  const result = await handleTallyWebhook(
    rawBody,
    sig,
    c.env.TALLY_WEBHOOK_SECRET,
    c.env.DB,
    c.env.RESUMES,
    c.env.R2_PUBLIC_URL,
  )
  return c.json(result.body, result.status as 200 | 400 | 401 | 500)
})

export default app
