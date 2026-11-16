import { useCallback, useEffect, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, Clock01Icon, Download04Icon } from '@hugeicons-pro/core-stroke-rounded'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  displayName,
  fetchPresenceOverview,
  fmtDuration,
  renderEmoji,
  saveWorkHours,
  type PresenceOverview,
  type PresenceSession,
} from '@/lib/presence'
import {
  PERIODS,
  analyzeMember,
  calendarDays,
  fmtClock,
  periodRange,
  statusTotals,
  viewerTz,
  type MemberAnalysis,
  type PeriodKey,
  type StatusTotal,
  type WorkHours,
} from '@/lib/presence-analysis'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : null
}

function coverageClass(p: number | null): string {
  if (p == null) return 'bg-muted-foreground/30'
  if (p >= 75) return 'bg-emerald-500'
  if (p >= 50) return 'bg-amber-500'
  return 'bg-red-500'
}

function describeHours(h: WorkHours): string {
  const days = h.days.length === 5 && [1, 2, 3, 4, 5].every((d) => h.days.includes(d))
    ? 'Mon–Fri'
    : h.days.map((d) => WEEKDAYS[d]).join(', ')
  return `${days} ${h.start}–${h.end}, ${h.perMemberTz ? "each member's own time zone" : `${viewerTz()} time`}`
}

export default function PresenceAnalysis({ isAdmin }: { isAdmin: boolean }) {
  const [period, setPeriod] = useState<PeriodKey>('this_week')
  const [data, setData] = useState<PresenceOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)

  // Ticks every minute so an open view keeps counting; the range follows the
  // calendar too, so "this week" moves on at midnight.
  const [now, setNow] = useState(() => Date.now())
  const today = new Date(now).toDateString()
  // `today` is a dependency on purpose: it recomputes the range after midnight.
  const range = useMemo(() => periodRange(period), [period, today])
  const isCurrent = range.from.getTime() <= now && now < range.to.getTime()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Pad a day on each side: a member far east or west of the viewer has
      // working hours that spill past the viewer's calendar edges.
      const from = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate() - 1)
      const to = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1)
      setData(await fetchPresenceOverview(from, to))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [range])

  // The current period refreshes with the poll; past periods don't change.
  useEffect(() => {
    if (!isCurrent) return
    const t = window.setInterval(() => {
      setNow(Date.now())
      void load()
    }, 60_000)
    return () => window.clearInterval(t)
  }, [isCurrent, load])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => {
    if (!data) return []
    const days = calendarDays(range.from, range.to)
    const byUser = new Map<string, PresenceSession[]>()
    for (const s of data.sessions) {
      const list = byUser.get(s.slack_user_id)
      if (list) list.push(s)
      else byUser.set(s.slack_user_id, [s])
    }
    const eventsByUser = new Map<string, typeof data.statusEvents>()
    for (const e of data.statusEvents) {
      const list = eventsByUser.get(e.slack_user_id)
      if (list) list.push(e)
      else eventsByUser.set(e.slack_user_id, [e])
    }
    return data.users
      .filter((u) => u.is_tracked === 1)
      .map((u) => ({
        user: u,
        a: analyzeMember(u, byUser.get(u.id) ?? [], data.leaves, days, data.workHours, now),
        statuses: statusTotals(eventsByUser.get(u.id) ?? [], range.from.getTime(), range.to.getTime(), now),
      }))
      .sort((x, y) => (pct(y.a.inHoursMs, y.a.expectedMs) ?? -1) - (pct(x.a.inHoursMs, x.a.expectedMs) ?? -1))
  }, [data, range, now])

  const team = useMemo(() => {
    const expected = rows.reduce((s, r) => s + r.a.expectedMs, 0)
    const inHours = rows.reduce((s, r) => s + r.a.inHoursMs, 0)
    const outside = rows.reduce((s, r) => s + r.a.outsideMs, 0)
    // Team-wide time per status, merged across members by text + emoji.
    const statusMap = new Map<string, StatusTotal>()
    for (const r of rows) {
      for (const st of r.statuses) {
        const key = `${st.emoji ?? ''}\u0000${(st.text ?? '').trim().toLowerCase()}`
        const t = statusMap.get(key)
        if (t) t.ms += st.ms
        else statusMap.set(key, { ...st })
      }
    }
    const statuses = [...statusMap.values()].sort((x, y) => y.ms - x.ms)
    return { expected, inHours, outside, pct: pct(inHours, expected), statuses }
  }, [rows])

  const periodLabel = `${range.from.toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${new Date(
    range.to.getTime() - 1,
  ).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`

  function exportCsv() {
    const head = [
      'Member',
      'Email',
      'Time zone',
      'Online in working hours (h)',
      'Working hours so far (h)',
      'Coverage %',
      'Online outside working hours (h)',
      'Active working days',
      'Working days',
      'Leave days',
      'Avg first active',
      'Avg last active',
      'Time in statuses',
    ]
    const h = (ms: number) => (ms / 3600000).toFixed(2)
    const lines = rows.map(({ user, a, statuses }) =>
      [
        displayName(user),
        user.email ?? '',
        a.tz,
        h(a.inHoursMs),
        h(a.expectedMs),
        pct(a.inHoursMs, a.expectedMs) ?? '',
        h(a.outsideMs),
        a.activeWorkDays,
        a.workDays,
        a.leaveDays,
        fmtClock(a.avgFirstMin),
        fmtClock(a.avgLastMin),
        statuses.map((st) => `${statusLabel(st)}: ${(st.ms / 3600000).toFixed(2)}h`).join('; '),
      ]
        .map((v) => {
          // A cell starting with = + - @ is read as a formula by spreadsheets;
          // a leading apostrophe keeps it text (Slack names are user-controlled).
          const text = String(v)
          const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
          return `"${safe.replace(/"/g, '""')}"`
        })
        .join(','),
    )
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `slack-presence-${range.from.toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={Alert02Icon} className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Working-hours analysis</CardTitle>
          <CardDescription>
            {periodLabel}
            {data ? ` · ${describeHours(data.workHours)}` : ''}
          </CardDescription>
          <CardAction className="flex flex-wrap items-center gap-2">
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
              <SelectTrigger size="sm" className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isAdmin && data && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <HugeiconsIcon icon={Clock01Icon} className="size-3.5" />
                Working hours
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
              <HugeiconsIcon icon={Download04Icon} className="size-3.5" />
              CSV
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rows.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Team coverage" value={team.pct == null ? '—' : `${team.pct}%`} />
              <Stat label="Online in working hours" value={fmtDuration(team.inHours)} />
              <Stat label="Expected so far" value={fmtDuration(team.expected)} />
              <Stat label="Online outside hours" value={fmtDuration(team.outside)} />
            </div>
          )}

          {!data && loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tracked members yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="min-w-[240px]">Online in working hours</TableHead>
                  <TableHead className="text-right">Outside hours</TableHead>
                  <TableHead className="text-right">Active days</TableHead>
                  <TableHead className="text-right">Avg start</TableHead>
                  <TableHead className="text-right">Avg end</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ user, a }) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium">{displayName(user)}</div>
                      <div className="text-xs text-muted-foreground">{a.tz}</div>
                    </TableCell>
                    <TableCell>
                      <CoverageBar a={a} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDuration(a.outsideMs)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.activeWorkDays}/{a.workDays}
                      {a.leaveDays > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {a.leaveDays} leave day{a.leaveDays === 1 ? '' : 's'}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtClock(a.avgFirstMin)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtClock(a.avgLastMin)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground">
            "Online" means Slack showed the member as active (checked every minute). Approved leave of members linked to
            an employee is left out of the expected time, as is time that hasn't happened yet. Start and end are the
            first and last activity of each working day, in the member's time zone.
          </p>
        </CardContent>
      </Card>

      {rows.length > 0 && <StatusCard rows={rows} teamStatuses={team.statuses} />}

      {editing && data && (
        <WorkHoursDialog
          initial={data.workHours}
          onClose={() => setEditing(false)}
          onSaved={(workHours) => {
            setData((d) => d && { ...d, workHours })
            setEditing(false)
          }}
        />
      )}
    </div>
  )
}

function statusLabel(st: StatusTotal): string {
  return `${renderEmoji(st.emoji)} ${st.text ?? ''}`.trim()
}

function StatusChip({ st }: { st: StatusTotal }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs">
      <span className="max-w-[180px] truncate" title={statusLabel(st)}>
        {statusLabel(st) || '—'}
      </span>
      <span className="font-medium tabular-nums">{fmtDuration(st.ms)}</span>
    </span>
  )
}

// Time each member spent in each Slack status during the period, e.g. lunch,
// meetings, sick or vacation statuses.
function StatusCard({
  rows,
  teamStatuses,
}: {
  rows: { user: Parameters<typeof displayName>[0]; statuses: StatusTotal[] }[]
  teamStatuses: StatusTotal[]
}) {
  const withStatus = rows.filter((r) => r.statuses.length > 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Time in Slack statuses</CardTitle>
        <CardDescription>
          How long each status (text + emoji) was set during the period. Counted from when tracking started; a status
          holds until it is changed or cleared.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {teamStatuses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody had a status set in this period.</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="text-xs text-muted-foreground">Whole team</div>
              <div className="flex flex-wrap gap-1.5">
                {teamStatuses.slice(0, 12).map((st, i) => (
                  <StatusChip key={i} st={st} />
                ))}
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">Member</TableHead>
                  <TableHead>Statuses, longest first</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withStatus.map(({ user, statuses }) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{displayName(user)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {statuses.map((st, i) => (
                          <StatusChip key={i} st={st} />
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function CoverageBar({ a }: { a: MemberAnalysis }) {
  const p = pct(a.inHoursMs, a.expectedMs)
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', coverageClass(p))} style={{ width: `${p ?? 0}%` }} />
      </div>
      <div className="w-36 text-right text-sm tabular-nums">
        <span className="font-medium">{fmtDuration(a.inHoursMs)}</span>
        <span className="text-muted-foreground"> / {fmtDuration(a.expectedMs)}</span>
        <span className="ml-1.5 inline-block w-9 font-medium">{p == null ? '—' : `${p}%`}</span>
      </div>
    </div>
  )
}

function WorkHoursDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: WorkHours
  onClose: () => void
  onSaved: (h: WorkHours) => void
}) {
  const [draft, setDraft] = useState<WorkHours>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    try {
      onSaved(await saveWorkHours(draft))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function toggleDay(d: number) {
    setDraft((h) => ({ ...h, days: h.days.includes(d) ? h.days.filter((x) => x !== d) : [...h.days, d].sort() }))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Working hours</DialogTitle>
          <DialogDescription>The analysis measures online time against these hours, for everyone.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wh-start">Start</Label>
              <Input
                id="wh-start"
                type="time"
                value={draft.start}
                onChange={(e) => setDraft((h) => ({ ...h, start: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wh-end">End</Label>
              <Input
                id="wh-end"
                type="time"
                value={draft.end}
                onChange={(e) => setDraft((h) => ({ ...h, end: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Working days</Label>
            <div className="flex flex-wrap gap-1">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <Button
                  key={d}
                  type="button"
                  size="sm"
                  variant={draft.days.includes(d) ? 'default' : 'outline'}
                  onClick={() => toggleDay(d)}
                >
                  {WEEKDAYS[d]}
                </Button>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draft.perMemberTz}
              onChange={(e) => setDraft((h) => ({ ...h, perMemberTz: e.target.checked }))}
            />
            <span>
              Use each member's own Slack time zone
              <span className="block text-xs text-muted-foreground">
                Off: everyone is measured against these hours in your time zone ({viewerTz()}).
              </span>
            </span>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || draft.days.length === 0 || draft.start >= draft.end}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
