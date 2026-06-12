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

const CHUNK_SIZE = 50

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
  const [progress, setProgress] = useState({ done: 0, total: 0 })
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
          setParseError('CSV boş ya da başlık satırı okunamadı.')
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
      setImportError('Pozisyon başlığı ve slug gerekli.')
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

    const total = Math.ceil(normalized.length / CHUNK_SIZE)
    setProgress({ done: 0, total })

    const acc: Summary = { positionId: 0, questions: 0, applicants: 0, applications: 0, answers: 0 }
    try {
      for (let i = 0; i < normalized.length; i += CHUNK_SIZE) {
        const chunk = normalized.slice(i, i + CHUNK_SIZE)
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position, questions, rows: chunk }),
        })
        const data = (await res.json()) as
          | { ok: true; summary: Summary }
          | { ok: false; error: string }
        if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'import hatası')
        acc.positionId = data.summary.positionId
        acc.questions = Math.max(acc.questions, data.summary.questions)
        acc.applicants += data.summary.applicants
        acc.applications += data.summary.applications
        acc.answers += data.summary.answers
        setProgress({ done: i / CHUNK_SIZE + 1, total })
      }
      setResult(acc)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'import hatası')
    } finally {
      setBusy(false)
    }
  }

  const c = parsed?.classification
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>CSV İçe Aktar</CardTitle>
          <CardDescription>
            Tally CSV'sini seç — kolonlar otomatik eşlenir, ekstra sorular otomatik oluşturulur.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="csv">CSV dosyası</Label>
            <Input id="csv" type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} />
          </div>

          {parseError && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>CSV okunamadı</AlertTitle>
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}

          {parsed && c && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="title">Pozisyon başlığı</Label>
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
                <span className="font-medium text-foreground">{parsed.rows.length}</span> satır ·{' '}
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
              <CardTitle className="text-base">Eşlenen alanlar</CardTitle>
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
              <CardTitle className="text-base">Otomatik sorular ({c.questions.length})</CardTitle>
              <CardDescription>Bilinen kolonlar dışındaki başlıklar pozisyon sorusu olur.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Soru</TableHead>
                    <TableHead>field_key</TableHead>
                    <TableHead className="w-24">Tip</TableHead>
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
              {busy ? `İçe aktarılıyor… (${progress.done}/${progress.total})` : 'İçe aktar'}
            </Button>
            {busy && <Progress value={pct} />}
          </div>
        </>
      )}

      {importError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>İçe aktarma başarısız</AlertTitle>
          <AlertDescription>{importError}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>İçe aktarma tamamlandı</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc">
              <li>Pozisyon ID: {result.positionId}</li>
              <li>Soru: {result.questions}</li>
              <li>Başvuru (application): {result.applications}</li>
              <li>Cevap: {result.answers}</li>
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
