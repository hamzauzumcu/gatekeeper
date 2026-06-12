import { useEffect, useRef, useState } from 'react'
import {
  Search, ExternalLink, FileText, X, SlidersHorizontal, ChevronDown, ChevronLeft, ChevronRight, Check,
  Mail, Phone, Globe, Download, MessageSquare, Trash2, Columns3, Plus, Sparkles,
  GitBranch, AtSign,
} from 'lucide-react'
import {
  fetchCandidates,
  fetchCandidate,
  fetchFilterOptions,
  fetchQuestionColumns,
  loadSavedFilters,
  saveFilters,
  loadSavedColumns,
  saveColumns,
  formatDate,
  formatRelativeTime,
  formatSalary,
  updateApplicationStatus,
  updateApplicantsFitStatus,
  fetchNotes,
  addNote,
  deleteNote,
  FIT_STATUS_OPTIONS,
  getOpOptions,
  defaultOpForType,
  NO_VALUE_OPS,
  type CandidateListItem,
  type CandidateDetail,
  type CandidateNote,
  type FilterOptions,
  type ActiveFilters,
  type QuestionColumn,
  type AnswerFilter,
  type AnswerFilterOp,
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

function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-muted-foreground">—</span>
  const cls =
    score >= 75
      ? 'bg-green-50 text-green-700 border-green-200'
      : score >= 50
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-red-50 text-red-700 border-red-200'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${cls}`}>
      {score}
    </span>
  )
}

// Generic multi-select dropdown
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

// Column picker dropdown
function ColumnPicker({
  questionColumns,
  visibleIds,
  onChange,
}: {
  questionColumns: QuestionColumn[]
  visibleIds: number[]
  onChange: (ids: number[]) => void
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

  function toggle(id: number) {
    onChange(visibleIds.includes(id) ? visibleIds.filter((x) => x !== id) : [...visibleIds, id])
  }

  // Group by position
  const byPosition = questionColumns.reduce<Record<string, QuestionColumn[]>>((acc, q) => {
    const key = q.position_title
    if (!acc[key]) acc[key] = []
    acc[key].push(q)
    return acc
  }, {})

  const active = visibleIds.length > 0

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          'flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors',
          active
            ? 'border-primary bg-primary/5 font-medium text-primary'
            : 'border-input bg-background text-muted-foreground hover:text-foreground',
        ].join(' ')}
      >
        <Columns3 className="size-3.5 shrink-0" />
        Columns
        {active && (
          <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {visibleIds.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-96 overflow-hidden rounded-md border bg-popover shadow-md">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Question Columns
            </span>
            {visibleIds.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            )}
          </div>
          {questionColumns.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">No questions found</div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {Object.entries(byPosition).map(([posTitle, qs]) => (
                <div key={posTitle}>
                  <div className="sticky top-0 bg-muted/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                    {posTitle === 'AI Analysis' && <Sparkles className="size-3 text-violet-500" />}
                    {posTitle}
                  </div>
                  {qs.map((q) => {
                    const checked = visibleIds.includes(q.id)
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => toggle(q.id)}
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
                        <span className="flex-1 leading-snug">{q.label}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{q.type}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Single answer filter row
function AnswerFilterRow({
  filter,
  questionColumns,
  onChange,
  onRemove,
}: {
  filter: AnswerFilter
  questionColumns: QuestionColumn[]
  onChange: (f: AnswerFilter) => void
  onRemove: () => void
}) {
  const question = questionColumns.find((q) => q.id === filter.questionId)
  const opOptions = question ? getOpOptions(question.type) : []
  const noValue = NO_VALUE_OPS.has(filter.op as AnswerFilterOp)

  function handleQuestionChange(qIdStr: string) {
    const qId = Number(qIdStr)
    const q = questionColumns.find((c) => c.id === qId)
    const newOp = q ? defaultOpForType(q.type) : 'contains'
    onChange({ questionId: qId, op: newOp as AnswerFilterOp, value: '' })
  }

  function handleOpChange(op: string) {
    const newNoValue = NO_VALUE_OPS.has(op as AnswerFilterOp)
    onChange({ ...filter, op: op as AnswerFilterOp, value: newNoValue ? '' : filter.value })
  }

  const selectCls = [
    'h-8 rounded-md border border-input bg-background px-2 text-sm appearance-none cursor-pointer',
    'ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  ].join(' ')

  const chevron = (
    <svg className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )

  return (
    <div className="flex items-center gap-2">
      {/* Question select */}
      <div className="relative">
        <select
          value={filter.questionId || ''}
          onChange={(e) => handleQuestionChange(e.target.value)}
          className={`${selectCls} min-w-40 pr-7 font-medium`}
        >
          <option value="" disabled>Select field…</option>
          {questionColumns.map((q) => (
            <option key={q.id} value={q.id}>{q.label}</option>
          ))}
        </select>
        {chevron}
      </div>

      {/* Operator select */}
      <div className="relative">
        <select
          value={filter.op}
          onChange={(e) => handleOpChange(e.target.value)}
          className={`${selectCls} min-w-32 pr-7`}
        >
          {opOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {chevron}
      </div>

      {/* Value input */}
      {!noValue && (
        <input
          type={question?.type === 'number' ? 'number' : 'text'}
          value={filter.value}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          placeholder="value…"
          className={[
            'h-8 w-28 rounded-md border border-input bg-background px-2 text-sm',
            'ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          ].join(' ')}
        />
      )}

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export default function CandidatesPage() {
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<ActiveFilters>(loadSavedFilters)
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ countries: [], positions: [] })
  const [questionColumns, setQuestionColumns] = useState<QuestionColumn[]>([])
  const [visibleQuestionIds, setVisibleQuestionIds] = useState<number[]>(loadSavedColumns)

  const PAGE_SIZE = 50

  const [candidates, setCandidates] = useState<CandidateListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exitingIds, setExitingIds] = useState<Set<number>>(new Set())
  const sentinelRef = useRef<HTMLTableRowElement>(null)

  const currentUser = getUser()!

  const [selected, setSelected] = useState<CandidateDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [sheetTab, setSheetTab] = useState('applications')
  const [openedIndex, setOpenedIndex] = useState(-1)

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; candId: number; candName: string } | null>(null)
  const [ctxNote, setCtxNote] = useState('')
  const [ctxNoteSubmitting, setCtxNoteSubmitting] = useState(false)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // All extra col IDs to request = visible columns + answer filter question IDs
  const extraColIds = Array.from(
    new Set([...visibleQuestionIds, ...filters.answerFilters.map((f) => f.questionId).filter(Boolean)])
  )

  useEffect(() => {
    fetchFilterOptions().then(setFilterOptions).catch(() => {})
    fetchQuestionColumns().then(setQuestionColumns).catch(() => {})
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    function handleClick(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
        setCtxNote('')
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setContextMenu(null); setCtxNote('') }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  // Reset + initial load when query, filters, or visible columns change
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true)
      setError(null)
      setCandidates([])
      setOffset(0)
      setHasMore(false)
      setSelectedIds(new Set())
      fetchCandidates(q, filters, extraColIds, 0, PAGE_SIZE)
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
  }, [q, filters, visibleQuestionIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          setLoadingMore(true)
          fetchCandidates(q, filters, extraColIds, offset, PAGE_SIZE)
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
  }, [hasMore, loadingMore, loading, offset, q, filters, visibleQuestionIds]) // eslint-disable-line react-hooks/exhaustive-deps

  function updateFilter<K extends keyof ActiveFilters>(key: K, value: ActiveFilters[K]) {
    const next = { ...filters, [key]: value }
    setFilters(next)
    saveFilters(next)
  }

  function clearFilters() {
    const cleared: ActiveFilters = { countries: [], position: '', fit_statuses: [], answerFilters: [], min_score: '', max_score: '' }
    setFilters(cleared)
    saveFilters(cleared)
  }

  function updateVisibleColumns(ids: number[]) {
    setVisibleQuestionIds(ids)
    saveColumns(ids)
  }

  function addAnswerFilter() {
    if (questionColumns.length === 0) return
    const col = questionColumns[0]
    const newFilter: AnswerFilter = {
      questionId: col.id,
      op: defaultOpForType(col.type),
      value: '',
    }
    updateFilter('answerFilters', [...filters.answerFilters, newFilter])
  }

  function updateAnswerFilter(i: number, f: AnswerFilter) {
    updateFilter('answerFilters', filters.answerFilters.map((x, idx) => (idx === i ? f : x)))
  }

  function removeAnswerFilter(i: number) {
    updateFilter('answerFilters', filters.answerFilters.filter((_, idx) => idx !== i))
  }

  function openCandidate(id: number, tab = 'applications', idx = -1) {
    setOpenedIndex(idx)
    setSheetTab(tab)
    setOpen(true)
    setSelected(null)
    setDetailLoading(true)
    fetchCandidate(id)
      .then(setSelected)
      .catch(() => setSelected(null))
      .finally(() => setDetailLoading(false))
  }

  function navigateSheet(dir: -1 | 1) {
    const newIdx = openedIndex + dir
    if (newIdx < 0 || newIdx >= candidates.length) return
    openCandidate(candidates[newIdx].id, sheetTab, newIdx)
  }

  async function handleSheetFitStatus(fitStatus: string | null) {
    if (!selected) return
    const candId = selected.applicant.id
    const willExit =
      filters.fit_statuses.length > 0 &&
      (fitStatus === null || !filters.fit_statuses.includes(fitStatus))
    setCandidates((prev) => prev.map((c) => (c.id === candId ? { ...c, fit_status: fitStatus } : c)))
    if (willExit && openedIndex >= 0) {
      const nextCand = openedIndex + 1 < candidates.length ? candidates[openedIndex + 1] : null
      const prevCand = openedIndex > 0 ? candidates[openedIndex - 1] : null
      const target = nextCand ?? prevCand
      if (target) {
        // post-removal the successor slides down by 1 if we went forward
        openCandidate(target.id, sheetTab, nextCand ? openedIndex : openedIndex - 1)
      } else {
        setOpen(false)
      }
      setExitingIds((prev) => new Set([...prev, candId]))
      setTimeout(() => {
        setCandidates((prev) => prev.filter((c) => c.id !== candId))
        setExitingIds((prev) => { const next = new Set(prev); next.delete(candId); return next })
      }, 350)
    }
    try {
      await updateApplicantsFitStatus([candId], fitStatus)
    } catch {
      setCandidates((prev) => prev.map((c) => (c.id === candId ? { ...c, fit_status: null } : c)))
    }
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
    const willExit = filters.fit_statuses.length > 0 && (fitStatus === null || !filters.fit_statuses.includes(fitStatus))
    const exitIds = willExit ? [...selectedIds] : []
    setBulkLoading(true)
    try {
      await updateApplicantsFitStatus([...selectedIds], fitStatus)
      setCandidates((prev) =>
        prev.map((c) => (selectedIds.has(c.id) ? { ...c, fit_status: fitStatus } : c))
      )
      setSelectedIds(new Set())
      if (willExit && exitIds.length > 0) {
        setExitingIds(new Set(exitIds))
        setTimeout(() => {
          setCandidates((prev) => prev.filter((c) => !exitIds.includes(c.id)))
          setExitingIds(new Set())
        }, 350)
      }
    } catch {
      // silent
    } finally {
      setBulkLoading(false)
    }
  }

  async function assignSingleFitStatus(candId: number, fitStatus: string | null) {
    const willExit = filters.fit_statuses.length > 0 && (fitStatus === null || !filters.fit_statuses.includes(fitStatus))
    try {
      await updateApplicantsFitStatus([candId], fitStatus)
      setCandidates((prev) => prev.map((c) => (c.id === candId ? { ...c, fit_status: fitStatus } : c)))
      if (willExit) {
        setExitingIds((prev) => new Set([...prev, candId]))
        setTimeout(() => {
          setCandidates((prev) => prev.filter((c) => c.id !== candId))
          setExitingIds((prev) => { const next = new Set(prev); next.delete(candId); return next })
        }, 350)
      }
    } catch {
      // silent
    }
    setContextMenu(null)
  }

  async function submitQuickNote(candId: number) {
    if (!ctxNote.trim()) return
    setCtxNoteSubmitting(true)
    try {
      await addNote(candId, ctxNote.trim(), currentUser.username, currentUser.fullName)
      setCandidates((prev) => prev.map((c) => (c.id === candId ? { ...c, notes_count: (c.notes_count ?? 0) + 1 } : c)))
      setCtxNote('')
      setContextMenu(null)
    } catch {
      // silent
    } finally {
      setCtxNoteSubmitting(false)
    }
  }

  const activeFilterCount =
    (filters.countries.length > 0 ? 1 : 0) +
    (filters.position ? 1 : 0) +
    (filters.fit_statuses.length > 0 ? 1 : 0) +
    filters.answerFilters.length +
    (filters.min_score || filters.max_score ? 1 : 0)

  const allSelected = candidates.length > 0 && selectedIds.size === candidates.length
  const someSelected = selectedIds.size > 0 && !allSelected

  const countryOptions = filterOptions.countries.map((c) => ({ value: c, label: c }))

  // Ordered visible question columns
  const visibleQuestions = visibleQuestionIds
    .map((id) => questionColumns.find((q) => q.id === id))
    .filter(Boolean) as QuestionColumn[]

  const totalCols = 9 + visibleQuestions.length

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

          <div className="flex flex-wrap items-center gap-2">
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
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                type="number"
                min="0"
                max="100"
                placeholder="min"
                value={filters.min_score}
                onChange={(e) => updateFilter('min_score', e.target.value)}
                className={[
                  'h-9 w-16 rounded-md border border-input bg-background px-2 text-sm tabular-nums',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  filters.min_score ? 'font-medium text-foreground' : 'text-muted-foreground',
                ].join(' ')}
              />
              <span className="text-xs text-muted-foreground">–</span>
              <input
                type="number"
                min="0"
                max="100"
                placeholder="max"
                value={filters.max_score}
                onChange={(e) => updateFilter('max_score', e.target.value)}
                className={[
                  'h-9 w-16 rounded-md border border-input bg-background px-2 text-sm tabular-nums',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  filters.max_score ? 'font-medium text-foreground' : 'text-muted-foreground',
                ].join(' ')}
              />
            </div>
            <ColumnPicker
              questionColumns={questionColumns}
              visibleIds={visibleQuestionIds}
              onChange={updateVisibleColumns}
            />
            {questionColumns.length > 0 && (
              <button
                type="button"
                onClick={addAnswerFilter}
                className="flex h-9 items-center gap-1.5 rounded-md border border-dashed border-input bg-background px-3 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
              >
                <Plus className="size-3.5" />
                Add filter
              </button>
            )}
          </div>
        </div>

        {/* Answer filter rows */}
        {filters.answerFilters.length > 0 && (
          <div className="mt-2 flex flex-col gap-2 pl-1">
            {filters.answerFilters.map((f, i) => (
              <AnswerFilterRow
                key={i}
                filter={f}
                questionColumns={questionColumns}
                onChange={(updated) => updateAnswerFilter(i, updated)}
                onRemove={() => removeAnswerFilter(i)}
              />
            ))}
          </div>
        )}

        {/* Active filter tags (country, position, fit_status, score) */}
        {(filters.countries.length > 0 || filters.position || filters.fit_statuses.length > 0 || filters.min_score || filters.max_score) && (
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
            {(filters.min_score || filters.max_score) && (
              <Badge variant="secondary" className="gap-1 pr-1">
                Score {filters.min_score || '0'}–{filters.max_score || '100'}
                <button
                  onClick={() => { updateFilter('min_score', ''); updateFilter('max_score', '') }}
                  className="ml-0.5 rounded-sm opacity-60 hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="relative pb-0 overflow-x-auto">
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
              <TableHead className="w-20 text-center">
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="size-3 text-muted-foreground" />
                  Score
                </span>
              </TableHead>
              <TableHead>Apply date</TableHead>
              {visibleQuestions.map((q) => (
                <TableHead key={q.id} className="max-w-40">
                  <span className="block truncate" title={q.label}>{q.label}</span>
                </TableHead>
              ))}
              <TableHead className="w-10 text-center">Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: totalCols }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : candidates.map((cand, idx) => {
                  const checked = selectedIds.has(cand.id)
                  return (
                    <TableRow
                      key={cand.id}
                      className={`cursor-pointer transition-opacity duration-300 ${checked ? 'bg-primary/5' : ''} ${exitingIds.has(cand.id) ? 'opacity-0' : ''}`}
                      onClick={() => openCandidate(cand.id, 'applications', idx)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setCtxNote('')
                        setContextMenu({ x: e.clientX, y: e.clientY, candId: cand.id, candName: cand.full_name ?? '' })
                      }}
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
                      <TableCell className="text-center">
                        <ScoreBadge score={cand.ai_score} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <span title={formatDate(cand.latest_submitted_at)}>
                          {formatRelativeTime(cand.latest_submitted_at)}
                        </span>
                      </TableCell>
                      {visibleQuestions.map((q) => (
                        <TableCell key={q.id} className="max-w-40 text-sm text-muted-foreground">
                          <span className="block truncate" title={cand.extra_answers?.[String(q.id)] ?? undefined}>
                            {cand.extra_answers?.[String(q.id)] ?? '—'}
                          </span>
                        </TableCell>
                      ))}
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
                <TableCell colSpan={totalCols} className="text-center text-muted-foreground">
                  {activeFilterCount > 0 || q
                    ? 'No candidates match the current filters.'
                    : 'No candidates found.'}
                </TableCell>
              </TableRow>
            )}
            {/* Infinite scroll sentinel */}
            <TableRow ref={sentinelRef} className="border-0">
              {loadingMore && (
                <TableCell colSpan={totalCols} className="py-3 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              )}
            </TableRow>
          </TableBody>
        </Table>

        {/* Floating bulk pill — multi-select */}
        {selectedIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-2xl border bg-background/95 px-4 py-2.5 shadow-xl backdrop-blur">
              <span className="text-sm font-medium text-foreground whitespace-nowrap">
                {selectedIds.size} candidate{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">Assign:</span>
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
              <Separator orientation="vertical" className="h-4" />
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </CardContent>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-52 overflow-hidden rounded-xl border bg-popover shadow-xl"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <div className="border-b px-3 py-2">
            <p className="text-xs font-medium truncate max-w-48">{contextMenu.candName}</p>
          </div>
          <div className="p-1.5">
            <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Status</p>
            {FIT_STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => assignSingleFitStatus(contextMenu.candId, opt.value)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
              >
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${FIT_STATUS_STYLES[opt.value]?.badge ?? ''}`}>
                  {opt.label}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => assignSingleFitStatus(contextMenu.candId, null)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            >
              Clear status
            </button>
          </div>
          <div className="border-t p-1.5">
            <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Quick Note</p>
            <div className="px-2 pb-1.5 flex flex-col gap-1.5">
              <textarea
                autoFocus={false}
                rows={2}
                value={ctxNote}
                onChange={(e) => setCtxNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitQuickNote(contextMenu.candId)
                }}
                placeholder="Add a note… (⌘↵ to save)"
                className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                disabled={!ctxNote.trim() || ctxNoteSubmitting}
                onClick={() => submitQuickNote(contextMenu.candId)}
                className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {ctxNoteSubmitting ? 'Saving…' : 'Save Note'}
              </button>
            </div>
          </div>
        </div>
      )}

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
              onFitStatus={handleSheetFitStatus}
              onNavigate={navigateSheet}
              hasPrev={openedIndex > 0}
              hasNext={openedIndex >= 0 && openedIndex < candidates.length - 1}
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

function CandidateDetailView({
  detail,
  activeTab,
  onTabChange,
  currentUser,
  onFitStatus,
  onNavigate,
  hasPrev,
  hasNext,
}: {
  detail: CandidateDetail
  activeTab: string
  onTabChange: (tab: string) => void
  currentUser: User
  onFitStatus: (status: string | null) => void
  onNavigate: (dir: -1 | 1) => void
  hasPrev: boolean
  hasNext: boolean
}) {
  const { applicant, applications } = detail
  const initials = getInitials(applicant.full_name)
  const [appStatuses, setAppStatuses] = useState<Map<number, string>>(
    () => new Map(applications.map((a) => [a.id, a.status]))
  )
  const [fitStatus, setFitStatus] = useState<string | null>(applicant.fit_status ?? null)

  useEffect(() => {
    setFitStatus(applicant.fit_status ?? null)
  }, [applicant.id])

  function handleFitClick(status: string) {
    const next = fitStatus === status ? null : status
    setFitStatus(next)
    onFitStatus(next)
  }

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

  const firstResumeUrl = applications.find((a) => a.resume_url)?.resume_url ?? null

  // Personal links: LinkedIn from the applicant record + everything extracted from the CVs, deduped.
  const linkButtons: { type: string; url: string }[] = []
  const seenLinks = new Set<string>()
  const pushLink = (type: string, raw: string | null | undefined) => {
    if (!raw || !raw.trim()) return
    const url = raw.startsWith('http') ? raw : `https://${raw}`
    const key = url.replace(/\/+$/, '').toLowerCase()
    if (seenLinks.has(key)) return
    seenLinks.add(key)
    linkButtons.push({ type, url })
  }
  pushLink('linkedin', linkedinHref)
  for (const a of applications) {
    if (!a.resume_parsed) continue
    let parsed: { links?: { type?: string; url?: string }[] }
    try { parsed = JSON.parse(a.resume_parsed) } catch { continue }
    for (const l of parsed.links ?? []) {
      pushLink((l.type ?? 'other').toLowerCase(), l.url)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky header */}
      <div className="shrink-0 border-b bg-background px-4 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
        <SheetHeader className="mb-0">
          <div className="flex items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <SheetTitle className="text-xl">{applicant.full_name ?? 'Candidate'}</SheetTitle>
                {fitStatus && <FitBadge status={fitStatus} />}
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
              {(linkedinHref || firstResumeUrl) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {linkedinHref && (
                    <a
                      href={linkedinHref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                      <ExternalLink className="size-3" />
                      LinkedIn
                    </a>
                  )}
                  {firstResumeUrl && (
                    <a
                      href={firstResumeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                      <Download className="size-3" />
                      CV
                    </a>
                  )}
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
        <TabsList className="mx-4 my-3 shrink-0 w-fit sm:mx-6">
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

        <TabsContent value="applications" className="mt-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6">
          <div className="space-y-4">
            {applications.map((app, idx) => (
              <div key={app.id} className="overflow-hidden rounded-xl border">
                <div className="flex items-start justify-between bg-muted/40 px-4 py-3 sm:px-5 sm:py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{app.position_title ?? 'Position'}</span>
                      {app.ai_score != null && <ScoreBadge score={app.ai_score} />}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(app.submitted_at)}
                      {applications.length > 1 && (
                        <span className="ml-2 font-medium text-foreground/50">#{idx + 1}</span>
                      )}
                    </div>
                    {app.ai_score_reasoning && (
                      <p className="mt-1.5 text-xs text-muted-foreground max-w-prose leading-relaxed">
                        {app.ai_score_reasoning}
                      </p>
                    )}
                  </div>
                </div>

                <div className="divide-y">

                  {app.resume_parse_version > 0 && app.resume_parsed && (() => {
                    let p: Record<string, unknown>
                    try { p = JSON.parse(app.resume_parsed) } catch { return null }
                    const edu = (p.education as { school?: string; degree?: string; year?: number | null; gpa?: string | null }[] | undefined) ?? []
                    const work = (p.work_history as { company?: string; role?: string; start?: string | null; end?: string | null; months?: number | null }[] | undefined) ?? []
                    const languages = (p.languages as string[] | undefined) ?? []
                    const summary = typeof p.summary === 'string' ? p.summary : null
                    const seniority = typeof p.seniority === 'string' ? p.seniority : null
                    const location = typeof p.location === 'string' ? p.location : null
                    const avgTenure = typeof p.avg_tenure_months === 'number' ? p.avg_tenure_months : null
                    return (
                      <div className="px-4 py-4 sm:px-5">
                        <div className="mb-3 flex items-center gap-1.5">
                          <Sparkles className="size-3.5 text-violet-500" />
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Analysis</span>
                        </div>
                        {summary && (
                          <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm leading-relaxed text-foreground/90">
                            {summary}
                          </div>
                        )}
                        <dl className="space-y-3">
                          {(p.total_experience_years as number | null) != null && (
                            <div className="text-sm">
                              <dt className="mb-0.5 text-xs text-muted-foreground">Experience</dt>
                              <dd className="font-medium">{p.total_experience_years as number} years</dd>
                            </div>
                          )}
                          {seniority && (
                            <div className="text-sm">
                              <dt className="mb-0.5 text-xs text-muted-foreground">Seniority</dt>
                              <dd className="font-medium capitalize">{seniority}</dd>
                            </div>
                          )}
                          {location && (
                            <div className="text-sm">
                              <dt className="mb-0.5 text-xs text-muted-foreground">Location</dt>
                              <dd className="font-medium">{location}</dd>
                            </div>
                          )}
                          {avgTenure != null && (
                            <div className="text-sm">
                              <dt className="mb-0.5 text-xs text-muted-foreground">Avg Tenure</dt>
                              <dd className="font-medium">{avgTenure} months</dd>
                            </div>
                          )}
                          {edu.length > 0 && (
                            <div className="text-sm">
                              <dt className="mb-0.5 text-xs text-muted-foreground">Education</dt>
                              {edu.map((e, i) => (
                                <dd key={i} className="font-medium">
                                  {e.school ?? '—'}{e.degree ? ` · ${e.degree}` : ''}{e.year ? ` (${e.year})` : ''}
                                  {e.gpa ? <span className="text-muted-foreground font-normal"> · GPA {e.gpa}</span> : ''}
                                </dd>
                              ))}
                            </div>
                          )}
                          {work.length > 0 && (
                            <div className="text-sm">
                              <dt className="mb-0.5 text-xs text-muted-foreground">Work History</dt>
                              <dd className="space-y-1.5 mt-0.5">
                                {work.map((w, i) => (
                                  <div key={i} className="leading-snug">
                                    <span className="font-medium">{w.role ?? '—'}</span>
                                    {w.company && <span className="text-muted-foreground"> · {w.company}</span>}
                                    {(w.start || w.months) && (
                                      <div className="text-xs text-muted-foreground">
                                        {w.start}{w.end ? ` – ${w.end}` : w.start ? ' – present' : ''}
                                        {w.months ? ` (${w.months} mo)` : ''}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </dd>
                            </div>
                          )}
                          {languages.length > 0 && (
                            <div className="text-sm">
                              <dt className="mb-1 text-xs text-muted-foreground">Languages</dt>
                              <dd className="flex flex-wrap gap-1">
                                {languages.map((l, i) => (
                                  <span key={i} className="rounded-md bg-muted px-1.5 py-0.5 text-xs">{l}</span>
                                ))}
                              </dd>
                            </div>
                          )}
                        </dl>
                      </div>
                    )
                  })()}

                  {app.answers.length > 0 && (
                    <div className="px-4 py-4 sm:px-5">
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
                    <div className="px-4 py-4 sm:px-5">
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

        <TabsContent value="notes" className="mt-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6">
          <NotesSection applicantId={applicant.id} currentUser={currentUser} />
        </TabsContent>
      </Tabs>

      {/* Bottom action bar — fit status + prev/next navigation */}
      <div className="shrink-0 border-t bg-background px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate(-1)}
            disabled={!hasPrev}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
            aria-label="Previous candidate"
          >
            <ChevronLeft className="size-4" />
          </button>

          <div className="flex flex-1 gap-1.5">
            {(['good_fit', 'maybe', 'not_fit'] as const).map((s) => {
              const active = fitStatus === s
              const styles = {
                good_fit: active
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-input text-muted-foreground hover:border-green-300 hover:bg-green-50/60 hover:text-green-700',
                maybe: active
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-input text-muted-foreground hover:border-amber-300 hover:bg-amber-50/60 hover:text-amber-700',
                not_fit: active
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-input text-muted-foreground hover:border-red-300 hover:bg-red-50/60 hover:text-red-700',
              }
              const labels = { good_fit: 'Good Fit', maybe: 'Maybe', not_fit: 'Not Fit' }
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleFitClick(s)}
                  className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${styles[s]}`}
                >
                  {labels[s]}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => onNavigate(1)}
            disabled={!hasNext}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
            aria-label="Next candidate"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
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
