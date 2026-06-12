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
  extra_answers?: Record<string, string | null>
}

export const FIT_STATUS_OPTIONS = [
  { value: 'good_fit', label: 'Good Fit' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'not_fit', label: 'Not Fit' },
] as const

export type FitStatusValue = 'good_fit' | 'maybe' | 'not_fit'

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
}

const FILTER_STORAGE_KEY = 'gk_candidate_filters'
const COLUMN_STORAGE_KEY = 'gk_candidate_columns'

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
      }
    }
  } catch {
    // ignore
  }
  return { countries: [], position: '', fit_statuses: [], answerFilters: [] }
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
  limit = 50
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
