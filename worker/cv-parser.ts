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
- total_experience_years: sum of all work experience, 1 decimal precision
- work_history: sorted newest to oldest
- months: calculate from start/end dates if given; otherwise estimate from "X years Y months" in the CV
- Use null for unknown fields, do not guess`

  let raw: string
  if (resume_text) {
    raw = await deepseekChat(
      deepseekApiKey,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: resume_text },
      ],
      { model: 'deepseek-v4-flash', thinking: 'disabled', jsonMode: true },
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
  const fields = JSON.parse(jsonText)

  if (Array.isArray(fields.education)) {
    for (const entry of fields.education) {
      if (typeof entry.school === 'string') {
        entry.school = normalizeUniversity(entry.school)
      }
    }
  }

  await db
    .prepare(
      `UPDATE applications
       SET resume_text = ?, resume_parsed = ?, resume_parse_version = ?
       WHERE id = ?`,
    )
    .bind(resume_text, JSON.stringify(fields), PARSE_VERSION, applicationId)
    .run()
}
