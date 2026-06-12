import { useEffect, useRef, useState } from 'react'
import { Search, ExternalLink, FileText, X, SlidersHorizontal, ChevronDown, Check, Mail, Phone, Globe, Download, MessageSquare, Trash2 } from 'lucide-react'
import {
  fetchCandidates,
  fetchCandidate,
  fetchFilterOptions,
  loadSavedFilters,
  saveFilters,
  formatDate,
  formatDateShort,
  formatSalary,
  updateApplicationStatus,
  updateApplicantsFitStatus,
  fetchNotes,
  addNote,
  deleteNote,
  FIT_STATUS_OPTIONS,
  type CandidateListItem,
  type CandidateDetail,
  type CandidateNote,
  type FilterOptions,
  type ActiveFilters,
} from './lib/candidates'
import { getUser, type User } from './lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const FIT_STATUS_STYLES: Record<string, { badge: string; label: string }> = {
  good_fit: { badge: 'bg-green-50 text-green-700 border-green-200', label: 'Good Fit' },
  maybe: { badge: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Maybe' },
  not_fit: { badge: 'bg-red-50 text-red-700 border-red-200', label: 'Not Fit' },
}

function FitBadge({ status }: { status: string | null }) {
  if (!status) return null
  const s = FIT_STATUS_STYLES[status]
  if (!s) return null
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.badge}`}>
      {s.label}
    </span>
  )
}

// Generic multi-select dropdown (shared for country and fit_status)
function MultiSelect({
  values,
  onChange,
  options,
  placeholder,
  minWidth = 'min-w-36',
}: {
  values: string[]
  onChange: (v: string[]) => void
  options: { value: string; label: string }[]
  placeholder: string
  minWidth?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function toggle(v: string) {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])
  }

  const selectedLabels = options.filter((o) => values.includes(o.value)).map((o) => o.label)
  const label =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : `${selectedLabels.length} selected`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          `flex h-9 ${minWidth} items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm`,
          'ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          values.length > 0 ? 'font-medium text-foreground' : 'text-muted-foreground',
        ].join(' ')}
      >
        <span>{label}</span>
        <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1 max-h-64 min-w-44 overflow-y-auto rounded-md border bg-popover shadow-md">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No options</div>
          ) : (
            <>
              {values.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => onChange([])}
                    className="w-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear all
                  </button>
                  <div className="border-t" />
                </>
              )}
              {options.map((o) => {
                const checked = values.includes(o.value)
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span
                      className={[
                        'flex size-4 shrink-0 items-center justify-center rounded border',
                        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                      ].join(' ')}
                    >
                      {checked && <Check className="size-2.5" />}
                    </span>
                    {o.label}
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Single-select dropdown (for position)
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
          'appearance-none cursor-pointer min-w-40',
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

  const PAGE_SIZE = 50

  const [candidates, setCandidates] = useState<CandidateListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLTableRowElement>(null)

  const currentUser = getUser()!

  const [selected, setSelected] = useState<CandidateDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [sheetTab, setSheetTab] = useState('applications')

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)


  useEffect(() => {
    fetchFilterOptions().then(setFilterOptions).catch(() => {})
  }, [])

  // Reset + initial load when query or filters change
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true)
      setError(null)
      setCandidates([])
      setOffset(0)
      setHasMore(false)
      setSelectedIds(new Set())
      fetchCandidates(q, filters, 0, PAGE_SIZE)
        .then(({ candidates: page, total }) => {
          setCandidates(page)
          setTotal(total)
          setHasMore(page.length < total)
          setOffset(page.length)
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'error'))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q, filters])

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          setLoadingMore(true)
          fetchCandidates(q, filters, offset, PAGE_SIZE)
            .then(({ candidates: page, total }) => {
              setCandidates((prev) => {
                const merged = [...prev, ...page]
                setHasMore(merged.length < total)
                setOffset(merged.length)
                return merged
              })
            })
            .catch(() => {})
            .finally(() => setLoadingMore(false))
        }
      },
      { rootMargin: '200px' }
    )
    obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [hasMore, loadingMore, loading, offset, q, filters])

  function updateFilter<K extends keyof ActiveFilters>(key: K, value: ActiveFilters[K]) {
    const next = { ...filters, [key]: value }
    setFilters(next)
    saveFilters(next)
  }

  function clearFilters() {
    const cleared: ActiveFilters = { countries: [], position: '', fit_statuses: [] }
    setFilters(cleared)
    saveFilters(cleared)
  }

  function openCandidate(id: number, tab = 'applications') {
    setSheetTab(tab)
    setOpen(true)
    setSelected(null)
    setDetailLoading(true)
    fetchCandidate(id)
      .then(setSelected)
      .catch(() => setSelected(null))
      .finally(() => setDetailLoading(false))
  }

  function toggleSelectId(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === candidates.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(candidates.map((c) => c.id)))
    }
  }

  async function assignFitStatus(fitStatus: string | null) {
    if (selectedIds.size === 0) return
    setBulkLoading(true)
    try {
      await updateApplicantsFitStatus([...selectedIds], fitStatus)
      setCandidates((prev) =>
        prev.map((c) => (selectedIds.has(c.id) ? { ...c, fit_status: fitStatus } : c))
      )
      setSelectedIds(new Set())
    } catch {
      // silent
    } finally {
      setBulkLoading(false)
    }
  }

  const activeFilterCount =
    (filters.countries.length > 0 ? 1 : 0) +
    (filters.position ? 1 : 0) +
    (filters.fit_statuses.length > 0 ? 1 : 0)

  const allSelected = candidates.length > 0 && selectedIds.size === candidates.length
  const someSelected = selectedIds.size > 0 && !allSelected

  const countryOptions = filterOptions.countries.map((c) => ({ value: c, label: c }))

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            Candidates
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
              Clear {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''}
            </Button>
          )}
        </div>

        {/* Search + Filters */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
            <MultiSelect
              values={filters.countries}
              onChange={(v) => updateFilter('countries', v)}
              options={countryOptions}
              placeholder="All countries"
            />
            <FilterSelect
              value={filters.position}
              onChange={(v) => updateFilter('position', v)}
              placeholder="All positions"
              options={filterOptions.positions}
            />
            <MultiSelect
              values={filters.fit_statuses}
              onChange={(v) => updateFilter('fit_statuses', v)}
              options={[...FIT_STATUS_OPTIONS]}
              placeholder="All statuses"
              minWidth="min-w-36"
            />
          </div>
        </div>

        {/* Active filter tags */}
        {activeFilterCount > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {filters.countries.map((c) => (
              <Badge key={c} variant="secondary" className="gap-1 pr-1">
                {c}
                <button
                  onClick={() => updateFilter('countries', filters.countries.filter((x) => x !== c))}
                  className="ml-0.5 rounded-sm opacity-60 hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
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
            {filters.fit_statuses.map((s) => {
              const opt = FIT_STATUS_OPTIONS.find((o) => o.value === s)
              return opt ? (
                <Badge key={s} variant="secondary" className="gap-1 pr-1">
                  {opt.label}
                  <button
                    onClick={() =>
                      updateFilter('fit_statuses', filters.fit_statuses.filter((x) => x !== s))
                    }
                    className="ml-0.5 rounded-sm opacity-60 hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ) : null
            })}
          </div>
        )}
      </CardHeader>

      <CardContent className="relative pb-0">
        {error && <p className="mb-2 text-sm text-destructive">Error: {error}</p>}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className={[
                    'flex size-4 items-center justify-center rounded border',
                    allSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : someSelected
                        ? 'border-primary bg-primary/30'
                        : 'border-input',
                  ].join(' ')}
                  aria-label="Select all"
                >
                  {(allSelected || someSelected) && <Check className="size-2.5" />}
                </button>
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Salary Expectation</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Apply Date</TableHead>
              <TableHead className="w-10 text-center">Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : candidates.map((cand) => {
                  const checked = selectedIds.has(cand.id)
                  return (
                    <TableRow
                      key={cand.id}
                      className={`cursor-pointer ${checked ? 'bg-primary/5' : ''}`}
                      onClick={() => openCandidate(cand.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => toggleSelectId(cand.id)}
                          className={[
                            'flex size-4 items-center justify-center rounded border',
                            checked
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input hover:border-primary/50',
                          ].join(' ')}
                        >
                          {checked && <Check className="size-2.5" />}
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{cand.full_name ?? '—'}</div>
                        <div className="text-xs text-muted-foreground">{cand.email ?? '—'}</div>
                      </TableCell>
                      <TableCell>
                        {cand.country ? (
                          <button
                            className={[
                              'text-sm',
                              filters.countries.includes(cand.country)
                                ? 'font-semibold text-foreground underline underline-offset-2'
                                : 'text-muted-foreground hover:text-foreground',
                            ].join(' ')}
                            onClick={(e) => {
                              e.stopPropagation()
                              const already = filters.countries.includes(cand.country!)
                              updateFilter(
                                'countries',
                                already
                                  ? filters.countries.filter((x) => x !== cand.country)
                                  : [...filters.countries, cand.country!]
                              )
                            }}
                          >
                            {cand.country}
                          </button>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="max-w-44 truncate text-sm text-muted-foreground">
                        {cand.positions ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm font-medium tabular-nums">
                        {formatSalary(cand.salary_expectation)}
                      </TableCell>
                      <TableCell>
                        <FitBadge status={cand.fit_status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateShort(cand.latest_submitted_at)}
                      </TableCell>
                      <TableCell className="text-center">
                        <button
                          type="button"
                          title={`${cand.notes_count ?? 0} note${(cand.notes_count ?? 0) !== 1 ? 's' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            openCandidate(cand.id, 'notes')
                          }}
                          className={[
                            'inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors hover:bg-accent',
                            (cand.notes_count ?? 0) > 0 ? 'text-primary' : 'text-muted-foreground',
                          ].join(' ')}
                        >
                          <MessageSquare className="size-3.5" />
                          {(cand.notes_count ?? 0) > 0 && <span>{cand.notes_count}</span>}
                        </button>
                      </TableCell>
                    </TableRow>
                  )
                })}
            {!loading && candidates.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  {activeFilterCount > 0 || q
                    ? 'No candidates match the current filters.'
                    : 'No candidates found.'}
                </TableCell>
              </TableRow>
            )}
            {/* Infinite scroll sentinel */}
            <TableRow ref={sentinelRef} className="border-0">
              {loadingMore && (
                <TableCell colSpan={8} className="py-3 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              )}
            </TableRow>
          </TableBody>
        </Table>

        {/* Bottom action bar — multi-select */}
        {selectedIds.size > 0 && (
          <div className="sticky bottom-0 left-0 right-0 border-t bg-background/95 px-4 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-foreground">
                {selectedIds.size} candidate{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
              <Separator orientation="vertical" className="h-5" />
              <span className="text-xs text-muted-foreground">Assign status:</span>
              {FIT_STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={bulkLoading}
                  onClick={() => assignFitStatus(opt.value)}
                  className={[
                    'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-opacity',
                    FIT_STATUS_STYLES[opt.value]?.badge ?? '',
                    bulkLoading ? 'opacity-50' : 'hover:opacity-80',
                  ].join(' ')}
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                disabled={bulkLoading}
                onClick={() => assignFitStatus(null)}
                className="inline-flex items-center rounded-full border border-input bg-background px-3 py-1 text-xs font-medium text-muted-foreground transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                Deselect
              </button>
            </div>
          </div>
        )}
      </CardContent>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col p-0 sm:max-w-3xl">
          {detailLoading || !selected ? (
            <div className="space-y-4 p-8">
              <div className="flex items-center gap-4">
                <Skeleton className="size-14 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-56" />
                </div>
              </div>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <CandidateDetailView
              detail={selected}
              activeTab={sheetTab}
              onTabChange={setSheetTab}
              currentUser={currentUser}
            />
          )}
        </SheetContent>
      </Sheet>
    </Card>
  )
}

function getInitials(name: string | null | undefined) {
  if (!name) return '?'
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'rejected', label: 'Rejected' },
] as const

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-slate-50 text-slate-700 border-slate-200',
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  reviewed: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  shortlisted: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  hired: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status?.toLowerCase()] ?? 'bg-muted text-muted-foreground border-border'
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

function CandidateDetailView({
  detail,
  activeTab,
  onTabChange,
  currentUser,
}: {
  detail: CandidateDetail
  activeTab: string
  onTabChange: (tab: string) => void
  currentUser: User
}) {
  const { applicant, applications } = detail
  const initials = getInitials(applicant.full_name)
  const [appStatuses, setAppStatuses] = useState<Map<number, string>>(
    () => new Map(applications.map((a) => [a.id, a.status]))
  )

  async function handleDetailStatusChange(appId: number, newStatus: string) {
    const prev = appStatuses.get(appId) ?? 'new'
    if (newStatus === prev) return
    setAppStatuses((m) => new Map(m).set(appId, newStatus))
    try {
      await updateApplicationStatus(appId, newStatus)
    } catch {
      setAppStatuses((m) => new Map(m).set(appId, prev))
    }
  }
  const linkedinHref = applicant.linkedin_url
    ? applicant.linkedin_url.startsWith('http')
      ? applicant.linkedin_url
      : `https://${applicant.linkedin_url}`
    : null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky header */}
      <div className="shrink-0 border-b bg-background px-6 pb-5 pt-6">
        <SheetHeader className="mb-0">
          <div className="flex items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <SheetTitle className="text-xl">{applicant.full_name ?? 'Candidate'}</SheetTitle>
                {applicant.fit_status && <FitBadge status={applicant.fit_status} />}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {applicant.email && (
                  <a
                    href={`mailto:${applicant.email}`}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Mail className="size-3" />
                    {applicant.email}
                  </a>
                )}
                {applicant.phone && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="size-3" />
                    {applicant.phone}
                  </span>
                )}
                {applicant.country && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Globe className="size-3" />
                    {applicant.country}
                  </span>
                )}
              </div>
              {linkedinHref && (
                <div className="mt-3">
                  <a
                    href={linkedinHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    <ExternalLink className="size-3" />
                    LinkedIn
                  </a>
                </div>
              )}
            </div>
          </div>
        </SheetHeader>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={onTabChange}
        className="flex flex-1 flex-col overflow-hidden gap-0"
      >
        <TabsList className="mx-6 my-3 shrink-0 w-fit">
          <TabsTrigger value="applications">
            Applications
            {applications.length > 1 && (
              <Badge variant="secondary" className="ml-1.5 px-1.5 text-xs">
                {applications.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="notes">
            <MessageSquare className="size-3.5" />
            Notes
            {(applicant.notes_count ?? 0) > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 text-xs">
                {applicant.notes_count}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="applications" className="mt-0 flex-1 overflow-y-auto px-6 pb-6">
          <div className="space-y-4">
            {applications.map((app, idx) => (
              <div key={app.id} className="overflow-hidden rounded-xl border">
                <div className="flex items-start justify-between bg-muted/40 px-5 py-4">
                  <div>
                    <div className="font-semibold">{app.position_title ?? 'Position'}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(app.submitted_at)}
                      {applications.length > 1 && (
                        <span className="ml-2 font-medium text-foreground/50">#{idx + 1}</span>
                      )}
                    </div>
                  </div>
                  <select
                    value={appStatuses.get(app.id) ?? app.status}
                    onChange={(e) => handleDetailStatusChange(app.id, e.target.value)}
                    className="h-7 cursor-pointer rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div className="divide-y">
                  {app.resume_url && (
                    <div className="px-5 py-3">
                      <a
                        href={app.resume_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 py-3 text-sm font-medium text-primary transition-colors hover:border-primary/60 hover:bg-primary/10"
                      >
                        <Download className="size-4" />
                        Open / Download CV
                      </a>
                    </div>
                  )}

                  {app.answers.length > 0 && (
                    <div className="px-5 py-4">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Application Form
                      </div>
                      <dl className="space-y-3">
                        {app.answers.map((a, i) => (
                          <div key={i} className="text-sm">
                            <dt className="mb-0.5 text-xs text-muted-foreground">{a.label}</dt>
                            <dd className="font-medium">
                              {/salary|maaş|maas|ücret|ucret|wage|compensation/i.test(a.label)
                                ? formatSalary(a.value)
                                : (a.value ?? '—')}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}

                  {app.cover_letter && (
                    <div className="px-5 py-4">
                      <div className="mb-2 flex items-center gap-1.5">
                        <FileText className="size-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Cover Letter
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                        {app.cover_letter}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="notes" className="mt-0 flex-1 overflow-y-auto px-6 pb-6">
          <NotesSection applicantId={applicant.id} currentUser={currentUser} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function NotesSection({ applicantId, currentUser }: { applicantId: number; currentUser: User }) {
  const [notes, setNotes] = useState<CandidateNote[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchNotes(applicantId)
      .then((n) => { if (!cancelled) setNotes(n) })
      .catch(() => { if (!cancelled) setNotes([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [applicantId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const note = await addNote(applicantId, text.trim(), currentUser.username, currentUser.fullName)
      setNotes((prev) => [note, ...prev])
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to add note')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(noteId: number) {
    try {
      await deleteNote(noteId)
      setNotes((prev) => prev.filter((n) => n.id !== noteId))
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-4 pt-1">
      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note…"
          rows={3}
          className={[
            'w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm',
            'ring-offset-background placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          ].join(' ')}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" size="sm" disabled={!text.trim() || submitting}>
          {submitting ? 'Adding…' : 'Add Note'}
        </Button>
      </form>

      <Separator />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div key={note.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-medium">{note.created_by_name}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{formatDate(note.created_at)}</span>
                </div>
                {note.created_by === currentUser.username && (
                  <button
                    type="button"
                    onClick={() => handleDelete(note.id)}
                    title="Delete note"
                    className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{note.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
