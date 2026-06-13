import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Search, ExternalLink, FileText, X, SlidersHorizontal, ChevronDown, ChevronLeft, ChevronRight, Check,
  Mail, Phone, Globe, MessageSquare, Trash2, Pencil, Columns3, Plus, Sparkles,
  GitBranch, AtSign, ArrowUp, ArrowDown, ArrowUpDown,
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
  loadSavedSort,
  saveSort,
  type SortState,
  BASE_COLUMNS,
  loadHiddenBaseColumns,
  saveHiddenBaseColumns,
  formatDate,
  formatRelativeTime,
  formatSalary,
  normalizeSalary,
  updateAnswerValue,
  fetchFxRates,
  estimateUsdSalary,
  type FxRates,
  updateApplicationStatus,
  updateApplicantsFitStatus,
  fetchNotes,
  addNote,
  updateNote,
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
  type BaseColumnKey,
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
  SheetClose,
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

// All filter kinds (besides per-question answer filters) that can be added
const FIXED_FILTER_KINDS = [
  { key: 'country', label: 'Country' },
  { key: 'position', label: 'Position' },
  { key: 'status', label: 'Status' },
  { key: 'score', label: 'Score' },
] as const

// Shared checkbox list used inside multi-value filter chips
function OptionCheckList({
  options,
  values,
  onToggle,
}: {
  options: { value: string; label: string }[]
  values: string[]
  onToggle: (v: string) => void
}) {
  if (options.length === 0) {
    return <div className="px-2 py-1.5 text-sm text-muted-foreground">No options</div>
  }
  return (
    <div className="max-h-64 overflow-y-auto">
      {options.map((o) => {
        const checked = values.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onToggle(o.value)}
            className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
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
    </div>
  )
}

// A single active filter rendered as a removable chip with an editor popover.
// Open state is lifted to the parent so only one chip popover is open at a time.
function FilterChip({
  id,
  openChip,
  setOpenChip,
  label,
  summary,
  onRemove,
  children,
}: {
  id: string
  openChip: string | null
  setOpenChip: (id: string | null) => void
  label: string
  summary: string | null
  onRemove: () => void
  children: ReactNode
}) {
  const open = openChip === id
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenChip(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open, setOpenChip])

  const hasValue = summary != null

  return (
    <div ref={ref} className="relative">
      <div
        className={[
          'flex h-8 items-center rounded-md border text-sm transition-colors',
          hasValue ? 'border-primary/40 bg-primary/5' : 'border-input bg-background',
        ].join(' ')}
      >
        <button
          type="button"
          onClick={() => setOpenChip(open ? null : id)}
          className="flex h-full min-w-0 items-center gap-1.5 rounded-l-md pl-2.5 pr-1.5"
        >
          <span className="shrink-0 text-muted-foreground">{label}</span>
          <span
            className={[
              'truncate max-w-[40vw] sm:max-w-[16rem]',
              hasValue ? 'font-medium text-foreground' : 'text-muted-foreground/70',
            ].join(' ')}
          >
            {summary ?? 'Any'}
          </span>
          <ChevronDown
            className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-full items-center rounded-r-md pl-1 pr-2 text-muted-foreground hover:text-foreground"
          aria-label={`Remove ${label} filter`}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 z-50 mt-1 min-w-52 rounded-md border bg-popover p-1 shadow-md">
          {children}
        </div>
      )}
    </div>
  )
}

// "+ Add filter" menu listing every filter kind that isn't active yet
function AddFilterMenu({
  availableKinds,
  questionColumns,
  onAddKind,
  onAddAnswer,
}: {
  availableKinds: { key: string; label: string }[]
  questionColumns: QuestionColumn[]
  onAddKind: (key: string) => void
  onAddAnswer: (questionId: number) => void
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

  // Group questions by position (mirrors ColumnPicker)
  const byPosition = questionColumns.reduce<Record<string, QuestionColumn[]>>((acc, q) => {
    const key = q.position_title
    if (!acc[key]) acc[key] = []
    acc[key].push(q)
    return acc
  }, {})

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-dashed border-input bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <Plus className="size-3.5" />
        Add filter
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1 w-64 overflow-hidden rounded-md border bg-popover shadow-md">
          <div className="max-h-80 overflow-y-auto p-1">
            {availableKinds.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => { onAddKind(k.key); setOpen(false) }}
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                {k.label}
              </button>
            ))}
            {questionColumns.length > 0 && (
              <>
                {availableKinds.length > 0 && <div className="my-1 border-t" />}
                {Object.entries(byPosition).map(([posTitle, qs]) => (
                  <div key={posTitle}>
                    <div className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {posTitle === 'AI Analysis' && <Sparkles className="size-3 text-violet-500" />}
                      {posTitle}
                    </div>
                    {qs.map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => { onAddAnswer(q.id); setOpen(false) }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <span className="flex-1 truncate">{q.label}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{q.type}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Column picker dropdown
function ColumnPicker({
  questionColumns,
  visibleIds,
  onChange,
  hiddenBaseColumns,
  onToggleBase,
  onResetBase,
}: {
  questionColumns: QuestionColumn[]
  visibleIds: number[]
  onChange: (ids: number[]) => void
  hiddenBaseColumns: BaseColumnKey[]
  onToggleBase: (key: BaseColumnKey) => void
  onResetBase: () => void
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

  const customizedCount = visibleIds.length + hiddenBaseColumns.length
  const active = customizedCount > 0

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
        <span className="hidden sm:inline">Columns</span>
        {active && (
          <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {customizedCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-md border bg-popover shadow-md">
          {/* Default columns — always available, can be shown/hidden */}
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Default Columns
            </span>
            {hiddenBaseColumns.length > 0 && (
              <button
                type="button"
                onClick={onResetBase}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Reset
              </button>
            )}
          </div>
          <div className="border-b">
            {BASE_COLUMNS.map((c) => {
              const checked = !hiddenBaseColumns.includes(c.key)
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onToggleBase(c.key)}
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
                  <span className="flex-1 leading-snug">{c.label}</span>
                </button>
              )
            })}
          </div>

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

// Editor body for an answer (question) filter, shown inside a FilterChip popover
function AnswerFilterEditor({
  filter,
  questionColumns,
  onChange,
}: {
  filter: AnswerFilter
  questionColumns: QuestionColumn[]
  onChange: (f: AnswerFilter) => void
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
    'h-8 w-full rounded-md border border-input bg-background px-2 pr-7 text-sm appearance-none cursor-pointer',
    'ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  ].join(' ')

  const chevron = (
    <svg className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )

  return (
    <div className="flex w-56 flex-col gap-2 p-1.5">
      {/* Question select */}
      <div className="relative">
        <select
          value={filter.questionId || ''}
          onChange={(e) => handleQuestionChange(e.target.value)}
          className={`${selectCls} font-medium`}
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
        <select value={filter.op} onChange={(e) => handleOpChange(e.target.value)} className={selectCls}>
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
            'h-8 w-full rounded-md border border-input bg-background px-2 text-sm',
            'ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          ].join(' ')}
        />
      )}
    </div>
  )
}

// Clickable table header that drives column sorting. Cycles desc → asc → off.
function SortHeader({
  label,
  sortKey,
  numeric,
  sort,
  onSort,
  className,
  children,
}: {
  label: string
  sortKey: string
  numeric: boolean
  sort: SortState | null
  onSort: (key: string, numeric: boolean) => void
  className?: string
  children?: ReactNode
}) {
  const active = sort?.key === sortKey
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey, numeric)}
        className="group inline-flex items-center gap-1 transition-colors hover:text-foreground"
        title={`Sort by ${label}`}
      >
        {children ?? label}
        {active ? (
          sort!.dir === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />
        ) : (
          <ArrowUpDown className="size-3 opacity-0 transition-opacity group-hover:opacity-40" />
        )}
      </button>
    </TableHead>
  )
}

export default function CandidatesPage() {
  const [q, setQ] = useState('')
  const [searchOpen, setSearchOpen] = useState(false) // mobile: search field hidden until toggled
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [filters, setFilters] = useState<ActiveFilters>(loadSavedFilters)
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ countries: [], positions: [] })
  const [questionColumns, setQuestionColumns] = useState<QuestionColumn[]>([])
  const [visibleQuestionIds, setVisibleQuestionIds] = useState<number[]>(loadSavedColumns)
  const [hiddenBaseColumns, setHiddenBaseColumns] = useState<BaseColumnKey[]>(loadHiddenBaseColumns)
  const isBaseVisible = (key: BaseColumnKey) => !hiddenBaseColumns.includes(key)
  const [sort, setSort] = useState<SortState | null>(loadSavedSort)

  // Which fixed-filter chips are shown (a chip can be visible before it has a value).
  // Initialized from saved filters so persisted values reappear as chips on reload.
  const [shownKinds, setShownKinds] = useState<Set<string>>(() => {
    const s = new Set<string>()
    const f = loadSavedFilters()
    if (f.countries.length) s.add('country')
    if (f.position) s.add('position')
    if (f.fit_statuses.length) s.add('status')
    if (f.min_score || f.max_score) s.add('score')
    return s
  })
  // Id of the chip whose editor popover is currently open (only one at a time).
  const [openChip, setOpenChip] = useState<string | null>(null)

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
      fetchCandidates(q, filters, extraColIds, 0, PAGE_SIZE, sort)
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
  }, [q, filters, visibleQuestionIds, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          setLoadingMore(true)
          fetchCandidates(q, filters, extraColIds, offset, PAGE_SIZE, sort)
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
  }, [hasMore, loadingMore, loading, offset, q, filters, visibleQuestionIds, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  function updateFilter<K extends keyof ActiveFilters>(key: K, value: ActiveFilters[K]) {
    const next = { ...filters, [key]: value }
    setFilters(next)
    saveFilters(next)
  }

  function clearFilters() {
    const cleared: ActiveFilters = { countries: [], position: '', fit_statuses: [], answerFilters: [], min_score: '', max_score: '' }
    setFilters(cleared)
    saveFilters(cleared)
    setShownKinds(new Set())
    setOpenChip(null)
  }

  function updateVisibleColumns(ids: number[]) {
    setVisibleQuestionIds(ids)
    saveColumns(ids)
  }

  // Cycle a column's sort: none → desc → asc → none (back to default order).
  function toggleSort(key: string, numeric: boolean) {
    setSort((prev) => {
      const next: SortState | null =
        !prev || prev.key !== key
          ? { key, dir: 'desc', numeric }
          : prev.dir === 'desc'
            ? { key, dir: 'asc', numeric }
            : null
      saveSort(next)
      return next
    })
  }

  function toggleBaseColumn(key: BaseColumnKey) {
    const next = hiddenBaseColumns.includes(key)
      ? hiddenBaseColumns.filter((k) => k !== key)
      : [...hiddenBaseColumns, key]
    setHiddenBaseColumns(next)
    saveHiddenBaseColumns(next)
  }

  function resetBaseColumns() {
    setHiddenBaseColumns([])
    saveHiddenBaseColumns([])
  }

  // Show a fixed-filter chip and immediately open its editor so the user can pick a value.
  function addFilterKind(key: string) {
    setShownKinds((prev) => new Set(prev).add(key))
    setOpenChip(key)
  }

  // Hide a fixed-filter chip and clear whatever value it held.
  function removeFilterKind(key: string) {
    setShownKinds((prev) => { const next = new Set(prev); next.delete(key); return next })
    setOpenChip(null)
    if (key === 'country') updateFilter('countries', [])
    else if (key === 'position') updateFilter('position', '')
    else if (key === 'status') updateFilter('fit_statuses', [])
    else if (key === 'score') {
      const next = { ...filters, min_score: '', max_score: '' }
      setFilters(next)
      saveFilters(next)
    }
  }

  // Add an answer filter for a specific question and open its editor.
  function addAnswerFilterFor(questionId: number) {
    const col = questionColumns.find((c) => c.id === questionId)
    if (!col) return
    const newFilter: AnswerFilter = {
      questionId: col.id,
      op: defaultOpForType(col.type),
      value: '',
    }
    const idx = filters.answerFilters.length
    updateFilter('answerFilters', [...filters.answerFilters, newFilter])
    setOpenChip(`answer:${idx}`)
  }

  function updateAnswerFilter(i: number, f: AnswerFilter) {
    updateFilter('answerFilters', filters.answerFilters.map((x, idx) => (idx === i ? f : x)))
  }

  function removeAnswerFilter(i: number) {
    updateFilter('answerFilters', filters.answerFilters.filter((_, idx) => idx !== i))
    setOpenChip(null)
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

  const totalCols = 9 - hiddenBaseColumns.length + visibleQuestions.length

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

        {/* Search + Columns */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Mobile: search hidden until this button is tapped. Desktop: always shown. */}
          <button
            type="button"
            onClick={() => {
              setSearchOpen((o) => {
                const next = !o
                if (next) setTimeout(() => searchInputRef.current?.focus(), 0)
                return next
              })
            }}
            aria-label="Toggle search"
            className={[
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors sm:hidden',
              searchOpen || q
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-input bg-background text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            <Search className="size-4" />
          </button>
          <div
            className={[
              'relative min-w-48 flex-1',
              searchOpen ? 'block' : 'hidden',
              'sm:block',
            ].join(' ')}
          >
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              type="search"
              placeholder="Search by ID, name or email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 pr-9"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <ColumnPicker
            questionColumns={questionColumns}
            visibleIds={visibleQuestionIds}
            onChange={updateVisibleColumns}
            hiddenBaseColumns={hiddenBaseColumns}
            onToggleBase={toggleBaseColumn}
            onResetBase={resetBaseColumns}
          />
        </div>

        {/* Filter chips — collapsed by default, added on demand via "Add filter" */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SlidersHorizontal className="hidden size-4 shrink-0 text-muted-foreground sm:block" />

          {shownKinds.has('country') && (
            <FilterChip
              id="country"
              openChip={openChip}
              setOpenChip={setOpenChip}
              label="Country"
              summary={
                filters.countries.length === 0
                  ? null
                  : filters.countries.length === 1
                    ? filters.countries[0]
                    : `${filters.countries.length} selected`
              }
              onRemove={() => removeFilterKind('country')}
            >
              <OptionCheckList
                options={countryOptions}
                values={filters.countries}
                onToggle={(v) =>
                  updateFilter(
                    'countries',
                    filters.countries.includes(v)
                      ? filters.countries.filter((x) => x !== v)
                      : [...filters.countries, v]
                  )
                }
              />
            </FilterChip>
          )}

          {shownKinds.has('position') && (
            <FilterChip
              id="position"
              openChip={openChip}
              setOpenChip={setOpenChip}
              label="Position"
              summary={filters.position || null}
              onRemove={() => removeFilterKind('position')}
            >
              <div className="max-h-64 w-56 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => updateFilter('position', '')}
                  className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <span className={['flex size-4 shrink-0 items-center justify-center rounded-full border', !filters.position ? 'border-primary' : 'border-input'].join(' ')}>
                    {!filters.position && <span className="size-2 rounded-full bg-primary" />}
                  </span>
                  <span className="text-muted-foreground">Any position</span>
                </button>
                {filterOptions.positions.map((p) => {
                  const checked = filters.position === p
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => { updateFilter('position', p); setOpenChip(null) }}
                      className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span className={['flex size-4 shrink-0 items-center justify-center rounded-full border', checked ? 'border-primary' : 'border-input'].join(' ')}>
                        {checked && <span className="size-2 rounded-full bg-primary" />}
                      </span>
                      <span className="truncate">{p}</span>
                    </button>
                  )
                })}
              </div>
            </FilterChip>
          )}

          {shownKinds.has('status') && (
            <FilterChip
              id="status"
              openChip={openChip}
              setOpenChip={setOpenChip}
              label="Status"
              summary={
                filters.fit_statuses.length === 0
                  ? null
                  : filters.fit_statuses.length === 1
                    ? (FIT_STATUS_OPTIONS.find((o) => o.value === filters.fit_statuses[0])?.label ?? filters.fit_statuses[0])
                    : `${filters.fit_statuses.length} selected`
              }
              onRemove={() => removeFilterKind('status')}
            >
              <OptionCheckList
                options={[...FIT_STATUS_OPTIONS]}
                values={filters.fit_statuses}
                onToggle={(v) =>
                  updateFilter(
                    'fit_statuses',
                    filters.fit_statuses.includes(v)
                      ? filters.fit_statuses.filter((x) => x !== v)
                      : [...filters.fit_statuses, v]
                  )
                }
              />
            </FilterChip>
          )}

          {shownKinds.has('score') && (
            <FilterChip
              id="score"
              openChip={openChip}
              setOpenChip={setOpenChip}
              label="Score"
              summary={(filters.min_score || filters.max_score) ? `${filters.min_score || '0'}–${filters.max_score || '100'}` : null}
              onRemove={() => removeFilterKind('score')}
            >
              <div className="flex items-center gap-1.5 p-1.5">
                <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="min"
                  value={filters.min_score}
                  onChange={(e) => updateFilter('min_score', e.target.value)}
                  className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="max"
                  value={filters.max_score}
                  onChange={(e) => updateFilter('max_score', e.target.value)}
                  className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                />
              </div>
            </FilterChip>
          )}

          {filters.answerFilters.map((f, i) => {
            const question = questionColumns.find((qc) => qc.id === f.questionId)
            const opLabel = question
              ? (getOpOptions(question.type).find((o) => o.value === f.op)?.label ?? f.op)
              : f.op
            const noValue = NO_VALUE_OPS.has(f.op as AnswerFilterOp)
            const summary = noValue ? opLabel : (f.value ? `${opLabel} ${f.value}` : null)
            return (
              <FilterChip
                key={i}
                id={`answer:${i}`}
                openChip={openChip}
                setOpenChip={setOpenChip}
                label={question?.label ?? 'Field'}
                summary={summary}
                onRemove={() => removeAnswerFilter(i)}
              >
                <AnswerFilterEditor
                  filter={f}
                  questionColumns={questionColumns}
                  onChange={(updated) => updateAnswerFilter(i, updated)}
                />
              </FilterChip>
            )
          })}

          <AddFilterMenu
            availableKinds={FIXED_FILTER_KINDS.filter((k) => !shownKinds.has(k.key))}
            questionColumns={questionColumns}
            onAddKind={addFilterKind}
            onAddAnswer={addAnswerFilterFor}
          />
        </div>
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
              <SortHeader label="Name" sortKey="name" numeric={false} sort={sort} onSort={toggleSort} />
              {isBaseVisible('country') && (
                <SortHeader label="Country" sortKey="country" numeric={false} sort={sort} onSort={toggleSort} />
              )}
              {isBaseVisible('position') && <TableHead>Position</TableHead>}
              {isBaseVisible('salary') && <TableHead>Salary Expectation</TableHead>}
              {isBaseVisible('status') && <TableHead>Status</TableHead>}
              {isBaseVisible('score') && (
                <SortHeader label="Score" sortKey="score" numeric sort={sort} onSort={toggleSort} className="w-20 text-center">
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="size-3 text-muted-foreground" />
                    Score
                  </span>
                </SortHeader>
              )}
              {isBaseVisible('apply_date') && (
                <SortHeader label="Apply date" sortKey="apply_date" numeric={false} sort={sort} onSort={toggleSort} />
              )}
              {visibleQuestions.map((q) => (
                <SortHeader
                  key={q.id}
                  label={q.label}
                  sortKey={`q:${q.id}`}
                  numeric={q.type === 'number'}
                  sort={sort}
                  onSort={toggleSort}
                  className="max-w-40"
                >
                  <span className="block truncate" title={q.label}>{q.label}</span>
                </SortHeader>
              ))}
              {isBaseVisible('notes') && <TableHead className="w-10 text-center">Notes</TableHead>}
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
                      {isBaseVisible('country') && (
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
                      )}
                      {isBaseVisible('position') && (
                      <TableCell className="max-w-44 truncate text-sm text-muted-foreground">
                        {cand.positions ?? '—'}
                      </TableCell>
                      )}
                      {isBaseVisible('salary') && (
                      <TableCell className="text-sm font-medium tabular-nums">
                        {formatSalary(cand.salary_expectation)}
                      </TableCell>
                      )}
                      {isBaseVisible('status') && (
                      <TableCell>
                        <FitBadge status={cand.fit_status} />
                      </TableCell>
                      )}
                      {isBaseVisible('score') && (
                      <TableCell className="text-center">
                        <ScoreBadge score={cand.ai_score} />
                      </TableCell>
                      )}
                      {isBaseVisible('apply_date') && (
                      <TableCell className="text-sm text-muted-foreground">
                        <span title={formatDate(cand.latest_submitted_at)}>
                          {formatRelativeTime(cand.latest_submitted_at)}
                        </span>
                      </TableCell>
                      )}
                      {visibleQuestions.map((q) => (
                        <TableCell key={q.id} className="max-w-40 text-sm text-muted-foreground">
                          <span className="block truncate" title={cand.extra_answers?.[String(q.id)] ?? undefined}>
                            {cand.extra_answers?.[String(q.id)] ?? '—'}
                          </span>
                        </TableCell>
                      ))}
                      {isBaseVisible('notes') && (
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
                      )}
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
          <div className="fixed inset-x-3 bottom-6 z-50 mx-auto w-fit max-w-[calc(100vw-1.5rem)]">
            <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border bg-background/95 px-4 py-2.5 shadow-xl backdrop-blur">
              <span className="text-sm font-medium text-foreground whitespace-nowrap">
                {selectedIds.size} candidate{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
              <Separator orientation="vertical" className="hidden h-4 sm:block" />
              <span className="hidden text-xs text-muted-foreground whitespace-nowrap sm:inline">Assign:</span>
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

const LINK_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  github: 'GitHub',
  portfolio: 'Portfolio',
  twitter: 'Twitter',
  website: 'Website',
  other: 'Link',
}

function LinkTypeIcon({ type }: { type: string }) {
  const cls = 'size-3'
  switch (type) {
    case 'github':
      return <GitBranch className={cls} />
    case 'twitter':
      return <AtSign className={cls} />
    case 'portfolio':
    case 'website':
      return <Globe className={cls} />
    default:
      return <ExternalLink className={cls} />
  }
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
  const [cvOpen, setCvOpen] = useState(false)
  const [fx, setFx] = useState<FxRates | null>(null)
  // Locally-applied salary corrections, keyed by `${applicationId}:${questionId}`.
  const [answerOverrides, setAnswerOverrides] = useState<Map<string, string>>(new Map())
  const [savingAnswers, setSavingAnswers] = useState<Set<string>>(new Set())

  // Reset any pending overrides when switching to a different candidate.
  useEffect(() => {
    setAnswerOverrides(new Map())
    setSavingAnswers(new Set())
  }, [applicant.id])

  async function applySalaryFix(appId: number, questionId: number, value: string) {
    const key = `${appId}:${questionId}`
    setSavingAnswers((prev) => new Set(prev).add(key))
    try {
      await updateAnswerValue(appId, questionId, value)
      setAnswerOverrides((prev) => new Map(prev).set(key, value))
    } catch {
      // Leave the original value in place; the suggestion stays actionable.
    } finally {
      setSavingAnswers((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  useEffect(() => {
    setFitStatus(applicant.fit_status ?? null)
  }, [applicant.id])

  useEffect(() => {
    let active = true
    fetchFxRates().then((rates) => {
      if (active) setFx(rates)
    })
    return () => {
      active = false
    }
  }, [])

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
              {(linkButtons.length > 0 || firstResumeUrl) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {linkButtons.map((l, i) => (
                    <a
                      key={i}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                      <LinkTypeIcon type={l.type} />
                      {LINK_LABELS[l.type] ?? 'Link'}
                    </a>
                  ))}
                  {firstResumeUrl && (
                    <button
                      type="button"
                      onClick={() => setCvOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                      <FileText className="size-3" />
                      CV
                    </button>
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
                          <div className="mb-3 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2.5 text-sm leading-relaxed text-foreground">
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
                        {app.answers.map((a, i) => {
                          const isSalary = /salary|maaş|maas|ücret|ucret|wage|compensation/i.test(a.label)
                          const key = `${app.id}:${a.question_id}`
                          const override = answerOverrides.get(key)
                          const value = override ?? a.value
                          const usd = isSalary ? estimateUsdSalary(value, fx) : null
                          // Only suggest a fix while the value is still uncorrected.
                          const suggestion = isSalary && override === undefined ? normalizeSalary(value) : null
                          const saving = savingAnswers.has(key)
                          return (
                            <div key={i} className="text-sm">
                              <dt className="mb-0.5 text-xs text-muted-foreground">{a.label}</dt>
                              <dd className="font-medium">
                                {isSalary ? formatSalary(value) : (value ?? '—')}
                                {usd && (
                                  <span className="ml-1.5 font-normal text-muted-foreground">
                                    {usd} <span className="text-xs">(est. USD)</span>
                                  </span>
                                )}
                              </dd>
                              {suggestion && (
                                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                  <span>Looks like thousands — did they mean {formatSalary(suggestion.suggested)}?</span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-xs"
                                    disabled={saving}
                                    onClick={() => applySalaryFix(app.id, a.question_id, suggestion.suggested)}
                                  >
                                    {saving ? 'Fixing…' : `Fix to ${formatSalary(suggestion.suggested)}`}
                                  </Button>
                                </div>
                              )}
                            </div>
                          )
                        })}
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

      {firstResumeUrl && (
        <Sheet open={cvOpen} onOpenChange={setCvOpen}>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="top-12 flex h-auto flex-col gap-0 rounded-t-xl p-0 sm:top-16"
          >
            <SheetHeader className="flex-row items-center justify-between gap-2 border-b px-4 py-3">
              <SheetTitle className="text-base">CV</SheetTitle>
              <div className="flex items-center gap-2">
                <a
                  href={firstResumeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
                >
                  <ExternalLink className="size-3" />
                  <span className="hidden sm:inline">Open in new tab</span>
                </a>
                <SheetClose className="inline-flex size-8 items-center justify-center rounded-md border border-input hover:bg-accent">
                  <X className="size-4" />
                  <span className="sr-only">Close</span>
                </SheetClose>
              </div>
            </SheetHeader>
            <iframe
              src={firstResumeUrl}
              title="CV preview"
              className="min-h-0 w-full flex-1 border-0"
            />
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}

function NotesSection({ applicantId, currentUser }: { applicantId: number; currentUser: User }) {
  const [notes, setNotes] = useState<CandidateNote[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setEditingId(null)
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

  function startEdit(note: CandidateNote) {
    setEditingId(note.id)
    setEditText(note.content)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditText('')
  }

  async function saveEdit(noteId: number) {
    if (!editText.trim()) return
    setSavingEdit(true)
    try {
      const updated = await updateNote(noteId, editText.trim())
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)))
      cancelEdit()
    } catch {
      // keep the editor open so the edit isn't lost
    } finally {
      setSavingEdit(false)
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
                {note.created_by === currentUser.username && editingId !== note.id && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(note)}
                      title="Edit note"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(note.id)}
                      title="Delete note"
                      className="text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
              {editingId === note.id ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={3}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit(note.id)
                      if (e.key === 'Escape') cancelEdit()
                    }}
                    className={[
                      'w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm',
                      'ring-offset-background placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    ].join(' ')}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!editText.trim() || savingEdit}
                      onClick={() => saveEdit(note.id)}
                    >
                      {savingEdit ? 'Saving…' : 'Save'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 whitespace-pre-wrap text-sm">{note.content}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
