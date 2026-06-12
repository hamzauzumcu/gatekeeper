// Tally webhook → ImportPayload dönüştürücü + HMAC doğrulama.
// Tally imzası: "tally-signature: t=<unix>,v1=<hex>" → HMAC-SHA256(secret, t + "." + rawBody)

import { importApplications, type ImportPayload } from './import'

// ── Tally payload types ────────────────────────────────────────────────────

type TallyFieldType =
  | 'INPUT_TEXT'
  | 'INPUT_EMAIL'
  | 'INPUT_PHONE_NUMBER'
  | 'INPUT_NUMBER'
  | 'INPUT_LINK'
  | 'TEXTAREA'
  | 'MULTIPLE_CHOICE'
  | 'CHECKBOXES'
  | 'DROPDOWN'
  | 'RATING'
  | 'LINEAR_SCALE'
  | 'DATE'
  | 'FILE_UPLOAD'
  | 'HIDDEN_FIELDS'
  | string

type TallyFileValue = { url: string; name?: string; mimeType?: string; size?: number }

type TallyField = {
  key: string
  label: string
  type: TallyFieldType
  value: string | number | boolean | string[] | TallyFileValue[] | null | undefined
}

type TallyWebhookPayload = {
  eventId?: string
  eventType: string
  createdAt?: string
  data: {
    submissionId: string
    respondentId: string
    formId?: string
    formName: string
    createdAt?: string
    fields: TallyField[]
  }
}

// ── HMAC-SHA256 signature verification ────────────────────────────────────

export async function verifyTallySignature(
  secret: string,
  rawBody: string,
  header: string
): Promise<boolean> {
  // header format: "t=1234567890,v1=abc123..."
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')))
  const { t, v1 } = parts as Record<string, string>
  if (!t || !v1) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`))
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Constant-time comparison not strictly possible in JS, but HMAC is enough here.
  return computed === v1
}

// ── Field value → string ───────────────────────────────────────────────────

function extractValue(field: TallyField): string | null {
  const v = field.value
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    if (v.length === 0) return null
    // FILE_UPLOAD — array of file objects
    if (typeof v[0] === 'object' && v[0] !== null && 'url' in v[0]) {
      return (v[0] as TallyFileValue).url ?? null
    }
    // CHECKBOXES / multi-select — array of strings
    return (v as string[]).filter(Boolean).join(', ') || null
  }
  return null
}

// ── Tally type → QuestionType ──────────────────────────────────────────────

function tallyTypeToQt(type: TallyFieldType): 'text' | 'number' | 'boolean' | 'file' {
  if (type === 'FILE_UPLOAD') return 'file'
  if (type === 'INPUT_NUMBER' || type === 'RATING' || type === 'LINEAR_SCALE') return 'number'
  return 'text'
}

// ── Shared utils (mirrors src/lib/import.ts — keep in sync) ───────────────

type KnownTarget =
  | 'submission_id' | 'respondent_id' | 'submitted_at' | 'country'
  | 'first_name' | 'last_name' | 'full_name' | 'email' | 'phone'
  | 'linkedin_url' | 'cover_letter' | 'resume_url'

const KNOWN_RULES: [RegExp, KnownTarget][] = [
  [/^submission id$/i, 'submission_id'],
  [/^respondent id$/i, 'respondent_id'],
  [/^submitted at$/i, 'submitted_at'],
  [/country|ülke/i, 'country'],
  [/first ?name/i, 'first_name'],
  [/last ?name|surname|soyad/i, 'last_name'],
  [/full ?name|^name$|^ad soyad$|^isim$/i, 'full_name'],
  [/e-?mail|e-?posta/i, 'email'],
  [/phone|telefon|gsm|mobile/i, 'phone'],
  [/linkedin/i, 'linkedin_url'],
  [/cover ?letter|motivation|ön ?yazı|niyet mektubu/i, 'cover_letter'],
  [/resume|\bcv\b|özgeçmiş|upload your resume/i, 'resume_url'],
]

function classifyHeader(header: string): KnownTarget | null {
  const h = header.trim()
  for (const [re, target] of KNOWN_RULES) if (re.test(h)) return target
  return null
}

function slugify(input: string, maxLen = 60): string {
  const s = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return s.slice(0, maxLen).replace(/_+$/, '') || 'field'
}

// ── Main: Tally payload → ImportPayload ────────────────────────────────────

export function tallyToImportPayload(raw: TallyWebhookPayload): ImportPayload {
  const { data } = raw

  // Position: derive slug from form name (same logic as guessPosition)
  const formName = data.formName?.trim() || 'Application'
  const slug = slugify(formName, 60)
  const position = { slug, title: formName }

  // Classify each field: known applicant field OR position question
  const questionsByKey = new Map<string, { field_key: string; label: string; type: 'text' | 'number' | 'boolean' | 'file' }>()
  const usedKeys = new Set<string>()
  const knownByKey = new Map<string, ReturnType<typeof classifyHeader>>()

  for (const field of data.fields) {
    const target = classifyHeader(field.label)
    if (target) {
      knownByKey.set(field.key, target)
      continue
    }
    // Unknown → position question
    const qt = tallyTypeToQt(field.type)
    let fk = slugify(field.label)
    while (usedKeys.has(fk)) fk += '_x'
    usedKeys.add(fk)
    questionsByKey.set(field.key, { field_key: fk, label: field.label.trim(), type: qt })
  }

  const questions = [...questionsByKey.values()]

  // Build a single ImportRow from this submission
  const known: Record<string, string | null> = {}
  const answers: Record<string, string> = {}

  for (const field of data.fields) {
    const val = extractValue(field)
    const target = knownByKey.get(field.key)
    if (target) {
      known[target] = val
    } else {
      const q = questionsByKey.get(field.key)
      if (q && val !== null) answers[q.field_key] = val
    }
  }

  // Compose full_name from parts when no explicit full_name field
  const full_name =
    known['full_name'] ??
    ([known['first_name'], known['last_name']].filter(Boolean).join(' ') || null)

  const submissionId = data.submissionId
  const respondentId = data.respondentId

  const row = {
    submission_id: submissionId,
    respondent_id: respondentId,
    submitted_at: data.createdAt ?? null,
    full_name,
    email: known['email'] ?? null,
    phone: known['phone'] ?? null,
    country: known['country'] ?? null,
    linkedin_url: known['linkedin_url'] ?? null,
    resume_url: known['resume_url'] ?? null,
    cover_letter: known['cover_letter'] ?? null,
    answers,
  }

  return { position, questions, rows: [row] }
}

// ── Handler called from index.ts ───────────────────────────────────────────

export async function handleTallyWebhook(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string | undefined,
  db: D1Database,
  resumes: R2Bucket,
  r2PublicUrl: string
): Promise<{ status: number; body: object }> {
  // Signature check — skip only if no secret configured (dev mode)
  if (webhookSecret) {
    if (!signatureHeader) return { status: 401, body: { ok: false, error: 'missing signature' } }
    const valid = await verifyTallySignature(webhookSecret, rawBody, signatureHeader)
    if (!valid) return { status: 401, body: { ok: false, error: 'invalid signature' } }
  }

  let payload: TallyWebhookPayload
  try {
    payload = JSON.parse(rawBody) as TallyWebhookPayload
  } catch {
    return { status: 400, body: { ok: false, error: 'invalid JSON' } }
  }

  // We only care about form responses
  if (payload.eventType !== 'FORM_RESPONSE') {
    return { status: 200, body: { ok: true, skipped: true, eventType: payload.eventType } }
  }

  if (!payload.data?.submissionId || !payload.data?.respondentId) {
    return { status: 400, body: { ok: false, error: 'submissionId/respondentId required' } }
  }

  const importPayload = tallyToImportPayload(payload)

  try {
    const summary = await importApplications(db, importPayload, resumes, r2PublicUrl)
    return { status: 200, body: { ok: true, summary } }
  } catch (e) {
    return { status: 500, body: { ok: false, error: e instanceof Error ? e.message : 'import error' } }
  }
}
