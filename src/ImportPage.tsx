import { useState } from 'react'
import Papa from 'papaparse'
import {
  classify,
  guessPosition,
  normalizeRow,
  type Classification,
  type ImportRow,
} from './lib/import'

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

  return (
    <section className="import">
      <h2>CSV İçe Aktar</h2>
      <p className="muted">Tally CSV'sini seç — kolonlar otomatik eşlenir, ekstra sorular otomatik oluşturulur.</p>

      <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} />
      {parseError && <p className="status-error">{parseError}</p>}

      {parsed && c && (
        <>
          <div className="grid2">
            <label>
              Pozisyon başlığı
              <input
                value={position.title}
                onChange={(e) => setPosition((p) => ({ ...p, title: e.target.value }))}
                disabled={busy}
              />
            </label>
            <label>
              Slug
              <input
                value={position.slug}
                onChange={(e) => setPosition((p) => ({ ...p, slug: e.target.value }))}
                disabled={busy}
              />
            </label>
          </div>

          <p className="muted">
            <strong>{parsed.rows.length}</strong> satır · <strong>{fileName}</strong>
          </p>

          <h3>Eşlenen alanlar</h3>
          <div className="badges">
            {[...c.known.entries()].map(([header, target]) => (
              <span className="badge badge-known" key={header}>
                {header} <span className="arrow">→</span> {target}
              </span>
            ))}
          </div>

          <h3>Otomatik sorular ({c.questions.length})</h3>
          <table className="qtable">
            <thead>
              <tr>
                <th>Soru</th>
                <th>field_key</th>
                <th>Tip</th>
              </tr>
            </thead>
            <tbody>
              {c.questions.map((q) => (
                <tr key={q.field_key}>
                  <td>{q.label}</td>
                  <td><code>{q.field_key}</code></td>
                  <td><span className={`pill pill-${q.type}`}>{q.type}</span></td>
                </tr>
              ))}
            </tbody>
          </table>

          <button onClick={runImport} disabled={busy} className="primary">
            {busy ? `İçe aktarılıyor… (${progress.done}/${progress.total})` : 'İçe aktar'}
          </button>
        </>
      )}

      {importError && <p className="status-error">Hata: {importError}</p>}
      {result && (
        <div className="result">
          <strong className="status-ok">İçe aktarma tamamlandı ✓</strong>
          <ul>
            <li>Pozisyon ID: {result.positionId}</li>
            <li>Soru: {result.questions}</li>
            <li>Başvuru (application): {result.applications}</li>
            <li>Cevap: {result.answers}</li>
          </ul>
        </div>
      )}
    </section>
  )
}
