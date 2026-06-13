// Compare CV PDF *parsing* quality across multiple multimodal LLMs.
//
// Pulls a random sample of applications that have a resume_url from the REMOTE D1
// database via wrangler, fetches each PDF, then sends the exact same raw PDF + the
// exact same parse prompt to every model. The only thing that changes is the model,
// so the extracted structured fields are directly comparable.
//
// Read-only: it NEVER writes anything back to the database.
//
// Models compared (each needs its provider's API key in the environment):
//   gpt-4o    gpt-4o            (OpenAI)     — current production scanned-PDF parser
//   opus-4.8  claude-opus-4-8   (Anthropic)
//   gemini    gemini-3.5-flash  (Google)
//
// A provider whose API key is missing is skipped automatically.
//
// Usage:
//   OPENAI_API_KEY=... ANTHROPIC_API_KEY=... GEMINI_API_KEY=... \
//     node scripts/parse-model-compare.mjs [sampleSize] [concurrency]
//
// Defaults: sampleSize=8, concurrency=4

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const execFileAsync = promisify(execFile)

// Load .dev.vars (same file wrangler uses for local secrets) into process.env so keys
// don't have to be exported manually. Existing env vars win over the file.
function loadDevVars() {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '.dev.vars')
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
loadDevVars()

const DB_NAME = 'gatekeeper'
const REQUEST_TIMEOUT_MS = 180_000
const MAX_TOKENS = 8192 // CVs can be long; give room for the full verbatim resume_text

const SAMPLE_SIZE = Number(process.argv[2]) || 8
const CONCURRENCY = Number(process.argv[3]) || 4

// NOTE: gemini-3.5-flash is a post-knowledge-cutoff guess — adjust the `model` string
// below if Google returns a 404 / "model not found".
const VARIANTS = [
  { key: 'gpt-4o', provider: 'openai', model: 'gpt-4o' },
  { key: 'opus-4.8', provider: 'anthropic', model: 'claude-opus-4-8' },
  { key: 'gemini', provider: 'google', model: 'gemini-3.5-flash' },
]

const KEYS = {
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  google: process.env.GEMINI_API_KEY,
}

// --- The parse prompt — kept in sync with worker/cv-parser.ts + worker/cv-schema.ts ---

const PARSE_SCHEMA = `{
  "resume_text": "the full plain-text content of the CV verbatim — every section in readable top-to-bottom order, including job descriptions and responsibilities; this is what downstream scoring reads",
  "summary": "concise 2-sentence professional summary in English, e.g. '5 years of React experience, last 2 years as frontend lead at Getir.'",
  "total_experience_years": "total work experience in years (decimal, e.g. 3.5), null if unknown",
  "seniority": "exactly one of: intern, junior, mid, senior, lead — inferred from titles and total experience; null if unclear",
  "location": "city the candidate is currently based in, null if unknown",
  "education": [
    { "school": "school/university name", "degree": "field of study or degree", "year": "graduation year as integer or null", "gpa": "GPA / grade as written incl. its scale, e.g. '3.6/4.0' or '85/100', null if not stated" }
  ],
  "links": [
    { "type": "one of: linkedin, github, portfolio, twitter, website, other", "url": "full URL including https://" }
  ],
  "work_history": [
    {
      "company": "company name",
      "role": "position/title",
      "start": "start date in YYYY-MM format or null",
      "end": "end date in YYYY-MM format, null if still employed",
      "months": "duration in this position in months as integer or null"
    }
  ],
  "skills": ["list of technical skills"],
  "languages": ["list of languages"]
}`

const SYSTEM_PROMPT = `You are a CV analysis expert. Extract structured data from the given CV and return ONLY valid JSON — no extra text, no code blocks.

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
- Use null for unknown fields, do not guess

Extract structured CV data from this document and return ONLY valid JSON.`

// --- D1 access via wrangler (remote) -------------------------------------------------

async function d1Query(sql) {
  const { stdout } = await execFileAsync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_NAME, '--remote', '--json', '--command', sql],
    { maxBuffer: 64 * 1024 * 1024 }
  )
  const start = stdout.indexOf('[')
  const parsed = JSON.parse(stdout.slice(start))
  return parsed[0]?.results ?? []
}

// --- PDF fetch + base64 --------------------------------------------------------------

async function fetchPdfBase64(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`PDF fetch ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return { base64: Buffer.from(binary, 'binary').toString('base64'), bytes: bytes.length }
}

// --- Provider callers — each gets the same PDF + prompt, returns raw JSON text --------

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

// OpenAI — chat completions with a base64 PDF file input (mirrors worker/openai.ts).
async function callOpenai(model, base64) {
  const data = await postJson(
    'https://api.openai.com/v1/chat/completions',
    { Authorization: `Bearer ${KEYS.openai}` },
    {
      model,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'file', file: { filename: 'cv.pdf', file_data: `data:application/pdf;base64,${base64}` } },
            { type: 'text', text: SYSTEM_PROMPT },
          ],
        },
      ],
    }
  )
  const choice = data.choices[0]
  if (choice.finish_reason === 'length') throw new Error('CUT')
  const content = choice.message.content ?? ''
  if (!content.trim()) throw new Error('EMPTY')
  return content
}

// Anthropic — /v1/messages with a base64 document block. Opus 4.8 reads PDFs natively.
async function callAnthropic(model, base64) {
  const data = await postJson(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': KEYS.anthropic, 'anthropic-version': '2023-06-01' },
    {
      model,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: SYSTEM_PROMPT },
          ],
        },
      ],
    }
  )
  if (data.stop_reason === 'refusal') throw new Error('REFUSED')
  if (data.stop_reason === 'max_tokens') throw new Error('CUT')
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  if (!text.trim()) throw new Error('EMPTY')
  return text
}

// Google Gemini — generateContent with an inline PDF part.
async function callGoogle(model, base64) {
  const data = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { 'x-goog-api-key': KEYS.google },
    {
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: base64 } },
            { text: SYSTEM_PROMPT },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: MAX_TOKENS, responseMimeType: 'application/json' },
    }
  )
  const cand = data.candidates?.[0]
  if (!cand) throw new Error('EMPTY')
  if (cand.finishReason && cand.finishReason !== 'STOP') {
    throw new Error(cand.finishReason === 'MAX_TOKENS' ? 'CUT' : cand.finishReason)
  }
  const text = (cand.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (!text.trim()) throw new Error('EMPTY')
  return text
}

const CALLERS = {
  openai: callOpenai,
  anthropic: callAnthropic,
  google: callGoogle,
}

function parseFields(raw) {
  const jsonText = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
  return JSON.parse(jsonText)
}

// --- Concurrency pool ----------------------------------------------------------------

async function runPool(tasks, limit) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) await tasks[i++]()
  })
  await Promise.all(workers)
}

// --- Field extraction for the comparison table ---------------------------------------

function summarizeFields(f) {
  if (!f || typeof f !== 'object') return null
  const wh = Array.isArray(f.work_history) ? f.work_history : []
  const edu = Array.isArray(f.education) ? f.education : []
  return {
    exp: f.total_experience_years ?? '—',
    seniority: f.seniority ?? '—',
    company: wh[0]?.company ?? '—',
    role: wh[0]?.role ?? '—',
    uni: edu[0]?.school ?? '—',
    jobs: wh.length,
    skills: Array.isArray(f.skills) ? f.skills.length : 0,
    links: Array.isArray(f.links) ? f.links.length : 0,
    cvLen: typeof f.resume_text === 'string' ? f.resume_text.length : 0,
  }
}

function pad(s, w) {
  s = String(s)
  return s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w)
}

// --- Main ----------------------------------------------------------------------------

async function main() {
  const active = VARIANTS.filter((v) => KEYS[v.provider])
  const skipped = VARIANTS.filter((v) => !KEYS[v.provider])
  if (active.length === 0) {
    console.error('No API keys set. Provide at least one of OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY.')
    process.exit(1)
  }
  if (skipped.length > 0) {
    console.log(`Skipping (no API key): ${skipped.map((v) => v.key).join(', ')}`)
  }

  console.log(`Fetching ${SAMPLE_SIZE} applications with a resume_url from remote D1 (${DB_NAME})…`)
  const apps = await d1Query(
    `SELECT a.id, a.resume_url, jp.title AS position_title
     FROM applications a
     JOIN job_positions jp ON jp.id = a.position_id
     WHERE a.resume_url IS NOT NULL AND TRIM(a.resume_url) <> ''
     ORDER BY RANDOM()
     LIMIT ${SAMPLE_SIZE}`
  )
  if (apps.length === 0) {
    console.error('No applications with a resume_url found.')
    process.exit(1)
  }

  const rows = []
  for (const app of apps) {
    process.stdout.write(`  fetching PDF for app ${app.id}… `)
    try {
      const { base64, bytes } = await fetchPdfBase64(app.resume_url)
      console.log(`${(bytes / 1024).toFixed(0)} KB`)
      rows.push({ app, base64, results: {} })
    } catch (e) {
      console.log(`FAILED (${e.message}) — skipping`)
    }
  }
  if (rows.length === 0) {
    console.error('No PDFs could be fetched.')
    process.exit(1)
  }

  const tasks = []
  for (const row of rows) {
    for (const v of active) {
      tasks.push(async () => {
        const start = process.hrtime.bigint()
        try {
          const raw = await CALLERS[v.provider](v.model, row.base64)
          if (process.env.DEBUG) console.error(`  [DEBUG] app ${row.app.id} / ${v.key} raw: ${raw.slice(0, 300)}`)
          const fields = parseFields(raw)
          const ms = Number(process.hrtime.bigint() - start) / 1e6
          row.results[v.key] = { ok: true, fields, summary: summarizeFields(fields), ms }
        } catch (e) {
          const ms = Number(process.hrtime.bigint() - start) / 1e6
          const m = e.message || String(e)
          const tag = m.startsWith('CUT') ? 'CUT' : m.startsWith('EMPTY') ? 'EMPTY' : m.startsWith('REFUSED') ? 'REFUSED' : m.slice(0, 60)
          row.results[v.key] = { ok: false, error: tag, ms }
          console.error(`  app ${row.app.id} / ${v.key}: ${m}`)
        }
      })
    }
  }

  console.log(`\nParsing ${rows.length} PDFs × ${active.length} models = ${tasks.length} calls (concurrency ${CONCURRENCY})…\n`)
  await runPool(tasks, CONCURRENCY)

  // Per-candidate side-by-side comparison.
  const FIELDS = [
    ['exp', 'Exp (yrs)'],
    ['seniority', 'Seniority'],
    ['company', 'Current Co.'],
    ['role', 'Current Role'],
    ['uni', 'University'],
    ['jobs', '#Jobs'],
    ['skills', '#Skills'],
    ['links', '#Links'],
    ['cvLen', 'CV text len'],
  ]
  const COL = 22

  for (const row of rows) {
    console.log('\n' + '='.repeat(18 + COL * active.length))
    console.log(`App ${row.app.id} — ${row.app.position_title}`)
    console.log('-'.repeat(18 + COL * active.length))
    // Header
    console.log(pad('field', 16) + active.map((v) => pad(v.key, COL)).join(''))
    // Latency / status
    console.log(
      pad('latency', 16) +
        active
          .map((v) => {
            const r = row.results[v.key]
            return pad(r?.ok ? `${(r.ms / 1000).toFixed(1)}s` : `ERR: ${r?.error ?? '?'}`, COL)
          })
          .join('')
    )
    for (const [key, label] of FIELDS) {
      console.log(
        pad(label, 16) +
          active
            .map((v) => {
              const r = row.results[v.key]
              return pad(r?.ok ? r.summary?.[key] ?? '—' : '—', COL)
            })
            .join('')
      )
    }
  }

  // Aggregate: average latency + success rate per model.
  console.log('\n' + '='.repeat(50))
  console.log('SUMMARY (across all PDFs)')
  console.log('-'.repeat(50))
  console.log(pad('model', 14) + pad('ok/total', 12) + pad('avg latency', 14) + pad('avg CV len', 12))
  for (const v of active) {
    const rs = rows.map((r) => r.results[v.key]).filter(Boolean)
    const ok = rs.filter((r) => r.ok)
    const avgMs = ok.length ? ok.reduce((a, r) => a + r.ms, 0) / ok.length : 0
    const avgLen = ok.length ? ok.reduce((a, r) => a + (r.summary?.cvLen ?? 0), 0) / ok.length : 0
    console.log(
      pad(v.key, 14) +
        pad(`${ok.length}/${rs.length}`, 12) +
        pad(ok.length ? `${(avgMs / 1000).toFixed(1)}s` : '—', 14) +
        pad(ok.length ? Math.round(avgLen) : '—', 12)
    )
  }
  console.log('\nLegend: gpt-4o = current production scanned-PDF parser. CV text len = chars of verbatim resume_text extracted (higher ≈ more complete OCR).')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
