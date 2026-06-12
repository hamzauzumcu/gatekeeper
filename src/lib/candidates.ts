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

export type ActiveFilters = {
  countries: string[]
  position: string
  fit_statuses: string[]
}

const FILTER_STORAGE_KEY = 'gk_candidate_filters'

export function loadSavedFilters(): ActiveFilters {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return {
        // migrate old single-string country → array
        countries: Array.isArray(parsed.countries)
          ? (parsed.countries as string[])
          : parsed.country
            ? [parsed.country as string]
            : [],
        position: typeof parsed.position === 'string' ? parsed.position : '',
        fit_statuses: Array.isArray(parsed.fit_statuses) ? (parsed.fit_statuses as string[]) : [],
      }
    }
  } catch {
    // ignore
  }
  return { countries: [], position: '', fit_statuses: [] }
}

export function saveFilters(f: ActiveFilters): void {
  localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(f))
}

export async function fetchFilterOptions(): Promise<FilterOptions> {
  const res = await fetch('/api/candidates/filters')
  const data = (await res.json()) as
    | { ok: true; countries: string[]; positions: string[] }
    | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch filters')
  return { countries: data.countries, positions: data.positions }
}

export async function fetchCandidates(
  q: string,
  filters: ActiveFilters,
  offset = 0,
  limit = 50
): Promise<{ candidates: CandidateListItem[]; total: number }> {
  const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) })
  filters.countries.forEach((c) => params.append('country', c))
  if (filters.position) params.set('position', filters.position)
  filters.fit_statuses.forEach((s) => params.append('fit_status', s))
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
  // Replace all digit groups (≥ 3 digits) with locale-formatted numbers
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
