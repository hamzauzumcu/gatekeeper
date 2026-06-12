import { useState } from 'react'
import Papa from 'papaparse'
import { CheckCircle2, AlertCircle, Upload } from 'lucide-react'
import {
  classify,
  guessPosition,
  normalizeRow,
  type Classification,
  type ImportRow,
  type QuestionType,
} from './lib/import'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const CHUNK_SIZE = 1

type Parsed = {
  headers: string[]
  rows: Record<string, string>[]
  classification: Classification
}

type Summary = {
  positionId: number
  questions: number
  applicants: number
  applications: number
  answers: number
  resumes_copied: number
}

const TYPE_STYLES: Record<QuestionType, string> = {
  number: 'border-amber-200 bg-amber-50 text-amber-700',
  boolean: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  file: 'border-violet-200 bg-violet-50 text-violet-700',
  text: 'border-slate-200 bg-slate-50 text-slate-700',
}

export default function ImportPage() {
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [position, setPosition] = useState({ title: '', slug: '' })
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, status: '' })
  const [result, setResult] = useState<Summary | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError(null)
    setResult(null)
    setImportError(null)
    setFileName(file.name)
    setPosition(guessPosition(file.name))

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.replace(/^﻿/, '').trim(),
      complete: (res) => {
        const headers = (res.meta.fields ?? []).filter(Boolean)
        const rows = res.data.filter((r) => Object.values(r).some((v) => (v ?? '').trim()))
        if (!headers.length || !rows.length) {
          setParseError('CSV is empty or the header row could not be read.')
          setParsed(null)
          return
        }
        setParsed({ headers, rows, classification: classify(headers, rows) })
      },
      error: (err) => {
        setParseError(err.message)
        setParsed(null)
      },
    })
  }

  async function runImport() {
    if (!parsed) return
    if (!position.slug || !position.title) {
      setImportError('Position title and slug are required.')
      return
    }
    setBusy(true)
    setImportError(null)
    setResult(null)

    const normalized: ImportRow[] = parsed.rows.map((r) => normalizeRow(r, parsed.classification))
    const questions = parsed.classification.questions.map(({ field_key, label, type }) => ({
      field_key,
      label,
      type,
    }))

    const total = normalized.length
    setProgress({ done: 0, total, status: '' })

    const acc: Summary = { positionId: 0, questions: 0, applicants: 0, applications: 0, answers: 0, resumes_copied: 0 }
    try {
      for (let i = 0; i < normalized.length; i += CHUNK_SIZE) {
        const chunk = normalized.slice(i, i + CHUNK_SIZE)
        const row = chunk[0]
        const hasResume = !!row?.resume_url
        const name = row?.full_name ?? row?.email ?? `#${i + 1}`
        setProgress({
          done: i,
          total: normalized.length,
          status: hasResume ? `${name} — uploading CV…` : `${name} — saving…`,
        })
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position, questions, rows: chunk }),
        })
        const data = (await res.json()) as
          | { ok: true; summary: Summary }
          | { ok: false; error: string }
        if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'import error')
        acc.positionId = data.summary.positionId
        acc.questions = Math.max(acc.questions, data.summary.questions)
        acc.applicants += data.summary.applicants
        acc.applications += data.summary.applications
        acc.answers += data.summary.answers
        acc.resumes_copied += data.summary.resumes_copied ?? 0
        setProgress({
          done: i + CHUNK_SIZE,
          total: normalized.length,
          status: hasResume && (data.summary.resumes_copied ?? 0) > 0
            ? `${name} — CV uploaded ✓`
            : `${name} — saved ✓`,
        })
      }
      setResult(acc)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'import error')
    } finally {
      setBusy(false)
    }
  }

  const c = parsed?.classification
  const pct = progress.total ? Math.round((Math.min(progress.done, progress.total) / progress.total) * 100) : 0

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Import CSV</CardTitle>
          <CardDescription>
            Select a Tally CSV — columns are mapped automatically, extra questions are created automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="csv">CSV file</Label>
            <Input id="csv" type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} />
          </div>

          {parseError && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Failed to read CSV</AlertTitle>
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}

          {parsed && c && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="title">Position title</Label>
                  <Input
                    id="title"
                    value={position.title}
                    onChange={(e) => setPosition((p) => ({ ...p, title: e.target.value }))}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="slug">Slug</Label>
                  <Input
                    id="slug"
                    value={position.slug}
                    onChange={(e) => setPosition((p) => ({ ...p, slug: e.target.value }))}
                    disabled={busy}
                  />
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{parsed.rows.length}</span> rows ·{' '}
                <span className="font-medium text-foreground">{fileName}</span>
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {parsed && c && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mapped fields</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {[...c.known.entries()].map(([header, target]) => (
                <Badge key={header} variant="secondary" className="font-normal">
                  {header} <span className="mx-1 text-muted-foreground">→</span> {target}
                </Badge>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auto-generated questions ({c.questions.length})</CardTitle>
              <CardDescription>Headers outside of known columns become position questions.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Question</TableHead>
                    <TableHead>field_key</TableHead>
                    <TableHead className="w-24">Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.questions.map((q) => (
                    <TableRow key={q.field_key}>
                      <TableCell>{q.label}</TableCell>
                      <TableCell>
                        <code className="text-xs text-muted-foreground">{q.field_key}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={TYPE_STYLES[q.type]}>
                          {q.type}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <Button onClick={runImport} disabled={busy}>
              <Upload />
              {busy ? `Importing… (${Math.min(progress.done, progress.total)}/${progress.total})` : 'Import'}
            </Button>
            {busy && (
              <>
                <Progress value={pct} />
                {progress.status && (
                  <p className="text-sm text-muted-foreground">{progress.status}</p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {importError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Import failed</AlertTitle>
          <AlertDescription>{importError}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Import complete</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc">
              <li>Position ID: {result.positionId}</li>
              <li>Questions: {result.questions}</li>
              <li>Applications: {result.applications}</li>
              <li>Answers: {result.answers}</li>
              <li>CVs copied: {result.resumes_copied}</li>
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
