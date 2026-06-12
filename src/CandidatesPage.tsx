import { useEffect, useState } from 'react'
import { Search, ExternalLink, FileText, X, SlidersHorizontal } from 'lucide-react'
import {
  fetchCandidates,
  fetchCandidate,
  fetchFilterOptions,
  loadSavedFilters,
  saveFilters,
  formatDate,
  type CandidateListItem,
  type CandidateDetail,
  type FilterOptions,
  type ActiveFilters,
} from './lib/candidates'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: string[]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          'h-9 rounded-md border border-input bg-background px-3 pr-8 text-sm',
          'ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          'appearance-none cursor-pointer min-w-36',
          value ? 'text-foreground font-medium' : 'text-muted-foreground',
        ].join(' ')}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  )
}

export default function CandidatesPage() {
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<ActiveFilters>(loadSavedFilters)
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ countries: [], positions: [] })

  const [candidates, setCandidates] = useState<CandidateListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<CandidateDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [open, setOpen] = useState(false)

  // Filtre seçeneklerini bir kere yükle
  useEffect(() => {
    fetchFilterOptions().then(setFilterOptions).catch(() => {})
  }, [])

  // Aday listesi — q veya filtreler değişince yenile
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true)
      setError(null)
      fetchCandidates(q, filters)
        .then(({ candidates, total }) => {
          setCandidates(candidates)
          setTotal(total)
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'hata'))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q, filters])

  function updateFilter(key: keyof ActiveFilters, value: string) {
    const next = { ...filters, [key]: value }
    setFilters(next)
    saveFilters(next)
  }

  function clearFilters() {
    const cleared: ActiveFilters = { country: '', position: '' }
    setFilters(cleared)
    saveFilters(cleared)
  }

  function openCandidate(id: number) {
    setOpen(true)
    setSelected(null)
    setDetailLoading(true)
    fetchCandidate(id)
      .then(setSelected)
      .catch(() => setSelected(null))
      .finally(() => setDetailLoading(false))
  }

  const activeFilterCount = [filters.country, filters.position].filter(Boolean).length

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            Adaylar
            {total > 0 && <span className="text-muted-foreground font-normal">({total})</span>}
          </CardTitle>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-7 gap-1.5 text-xs text-muted-foreground"
            >
              <X className="size-3" />
              {activeFilterCount} filtre temizle
            </Button>
          )}
        </div>

        {/* Arama + Filtreler */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="İsim veya e-posta ara…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
            <FilterSelect
              value={filters.country}
              onChange={(v) => updateFilter('country', v)}
              placeholder="Tüm ülkeler"
              options={filterOptions.countries}
            />
            <FilterSelect
              value={filters.position}
              onChange={(v) => updateFilter('position', v)}
              placeholder="Tüm pozisyonlar"
              options={filterOptions.positions}
            />
          </div>
        </div>

        {/* Aktif filtre etiketleri */}
        {activeFilterCount > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {filters.country && (
              <Badge variant="secondary" className="gap-1 pr-1">
                {filters.country}
                <button
                  onClick={() => updateFilter('country', '')}
                  className="ml-0.5 rounded-sm opacity-60 hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            )}
            {filters.position && (
              <Badge variant="secondary" className="gap-1 pr-1">
                {filters.position}
                <button
                  onClick={() => updateFilter('position', '')}
                  className="ml-0.5 rounded-sm opacity-60 hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent>
        {error && <p className="text-sm text-destructive">Hata: {error}</p>}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ad</TableHead>
              <TableHead>Ülke</TableHead>
              <TableHead>Pozisyon</TableHead>
              <TableHead className="text-center">Başvuru</TableHead>
              <TableHead>Son başvuru</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : candidates.map((cand) => (
                  <TableRow
                    key={cand.id}
                    className="cursor-pointer"
                    onClick={() => openCandidate(cand.id)}
                  >
                    <TableCell>
                      <div className="font-medium">{cand.full_name ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{cand.email ?? '—'}</div>
                    </TableCell>
                    <TableCell>
                      {cand.country ? (
                        <button
                          className={[
                            'text-sm',
                            filters.country === cand.country
                              ? 'font-semibold text-foreground underline underline-offset-2'
                              : 'text-muted-foreground hover:text-foreground',
                          ].join(' ')}
                          onClick={(e) => {
                            e.stopPropagation()
                            updateFilter('country', filters.country === cand.country ? '' : cand.country!)
                          }}
                        >
                          {cand.country}
                        </button>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="max-w-50 truncate text-sm text-muted-foreground">
                      {cand.positions ?? '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      {cand.applications_count > 1 ? (
                        <Badge variant="secondary">{cand.applications_count}</Badge>
                      ) : (
                        cand.applications_count
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(cand.latest_submitted_at)}
                    </TableCell>
                  </TableRow>
                ))}
            {!loading && candidates.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {activeFilterCount > 0 || q
                    ? 'Bu filtrelere uygun aday bulunamadı.'
                    : 'Aday bulunamadı.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {detailLoading || !selected ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <CandidateDetailView detail={selected} />
          )}
        </SheetContent>
      </Sheet>
    </Card>
  )
}

function CandidateDetailView({ detail }: { detail: CandidateDetail }) {
  const { applicant, applications } = detail
  return (
    <>
      <SheetHeader>
        <SheetTitle>{applicant.full_name ?? 'Aday'}</SheetTitle>
        <SheetDescription>
          {[applicant.email, applicant.phone, applicant.country].filter(Boolean).join(' · ') || '—'}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-5 px-4 pb-8">
        {applicant.linkedin_url && (
          <a
            href={applicant.linkedin_url.startsWith('http') ? applicant.linkedin_url : `https://${applicant.linkedin_url}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" /> LinkedIn
          </a>
        )}

        <div className="text-sm text-muted-foreground">
          {applications.length} başvuru
        </div>

        {applications.map((app) => (
          <div key={app.id} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium">{app.position_title ?? 'Pozisyon'}</div>
              <Badge variant="outline">{app.status}</Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{formatDate(app.submitted_at)}</div>

            <Separator className="my-3" />

            <dl className="space-y-2">
              {app.answers.map((a, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-2 text-sm">
                  <dt className="text-muted-foreground">{a.label}</dt>
                  <dd className="text-right font-medium">{a.value ?? '—'}</dd>
                </div>
              ))}
            </dl>

            {app.cover_letter && (
              <>
                <Separator className="my-3" />
                <div className="text-xs font-medium text-muted-foreground">Cover Letter</div>
                <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm">
                  {app.cover_letter}
                </p>
              </>
            )}

            {app.resume_url && (
              <a
                href={app.resume_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <FileText className="size-3.5" /> CV (PDF)
              </a>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
