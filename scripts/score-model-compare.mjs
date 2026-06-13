// Compare candidate scoring across multiple LLM providers / models.
//
// Pulls a random sample of applications (that have a scoring prompt) from the REMOTE
// D1 database via wrangler, then scores each one with every configured model and
// prints a side-by-side terminal table. The exact same input (scoring prompt as the
// system message + CV / cover letter / form answers as the user message) is sent to
// every model — only the model changes — so the scores are directly comparable.
//
// Read-only: it NEVER writes scores back to the database.
//
// Models compared (each needs its provider's API key in the environment):
//   ds-flash  deepseek-v4-flash   (DeepSeek)  — current production setup
//   ds-pro    deepseek-v4-pro     (DeepSeek)
//   gpt-5.5   gpt-5.5             (OpenAI)
//   gpt-5.4   gpt-5.4             (OpenAI)
//   gpt-5.4m  gpt-5.4-mini        (OpenAI)
//   opus-4.8  claude-opus-4-8     (Anthropic)
//   gemini    gemini-3.5-flash    (Google)
//
// A provider whose API key is missing is skipped automatically (shown as "-key").
//
// Usage:
//   DEEPSEEK_API_KEY=... OPENAI_API_KEY=... ANTHROPIC_API_KEY=... GEMINI_API_KEY=... \
//     node scripts/score-model-compare.mjs [sampleSize] [concurrency]
//
// Defaults: sampleSize=50, concurrency=6

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
const REQUEST_TIMEOUT_MS = 120_000
const MAX_TOKENS = 8192 // generous so reasoning-heavy models don't truncate the JSON

const PER_POSITION = Number(process.argv[2]) || 5
const CONCURRENCY = Number(process.argv[3]) || 6

// Sample PER_POSITION candidates from each of these positions, preferring ones that
// actually have a CV (so the comparison is meaningful — models that require CV evidence
// score 0 when none is present).
const POSITIONS = [
  { label: 'Backend', like: 'Backend Engineer' },
  { label: 'Apple Search Ads', like: 'Apple Search Ads Campaign Manager' },
]

// NOTE: GPT-5.x and Gemini 3.5 model IDs are post-knowledge-cutoff guesses — adjust
// the `model` strings below if a provider returns a 404 / "model not found".
const VARIANTS = [
  { key: 'ds-flash', provider: 'deepseek', model: 'deepseek-v4-flash' },
  { key: 'ds-pro', provider: 'deepseek', model: 'deepseek-v4-pro' },
  { key: 'gpt-5.5', provider: 'openai', model: 'gpt-5.5' },
  { key: 'gpt-5.4', provider: 'openai', model: 'gpt-5.4' },
  { key: 'gpt-5.4m', provider: 'openai', model: 'gpt-5.4-mini' },
  { key: 'opus-4.8', provider: 'anthropic', model: 'claude-opus-4-8' },
  { key: 'gemini', provider: 'google', model: 'gemini-3.5-flash' },
]

const KEYS = {
  deepseek: process.env.DEEPSEEK_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  google: process.env.GEMINI_API_KEY,
}

// Structured-output schema for the providers that support it (score 0-100 + reasoning).
const SCORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'integer' },
    reasoning: { type: 'string' },
  },
  required: ['score', 'reasoning'],
}

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

// --- Provider callers — each returns the model's raw JSON text answer ------------------

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

// DeepSeek — OpenAI-compatible, mirrors the production scorer (json_object, no thinking).
async function callDeepseek(model, system, user) {
  const data = await postJson(
    'https://api.deepseek.com/chat/completions',
    { Authorization: `Bearer ${KEYS.deepseek}` },
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 1,
      max_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    }
  )
  const choice = data.choices[0]
  if (choice.finish_reason === 'length') throw new Error('CUT')
  const content = choice.message.content ?? ''
  if (!content.trim()) throw new Error('EMPTY')
  return content
}

// OpenAI — chat completions with json_schema structured output.
async function callOpenai(model, system, user) {
  const data = await postJson(
    'https://api.openai.com/v1/chat/completions',
    { Authorization: `Bearer ${KEYS.openai}` },
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_completion_tokens: MAX_TOKENS,
      reasoning_effort: 'low', // minimize reasoning tokens — faster / cheaper
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'candidate_score', strict: true, schema: SCORE_SCHEMA },
      },
    }
  )
  const choice = data.choices[0]
  if (choice.finish_reason === 'length') throw new Error('CUT')
  const content = choice.message.content ?? ''
  if (!content.trim()) throw new Error('EMPTY')
  return content
}

// Anthropic — /v1/messages. System is a separate field; no temperature/prefill on Opus 4.8.
// output_config.format forces clean JSON matching SCORE_SCHEMA.
async function callAnthropic(model, system, user) {
  const data = await postJson(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': KEYS.anthropic, 'anthropic-version': '2023-06-01' },
    {
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema: SCORE_SCHEMA } },
    }
  )
  if (data.stop_reason === 'refusal') throw new Error('REFUSED')
  if (data.stop_reason === 'max_tokens') throw new Error('CUT')
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  if (!text.trim()) throw new Error('EMPTY')
  return text
}

// Google Gemini — generateContent with JSON response mime type + schema.
async function callGoogle(model, system, user) {
  const data = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { 'x-goog-api-key': KEYS.google },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: MAX_TOKENS,
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties: { score: { type: 'INTEGER' }, reasoning: { type: 'STRING' } }, required: ['score', 'reasoning'] },
        thinkingConfig: { thinkingBudget: 0 }, // disable thinking — faster / cheaper
      },
    }
  )
  const cand = data.candidates?.[0]
  if (!cand) throw new Error('EMPTY')
  if (cand.finishReason && cand.finishReason !== 'STOP') throw new Error(cand.finishReason === 'MAX_TOKENS' ? 'CUT' : cand.finishReason)
  const text = (cand.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (!text.trim()) throw new Error('EMPTY')
  return text
}

const CALLERS = {
  deepseek: callDeepseek,
  openai: callOpenai,
  anthropic: callAnthropic,
  google: callGoogle,
}

function parseScore(raw) {
  const jsonText = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
  const result = JSON.parse(jsonText)
  if (result.score == null || Number.isNaN(Number(result.score))) {
    throw new Error(`no score in: ${jsonText.slice(0, 100)}`)
  }
  return Math.min(100, Math.max(0, Math.round(Number(result.score))))
}

// --- Build the same prompt payload scoreApplication() uses ---------------------------

// The CV text the scorer should see. Mirrors the proposed fix: use resume_text when
// present, otherwise recover it from resume_parsed (the cached OCR result) — its
// resume_text field when available, else synthesized from the structured fields.
// Mirror worker/cv-parser.ts looksLikeText: the regex extractor emits short binary
// garbage that is non-empty but unreadable — treat only long, mostly-readable text as real.
const MIN_CV_TEXT_LEN = 200
function looksLikeText(s) {
  const t = (s ?? '').trim()
  if (t.length < MIN_CV_TEXT_LEN) return false
  const readable = (t.match(/[\p{L}\s]/gu) || []).length
  return readable / t.length > 0.6
}

function cvText(app) {
  if (looksLikeText(app.resume_text)) return app.resume_text
  if (!app.resume_parsed) return null
  let p
  try {
    p = JSON.parse(app.resume_parsed)
  } catch {
    return null
  }
  if (looksLikeText(p.resume_text)) return p.resume_text
  const lines = []
  if (p.summary) lines.push(`Summary: ${p.summary}`)
  if (p.total_experience_years != null) lines.push(`Total experience (years): ${p.total_experience_years}`)
  if (p.seniority) lines.push(`Seniority: ${p.seniority}`)
  if (Array.isArray(p.education) && p.education.length) {
    lines.push('Education:\n' + p.education.map((e) => `- ${e.degree ?? ''} @ ${e.school ?? ''}${e.year ? ` (${e.year})` : ''}`).join('\n'))
  }
  if (Array.isArray(p.work_history) && p.work_history.length) {
    lines.push('Work history:\n' + p.work_history.map((w) => `- ${w.role ?? ''} @ ${w.company ?? ''} (${w.start ?? '?'}–${w.end ?? 'present'}${w.months ? `, ${w.months} mo` : ''})`).join('\n'))
  }
  if (Array.isArray(p.skills) && p.skills.length) lines.push('Skills: ' + p.skills.join(', '))
  return lines.length ? lines.join('\n') : null
}

function buildUserContent(app, answers) {
  const parts = []
  const cv = cvText(app)
  if (cv?.trim()) parts.push(`=== CV / Resume ===\n${cv}`)
  if (app.cover_letter?.trim()) parts.push(`=== Cover Letter ===\n${app.cover_letter}`)
  const own = answers.filter((a) => a.application_id === app.id)
  if (own.length > 0) {
    const text = own.map((a) => `${a.label}: ${a.value ?? '—'}`).join('\n')
    parts.push(`=== Application Form Answers ===\n${text}`)
  }
  return parts.length > 0 ? parts.join('\n\n') : null
}

// --- Concurrency pool ----------------------------------------------------------------

async function runPool(tasks, limit) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) await tasks[i++]()
  })
  await Promise.all(workers)
}

// --- Table rendering -----------------------------------------------------------------

function pad(s, w) {
  s = String(s)
  return s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w)
}
function padLeft(s, w) {
  s = String(s)
  return s.length > w ? s.slice(0, w) : s.padStart(w)
}

// --- Main ----------------------------------------------------------------------------

async function main() {
  const active = VARIANTS.filter((v) => KEYS[v.provider])
  const skipped = VARIANTS.filter((v) => !KEYS[v.provider])
  if (active.length === 0) {
    console.error('No API keys set. Provide at least one of DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY.')
    process.exit(1)
  }
  if (skipped.length > 0) {
    console.log(`Skipping (no API key): ${skipped.map((v) => v.key).join(', ')}`)
  }

  const cols = `a.id, a.applicant_id, ap.full_name, a.cover_letter, a.resume_text, a.resume_parsed,
                a.ai_score AS prod_score, jp.title AS position_title, sp.prompt AS scoring_prompt`
  const sub = (like) =>
    `SELECT * FROM (
       SELECT ${cols}
       FROM applications a
       JOIN applicants ap ON ap.id = a.applicant_id
       JOIN job_positions jp ON jp.id = a.position_id
       JOIN scoring_prompts sp ON sp.position_id = a.position_id
       WHERE jp.title LIKE '${like}'
       ORDER BY (CASE WHEN a.resume_text IS NOT NULL AND TRIM(a.resume_text) <> '' THEN 0 ELSE 1 END), RANDOM()
       LIMIT ${PER_POSITION}
     )`
  console.log(`Fetching ${PER_POSITION} per position [${POSITIONS.map((p) => p.label).join(', ')}] from remote D1 (${DB_NAME})…`)
  const apps = await d1Query(POSITIONS.map((p) => sub(p.like)).join('\n     UNION ALL\n'))
  if (apps.length === 0) {
    console.error('No applications with a scoring prompt found.')
    process.exit(1)
  }

  const ids = apps.map((a) => a.id).join(',')
  const answers = await d1Query(
    `SELECT aa.application_id, pq.label, aa.value
     FROM application_answers aa
     JOIN position_questions pq ON pq.id = aa.question_id
     WHERE aa.application_id IN (${ids})
     ORDER BY pq.sort_order`
  )

  const rows = apps.map((app) => ({ app, content: buildUserContent(app, answers), scores: {} }))
  const tasks = []
  for (const row of rows) {
    if (!row.content) continue
    for (const v of active) {
      tasks.push(async () => {
        try {
          const raw = await CALLERS[v.provider](v.model, row.app.scoring_prompt, row.content)
          if (process.env.DEBUG) console.error(`  [DEBUG] app ${row.app.id} / ${v.key} raw: ${JSON.stringify(raw).slice(0, 400)}`)
          row.scores[v.key] = parseScore(raw)
        } catch (e) {
          const m = e.message || String(e)
          row.scores[v.key] = m.startsWith('CUT') ? 'CUT' : m.startsWith('EMPTY') ? 'EMPTY' : m.startsWith('REFUSED') ? 'REF' : 'ERR'
          console.error(`  app ${row.app.id} / ${v.key}: ${m}`)
        }
      })
    }
  }

  const scorable = rows.filter((r) => r.content).length
  console.log(`Scoring ${scorable} candidates × ${active.length} models = ${tasks.length} calls (concurrency ${CONCURRENCY})…\n`)
  await runPool(tasks, CONCURRENCY)

  // Table
  const header =
    pad('appID', 6) + pad('applID', 7) + pad('Name', 16) + pad('Position', 16) + padLeft('prod', 6) +
    active.map((v) => padLeft(v.key, 9)).join('') + '  ' + padLeft('spread', 7)
  console.log(header)
  console.log('-'.repeat(header.length))

  const sums = Object.fromEntries(active.map((v) => [v.key, { total: 0, n: 0 }]))
  for (const row of rows) {
    if (!row.content) {
      console.log(pad(row.app.id, 6) + pad(row.app.applicant_id, 7) + pad(row.app.full_name ?? '—', 16) + pad(row.app.position_title, 16) + '  (no scorable content — skipped)')
      continue
    }
    const vals = active.map((v) => row.scores[v.key])
    const nums = vals.filter((n) => typeof n === 'number')
    const spread = nums.length > 1 ? Math.max(...nums) - Math.min(...nums) : 0
    for (const v of active) {
      const s = row.scores[v.key]
      if (typeof s === 'number') {
        sums[v.key].total += s
        sums[v.key].n++
      }
    }
    console.log(
      pad(row.app.id, 6) +
        pad(row.app.applicant_id, 7) +
        pad(row.app.full_name ?? '—', 16) +
        pad(row.app.position_title, 16) +
        padLeft(row.app.prod_score ?? '—', 6) +
        vals.map((s) => padLeft(s ?? '—', 9)).join('') +
        '  ' +
        padLeft(spread, 7)
    )
  }

  console.log('-'.repeat(header.length))
  console.log(
    pad('', 6) + pad('', 7) + pad('', 16) + pad('AVERAGE', 16) + padLeft('', 6) +
    active.map((v) => padLeft(sums[v.key].n ? (sums[v.key].total / sums[v.key].n).toFixed(1) : '—', 9)).join('')
  )
  console.log('\nLegend: ds-flash = current production setup. spread = max−min across the models (excludes prod).')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
