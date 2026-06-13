// Candidate API types + fetch helpers (browser-side).

export type CandidateListItem = {
  id: number
  full_name: string | null
  email: string | null
  phone: string | null
  country: string | null
  linkedin_url: string | null
  applications_count: number
  latest_submitted_at: string | null
  positions: string | null
  salary_expectation: string | null
  latest_status: string | null
  latest_application_id: number | null
  fit_status: string | null
  notes_count: number
  ai_score: number | null
  extra_answers?: Record<string, string | null>
}

export const FIT_STATUS_OPTIONS = [
  { value: 'good_fit', label: 'Good Fit' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'not_fit', label: 'Not Fit' },
  { value: 'none', label: 'No Status' },
] as const

export type FitStatusValue = 'good_fit' | 'maybe' | 'not_fit'

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
}

export type CandidateDetail = {
  applicant: CandidateListItem
  applications: CandidateApplication[]
}

export type FilterOptions = {
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

export type AnswerFilterOp =
  | 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'starts_with' | 'ends_with'
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'is_true' | 'is_false'
  | 'is_empty' | 'is_not_empty'

export type AnswerFilter = {
  questionId: number
  op: AnswerFilterOp
  value: string
}

export const TEXT_OP_OPTIONS: { value: AnswerFilterOp; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'equals', label: 'is exactly' },
  { value: 'not_equals', label: 'is not' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

export const NUMBER_OP_OPTIONS: { value: AnswerFilterOp; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

export const BOOLEAN_OP_OPTIONS: { value: AnswerFilterOp; label: string }[] = [
  { value: 'is_true', label: 'is Yes' },
  { value: 'is_false', label: 'is No' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

export const FILE_OP_OPTIONS: { value: AnswerFilterOp; label: string }[] = [
  { value: 'is_not_empty', label: 'has file' },
  { value: 'is_empty', label: 'no file' },
]

export const NO_VALUE_OPS = new Set<AnswerFilterOp>(['is_empty', 'is_not_empty', 'is_true', 'is_false'])

export function getOpOptions(type: QuestionColumn['type']) {
  switch (type) {
    case 'number': return NUMBER_OP_OPTIONS
    case 'boolean': return BOOLEAN_OP_OPTIONS
    case 'file': return FILE_OP_OPTIONS
    default: return TEXT_OP_OPTIONS
  }
}

export function defaultOpForType(type: QuestionColumn['type']): AnswerFilterOp {
  switch (type) {
    case 'number': return 'eq'
    case 'boolean': return 'is_true'
    case 'file': return 'is_not_empty'
    default: return 'contains'
  }
}

export type ActiveFilters = {
  countries: string[]
  position: string
  fit_statuses: string[]
  answerFilters: AnswerFilter[]
  min_score: string
  max_score: string
}

// Table sort state. `key` is a column identifier: a base column ('name',
// 'country', 'score', 'apply_date') or a question column as `q:<id>`.
// `numeric` selects numeric (CAST) vs lexical ordering on the server.
export type SortState = { key: string; dir: 'asc' | 'desc'; numeric: boolean }

const FILTER_STORAGE_KEY = 'gk_candidate_filters'
const COLUMN_STORAGE_KEY = 'gk_candidate_columns'
const SORT_STORAGE_KEY = 'gk_candidate_sort'

export function loadSavedSort(): SortState | null {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Record<string, unknown>
      if (typeof p.key === 'string' && (p.dir === 'asc' || p.dir === 'desc')) {
        return { key: p.key, dir: p.dir, numeric: p.numeric === true }
      }
    }
  } catch {}
  return null
}

export function saveSort(sort: SortState | null): void {
  if (sort) localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort))
  else localStorage.removeItem(SORT_STORAGE_KEY)
}

export function loadSavedFilters(): ActiveFilters {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return {
        countries: Array.isArray(parsed.countries)
          ? (parsed.countries as string[])
          : parsed.country
            ? [parsed.country as string]
            : [],
        position: typeof parsed.position === 'string' ? parsed.position : '',
        fit_statuses: Array.isArray(parsed.fit_statuses) ? (parsed.fit_statuses as string[]) : [],
        answerFilters: Array.isArray(parsed.answerFilters) ? (parsed.answerFilters as AnswerFilter[]) : [],
        min_score: typeof parsed.min_score === 'string' ? parsed.min_score : '',
        max_score: typeof parsed.max_score === 'string' ? parsed.max_score : '',
      }
    }
  } catch {
    // ignore
  }
  return { countries: [], position: '', fit_statuses: [], answerFilters: [], min_score: '', max_score: '' }
}

export function saveFilters(f: ActiveFilters): void {
  localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(f))
}

export function loadSavedColumns(): number[] {
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as number[]
  } catch {}
  return []
}

export function saveColumns(cols: number[]): void {
  localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(cols))
}

// Default (always-available) table columns that the user can show/hide.
// Name and the row selector are intentionally omitted — they are always visible.
export type BaseColumnKey = 'country' | 'position' | 'salary' | 'status' | 'score' | 'apply_date' | 'notes'

export const BASE_COLUMNS: { key: BaseColumnKey; label: string }[] = [
  { key: 'country', label: 'Country' },
  { key: 'position', label: 'Position' },
  { key: 'salary', label: 'Salary Expectation' },
  { key: 'status', label: 'Status' },
  { key: 'score', label: 'Score' },
  { key: 'apply_date', label: 'Apply date' },
  { key: 'notes', label: 'Notes' },
]

const HIDDEN_BASE_COLUMN_STORAGE_KEY = 'gk_candidate_hidden_base_columns'

export function loadHiddenBaseColumns(): BaseColumnKey[] {
  try {
    const raw = localStorage.getItem(HIDDEN_BASE_COLUMN_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as BaseColumnKey[]
  } catch {}
  return []
}

export function saveHiddenBaseColumns(keys: BaseColumnKey[]): void {
  localStorage.setItem(HIDDEN_BASE_COLUMN_STORAGE_KEY, JSON.stringify(keys))
}

export async function fetchFilterOptions(): Promise<FilterOptions> {
  const res = await fetch('/api/candidates/filters')
  const data = (await res.json()) as
    | { ok: true; countries: string[]; positions: string[] }
    | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch filters')
  return { countries: data.countries, positions: data.positions }
}

export async function fetchQuestionColumns(): Promise<QuestionColumn[]> {
  const res = await fetch('/api/candidates/question-columns')
  const data = (await res.json()) as { ok: true; questions: QuestionColumn[] } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch question columns')
  return data.questions
}

export async function fetchCandidates(
  q: string,
  filters: ActiveFilters,
  extraCols: number[],
  offset = 0,
  limit = 50,
  sort: SortState | null = null
): Promise<{ candidates: CandidateListItem[]; total: number }> {
  const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) })
  filters.countries.forEach((c) => params.append('country', c))
  if (filters.position) params.set('position', filters.position)
  filters.fit_statuses.forEach((s) => params.append('fit_status', s))
  extraCols.forEach((id) => params.append('extra_col', String(id)))
  filters.answerFilters.forEach((f) => {
    params.append('af_q', String(f.questionId))
    params.append('af_op', f.op)
    params.append('af_v', f.value)
  })
  if (filters.min_score) params.set('min_score', filters.min_score)
  if (filters.max_score) params.set('max_score', filters.max_score)
  if (sort) {
    params.set('sort', sort.key)
    params.set('dir', sort.dir)
    if (sort.numeric) params.set('sort_numeric', '1')
  }
  const res = await fetch(`/api/candidates?${params}`)
  const data = (await res.json()) as
    | { ok: true; candidates: CandidateListItem[]; total: number }
    | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch list')
  return { candidates: data.candidates, total: data.total }
}

export async function fetchCandidate(id: number): Promise<CandidateDetail> {
  const res = await fetch(`/api/candidates/${id}`)
  const data = (await res.json()) as ({ ok: true } & CandidateDetail) | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch detail')
  return { applicant: data.applicant, applications: data.applications }
}

// --- FX / USD salary estimate ---------------------------------------------

export type FxRates = { base: 'USD'; rates: Record<string, number>; fetched_at: number | null }

const FX_CACHE_KEY = 'gatekeeper:fx'
const FX_TTL_MS = 24 * 60 * 60 * 1000 // 1 day

let fxCache: Promise<FxRates | null> | null = null

function readFxFromStorage(): FxRates | null {
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY)
    if (!raw) return null
    const { at, data } = JSON.parse(raw) as { at: number; data: FxRates }
    if (Date.now() - at > FX_TTL_MS) return null
    return data
  } catch {
    return null
  }
}

function writeFxToStorage(data: FxRates) {
  try {
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ at: Date.now(), data }))
  } catch {
    // storage full / unavailable — fall back to network next time
  }
}

// Fetch USD-based rates, cached for a day in localStorage (per browser) and at
// the edge. Module-level promise dedupes concurrent calls within a page load.
export function fetchFxRates(): Promise<FxRates | null> {
  if (!fxCache) {
    const cached = readFxFromStorage()
    if (cached) {
      fxCache = Promise.resolve(cached)
    } else {
      fxCache = fetch('/api/fx')
        .then(async (res) => {
          const data = (await res.json()) as
            | ({ ok: true } & FxRates)
            | { ok: false; error: string }
          if (!res.ok || !data.ok) return null
          const fx: FxRates = { base: 'USD', rates: data.rates, fetched_at: data.fetched_at }
          writeFxToStorage(fx)
          return fx
        })
        .catch(() => null)
    }
  }
  return fxCache
}

// Map common currency notations to ISO codes. Default is TRY (Turkish app).
function detectCurrency(s: string): string {
  const t = s.toLowerCase()
  if (/\$|usd|dollar|dolar/.test(t)) return 'USD'
  if (/€|eur|euro/.test(t)) return 'EUR'
  if (/£|gbp|sterling|pound/.test(t)) return 'GBP'
  if (/₺|\btl\b|try|lira/.test(t)) return 'TRY'
  return 'TRY'
}

// Pull numeric amounts out of a salary string, handling "40.000", "40,000",
// "40k" and ranges like "40000-50000".
function parseAmounts(s: string): number[] {
  const out: number[] = []
  const re = /(\d[\d.,]*)\s*(k|bin|m)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    let n = parseInt(m[1].replace(/[.,]/g, ''), 10)
    if (isNaN(n)) continue
    const suffix = (m[2] ?? '').toLowerCase()
    if (suffix === 'k' || suffix === 'bin') n *= 1000
    else if (suffix === 'm') n *= 1_000_000
    if (n >= 100) out.push(n)
  }
  return out
}

// Estimate a USD value (or range) for a salary answer. Returns a display string
// like "≈ $1,500" / "≈ $1,500–$1,900", or null if it can't be estimated.
export function estimateUsdSalary(raw: string | null, fx: FxRates | null): string | null {
  if (!raw || !fx) return null
  const currency = detectCurrency(raw)
  const rate = currency === 'USD' ? 1 : fx.rates[currency]
  if (currency === 'USD' || !rate) return null // already USD or unknown currency
  const amounts = parseAmounts(raw)
  if (amounts.length === 0) return null
  const fmt = (n: number) =>
    '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n / rate))
  const lo = Math.min(...amounts)
  const hi = Math.max(...amounts)
  return lo === hi ? `≈ ${fmt(lo)}` : `≈ ${fmt(lo)}–${fmt(hi)}`
}

export function formatSalary(raw: string | null): string {
  if (!raw) return '—'
  const s = raw.trim()
  if (!s) return '—'
  return s.replace(/\d[\d,.]*\d|\d{3,}/g, (m) => {
    const n = parseInt(m.replace(/[,.]/g, ''), 10)
    if (isNaN(n) || n < 100) return m
    return new Intl.NumberFormat('en-US').format(n)
  })
}

// Detect a salary value very likely entered in thousands (e.g. "220" meaning
// 220,000 TRY) and propose the ×1000 correction. Returns null when the value is
// non-numeric, a range, or already large enough (>= 10,000) to need no fixing.
export function normalizeSalary(
  raw: string | null
): { value: number; suggested: string } | null {
  if (!raw) return null
  // Drop a trailing currency marker so "220 TL" is still recognised as numeric.
  const stripped = raw.trim().replace(/\s*(tl|try|₺)\s*$/i, '').trim()
  if (!stripped || !/^[\d.,\s]+$/.test(stripped)) return null
  const n = parseInt(stripped.replace(/[.,\s]/g, ''), 10)
  if (isNaN(n) || n <= 0 || n >= 10000) return null
  return { value: n, suggested: String(n * 1000) }
}

// Overwrite a single application answer's raw value in the DB.
export async function updateAnswerValue(
  applicationId: number,
  questionId: number,
  value: string | null
): Promise<void> {
  const res = await fetch(`/api/applications/${applicationId}/answers/${questionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  const data = (await res.json()) as { ok: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'update failed')
}

export async function updateApplicationStatus(
  applicationId: number,
  status: string
): Promise<void> {
  const res = await fetch(`/api/applications/${applicationId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  const data = (await res.json()) as { ok: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'update failed')
}

export async function updateApplicantsFitStatus(
  ids: number[],
  fit_status: string | null
): Promise<void> {
  const res = await fetch('/api/applicants/fit-status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, fit_status }),
  })
  const data = (await res.json()) as { ok: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'update failed')
}

export type CandidateNote = {
  id: number
  applicant_id: number
  content: string
  created_by: string
  created_by_name: string
  created_at: string
}

export async function fetchNotes(applicantId: number): Promise<CandidateNote[]> {
  const res = await fetch(`/api/candidates/${applicantId}/notes`)
  const data = (await res.json()) as { ok: true; notes: CandidateNote[] } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch notes')
  return data.notes
}

export async function addNote(
  applicantId: number,
  content: string,
  createdBy: string,
  createdByName: string
): Promise<CandidateNote> {
  const res = await fetch(`/api/candidates/${applicantId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, created_by: createdBy, created_by_name: createdByName }),
  })
  const data = (await res.json()) as { ok: true; note: CandidateNote } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to add note')
  return data.note
}

export async function deleteNote(noteId: number): Promise<void> {
  const res = await fetch(`/api/notes/${noteId}`, { method: 'DELETE' })
  const data = (await res.json()) as { ok: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'failed to delete note')
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export type PositionWithPrompt = {
  id: number
  title: string
  prompt: string | null
  updated_at: string | null
}

export async function fetchScoringPrompts(): Promise<PositionWithPrompt[]> {
  const res = await fetch('/api/admin/scoring-prompts')
  const data = (await res.json()) as { ok: true; positions: PositionWithPrompt[] } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch scoring prompts')
  return data.positions
}

export async function saveScoringPrompt(positionId: number, prompt: string): Promise<void> {
  const res = await fetch(`/api/admin/scoring-prompts/${positionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  const data = (await res.json()) as { ok: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'failed to save prompt')
}

export async function syncScores(opts: { limit?: number; dryRun?: boolean } = {}): Promise<{ pending?: number; processed?: number; failed?: number; remaining?: number }> {
  const res = await fetch('/api/admin/sync-scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  const data = (await res.json()) as { ok: true; pending?: number; processed?: number; failed?: number; remaining?: number } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'sync failed')
  return data
}

export type CvSyncResult = {
  pending?: number
  processed?: number
  failed?: number
  remaining?: number
  errors?: { id: number; error: string }[]
}

export async function fetchPendingCvIds(): Promise<number[]> {
  const res = await fetch('/api/admin/pending-cvs')
  const data = (await res.json()) as { ok: true; ids: number[] } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'fetch failed')
  return data.ids
}

export async function parseSingleCv(id: number): Promise<void> {
  const res = await fetch(`/api/admin/parse-cv/${id}`, { method: 'POST' })
  const data = (await res.json()) as { ok: true } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'parse failed')
}

export async function fetchPendingScoreIds(): Promise<number[]> {
  const res = await fetch('/api/admin/pending-scores')
  const data = (await res.json()) as { ok: true; ids: number[] } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'fetch failed')
  return data.ids
}

export async function scoreOneApplication(id: number): Promise<void> {
  const res = await fetch(`/api/admin/score-application/${id}`, { method: 'POST' })
  const data = (await res.json()) as { ok: true } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'score failed')
}

export async function syncCv(opts: { limit?: number; dryRun?: boolean } = {}): Promise<CvSyncResult> {
  const res = await fetch('/api/admin/sync-cv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  const data = (await res.json()) as ({ ok: true } & CvSyncResult) | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'sync failed')
  return data
}

// ── Cloud sync jobs (Durable Object) ───────────────────────────────────────

export type SyncJobKind = 'scores' | 'cv'
export type SyncJobStatus = 'idle' | 'running' | 'stopping' | 'done' | 'stopped' | 'error'

export type SyncJobState = {
  kind: SyncJobKind | null
  status: SyncJobStatus
  total: number
  processed: number
  failed: number
  cursor: number
  cursorId: number
  batchSize: number
  errors: { id: number; error: string }[]
  fatalError: string | null
  startedAt: string | null
  finishedAt: string | null
}

export async function startSyncJob(kind: SyncJobKind, batchSize: number): Promise<SyncJobState> {
  const res = await fetch(`/api/admin/sync/${kind}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchSize }),
  })
  const data = (await res.json()) as { ok: true; state: SyncJobState } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to start sync')
  return data.state
}

export async function fetchSyncStatus(kind: SyncJobKind): Promise<SyncJobState> {
  const res = await fetch(`/api/admin/sync/${kind}/status`)
  const data = (await res.json()) as { ok: true; state: SyncJobState } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch status')
  return data.state
}

export async function stopSyncJob(kind: SyncJobKind): Promise<SyncJobState> {
  const res = await fetch(`/api/admin/sync/${kind}/stop`, { method: 'POST' })
  const data = (await res.json()) as { ok: true; state: SyncJobState } | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to stop sync')
  return data.state
}

export async function clearData(scope: 'cv_data' | 'scores' | 'all_candidates'): Promise<{ deleted?: number; updated?: number }> {
  const res = await fetch('/api/admin/data', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope }),
  })
  const data = (await res.json()) as ({ ok: true; deleted?: number; updated?: number }) | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'operation failed')
  return data
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} mo`
  return `${Math.floor(months / 12)} yr`
}

export function formatDateShort(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
