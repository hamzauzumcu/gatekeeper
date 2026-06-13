// CV parsing — extracts text from PDFs, parses structured data with DeepSeek.
// Text-based PDFs: BT...ET regex extraction → DeepSeek text model.
// Scanned PDFs: raw PDF buffer → GPT-4o (handles OCR natively).

import { PARSE_VERSION, PARSE_SCHEMA, UNIVERSITY_MAP } from './cv-schema'
import { deepseekChat } from './deepseek'
import { openaiParsePdf } from './openai'

function extractTextFromPdf(buffer: ArrayBuffer): string {
  // Decode PDF binary as latin-1 so ASCII text blocks become readable
  const raw = new TextDecoder('latin1').decode(buffer)

  const parts: string[] = []
  const btEtRe = /BT([\s\S]*?)ET/g
  let m: RegExpExecArray | null

  while ((m = btEtRe.exec(raw)) !== null) {
    const block = m[1]
    // (text) Tj  or  [(text)] TJ — the two PDF text operators
    const strRe = /\(([^\\)]*(?:\\.[^\\)]*)*)\)\s*(?:Tj|TJ)/g
    let s: RegExpExecArray | null
    while ((s = strRe.exec(block)) !== null) {
      const t = s[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
      if (t.trim()) parts.push(t)
    }
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export const MIN_CV_TEXT_LEN = 200

// The regex PDF extractor sometimes emits a few dozen chars of binary garbage that is
// non-empty but useless ("corrupted/unreadable" to the scoring models). Treat text as a
// real CV only if it's long enough AND mostly readable letters/spaces — latin1-decoded
// PDF noise fails the ratio test, and short extractions fail the length test.
export function looksLikeText(s: string | null | undefined): boolean {
  const t = (s ?? '').trim()
  if (t.length < MIN_CV_TEXT_LEN) return false
  const readable = (t.match(/[\p{L}\s]/gu) || []).length
  return readable / t.length > 0.6
}

// Build a readable CV text from the structured parsed fields. Last-resort fallback
// when neither the regex extraction nor the model's verbatim resume_text is available.
export function synthesizeCvText(fields: any): string {
  const lines: string[] = []
  if (fields?.summary) lines.push(`Summary: ${fields.summary}`)
  if (fields?.total_experience_years != null) lines.push(`Total experience (years): ${fields.total_experience_years}`)
  if (fields?.seniority) lines.push(`Seniority: ${fields.seniority}`)
  if (Array.isArray(fields?.education) && fields.education.length) {
    lines.push('Education:\n' + fields.education.map((e: any) => `- ${e?.degree ?? ''} @ ${e?.school ?? ''}${e?.year ? ` (${e.year})` : ''}`).join('\n'))
  }
  if (Array.isArray(fields?.work_history) && fields.work_history.length) {
    lines.push('Work history:\n' + fields.work_history.map((w: any) => `- ${w?.role ?? ''} @ ${w?.company ?? ''} (${w?.start ?? '?'}–${w?.end ?? 'present'}${w?.months ? `, ${w.months} mo` : ''})`).join('\n'))
  }
  if (Array.isArray(fields?.skills) && fields.skills.length) lines.push('Skills: ' + fields.skills.join(', '))
  return lines.join('\n')
}

// Recover the verbatim CV text cached in a resume_parsed JSON blob, if present.
export function parsedRawText(resumeParsed: string | null | undefined): string | null {
  if (!resumeParsed) return null
  try {
    const p = JSON.parse(resumeParsed)
    const t = typeof p?.resume_text === 'string' ? p.resume_text.trim() : ''
    return looksLikeText(t) ? t : null
  } catch {
    return null
  }
}

function normalizeUniversity(name: string): string {
  const lower = ` ${name.toLowerCase()} `
  for (const [pattern, canonical] of UNIVERSITY_MAP) {
    if (lower.includes(pattern)) return canonical
  }
  return name
}

async function fetchPdfBuffer(
  resumeUrl: string,
  r2Bucket?: R2Bucket,
  r2PublicUrl?: string,
): Promise<ArrayBuffer> {
  // Prefer reading from R2 directly (works in local dev + avoids public URL dependency)
  if (r2Bucket && r2PublicUrl) {
    const prefix = r2PublicUrl.endsWith('/') ? r2PublicUrl : `${r2PublicUrl}/`
    if (resumeUrl.startsWith(prefix)) {
      const key = resumeUrl.slice(prefix.length)
      const obj = await r2Bucket.get(key)
      if (!obj) throw new Error(`R2 object not found: ${key}`)
      return obj.arrayBuffer()
    }
  }
  // Fallback: HTTP fetch (Tally URLs or any external URL)
  const res = await fetch(resumeUrl)
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`)
  return res.arrayBuffer()
}

export async function parseAndStoreResume(
  db: D1Database,
  applicationId: number,
  resumeUrl: string,
  deepseekApiKey: string,
  r2Bucket?: R2Bucket,
  r2PublicUrl?: string,
  openaiApiKey?: string,
): Promise<void> {

  const buffer = await fetchPdfBuffer(resumeUrl, r2Bucket, r2PublicUrl)
  const resume_text = extractTextFromPdf(buffer)

  const systemPrompt = `You are a CV analysis expert. Extract structured data from the given CV and return ONLY valid JSON — no extra text, no code blocks.

Format to return:
${PARSE_SCHEMA}

Rules:
- summary: exactly 2 sentences, in English, highlighting years of experience and the most recent/notable role
- total_experience_years: sum of all work experience, 1 decimal precision
- seniority: exactly one of intern, junior, mid, senior, lead — infer from titles and total experience
- location: the city the candidate is currently based in (city name only)
- gpa: keep the original scale exactly as written (e.g. "3.6/4.0", "85/100"); null if not stated
- links: every personal URL found in the CV (LinkedIn, GitHub, portfolio, Twitter/X, personal site, etc.); classify each into type and keep the full URL; empty array if none
- work_history: sorted newest to oldest
- months: calculate from start/end dates if given; otherwise estimate from "X years Y months" in the CV
- Use null for unknown fields, do not guess`

  let raw: string
  if (looksLikeText(resume_text)) {
    raw = await deepseekChat(
      deepseekApiKey,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: resume_text },
      ],
      { model: 'deepseek-v4-flash', thinking: 'disabled', jsonMode: true, maxTokens: 8192 },
    )
  } else {
    // Scanned PDF — send raw PDF to GPT-4o which handles OCR natively
    if (!openaiApiKey) throw new Error('Scanned PDF requires OPENAI_API_KEY')
    raw = await openaiParsePdf(
      openaiApiKey,
      buffer,
      `${systemPrompt}\n\nExtract structured CV data from this scanned document and return ONLY valid JSON.`,
    )
  }

  // Strip ```json ... ``` wrapper if the model adds one
  const jsonText = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()

  if (!jsonText) throw new Error(`CV parse: empty model response (app ${applicationId})`)

  // Surface what the model actually returned when parsing fails — otherwise the raw
  // JSON.parse error ("Unterminated string…", "I'm sorry,"…) hides the cause:
  // truncation (output cut mid-string), a refusal (prose instead of JSON), or malformed JSON.
  let fields: any
  try {
    fields = JSON.parse(jsonText)
  } catch (e) {
    const snippet =
      jsonText.length > 600 ? `${jsonText.slice(0, 300)} … ${jsonText.slice(-300)}` : jsonText
    throw new Error(
      `CV parse failed (app ${applicationId}, ${jsonText.length} chars): ${(e as Error).message} — model output: ${snippet}`
    )
  }

  if (Array.isArray(fields.education)) {
    for (const entry of fields.education) {
      if (typeof entry.school === 'string') {
        entry.school = normalizeUniversity(entry.school)
      }
    }
  }

  // Average tenure (months) across work history — a job-hopping signal.
  // Computed deterministically here rather than asking the model to do arithmetic.
  if (Array.isArray(fields.work_history)) {
    const tenures = fields.work_history
      .map((w: { months?: unknown }) => Number(w?.months))
      .filter((n: number) => Number.isFinite(n) && n > 0)
    fields.avg_tenure_months =
      tenures.length > 0
        ? Math.round(tenures.reduce((a: number, b: number) => a + b, 0) / tenures.length)
        : null
  }

  // resume_text column must never be empty: prefer the regex extraction, then the
  // model's verbatim resume_text, then a synthesized version from structured fields.
  // The verbatim text lives in the column, so drop it from resume_parsed to avoid
  // storing the (often large) CV body twice.
  const modelText = typeof fields.resume_text === 'string' ? fields.resume_text.trim() : ''
  delete fields.resume_text
  const fullText = looksLikeText(resume_text) ? resume_text : modelText || synthesizeCvText(fields)

  await db
    .prepare(
      `UPDATE applications
       SET resume_text = ?, resume_parsed = ?, resume_parse_version = ?
       WHERE id = ?`,
    )
    .bind(fullText, JSON.stringify(fields), PARSE_VERSION, applicationId)
    .run()
}
