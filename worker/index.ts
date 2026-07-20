import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { deepseekChat } from './deepseek'
import { importApplications, type ImportPayload } from './import'
import { listCandidates, getCandidate, getCandidateFilters, getQuestionColumns, updateApplicationStatus, updateApplicationsStageBulk, updateApplicantsFitStatus, updateAnswerValue, logActivity, getDailyProgress, getDailyHistory, setDailyTarget } from './candidates'
import { getCandidateEvents, logCandidateEvents } from './events'
import { handleTallyWebhook } from './tally-webhook'
import { parseAndStoreResume } from './cv-parser'
import { PARSE_VERSION } from './cv-schema'
import { getPositionsWithPrompts, upsertScoringPrompt, scoreApplication, PENDING_SCORES_FROM_WHERE } from './ai-scorer'
import { generateInterviewNotes, getInterviewNotesPrompt, setInterviewNotesPrompt } from './interview-notes'
import { generateOutreachEmail, getOutreachEmailPrompt, setOutreachEmailPrompt } from './outreach-email'
import { listUsers, verifyLogin, listAllUsers, createUser, updateUser, type UserPermsInput } from './users'
import {
  authMiddleware,
  createSession,
  deleteSession,
  requirePerm,
  requireAdmin,
  permGate,
  adminGate,
  PERMISSIONS,
  type Auth,
  type Permission,
} from './permissions'
import { listEmployees, createEmployee } from './employees'
import {
  importLeaveRequests,
  listLeaveRequests,
  reviewLeaveRequest,
  assignEmployee,
  updateLeaveDuration,
  updateLeaveDates,
  setLeaveStatus,
  deleteLeaveRequest,
  type LeaveImportRow,
} from './leave'
import { handleLeaveTallyWebhook } from './leave-tally'
import {
  createMentionNotifications,
  existingRecipients,
  listNotifications,
  unreadApplicantIds,
  markRead,
  markAllRead,
  deleteForNote,
} from './notifications'
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
  Variables: {
    auth: Auth | null
  }
}

const app = new Hono<Env>()

// Resolve the caller's session (if any) for every API request. Individual routes
// decide whether auth/permissions are required — this only populates c.get('auth').
app.use('/api/*', authMiddleware)

// Prefix guards. More specific rules are registered first so admin-only user
// management isn't reachable by a plain recruiting-admin. (adminGate implies
// recruiting_admin, so admins still pass the broader /api/admin/* gate.)
app.use('/api/admin/users', adminGate)
app.use('/api/admin/users/*', adminGate)
app.use('/api/admin/*', permGate('recruiting_admin'))
app.use('/api/import', permGate('recruiting_admin'))

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

// Short, single-line preview of a note for the candidate timeline. Strips
// markdown image syntax and collapses whitespace, then truncates.
function noteExcerpt(content: string, max = 80): string {
  const text = content.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
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
  const auth = await verifyLogin(c.env.DB, username, password)
  if (!auth) return c.json({ ok: false, error: 'Invalid username or password' }, 401)
  const token = await createSession(c.env.DB, auth.username)
  return c.json({
    ok: true,
    user: {
      username: auth.username,
      fullName: auth.fullName,
      isAdmin: auth.isAdmin,
      permissions: auth.permissions,
      token,
    },
  })
})

// Invalidate the current session token (best-effort; client also clears locally).
app.post('/api/logout', async (c) => {
  const header = c.req.header('Authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (m) await deleteSession(c.env.DB, m[1].trim())
  return c.json({ ok: true })
})

// Filter options (country + position lists)
app.get('/api/candidates/filters', async (c) => {
  const denied = requirePerm(c, 'view_applications'); if (denied) return denied
  const filters = await getCandidateFilters(c.env.DB)
  return c.json({ ok: true, ...filters })
})

// Question columns available for extra display + filtering
app.get('/api/candidates/question-columns', async (c) => {
  const denied = requirePerm(c, 'view_applications'); if (denied) return denied
  const questions = await getQuestionColumns(c.env.DB)
  return c.json({ ok: true, questions })
})

// Candidate list + search + filter
app.get('/api/candidates', async (c) => {
  const denied = requirePerm(c, 'view_applications'); if (denied) return denied
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
  const canViewSalary = c.get('auth')?.permissions.view_salary ?? false
  const data = await listCandidates(c.env.DB, { q, countries, position, fit_statuses, limit, offset, extraCols, answerFilters, min_score, max_score, sort, dir, sortNumeric, canViewSalary })
  return c.json({ ok: true, ...data })
})

// Candidate detail (applications + answers)
app.get('/api/candidates/:id', async (c) => {
  const denied = requirePerm(c, 'view_applications'); if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400)
  const canViewSalary = c.get('auth')?.permissions.view_salary ?? false
  const detail = await getCandidate(c.env.DB, id, canViewSalary)
  if (!detail) return c.json({ ok: false, error: 'candidate not found' }, 404)
  return c.json({ ok: true, ...detail })
})

// Update application status
app.patch('/api/applications/:id/status', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  let body: { status: string; created_by?: string }
  try {
    body = await c.req.json<{ status: string; created_by?: string }>()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  try {
    const updated = await updateApplicationStatus(c.env.DB, id, body.status, body.created_by)
    if (!updated) return c.json({ ok: false, error: 'application not found' }, 404)
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'update failed' }, 400)
  }
})

// Bulk move applications to a pipeline stage (board add/remove via multi-select)
app.patch('/api/applications/status/bulk', async (c) => {
  let body: { application_ids: number[]; status: string; created_by?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400)
  }
  if (!Array.isArray(body.application_ids) || body.application_ids.length === 0) {
    return c.json({ ok: false, error: 'application_ids cannot be empty' }, 400)
  }
  try {
    const updated = await updateApplicationsStageBulk(c.env.DB, body.application_ids, body.status, body.created_by)
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
    const updated = await updateApplicantsFitStatus(c.env.DB, body.ids, body.fit_status ?? null, body.created_by)
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
  await logCandidateEvents(c.env.DB, body.created_by, [
    { applicant_id: id, event_type: 'note_added', application_id: null,
      metadata: { note_id: result.meta.last_row_id, excerpt: noteExcerpt(content), generated: true } },
  ])
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
  await logCandidateEvents(c.env.DB, body.created_by, [
    { applicant_id: id, event_type: 'note_added', application_id: null,
      metadata: { note_id: result.meta.last_row_id, excerpt: noteExcerpt(content) } },
  ])
  await createMentionNotifications(c.env.DB, {
    noteId: Number(result.meta.last_row_id),
    applicantId: id,
    actor: body.created_by,
    actorName: body.created_by_name,
    content,
  })
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
  ).bind(id).first<{ applicant_id: number; created_by: string; created_by_name: string }>()
  if (note) {
    // Only notify mentions added by this edit, not ones already notified before.
    const already = await existingRecipients(c.env.DB, id)
    await createMentionNotifications(c.env.DB, {
      noteId: id,
      applicantId: note.applicant_id,
      actor: note.created_by,
      actorName: note.created_by_name,
      content: body.content.trim(),
      skipRecipients: already,
    })
  }
  return c.json({ ok: true, note: shapeNote(note) })
})

// Delete note — DELETE
app.delete('/api/notes/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  // Capture the note's owner/content before deleting so we can log the event.
  const deletedNote = await c.env.DB.prepare(
    `SELECT applicant_id, content FROM candidate_notes WHERE id = ?`
  ).bind(id).first<{ applicant_id: number; content: string }>()
  await deleteForNote(c.env.DB, id)
  const result = await c.env.DB.prepare(`DELETE FROM candidate_notes WHERE id = ?`).bind(id).run()
  if ((result.meta?.changes ?? 0) === 0) return c.json({ ok: false, error: 'note not found' }, 404)
  if (deletedNote) {
    await logCandidateEvents(c.env.DB, c.req.query('actor'), [
      { applicant_id: deletedNote.applicant_id, event_type: 'note_deleted', application_id: null,
        metadata: { note_id: id, excerpt: noteExcerpt(deletedNote.content) } },
    ])
  }
  return c.json({ ok: true })
})

// AI score history for one application — every past scoring run, newest first,
// each joined to the prompt version it was scored with (NULL prompt for entries
// predating prompt snapshots).
app.get('/api/applications/:id/score-history', async (c) => {
  const denied = requirePerm(c, 'view_applications'); if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const { results } = await c.env.DB
    .prepare(
      `SELECT h.id, h.score, h.reasoning, h.score_version, h.prompt_updated_at, h.scored_at,
              ph.prompt
       FROM ai_score_history h
       JOIN applications a ON a.id = h.application_id
       LEFT JOIN scoring_prompt_history ph
         ON ph.position_id = a.position_id AND ph.saved_at = h.prompt_updated_at
       WHERE h.application_id = ?
       GROUP BY h.id
       ORDER BY h.scored_at DESC, h.id DESC`
    )
    .bind(id)
    .all()
  return c.json({ ok: true, history: results })
})

// Candidate timeline / history — status changes and note add/delete events.
app.get('/api/candidates/:id/events', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const events = await getCandidateEvents(c.env.DB, id)
  return c.json({ ok: true, events })
})

// ── Notifications (currently @mentions in notes) ───────────────────────────

// Identify the requesting user. Auth is client-side, so the username is passed
// as a query param (consistent with the rest of the app's username references).
function reqUser(c: { req: { query: (k: string) => string | undefined } }): string {
  return (c.req.query('user') ?? '').trim()
}

// List recent notifications for a user plus the unread count.
app.get('/api/notifications', async (c) => {
  const user = reqUser(c)
  if (!user) return c.json({ ok: false, error: 'user required' }, 400)
  const { notifications, unread } = await listNotifications(c.env.DB, user)
  return c.json({ ok: true, notifications, unread })
})

// Applicant ids with at least one unread mention — drives the candidate-list marker.
app.get('/api/notifications/unread-applicants', async (c) => {
  const user = reqUser(c)
  if (!user) return c.json({ ok: false, error: 'user required' }, 400)
  const applicantIds = await unreadApplicantIds(c.env.DB, user)
  return c.json({ ok: true, applicantIds })
})

// Mark a single notification read (scoped to the requesting user).
app.post('/api/notifications/:id/read', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const user = reqUser(c)
  if (!user) return c.json({ ok: false, error: 'user required' }, 400)
  await markRead(c.env.DB, id, user)
  return c.json({ ok: true })
})

// Mark all of a user's notifications read.
app.post('/api/notifications/read-all', async (c) => {
  const user = reqUser(c)
  if (!user) return c.json({ ok: false, error: 'user required' }, 400)
  const count = await markAllRead(c.env.DB, user)
  return c.json({ ok: true, count })
})

// ── Employees (people whose leave we track) ────────────────────────────────

// All active employees, alphabetical.
app.get('/api/employees', async (c) => {
  const denied = requirePerm(c, 'manage_leave'); if (denied) return denied
  const employees = await listEmployees(c.env.DB)
  return c.json({ ok: true, employees })
})

// Add an employee (idempotent on name).
app.post('/api/employees', async (c) => {
  const denied = requirePerm(c, 'manage_leave'); if (denied) return denied
  const body: { name?: unknown; email?: unknown; department?: unknown; annualQuota?: unknown } =
    await c.req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name : ''
  if (!name.trim()) return c.json({ ok: false, error: 'name required' }, 400)
  const result = await createEmployee(c.env.DB, {
    name,
    email: typeof body.email === 'string' ? body.email : null,
    department: typeof body.department === 'string' ? body.department : null,
    annualQuota: typeof body.annualQuota === 'number' ? body.annualQuota : null,
  })
  if (!result.ok) return c.json({ ok: false, error: result.error }, 400)
  return c.json({ ok: true, employee: result.employee })
})

// ── Leave requests (time-off management) ───────────────────────────────────

// All leave requests, newest first (small team → no pagination for now).
app.get('/api/leave', async (c) => {
  const denied = requirePerm(c, 'manage_leave'); if (denied) return denied
  const requests = await listLeaveRequests(c.env.DB)
  return c.json({ ok: true, requests })
})

// Bulk import from a CSV export (rows normalized client-side). Deduped on the
// Tally submission id and auto-mapped to employees by name.
app.post('/api/leave/import', async (c) => {
  const denied = requirePerm(c, 'manage_leave'); if (denied) return denied
  const body: { rows?: unknown } = await c.req.json().catch(() => ({}))
  if (!Array.isArray(body.rows)) return c.json({ ok: false, error: 'rows array required' }, 400)
  const rows = (body.rows as unknown[])
    .filter((r): r is Record<string, unknown> => r != null && typeof r === 'object')
    .map((r) => {
      const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : null)
      return {
        submissionId: s('submissionId'),
        respondentId: s('respondentId'),
        name: s('name') ?? '',
        leaveType: s('leaveType'),
        startDate: s('startDate'),
        endDate: s('endDate'),
        hoursRequested: s('hoursRequested'),
        workingDays: s('workingDays'),
        reason: s('reason'),
        documentUrl: s('documentUrl'),
        submittedAt: s('submittedAt'),
      } satisfies LeaveImportRow
    })
    .filter((r) => r.name.trim())
  const summary = await importLeaveRequests(c.env.DB, rows)
  return c.json({ ok: true, summary })
})

// Map (or re-map) a request to an employee. Body: { employeeId: number | null }.
app.post('/api/leave/:id/assign-employee', async (c) => {
  const denied = requirePerm(c, 'manage_leave'); if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const body: { employeeId?: unknown } = await c.req.json().catch(() => ({}))
  const employeeId =
    body.employeeId === null || body.employeeId === undefined ? null : Number(body.employeeId)
  if (employeeId !== null && (!Number.isInteger(employeeId) || employeeId <= 0)) {
    return c.json({ ok: false, error: 'invalid employeeId' }, 400)
  }
  const result = await assignEmployee(c.env.DB, id, employeeId)
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  }
  return c.json({ ok: true })
})

// Manually correct a request's raw duration (working_days / hours). For fixing
// messy legacy rows; new Tally submissions arrive clean.
app.post('/api/leave/:id/duration', async (c) => {
  const denied = requirePerm(c, 'manage_leave'); if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const body: { workingDays?: unknown; hours?: unknown } = await c.req.json().catch(() => ({}))
  const workingDays = typeof body.workingDays === 'string' ? body.workingDays : null
  const hours = typeof body.hours === 'string' ? body.hours : null
  const result = await updateLeaveDuration(c.env.DB, id, workingDays, hours)
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  }
  return c.json({ ok: true })
})

// Manually set (or clear) a request's start/end dates. Body:
// { startDate?: string | null, endDate?: string | null } as YYYY-MM-DD.
app.post('/api/leave/:id/dates', async (c) => {
  const denied = requirePerm(c, 'manage_leave'); if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const body: { startDate?: unknown; endDate?: unknown } = await c.req.json().catch(() => ({}))
  const parse = (v: unknown): string | null | undefined => {
    if (v === null || v === undefined) return null
    if (typeof v !== 'string') return undefined
    const s = v.trim()
    if (!s) return null
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined
  }
  const startDate = parse(body.startDate)
  const endDate = parse(body.endDate)
  if (startDate === undefined || endDate === undefined) {
    return c.json({ ok: false, error: 'dates must be YYYY-MM-DD' }, 400)
  }
  const result = await updateLeaveDates(c.env.DB, id, startDate, endDate)
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  }
  return c.json({ ok: true })
})

// Approve or reject a pending request. Reviewer identity (an app user) comes from
// the body, consistent with the notes/notifications endpoints.
app.post('/api/leave/:id/review', async (c) => {
  const denied = requirePerm(c, 'manage_leave'); if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const body: { decision?: unknown; reviewer?: unknown; reviewerName?: unknown } = await c.req
    .json()
    .catch(() => ({}))
  const decision = body.decision === 'approved' || body.decision === 'rejected' ? body.decision : null
  const reviewer = typeof body.reviewer === 'string' ? body.reviewer.trim() : ''
  const reviewerName = typeof body.reviewerName === 'string' ? body.reviewerName.trim() : ''
  if (!decision) return c.json({ ok: false, error: 'invalid decision' }, 400)
  if (!reviewer || !reviewerName) return c.json({ ok: false, error: 'reviewer required' }, 400)

  const result = await reviewLeaveRequest(c.env.DB, id, decision, reviewer, reviewerName)
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  }
  return c.json({ ok: true, request: result.request })
})

// Set a request's status directly. Unlike /review this also corrects an
// already-decided request or reverts it to pending (which clears the reviewer).
app.post('/api/leave/:id/status', async (c) => {
  const denied = requirePerm(c, 'manage_leave'); if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const body: { status?: unknown; reviewer?: unknown; reviewerName?: unknown } = await c.req
    .json()
    .catch(() => ({}))
  const status =
    body.status === 'pending' || body.status === 'approved' || body.status === 'rejected'
      ? body.status
      : null
  const reviewer = typeof body.reviewer === 'string' ? body.reviewer.trim() : ''
  const reviewerName = typeof body.reviewerName === 'string' ? body.reviewerName.trim() : ''
  if (!status) return c.json({ ok: false, error: 'invalid status' }, 400)
  // Reverting to pending clears the reviewer, so it needs no acting identity.
  if (status !== 'pending' && (!reviewer || !reviewerName)) {
    return c.json({ ok: false, error: 'reviewer required' }, 400)
  }

  const result = await setLeaveStatus(c.env.DB, id, status, reviewer, reviewerName)
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  }
  return c.json({ ok: true, request: result.request })
})

// Delete a leave request (duplicate or mistaken submission). Permanent.
app.delete('/api/leave/:id', async (c) => {
  const denied = requirePerm(c, 'manage_leave'); if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const result = await deleteLeaveRequest(c.env.DB, id)
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  }
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
  let body: { batchSize?: number; positionId?: number | null; force?: boolean } = {}
  try { body = await c.req.json() } catch { /* body optional */ }
  const positionId = body.positionId != null ? Number(body.positionId) : null
  const scope = Number.isFinite(positionId as number) ? (positionId as number) : null
  const stub = syncStub(c, kind)

  // force (scores only): re-queue every application in scope — including ones whose score
  // is current — by clearing the prompt-freshness marker the pending query checks. Existing
  // scores stay visible until each one is overwritten. Skipped while a job is in flight
  // (start() below would no-op anyway, and we must not invalidate rows mid-run).
  if (body.force === true && kind === 'scores') {
    const current = await stub.status()
    if (current.status !== 'running' && current.status !== 'stopping') {
      const sql = `UPDATE applications SET ai_scored_prompt_at = NULL
         WHERE position_id IN (SELECT position_id FROM scoring_prompts)${scope != null ? ' AND position_id = ?' : ''}`
      const stmt = scope != null ? c.env.DB.prepare(sql).bind(scope) : c.env.DB.prepare(sql)
      await stmt.run()
    }
  }

  const state = await stub.start(kind, Number(body.batchSize) || 5, scope)
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
    // Danger Zone wipes scoring data entirely, including the history log.
    await c.env.DB.prepare(`DELETE FROM ai_score_history`).run()
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

// ── Admin: user & permission management ────────────────────────────────────
// All routes below are admin-only (enforced by the /api/admin/users* adminGate).

// Coerce a client permissions payload into the UserPermsInput shape (only known
// keys, only booleans). is_admin ("Full access") is handled alongside the perms.
function parsePermsInput(raw: unknown): UserPermsInput {
  const out: UserPermsInput = {}
  if (raw == null || typeof raw !== 'object') return out
  const obj = raw as Record<string, unknown>
  if (typeof obj.is_admin === 'boolean') out.is_admin = obj.is_admin
  for (const perm of PERMISSIONS) {
    if (typeof obj[perm] === 'boolean') out[perm] = obj[perm] as boolean
  }
  return out
}

// List every user (active + inactive) with resolved capability flags.
app.get('/api/admin/users', async (c) => {
  const users = await listAllUsers(c.env.DB)
  return c.json({ ok: true, users })
})

// Create a user.
app.post('/api/admin/users', async (c) => {
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}))
  const result = await createUser(c.env.DB, {
    username: typeof body.username === 'string' ? body.username : '',
    full_name: typeof body.full_name === 'string' ? body.full_name : '',
    password: typeof body.password === 'string' ? body.password : '',
    color: typeof body.color === 'string' ? body.color : null,
    is_active: body.is_active === undefined ? true : body.is_active !== false,
    perms: parsePermsInput(body.permissions),
  })
  if (!result.ok) return c.json({ ok: false, error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  return c.json({ ok: true, user: result.user })
})

// Update a user (partial). Blank password leaves the existing one unchanged.
app.patch('/api/admin/users/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'invalid id' }, 400)
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}))

  // Guard against an admin locking themselves out (removing their own admin flag
  // or deactivating their own account).
  const self = c.get('auth')
  const perms = parsePermsInput(body.permissions)
  const deactivating = body.is_active === false
  const demoting = perms.is_admin === false
  if (self && self.isAdmin && (deactivating || demoting)) {
    const target = (await listAllUsers(c.env.DB)).find((u) => u.id === id)
    if (target && target.username === self.username) {
      return c.json({ ok: false, error: 'you cannot remove your own admin access' }, 400)
    }
  }

  const result = await updateUser(c.env.DB, id, {
    full_name: typeof body.full_name === 'string' ? body.full_name : undefined,
    password: typeof body.password === 'string' ? body.password : undefined,
    color: body.color === undefined ? undefined : (typeof body.color === 'string' ? body.color : null),
    is_active: body.is_active === undefined ? undefined : body.is_active !== false,
    perms: body.permissions === undefined ? undefined : perms,
  })
  if (!result.ok) return c.json({ ok: false, error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  return c.json({ ok: true, user: result.user })
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

// Tally webhook for the leave-request form — SEPARATE from the applicant webhook
// above. Point the Tally leave form's webhook at this URL.
app.post('/api/webhook/tally/leave', async (c) => {
  const rawBody = await c.req.text()
  const sig = c.req.header('tally-signature') ?? null
  const result = await handleLeaveTallyWebhook(rawBody, sig, c.env.TALLY_WEBHOOK_SECRET, c.env.DB)
  return c.json(result.body, result.status as 200 | 400 | 401 | 500)
})

export default app
