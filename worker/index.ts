import { Hono } from 'hono'
import { deepseekChat } from './deepseek'
import { importApplications, type ImportPayload } from './import'
import { listCandidates, getCandidate, getCandidateFilters, getQuestionColumns, updateApplicationStatus, updateApplicationsStageBulk, updateApplicantsFitStatus, updateAnswerValue, logActivity, getDailyProgress, getDailyHistory, setDailyTarget } from './candidates'
import { handleTallyWebhook } from './tally-webhook'
import { parseAndStoreResume } from './cv-parser'
import { PARSE_VERSION } from './cv-schema'
import { getPositionsWithPrompts, upsertScoringPrompt, scoreApplication, PENDING_SCORES_FROM_WHERE } from './ai-scorer'
import { generateInterviewNotes, getInterviewNotesPrompt, setInterviewNotesPrompt } from './interview-notes'
import { generateOutreachEmail, getOutreachEmailPrompt, setOutreachEmailPrompt } from './outreach-email'
import { listUsers, verifyLogin } from './users'
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

// Validate a serialized ActiveFilters blob before persisting it. We store the
// JSON verbatim, so we only check it parses and looks like the expected shape —
// the client owns the precise schema (src/lib/candidates.ts).
function isValidFiltersJson(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 10_000) return false
  try {
    const p = JSON.parse(raw) as Record<string, unknown>
    return (
      p != null &&
      typeof p === 'object' &&
      Array.isArray(p.countries) &&
      Array.isArray(p.fit_statuses) &&
      Array.isArray(p.answerFilters)
    )
  } catch {
    return false
  }
}

// Note image attachments are stored in R2 under `note-images/{applicantId}/...`
// and referenced from candidate_notes.images as a JSON array of public URLs.
const NOTE_IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const MAX_NOTE_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB

// Parse the stored images JSON into a clean string[] (NULL/garbage → []).
function parseNoteImages(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

// Shape a candidate_notes row for the API: parse images into an array.
function shapeNote(row: Record<string, unknown> | null) {
  if (!row) return row
  return { ...row, images: parseNoteImages(row.images) }
}

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

// Active users — for pickers and @mention autocomplete
app.get('/api/users', async (c) => {
  const users = await listUsers(c.env.DB)
  return c.json({ ok: true, users })
})

// Validate credentials against the users table (login is server-side now).
app.post('/api/login', async (c) => {
  const body: { username?: unknown; password?: unknown } = await c.req
    .json<{ username?: unknown; password?: unknown }>()
    .catch(() => ({}))
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!username || !password) {
    return c.json({ ok: false, error: 'Missing credentials' }, 400)
  }
  const user = await verifyLogin(c.env.DB, username, password)
  if (!user) return c.json({ ok: false, error: 'Invalid username or password' }, 401)
  return c.json({ ok: true, user: { username: user.username, fullName: user.full_name } })
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

// Bulk move applications to a pipeline stage (board add/remove via multi-select)
app.patch('/api/applications/status/bulk', async (c) => {
  let body: { application_ids: number[]; status: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  if (!Array.isArray(body.application_ids) || body.application_ids.length === 0) {
    return c.json({ ok: false, error: 'application_ids cannot be empty' }, 400)
  }
  try {
    const updated = await updateApplicationsStageBulk(c.env.DB, body.application_ids, body.status)
    return c.json({ ok: true, updated })
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
  let body: { ids: number[]; fit_status: string | null; created_by?: string }
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
    // Every fit-status change counts as processing a CV — including clearing it.
    await logActivity(c.env.DB, body.created_by, body.ids, 'fit_status_set')
    return c.json({ ok: true, updated })
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'update failed' }, 400)
  }
})

// Per-account daily CV-processing target + today's progress.
app.get('/api/settings/daily', async (c) => {
  const username = c.req.query('username')
  if (!username) return c.json({ ok: false, error: 'username required' }, 400)
  const progress = await getDailyProgress(c.env.DB, username)
  return c.json({ ok: true, ...progress })
})

// Per-day history for the daily-target stats panel (last N days, max 90).
app.get('/api/settings/daily/history', async (c) => {
  const username = c.req.query('username')
  if (!username) return c.json({ ok: false, error: 'username required' }, 400)
  let days = Number(c.req.query('days') ?? 30)
  if (!Number.isInteger(days) || days < 1) days = 30
  if (days > 90) days = 90
  const history = await getDailyHistory(c.env.DB, username, days)
  return c.json({ ok: true, ...history })
})

app.put('/api/settings/daily', async (c) => {
  let body: { username: string; daily_cv_target: number }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  if (!body.username) return c.json({ ok: false, error: 'username required' }, 400)
  const target = Number(body.daily_cv_target)
  if (!Number.isInteger(target) || target < 0 || target > 10000) {
    return c.json({ ok: false, error: 'target must be between 0 and 10000' }, 400)
  }
  await setDailyTarget(c.env.DB, body.username, target)
  const progress = await getDailyProgress(c.env.DB, body.username)
  return c.json({ ok: true, ...progress })
})

// Interview-notes prompt template (global) — GET effective prompt + is_custom flag
app.get('/api/settings/interview-prompt', async (c) => {
  const { prompt, is_custom } = await getInterviewNotesPrompt(c.env.DB)
  return c.json({ ok: true, prompt, is_custom })
})

// Interview-notes prompt template — PUT (empty body reverts to the built-in default)
app.put('/api/settings/interview-prompt', async (c) => {
  let body: { prompt?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  await setInterviewNotesPrompt(c.env.DB, body.prompt ?? '')
  const { prompt, is_custom } = await getInterviewNotesPrompt(c.env.DB)
  return c.json({ ok: true, prompt, is_custom })
})

// Outreach-email prompt template (global) — GET effective prompt + is_custom flag
app.get('/api/settings/outreach-prompt', async (c) => {
  const { prompt, is_custom } = await getOutreachEmailPrompt(c.env.DB)
  return c.json({ ok: true, prompt, is_custom })
})

// Outreach-email prompt template — PUT (empty body reverts to the built-in default)
app.put('/api/settings/outreach-prompt', async (c) => {
  let body: { prompt?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  await setOutreachEmailPrompt(c.env.DB, body.prompt ?? '')
  const { prompt, is_custom } = await getOutreachEmailPrompt(c.env.DB)
  return c.json({ ok: true, prompt, is_custom })
})

// Generate AI interview notes for a candidate and save them as a new note.
app.post('/api/candidates/:id/interview-notes', async (c) => {
  if (!c.env.DEEPSEEK_API_KEY) return c.json({ ok: false, error: 'DEEPSEEK_API_KEY not set' }, 500)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  let body: { created_by: string; created_by_name: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  if (!body.created_by) return c.json({ ok: false, error: 'user required' }, 400)
  let content: string
  try {
    content = await generateInterviewNotes(c.env.DB, id, c.env)
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'generation failed' }, 400)
  }
  if (!content.trim()) return c.json({ ok: false, error: 'empty generation' }, 502)
  const result = await c.env.DB.prepare(
    `INSERT INTO candidate_notes (applicant_id, content, created_by, created_by_name)
     VALUES (?, ?, ?, ?)`
  ).bind(id, content.trim(), body.created_by, body.created_by_name).run()
  await logActivity(c.env.DB, body.created_by, [id], 'note_added')
  const note = await c.env.DB.prepare(
    `SELECT id, applicant_id, content, created_by, created_by_name, created_at, images
     FROM candidate_notes WHERE id = ?`
  ).bind(result.meta.last_row_id).first()
  return c.json({ ok: true, note: shapeNote(note) })
})

// Generate a short outreach email for a candidate. Unlike interview notes this
// is not stored — the email is returned for the UI to copy or open in a mail
// client.
app.post('/api/candidates/:id/outreach-email', async (c) => {
  if (!c.env.DEEPSEEK_API_KEY) return c.json({ ok: false, error: 'DEEPSEEK_API_KEY not set' }, 500)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const body = await c.req.json<{ sender_name?: string }>().catch(() => ({}))
  const senderName = typeof body.sender_name === 'string' ? body.sender_name.trim() : ''
  if (!senderName) return c.json({ ok: false, error: 'sender_name is required' }, 400)
  try {
    const email = await generateOutreachEmail(c.env.DB, id, c.env, senderName)
    return c.json({ ok: true, email })
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'generation failed' }, 400)
  }
})

// Upload an image attachment for a candidate's notes. Stored in R2 under
// note-images/{applicantId}/{uuid}.{ext}; returns the public URL to embed in a
// note via POST /api/candidates/:id/notes.
app.post('/api/candidates/:id/note-images', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  if (!c.env.R2_PUBLIC_URL) return c.json({ ok: false, error: 'R2 not configured' }, 500)
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json({ ok: false, error: 'invalid form data' }, 400)
  }
  const file = form.get('file')
  if (!(file instanceof File)) return c.json({ ok: false, error: 'file is required' }, 400)
  const ext = NOTE_IMAGE_TYPES[file.type]
  if (!ext) return c.json({ ok: false, error: 'unsupported image type' }, 400)
  if (file.size > MAX_NOTE_IMAGE_BYTES) return c.json({ ok: false, error: 'image too large (max 10MB)' }, 400)
  const key = `note-images/${id}/${crypto.randomUUID()}.${ext}`
  await c.env.RESUMES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } })
  return c.json({ ok: true, url: `${c.env.R2_PUBLIC_URL}/${key}` })
})

// Candidate notes — GET
app.get('/api/candidates/:id/notes', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const { results } = await c.env.DB.prepare(
    `SELECT id, applicant_id, content, created_by, created_by_name, created_at, images
     FROM candidate_notes WHERE applicant_id = ? ORDER BY created_at DESC`
  ).bind(id).all()
  return c.json({ ok: true, notes: (results ?? []).map(shapeNote) })
})

// Candidate notes — POST (add new note)
app.post('/api/candidates/:id/notes', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  let body: { content: string; created_by: string; created_by_name: string; images?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  const content = body.content?.trim() ?? ''
  const images = Array.isArray(body.images) ? body.images.filter((x): x is string => typeof x === 'string') : []
  if (!content && images.length === 0) return c.json({ ok: false, error: 'note cannot be empty' }, 400)
  if (!body.created_by) return c.json({ ok: false, error: 'user required' }, 400)
  const result = await c.env.DB.prepare(
    `INSERT INTO candidate_notes (applicant_id, content, created_by, created_by_name, images)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, content, body.created_by, body.created_by_name, images.length ? JSON.stringify(images) : null).run()
  await logActivity(c.env.DB, body.created_by, [id], 'note_added')
  const note = await c.env.DB.prepare(
    `SELECT id, applicant_id, content, created_by, created_by_name, created_at, images
     FROM candidate_notes WHERE id = ?`
  ).bind(result.meta.last_row_id).first()
  return c.json({ ok: true, note: shapeNote(note) })
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
    `SELECT id, applicant_id, content, created_by, created_by_name, created_at, images
     FROM candidate_notes WHERE id = ?`
  ).bind(id).first()
  return c.json({ ok: true, note: shapeNote(note) })
})

// Delete note — DELETE
app.delete('/api/notes/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const result = await c.env.DB.prepare(`DELETE FROM candidate_notes WHERE id = ?`).bind(id).run()
  if ((result.meta?.changes ?? 0) === 0) return c.json({ ok: false, error: 'note not found' }, 404)
  return c.json({ ok: true })
})

// ── Saved filters (shared, team-wide presets) ──────────────────────────────

// List all saved filters, most recently updated first.
app.get('/api/saved-filters', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, filters_json, created_by, created_at, updated_at
     FROM saved_filters ORDER BY updated_at DESC`
  ).all()
  return c.json({ ok: true, filters: results ?? [] })
})

// Create a new saved filter from the current filter state.
app.post('/api/saved-filters', async (c) => {
  let body: { name: string; filters_json: string; created_by: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  if (!body.name?.trim()) return c.json({ ok: false, error: 'name cannot be empty' }, 400)
  if (!body.created_by) return c.json({ ok: false, error: 'user required' }, 400)
  if (!isValidFiltersJson(body.filters_json)) return c.json({ ok: false, error: 'invalid filters' }, 400)
  const result = await c.env.DB.prepare(
    `INSERT INTO saved_filters (name, filters_json, created_by) VALUES (?, ?, ?)`
  ).bind(body.name.trim(), body.filters_json, body.created_by).run()
  const filter = await c.env.DB.prepare(
    `SELECT id, name, filters_json, created_by, created_at, updated_at FROM saved_filters WHERE id = ?`
  ).bind(result.meta.last_row_id).first()
  return c.json({ ok: true, filter })
})

// Update a saved filter — rename and/or overwrite its filter state.
app.put('/api/saved-filters/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  let body: { name?: string; filters_json?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  if (body.name !== undefined && !body.name.trim()) return c.json({ ok: false, error: 'name cannot be empty' }, 400)
  if (body.filters_json !== undefined && !isValidFiltersJson(body.filters_json)) {
    return c.json({ ok: false, error: 'invalid filters' }, 400)
  }
  const result = await c.env.DB.prepare(
    `UPDATE saved_filters
     SET name = COALESCE(?, name),
         filters_json = COALESCE(?, filters_json),
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(body.name?.trim() ?? null, body.filters_json ?? null, id).run()
  if ((result.meta?.changes ?? 0) === 0) return c.json({ ok: false, error: 'saved filter not found' }, 404)
  const filter = await c.env.DB.prepare(
    `SELECT id, name, filters_json, created_by, created_at, updated_at FROM saved_filters WHERE id = ?`
  ).bind(id).first()
  return c.json({ ok: true, filter })
})

// Delete a saved filter.
app.delete('/api/saved-filters/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const result = await c.env.DB.prepare(`DELETE FROM saved_filters WHERE id = ?`).bind(id).run()
  if ((result.meta?.changes ?? 0) === 0) return c.json({ ok: false, error: 'saved filter not found' }, 404)
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
