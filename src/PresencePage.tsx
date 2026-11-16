import { useCallback, useEffect, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowLeft01Icon,
  Calendar01Icon,
  ChartBarLineIcon,
  ArrowRight01Icon,
  RefreshIcon,
  ViewIcon,
  ViewOffSlashIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  activeMs,
  displayName,
  fetchPresenceOverview,
  fmtDuration,
  emojiText,
  setTracked,
  syncPresenceNow,
  type PresenceOverview,
  type PresenceSession,
  type SlackUser,
  type StatusEvent,
} from '@/lib/presence'
import { cn } from '@/lib/utils'
import SlackEmoji from '@/components/SlackEmoji'
import type { User } from '@/lib/auth'
import PresenceAnalysis from './PresenceAnalysis'

const WEEK_DAYS = 7

// Local midnight of the day containing `d`.
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

function fmtTime(iso: string | number): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

function fmtAgo(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

// Member's local time, so a teammate in another zone reads at a glance.
function localTimeIn(tz: string | null): string | null {
  if (!tz) return null
  try {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz })
  } catch {
    return null
  }
}

// Two views: the day-by-day timeline and the working-hours analysis.
export default function PresencePage({ user }: { user: User }) {
  return (
    <Tabs defaultValue="analysis" className="flex flex-col gap-4">
      <TabsList>
        <TabsTrigger value="analysis">
          <HugeiconsIcon icon={ChartBarLineIcon} className="size-3.5 shrink-0" />
          Analysis
        </TabsTrigger>
        <TabsTrigger value="daily">
          <HugeiconsIcon icon={Calendar01Icon} className="size-3.5 shrink-0" />
          Daily timeline
        </TabsTrigger>
      </TabsList>
      <TabsContent value="analysis">
        <PresenceAnalysis isAdmin={user.isAdmin} />
      </TabsContent>
      <TabsContent value="daily">
        <DailyPresence />
      </TabsContent>
    </Tabs>
  )
}

function DailyPresence() {
  const [day, setDay] = useState(() => startOfDay(new Date()))
  const [data, setData] = useState<PresenceOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [showHidden, setShowHidden] = useState(false)

  const isToday = day.getTime() === startOfDay(new Date()).getTime()
  // Load the selected day plus the six before it, for the week column.
  const rangeFrom = useMemo(() => addDays(day, -(WEEK_DAYS - 1)), [day])
  const rangeTo = useMemo(() => addDays(day, 1), [day])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await fetchPresenceOverview(rangeFrom, rangeTo))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [rangeFrom, rangeTo])

  useEffect(() => {
    void load()
  }, [load])

  // Today's view follows the poll: refresh every minute.
  useEffect(() => {
    if (!isToday) return
    const t = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(t)
  }, [isToday, load])

  async function handleSync() {
    setSyncing(true)
    try {
      await syncPresenceNow()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  async function handleTrack(u: SlackUser, tracked: boolean) {
    setData((d) => d && { ...d, users: d.users.map((x) => (x.id === u.id ? { ...x, is_tracked: tracked ? 1 : 0 } : x)) })
    try {
      await setTracked(u.id, tracked)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      void load()
    }
  }

  const sessionsByUser = useMemo(() => groupBy(data?.sessions ?? [], (s) => s.slack_user_id), [data])
  const eventsByUser = useMemo(() => groupBy(data?.statusEvents ?? [], (e) => e.slack_user_id), [data])

  const users = (data?.users ?? []).filter((u) => showHidden || u.is_tracked === 1)
  const hiddenCount = (data?.users ?? []).filter((u) => u.is_tracked !== 1).length
  const activeNow = (data?.users ?? []).filter((u) => u.is_tracked === 1 && isActiveNow(u)).length
  const trackedCount = (data?.users ?? []).filter((u) => u.is_tracked === 1).length

  const dayFrom = day.getTime()
  // Next local midnight, not +24h: days with a clock change last 23 or 25 hours.
  const dayTo = addDays(day, 1).getTime()
  const weekDays = Array.from({ length: WEEK_DAYS }, (_, i) => addDays(rangeFrom, i))

  return (
    <div className="flex flex-col gap-4">
      {data && !data.configured && (
        <Alert>
          <HugeiconsIcon icon={Alert02Icon} className="size-4" />
          <AlertDescription>
            Slack is not connected. Add a bot token with the <code>users:read</code> and{' '}
            <code>users:read.email</code> scopes as the <code>SLACK_BOT_TOKEN</code> secret
            (<code>wrangler secret put SLACK_BOT_TOKEN</code>); presence is then polled every minute.
          </AlertDescription>
        </Alert>
      )}
      {data?.configured && data.emojiError?.includes('missing_scope') && (
        <Alert>
          <HugeiconsIcon icon={Alert02Icon} className="size-4" />
          <AlertDescription>
            Custom workspace emoji in statuses show as <code>:codes:</code>. Add the <code>emoji:read</code> bot scope
            to the Slack app and reinstall it; the images appear within an hour.
          </AlertDescription>
        </Alert>
      )}
      {(error || data?.lastError) && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={Alert02Icon} className="size-4" />
          <AlertDescription>{error ?? data?.lastError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Slack presence</CardTitle>
          <CardDescription>
            {trackedCount > 0 ? `${activeNow} of ${trackedCount} active now` : 'No members tracked yet'}
            {data?.lastPollAt ? ` · last checked ${fmtAgo(data.lastPollAt)}` : ''}
            {' · times in your local zone'}
          </CardDescription>
          <CardAction className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDay((d) => addDays(d, -1))}>
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={isToday} onClick={() => setDay(startOfDay(new Date()))}>
                {isToday ? 'Today' : fmtDay(day)}
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next day"
                disabled={isToday}
                onClick={() => setDay((d) => addDays(d, 1))}
              >
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </Button>
            </div>
            {hiddenCount > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowHidden((v) => !v)}>
                <HugeiconsIcon icon={showHidden ? ViewOffSlashIcon : ViewIcon} className="size-3.5" />
                {showHidden ? 'Hide untracked' : `Show untracked (${hiddenCount})`}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing || data?.configured === false}>
              <HugeiconsIcon icon={RefreshIcon} className={cn('size-3.5', syncing && 'animate-spin')} />
              {syncing ? 'Checking…' : 'Check now'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {!data && loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {data?.configured ? 'No Slack members yet. Run "Check now" to load the member list.' : 'Nothing to show yet.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Now</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Online {isToday ? 'today' : fmtDay(day)}</TableHead>
                  <TableHead className="min-w-[280px]">
                    <TimelineAxis />
                  </TableHead>
                  <TableHead className="text-right">Last 7 days</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const sessions = sessionsByUser.get(u.id) ?? []
                  const events = eventsByUser.get(u.id) ?? []
                  const tracked = u.is_tracked === 1
                  return (
                    <TableRow key={u.id} className={cn(!tracked && 'opacity-50')}>
                      <TableCell>
                        <MemberCell user={u} />
                      </TableCell>
                      <TableCell>
                        <PresenceCell user={u} />
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <StatusCell user={u} custom={data?.customEmoji} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmtDuration(activeMs(sessions, dayFrom, dayTo))}
                      </TableCell>
                      <TableCell>
                        <Timeline sessions={sessions} events={events} from={dayFrom} to={dayTo} custom={data?.customEmoji} />
                      </TableCell>
                      <TableCell className="text-right">
                        <WeekBars sessions={sessions} days={weekDays} />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={tracked ? 'Stop tracking' : 'Track again'}
                          aria-label={tracked ? 'Stop tracking' : 'Track again'}
                          onClick={() => handleTrack(u, !tracked)}
                        >
                          <HugeiconsIcon icon={tracked ? ViewOffSlashIcon : ViewIcon} className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = out.get(k)
    if (list) list.push(item)
    else out.set(k, [item])
  }
  return out
}

function MemberCell({ user }: { user: SlackUser }) {
  const name = displayName(user)
  const local = localTimeIn(user.tz)
  return (
    <div className="flex items-center gap-2.5">
      {user.avatar_url ? (
        <img src={user.avatar_url} alt="" className="size-8 shrink-0 rounded-md" />
      ) : (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium">
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        <div className="truncate text-xs text-muted-foreground">
          @{user.display_name || user.handle}
          {local ? ` · ${local} local` : ''}
        </div>
      </div>
    </div>
  )
}

// A presence reading older than this is no longer shown as current: if polling
// stops (token revoked, Slack outage) nobody should keep looking "active".
const PRESENCE_FRESH_MS = 10 * 60 * 1000

function isFresh(u: SlackUser): boolean {
  return !!u.presence_checked_at && Date.now() - Date.parse(u.presence_checked_at) < PRESENCE_FRESH_MS
}

function isActiveNow(u: SlackUser): boolean {
  return u.presence === 'active' && isFresh(u)
}

function PresenceCell({ user }: { user: SlackUser }) {
  if (!user.presence) return <span className="text-xs text-muted-foreground">Not checked</span>
  if (!isFresh(user)) {
    return (
      <div className="flex flex-col">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="size-2 rounded-full border border-dashed border-muted-foreground/60" />
          Unknown
        </span>
        <span className="text-xs text-muted-foreground">last checked {fmtAgo(user.presence_checked_at)}</span>
      </div>
    )
  }
  const active = user.presence === 'active'
  return (
    <div className="flex flex-col">
      <span className="flex items-center gap-1.5 text-sm">
        <span className={cn('size-2 rounded-full', active ? 'bg-emerald-500' : 'border border-muted-foreground/60')} />
        {active ? 'Active' : 'Away'}
      </span>
      {!active && (
        <span className="text-xs text-muted-foreground">last active {fmtAgo(user.last_active_at)}</span>
      )}
    </div>
  )
}

function StatusCell({ user, custom }: { user: SlackUser; custom?: Record<string, string> }) {
  if (!user.status_text && !user.status_emoji) return <span className="text-xs text-muted-foreground">—</span>
  const until = user.status_expiration ? new Date(user.status_expiration * 1000) : null
  return (
    <div className="min-w-0">
      <div className="truncate text-sm" title={user.status_text ?? undefined}>
        <SlackEmoji code={user.status_emoji} custom={custom} className="mr-1" />
        {user.status_text}
      </div>
      {until && (
        <div className="text-xs text-muted-foreground">
          until {until.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  )
}

const AXIS_HOURS = [0, 6, 12, 18, 24]

function TimelineAxis() {
  return (
    <div className="relative h-4 text-[10px] font-normal text-muted-foreground">
      {AXIS_HOURS.map((h) => (
        <span
          key={h}
          className={cn('absolute top-0', h === 0 ? '' : h === 24 ? '-translate-x-full' : '-translate-x-1/2')}
          style={{ left: `${(h / 24) * 100}%` }}
        >
          {String(h).padStart(2, '0')}:00
        </span>
      ))}
    </div>
  )
}

// 24-hour strip for one day: green blocks where the member was active, small
// ticks where their status changed.
function Timeline({
  sessions,
  events,
  from,
  to,
  custom,
}: {
  sessions: PresenceSession[]
  events: StatusEvent[]
  from: number
  to: number
  custom?: Record<string, string>
}) {
  const span = to - from
  const pct = (t: number) => `${((Math.min(Math.max(t, from), to) - from) / span) * 100}%`
  const now = Date.now()
  return (
    <div className="relative h-5 overflow-hidden rounded bg-muted">
      {AXIS_HOURS.slice(1, -1).map((h) => (
        <div key={h} className="absolute inset-y-0 w-px bg-border" style={{ left: `${(h / 24) * 100}%` }} />
      ))}
      {now > from && now < to && (
        <div className="absolute inset-y-0 right-0 bg-background/60" style={{ left: pct(now) }} />
      )}
      {sessions.map((s, i) => {
        const start = Date.parse(s.started_at)
        const end = Math.max(Date.parse(s.ended_at), start + 60_000)
        if (end <= from || start >= to) return null
        return (
          <div
            key={i}
            className="absolute inset-y-0.5 min-w-[2px] rounded-sm bg-emerald-500"
            style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }}
            title={`${fmtTime(start)} – ${s.open ? 'now' : fmtTime(end)}`}
          />
        )
      })}
      {events.map((e, i) => {
        const t = Date.parse(e.at)
        if (t < from || t >= to) return null
        const label = e.status_text || e.status_emoji ? `${emojiText(e.status_emoji, custom)} ${e.status_text ?? ''}`.trim() : 'cleared'
        return (
          <div
            key={`e${i}`}
            className="absolute inset-y-0 w-0.5 bg-amber-500"
            style={{ left: pct(t) }}
            title={`${fmtTime(t)} status: ${label}`}
          />
        )
      })}
    </div>
  )
}

// Seven small bars, one per day, scaled to a 10-hour day.
function WeekBars({ sessions, days }: { sessions: PresenceSession[]; days: Date[] }) {
  const totals = days.map((d) => activeMs(sessions, d.getTime(), addDays(d, 1).getTime()))
  const sum = totals.reduce((a, b) => a + b, 0)
  const scale = 10 * 3600 * 1000
  return (
    <div className="flex items-end justify-end gap-2">
      <div className="flex h-6 items-end gap-0.5">
        {totals.map((ms, i) => (
          <div
            key={i}
            className="w-1.5 rounded-sm bg-emerald-500/70"
            style={{ height: `${Math.max(ms > 0 ? 8 : 4, Math.min(1, ms / scale) * 100)}%`, opacity: ms > 0 ? 1 : 0.25 }}
            title={`${fmtDay(days[i])}: ${fmtDuration(ms)}`}
          />
        ))}
      </div>
      <span className="w-16 text-sm tabular-nums">{fmtDuration(sum)}</span>
    </div>
  )
}
