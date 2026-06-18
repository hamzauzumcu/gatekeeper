import { useEffect, useMemo, useState } from 'react'
import { Check, TrendingUp, Target, Flame, CalendarDays } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchDailyHistory, type DailyHistoryPoint } from '@/lib/candidates'
import { cn } from '@/lib/utils'

type Range = 7 | 14 | 30

const RANGES: Range[] = [7, 14, 30]

function parseDate(d: string): Date {
  // Activity dates are 'YYYY-MM-DD' (UTC). Parse as local midnight for display.
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, day ?? 1)
}

function weekdayLabel(d: string): string {
  return parseDate(d).toLocaleDateString(undefined, { weekday: 'short' })
}

function dayLabel(d: string): string {
  return parseDate(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function isToday(d: string): boolean {
  const t = new Date()
  const p = parseDate(d)
  return (
    p.getFullYear() === t.getFullYear() &&
    p.getMonth() === t.getMonth() &&
    p.getDate() === t.getDate()
  )
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums leading-none">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

export function DailyStatsSheet({
  open,
  onOpenChange,
  username,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  username: string
}) {
  const [range, setRange] = useState<Range>(7)
  const [target, setTarget] = useState(0)
  const [allDays, setAllDays] = useState<DailyHistoryPoint[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch the widest window once per open; narrower ranges are sliced client-side.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchDailyHistory(username, 30)
      .then((h) => {
        if (cancelled) return
        setTarget(h.target)
        setAllDays(h.days)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, username])

  const days = useMemo(
    () => (allDays ? allDays.slice(-range) : []),
    [allDays, range]
  )

  const stats = useMemo(() => {
    if (days.length === 0) return null
    const total = days.reduce((s, d) => s + d.count, 0)
    const avg = total / days.length
    const best = days.reduce((m, d) => Math.max(m, d.count), 0)
    const activeDays = days.filter((d) => d.count > 0).length
    const hitTarget = target > 0 ? days.filter((d) => d.count >= target).length : 0
    return { total, avg, best, activeDays, hitTarget }
  }, [days, target])

  // Scale bars against whichever is larger: the busiest day or the target line.
  const chartMax = useMemo(() => {
    const maxCount = days.reduce((m, d) => Math.max(m, d.count), 0)
    return Math.max(maxCount, target, 1)
  }, [days, target])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="border-b p-4 sm:p-6">
          <SheetTitle className="flex items-center gap-2">
            <TrendingUp className="size-4" />
            CV Review Stats
          </SheetTitle>
          <SheetDescription>
            Candidates you've processed per day. A day counts a candidate once.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4 sm:p-6">
          <Tabs value={String(range)} onValueChange={(v) => setRange(Number(v) as Range)}>
            <TabsList className="grid w-full grid-cols-3">
              {RANGES.map((r) => (
                <TabsTrigger key={r} value={String(r)}>
                  {r} days
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {loading || !stats ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <StatCard
                  icon={<TrendingUp className="size-3.5" />}
                  label="Avg / day"
                  value={stats.avg.toFixed(1)}
                  sub={`${stats.total} total`}
                />
                <StatCard
                  icon={<Flame className="size-3.5" />}
                  label="Best day"
                  value={String(stats.best)}
                  sub={`${stats.activeDays}/${days.length} active`}
                />
                <StatCard
                  icon={<Target className="size-3.5" />}
                  label="Target hit"
                  value={target > 0 ? `${stats.hitTarget}` : '—'}
                  sub={target > 0 ? `of ${days.length} days` : 'no target set'}
                />
              </div>

              {/* Bar chart */}
              <div className="rounded-lg border p-3">
                <div className="relative flex h-40 items-end gap-[3px]">
                  {target > 0 && (
                    <div
                      className="pointer-events-none absolute inset-x-0 border-t border-dashed border-emerald-500/60"
                      style={{ bottom: `${(target / chartMax) * 100}%` }}
                    >
                      <span className="absolute -top-2 right-0 bg-card px-1 text-[10px] font-medium text-emerald-600">
                        target {target}
                      </span>
                    </div>
                  )}
                  {days.map((d) => {
                    const hit = target > 0 && d.count >= target
                    return (
                      <div
                        key={d.date}
                        className="group relative flex flex-1 flex-col items-center justify-end"
                        title={`${dayLabel(d.date)}: ${d.count}`}
                      >
                        <div
                          className={cn(
                            'w-full rounded-sm transition-all',
                            d.count === 0
                              ? 'bg-muted'
                              : hit
                                ? 'bg-emerald-500'
                                : 'bg-primary/70',
                            isToday(d.date) && 'ring-2 ring-primary ring-offset-1 ring-offset-card'
                          )}
                          style={{
                            height: `${Math.max((d.count / chartMax) * 100, d.count > 0 ? 4 : 2)}%`,
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
                {/* X axis labels: show sparse weekday markers for readability */}
                <div className="mt-1.5 flex gap-[3px]">
                  {days.map((d, i) => {
                    const step = days.length > 14 ? 5 : days.length > 7 ? 2 : 1
                    const show = i % step === 0 || i === days.length - 1
                    return (
                      <div
                        key={d.date}
                        className="flex-1 text-center text-[10px] text-muted-foreground"
                      >
                        {show ? weekdayLabel(d.date) : ''}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Per-day list, most recent first */}
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">By day</div>
                <div className="divide-y rounded-lg border">
                  {[...days].reverse().map((d) => {
                    const hit = target > 0 && d.count >= target
                    return (
                      <div
                        key={d.date}
                        className="flex items-center justify-between px-3 py-2 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <CalendarDays className="size-3.5 text-muted-foreground" />
                          <span className={cn(isToday(d.date) && 'font-medium')}>
                            {dayLabel(d.date)}
                            {isToday(d.date) && (
                              <span className="ml-1.5 text-xs text-muted-foreground">today</span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 tabular-nums">
                          <span className={cn(d.count === 0 && 'text-muted-foreground')}>
                            {d.count}
                            {target > 0 && (
                              <span className="text-muted-foreground"> / {target}</span>
                            )}
                          </span>
                          {hit && <Check className="size-3.5 text-emerald-600" />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
