import { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { Check, X, Upload, UserPlus, ExternalLink, Pencil, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { User } from '@/lib/auth'
import { fetchEmployees, createEmployee, type Employee } from '@/lib/employees'
import {
  fetchLeaveRequests,
  importLeaveRequests,
  assignEmployee,
  reviewLeaveRequest,
  updateLeaveDuration,
  csvRowsToImportRows,
  parseAmount,
  fmtNum,
  leaveYear,
  type LeaveRequest,
  type LeaveStatus,
} from '@/lib/leave'

const STATUS_VARIANT: Record<LeaveStatus, 'secondary' | 'default' | 'destructive'> = {
  pending: 'secondary',
  approved: 'default',
  rejected: 'destructive',
}

const SELECT_CLASS =
  'h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

function formatDates(start: string | null, end: string | null): string {
  if (!start && !end) return '—'
  if (start && end && start !== end) return `${start} → ${end}`
  return start || end || '—'
}

// Render the two raw duration fields as clean "N d" / "N h" (hiding zeros). If
// neither parses to a number, fall back to whatever raw text is there.
function formatDuration(days: string | null, hours: string | null): string {
  const d = parseAmount(days)
  const h = parseAmount(hours)
  const parts: string[] = []
  if (d && d > 0) parts.push(`${fmtNum(d)} d`)
  if (h && h > 0) parts.push(`${fmtNum(h)} h`)
  if (parts.length) return parts.join(' · ')
  return (days || hours || '').trim() || '—'
}

// Days/hours totals over a set of requests (parsed, kept separate — never mixed).
type Totals = { days: number; hours: number; count: number }
function sumTotals(reqs: LeaveRequest[]): Totals {
  let days = 0
  let hours = 0
  for (const r of reqs) {
    const d = parseAmount(r.working_days)
    const h = parseAmount(r.hours_requested)
    if (d) days += d
    if (h) hours += h
  }
  return { days, hours, count: reqs.length }
}

// "3 d · 5 h" (omit zero parts; em dash if empty).
function fmtTotals(t: Totals): string {
  const parts: string[] = []
  if (t.days > 0) parts.push(`${fmtNum(t.days)} d`)
  if (t.hours > 0) parts.push(`${fmtNum(t.hours)} h`)
  return parts.join(' · ') || '—'
}

export default function LeavePage({ user }: { user: User }) {
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [newEmp, setNewEmp] = useState({ name: '', email: '', department: '' })
  const [addingEmp, setAddingEmp] = useState(false)

  // Inline duration editing (for messy legacy rows).
  const [editDurId, setEditDurId] = useState<number | null>(null)
  const [editDays, setEditDays] = useState('')
  const [editHours, setEditHours] = useState('')

  // Employees tab: year filter + drill-down.
  const [year, setYear] = useState<string>('all')
  const [selectedEmp, setSelectedEmp] = useState<number | null>(null)

  const employeesById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])

  // Years present in the data, newest first, for the year picker.
  const years = useMemo(() => {
    const set = new Set<string>()
    for (const r of requests) {
      const y = leaveYear(r)
      if (y) set.add(y)
    }
    return [...set].sort().reverse()
  }, [requests])

  async function load() {
    try {
      setError(null)
      const [reqs, emps] = await Promise.all([fetchLeaveRequests(), fetchEmployees()])
      setRequests(reqs)
      setEmployees(emps)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportMsg(null)
    setImporting(true)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.replace(/^﻿/, '').trim(),
      complete: async (res) => {
        try {
          const rows = csvRowsToImportRows(res.data)
          if (rows.length === 0) {
            setImportMsg('No leave rows found in that file.')
            return
          }
          const summary = await importLeaveRequests(rows)
          setImportMsg(`Imported ${summary.inserted} new request(s); ${summary.skipped} already existed.`)
          await load()
        } catch (err) {
          setImportMsg(err instanceof Error ? err.message : 'Import failed')
        } finally {
          setImporting(false)
          if (fileRef.current) fileRef.current.value = ''
        }
      },
      error: (err) => {
        setImportMsg(err.message)
        setImporting(false)
      },
    })
  }

  async function onAssign(req: LeaveRequest, value: string) {
    if (value === '__add__') {
      const name = window.prompt('New employee name:', req.raw_name)?.trim()
      if (!name) return
      setBusyId(req.id)
      try {
        const emp = await createEmployee({ name })
        await assignEmployee(req.id, emp.id)
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to add employee')
      } finally {
        setBusyId(null)
      }
      return
    }
    setBusyId(req.id)
    try {
      await assignEmployee(req.id, value ? Number(value) : null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to map employee')
    } finally {
      setBusyId(null)
    }
  }

  function startEditDuration(r: LeaveRequest) {
    setEditDurId(r.id)
    setEditDays(r.working_days ?? '')
    setEditHours(r.hours_requested ?? '')
  }

  async function saveDuration(id: number) {
    setBusyId(id)
    try {
      await updateLeaveDuration(id, editDays.trim() || null, editHours.trim() || null)
      setEditDurId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update duration')
    } finally {
      setBusyId(null)
    }
  }

  async function onReview(id: number, decision: 'approved' | 'rejected') {
    setBusyId(id)
    try {
      await reviewLeaveRequest(id, decision, user.username, user.fullName)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to review')
    } finally {
      setBusyId(null)
    }
  }

  async function onAddEmployee(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmp.name.trim()) return
    setAddingEmp(true)
    try {
      await createEmployee({
        name: newEmp.name,
        email: newEmp.email.trim() || undefined,
        department: newEmp.department.trim() || undefined,
      })
      setNewEmp({ name: '', email: '', department: '' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add employee')
    } finally {
      setAddingEmp(false)
    }
  }

  const unmappedCount = requests.filter((r) => r.employee_id === null).length
  const pendingCount = requests.filter((r) => r.status === 'pending').length

  // Requests within the selected year (or all years).
  function inYear(r: LeaveRequest): boolean {
    return year === 'all' || leaveYear(r) === year
  }

  return (
    <Tabs defaultValue="requests" className="flex flex-col gap-4">
      <TabsList>
        <TabsTrigger value="requests">
          Requests
          {pendingCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {pendingCount} pending
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="employees">Employees</TabsTrigger>
      </TabsList>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <TabsContent value="requests" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onImportFile}
            className="hidden"
          />
          <Button variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" />
            {importing ? 'Importing…' : 'Import CSV'}
          </Button>
          {unmappedCount > 0 && (
            <span className="text-sm text-muted-foreground">
              {unmappedCount} request(s) not yet mapped to an employee
            </span>
          )}
          {importMsg && <span className="text-sm text-muted-foreground">{importMsg}</span>}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No leave requests yet. Import a CSV export or wait for the Tally webhook.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Doc</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <select
                        className={SELECT_CLASS}
                        value={r.employee_id ?? ''}
                        disabled={busyId === r.id}
                        onChange={(e) => onAssign(r, e.target.value)}
                      >
                        <option value="">— Unmapped —</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name}
                          </option>
                        ))}
                        <option value="__add__">+ Add new…</option>
                      </select>
                      {(!r.employee_id ||
                        employeesById.get(r.employee_id)?.name !== r.raw_name) && (
                        <div className="mt-1 text-xs text-muted-foreground">form: {r.raw_name}</div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{r.leave_type || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDates(r.start_date, r.end_date)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {editDurId === r.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={editDays}
                            onChange={(e) => setEditDays(e.target.value)}
                            placeholder="days"
                            className="h-8 w-16"
                          />
                          <Input
                            value={editHours}
                            onChange={(e) => setEditHours(e.target.value)}
                            placeholder="hrs"
                            className="h-8 w-16"
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            disabled={busyId === r.id}
                            onClick={() => saveDuration(r.id)}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => setEditDurId(null)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="group inline-flex items-center gap-1"
                          onClick={() => startEditDuration(r)}
                          title="Edit duration"
                        >
                          {formatDuration(r.working_days, r.hours_requested)}
                          <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[18rem] truncate text-muted-foreground" title={r.reason ?? ''}>
                      {r.reason || '—'}
                    </TableCell>
                    <TableCell>
                      {r.document_url ? (
                        <a
                          href={r.document_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center text-primary hover:underline"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status]} className="capitalize">
                        {r.status}
                      </Badge>
                      {r.status !== 'pending' && r.reviewer_name && (
                        <div className="mt-1 text-xs text-muted-foreground">by {r.reviewer_name}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status === 'pending' ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === r.id}
                            onClick={() => onReview(r.id, 'approved')}
                          >
                            <Check className="h-4 w-4" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === r.id}
                            onClick={() => onReview(r.id, 'rejected')}
                          >
                            <X className="h-4 w-4" />
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="employees" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="year" className="text-sm">
            Year
          </Label>
          <select
            id="year"
            className={SELECT_CLASS}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            <option value="all">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {selectedEmp !== null
          ? (() => {
              const emp = employeesById.get(selectedEmp)
              const mine = requests.filter((r) => r.employee_id === selectedEmp && inYear(r))
              const approved = sumTotals(mine.filter((r) => r.status === 'approved'))
              const pending = sumTotals(mine.filter((r) => r.status === 'pending'))
              return (
                <div className="flex flex-col gap-4">
                  <div>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedEmp(null)}>
                      <ChevronLeft className="h-4 w-4" />
                      All employees
                    </Button>
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle>{emp?.name ?? 'Employee'}</CardTitle>
                      <CardDescription>
                        {year === 'all' ? 'All years' : year} · {mine.length} request(s)
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-8">
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Approved (taken)</div>
                        <div className="text-2xl font-semibold">{fmtTotals(approved)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Pending</div>
                        <div className="text-2xl font-semibold">{fmtTotals(pending)}</div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Requests</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {mine.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No requests in this period.</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Type</TableHead>
                              <TableHead>Dates</TableHead>
                              <TableHead>Duration</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {mine.map((r) => (
                              <TableRow key={r.id}>
                                <TableCell className="whitespace-nowrap">{r.leave_type || '—'}</TableCell>
                                <TableCell className="whitespace-nowrap">
                                  {formatDates(r.start_date, r.end_date)}
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                  {formatDuration(r.working_days, r.hours_requested)}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={STATUS_VARIANT[r.status]} className="capitalize">
                                    {r.status}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )
            })()
          : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserPlus className="h-5 w-5" />
                    Add employee
                  </CardTitle>
                  <CardDescription>
                    Employees are the people whose leave you track. Map incoming requests to them on
                    the Requests tab.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={onAddEmployee} className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="emp-name">Name</Label>
                      <Input
                        id="emp-name"
                        value={newEmp.name}
                        onChange={(e) => setNewEmp((s) => ({ ...s, name: e.target.value }))}
                        placeholder="Full name"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="emp-email">Email (optional)</Label>
                      <Input
                        id="emp-email"
                        type="email"
                        value={newEmp.email}
                        onChange={(e) => setNewEmp((s) => ({ ...s, email: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="emp-dept">Department (optional)</Label>
                      <Input
                        id="emp-dept"
                        value={newEmp.department}
                        onChange={(e) => setNewEmp((s) => ({ ...s, department: e.target.value }))}
                      />
                    </div>
                    <Button type="submit" disabled={addingEmp}>
                      {addingEmp ? 'Adding…' : 'Add'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>
                    Employees ({employees.length}) ·{' '}
                    <span className="font-normal text-muted-foreground">
                      {year === 'all' ? 'all years' : year}
                    </span>
                  </CardTitle>
                  <CardDescription>Click an employee to see their leave for the year.</CardDescription>
                </CardHeader>
                <CardContent>
                  {employees.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No employees yet.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Department</TableHead>
                          <TableHead>Approved (taken)</TableHead>
                          <TableHead>Pending</TableHead>
                          <TableHead className="text-right">Requests</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {employees.map((emp) => {
                          const mine = requests.filter((r) => r.employee_id === emp.id && inYear(r))
                          const approved = sumTotals(mine.filter((r) => r.status === 'approved'))
                          const pending = sumTotals(mine.filter((r) => r.status === 'pending'))
                          return (
                            <TableRow
                              key={emp.id}
                              className="cursor-pointer"
                              onClick={() => setSelectedEmp(emp.id)}
                            >
                              <TableCell className="font-medium">{emp.name}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {emp.department || '—'}
                              </TableCell>
                              <TableCell>{fmtTotals(approved)}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {fmtTotals(pending)}
                              </TableCell>
                              <TableCell className="text-right">{mine.length}</TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
      </TabsContent>
    </Tabs>
  )
}
