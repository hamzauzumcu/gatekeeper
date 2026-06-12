// Aday API tipleri + fetch yardımcıları (tarayıcı tarafı).

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

export type FilterOptions = {
  countries: string[]
  positions: string[]
}

export type ActiveFilters = {
  countries: string[]
  position: string
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
      }
    }
  } catch {
    // ignore
  }
  return { countries: [], position: '' }
}

export function saveFilters(f: ActiveFilters): void {
  localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(f))
}

export async function fetchFilterOptions(): Promise<FilterOptions> {
  const res = await fetch('/api/candidates/filters')
  const data = (await res.json()) as
    | { ok: true; countries: string[]; positions: string[] }
    | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'filtreler alınamadı')
  return { countries: data.countries, positions: data.positions }
}

export async function fetchCandidates(
  q: string,
  filters: ActiveFilters
): Promise<{ candidates: CandidateListItem[]; total: number }> {
  const params = new URLSearchParams({ q })
  filters.countries.forEach((c) => params.append('country', c))
  if (filters.position) params.set('position', filters.position)
  const res = await fetch(`/api/candidates?${params}`)
  const data = (await res.json()) as
    | { ok: true; candidates: CandidateListItem[]; total: number }
    | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'liste alınamadı')
  return { candidates: data.candidates, total: data.total }
}

export async function fetchCandidate(id: number): Promise<CandidateDetail> {
  const res = await fetch(`/api/candidates/${id}`)
  const data = (await res.json()) as ({ ok: true } & CandidateDetail) | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'detay alınamadı')
  return { applicant: data.applicant, applications: data.applications }
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
