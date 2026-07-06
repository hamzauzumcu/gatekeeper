import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addDays, daysBetween, isoDay, leaveSpan, weekdayMon, type LeaveRequest, type LeaveStatus } from '@/lib/leave'

// Bar colors per status — same palette as the request badges, tuned for a solid
// pill that reads on the calendar in both light and dark mode.
const BAR_CLASS: Record<LeaveStatus, string> = {
  pending: 'bg-amber-200 text-amber-900 dark:bg-amber-500/30 dark:text-amber-100',
  approved: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-100',
  rejected: 'bg-red-200 text-red-900 dark:bg-red-500/25 dark:text-red-100',
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Today's local date as a YYYY-MM-DD key (for the "today" highlight).
function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// A leave placed on the calendar: its request plus its resolved span.
type Placed = { req: LeaveRequest; start: string; end: string; days: number }

// One rendered bar segment inside a single week row.
type Segment = { placed: Placed; col: number; span: number; startsHere: boolean; endsHere: boolean }

export default function LeaveCalendar({ requests }: { requests: LeaveRequest[] }) {
  const today = todayISO()
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  // Resolve every request to a concrete span once. Requests without a usable
  // start date can't be placed on the calendar and are dropped here.
  const placed = useMemo<Placed[]>(() => {
    return requests
      .map((req) => {
        const span = leaveSpan(req)
        return span ? { req, ...span } : null
      })
      .filter((p): p is Placed => p !== null)
  }, [requests])

  // The 6×7 grid of ISO days for the visible month, starting on Monday.
  const gridDays = useMemo(() => {
    const first = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-01`
    const monday = addDays(first, -weekdayMon(first))
    return Array.from({ length: 42 }, (_, i) => addDays(monday, i))
  }, [cursor])

  // Split the flat grid into weeks and, per week, lay out each intersecting
  // leave as a column-spanning segment (one leave per row — simple and clear).
  const weeks = useMemo(() => {
    const rows: { days: string[]; segments: Segment[] }[] = []
    for (let w = 0; w < 6; w++) {
      const days = gridDays.slice(w * 7, w * 7 + 7)
      const weekStart = days[0]
      const weekEnd = days[6]
      const segments: Segment[] = []
      for (const p of placed) {
        // Skip leaves that don't touch this week at all.
        if (daysBetween(p.end, weekStart) > 0 || daysBetween(weekEnd, p.start) > 0) continue
        const startCol = daysBetween(weekStart, p.start) < 0 ? 0 : daysBetween(weekStart, p.start)
        const endCol = daysBetween(weekStart, p.end) > 6 ? 6 : daysBetween(weekStart, p.end)
        segments.push({
          placed: p,
          col: startCol,
          span: endCol - startCol + 1,
          startsHere: daysBetween(weekStart, p.start) >= 0,
          endsHere: daysBetween(weekStart, p.end) <= 6,
        })
      }
      // Stable order: earliest-starting, then longest, so bars read top-down.
      segments.sort((a, b) => daysBetween(b.placed.start, a.placed.start) || b.placed.days - a.placed.days)
      rows.push({ days, segments })
    }
    // Trim a trailing all-outside week (months that fit in 5 rows).
    while (rows.length > 5 && rows[rows.length - 1].days.every((d) => isoDay(d)!.slice(0, 7) !== `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`)) {
      rows.pop()
    }
    return rows
  }, [gridDays, placed, cursor])

  const monthKey = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`

  function shift(delta: number) {
    setCursor((c) => {
      const m = c.month + delta
      return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 }
    })
  }
  function goToday() {
    const d = new Date()
    setCursor({ year: d.getFullYear(), month: d.getMonth() })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: month title, navigation, legend */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-40 text-center text-lg font-semibold">
            {MONTHS[cursor.month]} {cursor.year}
          </div>
          <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToday}>
            Today
          </Button>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-300 dark:bg-emerald-500/40" /> Approved
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-amber-300 dark:bg-amber-500/40" /> Pending
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-300 dark:bg-red-500/40" /> Rejected
          </span>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>

      {/* Week rows. Each week is a single 7-column grid: full-height background
          cells on the bottom layer, day numbers on row 1, then one bar per lane
          below — so multi-day leaves span columns cleanly without overlap. */}
      <div className="flex flex-col overflow-hidden rounded-md border">
        {weeks.map((week, wi) => (
          <div
            key={wi}
            className="grid min-h-24 grid-cols-7 border-b last:border-b-0"
            style={{ gridTemplateRows: `1.75rem repeat(${Math.max(1, week.segments.length)}, auto)` }}
          >
            {/* Background cells span every row of the week */}
            {week.days.map((day) => {
              const inMonth = day.slice(0, 7) === monthKey
              return (
                <div
                  key={`bg-${day}`}
                  className={`border-r last:border-r-0 ${inMonth ? '' : 'bg-muted/40'}`}
                  style={{ gridRow: '1 / -1' }}
                />
              )
            })}
            {/* Day numbers on the first row */}
            {week.days.map((day, di) => {
              const inMonth = day.slice(0, 7) === monthKey
              const isToday = day === today
              return (
                <div key={`num-${day}`} className="p-1" style={{ gridColumn: di + 1, gridRow: 1 }}>
                  <div
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      isToday
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : inMonth
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {Number(day.slice(8, 10))}
                  </div>
                </div>
              )
            })}
            {/* Leave bars, one per lane */}
            {week.segments.map((seg, si) => {
              const name = seg.placed.req.employee_name || seg.placed.req.raw_name || '—'
              const type = seg.placed.req.leave_type ? ` · ${seg.placed.req.leave_type}` : ''
              return (
                <div
                  key={`${seg.placed.req.id}-${si}`}
                  title={`${name}${type} — ${seg.placed.days} day(s), ${seg.placed.req.status}`}
                  className={`z-10 mx-0.5 mb-0.5 truncate rounded px-1.5 py-0.5 text-[11px] leading-tight ${BAR_CLASS[seg.placed.req.status]} ${
                    seg.startsHere ? '' : 'ml-0 rounded-l-none'
                  } ${seg.endsHere ? '' : 'mr-0 rounded-r-none'}`}
                  style={{ gridColumn: `${seg.col + 1} / span ${seg.span}`, gridRow: si + 2 }}
                >
                  {seg.startsHere ? name : `↳ ${name}`}
                  {seg.startsHere && type}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {placed.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No dated leave requests to show on the calendar.
        </p>
      )}
    </div>
  )
}
