// Tally CSV → DB import: column classification + row normalization (browser-side).
// Worker receives the ImportPayload produced by this module; classification happens here.

export type QuestionType = 'text' | 'number' | 'boolean' | 'file'

export type ImportQuestion = {
  field_key: string
  label: string
  type: QuestionType
  /** original CSV header — we read the value from here during normalization */
  header: string
}

export type ImportRow = {
  submission_id: string
  respondent_id: string
  submitted_at: string | null
  full_name: string | null
  email: string | null
  phone: string | null
  country: string | null
  linkedin_url: string | null
  resume_url: string | null
  cover_letter: string | null
  answers: Record<string, string> // field_key -> raw value (only non-empty)
}

export type ImportPayload = {
  position: { slug: string; title: string }
  questions: Omit<ImportQuestion, 'header'>[]
  rows: ImportRow[]
}

// "Known" column targets mapped to applicant/application fields.
export type KnownTarget =
  | 'submission_id'
  | 'respondent_id'
  | 'submitted_at'
  | 'country'
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'email'
  | 'phone'
  | 'linkedin_url'
  | 'cover_letter'
  | 'resume_url'

// Header → target. First match wins; unmatched header = position question.
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

export function classifyHeader(header: string): KnownTarget | null {
  const h = header.trim()
  for (const [re, target] of KNOWN_RULES) if (re.test(h)) return target
  return null
}

export function slugify(input: string, maxLen = 60): string {
  const s = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return s.slice(0, maxLen).replace(/_+$/, '') || 'field'
}

const BOOL_RE = /^(yes|no|true|false|evet|hayır|hayir)$/i
const NUM_RE = /^-?\d+([.,]\d+)?$/
const URL_RE = /^https?:\/\//i

export function inferType(samples: string[]): QuestionType {
  const vals = samples.map((s) => s.trim()).filter(Boolean)
  if (vals.length === 0) return 'text'
  if (vals.every((v) => BOOL_RE.test(v))) return 'boolean'
  if (vals.every((v) => NUM_RE.test(v))) return 'number'
  if (vals.every((v) => URL_RE.test(v) || v.includes('storage.tally.so'))) return 'file'
  return 'text'
}

export type Classification = {
  /** known header → target field */
  known: Map<string, KnownTarget>
  /** position-specific questions (auto-generated) */
  questions: ImportQuestion[]
}

export function classify(headers: string[], rows: Record<string, string>[]): Classification {
  const known = new Map<string, KnownTarget>()
  const questions: ImportQuestion[] = []
  const usedKeys = new Set<string>()

  for (const header of headers) {
    const target = classifyHeader(header)
    if (target) {
      known.set(header, target)
      continue
    }
    // Unknown header → position question. Infer type from sample values.
    const samples = rows.slice(0, 50).map((r) => r[header] ?? '')
    let field_key = slugify(header)
    while (usedKeys.has(field_key)) field_key += '_x'
    usedKeys.add(field_key)
    questions.push({ field_key, label: header.trim(), type: inferType(samples), header })
  }

  return { known, questions }
}

function orNull(v: string | undefined): string | null {
  const t = (v ?? '').trim()
  return t.length ? t : null
}

// "2026-03-04 19:34:21" → "2026-03-04T19:34:21Z" (assumes UTC).
export function parseTallyDate(v: string | undefined): string | null {
  const t = (v ?? '').trim()
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(t)
  if (!m) return t || null
  return `${m[1]}T${m[2]}Z`
}

export function normalizeRow(
  row: Record<string, string>,
  c: Classification
): ImportRow {
  // reverse header lookup by target
  const byTarget = (target: KnownTarget): string | undefined => {
    for (const [header, t] of c.known) if (t === target) return row[header]
    return undefined
  }

  const fullFromParts = [orNull(byTarget('first_name')), orNull(byTarget('last_name'))]
    .filter(Boolean)
    .join(' ')
  const full_name = orNull(byTarget('full_name')) ?? (fullFromParts || null)

  const respondent_id = orNull(byTarget('respondent_id'))
  const submission_id = orNull(byTarget('submission_id'))
  // Dedup keys must always be populated; derive them if missing.
  const subId = submission_id ?? `synthsub:${respondent_id ?? full_name ?? 'anon'}:${byTarget('submitted_at') ?? ''}`
  const respId = respondent_id ?? `sub:${subId}`

  const answers: Record<string, string> = {}
  for (const q of c.questions) {
    const val = orNull(row[q.header])
    if (val !== null) answers[q.field_key] = val
  }

  return {
    submission_id: subId,
    respondent_id: respId,
    submitted_at: parseTallyDate(byTarget('submitted_at')),
    full_name,
    email: orNull(byTarget('email')),
    phone: orNull(byTarget('phone')), // raw; do NOT normalize
    country: orNull(byTarget('country')),
    linkedin_url: orNull(byTarget('linkedin_url')),
    resume_url: orNull(byTarget('resume_url')),
    cover_letter: orNull(byTarget('cover_letter')),
    answers,
  }
}

// "...Job application_Submissions_2026-06-12.csv" → {title, slug}
export function guessPosition(fileName: string): { title: string; slug: string } {
  let base = fileName.replace(/\.csv$/i, '')
  base = base.split(/_submissions/i)[0]
  base = base.replace(/job application/i, '').trim()
  base = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const title = base || 'New Position'
  return { title, slug: slugify(title) }
}
