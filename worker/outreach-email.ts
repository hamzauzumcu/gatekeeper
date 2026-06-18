// AI outreach-email generation.
// generateOutreachEmail produces a short recruiter outreach email for a
// candidate: it references the position they applied to and roughly when they
// applied, asks whether their job search is still active, and proposes a brief
// chat. The email language is chosen by the candidate's country first (Turkey →
// Turkish, any other country → English) and falls back to the CV languages /
// name when no country is on file. Unlike interview notes, the result is NOT
// stored — it is handed to the UI to copy or open in a mail client.
//
// The prompt template is a single global setting (app_settings), editable in
// Settings; a missing row falls back to DEFAULT_OUTREACH_EMAIL_PROMPT below.

import { deepseekChat } from './deepseek'

const OUTREACH_PROMPT_KEY = 'outreach_email_prompt'

// Single source of truth for how the AI introduces the company in outreach
// emails. English only (repo policy); the model translates it into the
// candidate's language when writing the email. Keep this to verifiable facts —
// the prompt forbids inventing anything beyond it.
export const COMPANY_BLURB =
  'beta.limited is a company operating in the B2B SaaS and mobile application space, ' +
  'building innovative mobile marketing solutions (https://beta.limited).'

// Lighter env than interview notes — outreach only needs the position, the
// application date, and the candidate's name/country/CV languages, so it never
// re-OCRs the PDF.
export type OutreachEmailEnv = {
  DEEPSEEK_API_KEY: string
}

export type OutreachEmail = {
  subject: string
  body: string
  language: string
}

// The instruction half of the prompt is in English (per repo policy); the
// candidate-facing email is written in whatever language the input block
// requests. The input blocks referenced here are produced verbatim by the
// user-content builder in generateOutreachEmail — keep the two in sync.
export const DEFAULT_OUTREACH_EMAIL_PROMPT = `You are a recruiter writing a short, warm outreach email to a candidate who applied to one of our roles some time ago.

Company description (translate it into the email's language; do not add facts beyond it):
${COMPANY_BLURB}

You are given the following inputs, each in its own block:
<candidate_name>...</candidate_name>
<position>...</position>
<applied_on>...</applied_on>
<language>...</language>
<cv_languages>...</cv_languages>
<sender_name>...</sender_name>

Goal: a brief, friendly check-in email that (1) references the specific position they applied to and roughly when they applied, (2) includes one or two short sentences introducing the company based on the company description above, (3) asks whether they are still open / their job search is still active, and (4) proposes a short, low-pressure call to talk. Keep it genuinely short — 4-6 sentences of body, no filler, no long pitch.

Language:
- <language> is either "Turkish", "English", or "auto".
- If it is "Turkish" or "English", write the ENTIRE email (subject and body) in that language.
- If it is "auto", infer the language from <candidate_name> and <cv_languages>: write Turkish if the candidate appears to be Turkish, otherwise English.

Rules:
- Address the candidate by their first name if a name is given; otherwise use a neutral greeting.
- Do not invent details that are not in the inputs (no fake salary, location, or specific times). Propose a call without committing to an exact slot.
- The only allowed company facts are those in the company description above — keep the introduction to one or two sentences and do not invent any other company details.
- Always include the company link in the email, written in parentheses exactly as (https://beta.limited). Never omit, alter, or translate this URL.
- The subject line must be short and specific to the position.
- Use a warm, friendly, conversational tone — write like a real person reaching out personally, not a formal corporate template. Keep it relaxed and sincere while staying respectful.
- Open with a friendly greeting and a natural line that you saw their application for the position and wanted to get in touch (e.g. in Turkish: "Merhaba Gülşah, bu pozisyona başvurunuzu gördüm, bu sebeple sizinle iletişime geçmek istedim.").
- End the email with a sign-off line — "İyi çalışmalar" for a Turkish email, "Best regards" for an English one — followed on the next line by the sender's name from <sender_name>. Do not invent any other sender name.

Output ONLY a JSON object with exactly these keys:
{"subject": "<email subject>", "body": "<email body with line breaks as \\n>", "language": "<the language you actually wrote in: Turkish or English>"}
No markdown, no code fences, no text outside the JSON object.`

export async function getOutreachEmailPrompt(db: D1Database): Promise<{ prompt: string; is_custom: boolean }> {
  const row = await db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .bind(OUTREACH_PROMPT_KEY)
    .first<{ value: string }>()
  const custom = row?.value?.trim()
  return custom ? { prompt: custom, is_custom: true } : { prompt: DEFAULT_OUTREACH_EMAIL_PROMPT, is_custom: false }
}

// Persist a custom prompt, or revert to the built-in default when given an empty
// value (delete the row so getOutreachEmailPrompt falls back).
export async function setOutreachEmailPrompt(db: D1Database, prompt: string): Promise<void> {
  const trimmed = prompt.trim()
  if (!trimmed) {
    await db.prepare(`DELETE FROM app_settings WHERE key = ?`).bind(OUTREACH_PROMPT_KEY).run()
    return
  }
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(OUTREACH_PROMPT_KEY, trimmed)
    .run()
}

// Country first: Turkey → Turkish, any other non-empty country → English. When
// no country is on file, return 'auto' and let the model infer from the name and
// CV languages.
function resolveLanguage(country: string | null): 'Turkish' | 'English' | 'auto' {
  const c = country?.trim().toLowerCase()
  if (!c) return 'auto'
  if (c === 'turkey' || c === 'türkiye' || c === 'turkiye' || c === 'tr') return 'Turkish'
  return 'English'
}

// Best-effort extraction of language names from the parsed-CV JSON ($.languages).
// Entries may be plain strings or objects like { name, level }; we only need the
// names as a hint for the 'auto' language path.
function cvLanguageNames(resumeParsed: string | null): string[] {
  if (!resumeParsed) return []
  try {
    const parsed = JSON.parse(resumeParsed) as { languages?: unknown }
    const langs = parsed.languages
    if (!Array.isArray(langs)) return []
    return langs
      .map((l) => (typeof l === 'string' ? l : typeof l === 'object' && l && 'name' in l ? String((l as { name: unknown }).name) : ''))
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

// Generate an outreach email for a candidate (applicant), based on their most
// recently submitted application — i.e. the position they last applied to.
// Returns the structured email; throws if the candidate has no application to
// reference or the model returns an unusable result.
export async function generateOutreachEmail(
  db: D1Database,
  applicantId: number,
  env: OutreachEmailEnv,
  senderName: string,
  signal?: AbortSignal
): Promise<OutreachEmail> {
  const row = await db
    .prepare(
      `SELECT ap.full_name, ap.country,
              a.submitted_at, a.resume_parsed,
              jp.title AS position_title
       FROM applications a
       JOIN applicants ap ON ap.id = a.applicant_id
       JOIN job_positions jp ON jp.id = a.position_id
       WHERE a.applicant_id = ?
       ORDER BY a.submitted_at DESC
       LIMIT 1`
    )
    .bind(applicantId)
    .first<{
      full_name: string | null
      country: string | null
      submitted_at: string | null
      resume_parsed: string | null
      position_title: string
    }>()

  if (!row) throw new Error('candidate has no application to base an outreach email on')

  const language = resolveLanguage(row.country)
  const cvLangs = cvLanguageNames(row.resume_parsed)
  // Date-only is enough for "you applied on …"; avoids leaking the exact time.
  const appliedOn = row.submitted_at ? row.submitted_at.slice(0, 10) : 'unknown'

  const userContent = [
    `<candidate_name>\n${row.full_name?.trim() ?? ''}\n</candidate_name>`,
    `<position>\n${row.position_title}\n</position>`,
    `<applied_on>\n${appliedOn}\n</applied_on>`,
    `<language>\n${language}\n</language>`,
    `<cv_languages>\n${cvLangs.join(', ')}\n</cv_languages>`,
    `<sender_name>\n${senderName.trim()}\n</sender_name>`,
  ].join('\n\n')

  const { prompt } = await getOutreachEmailPrompt(db)

  const raw = await deepseekChat(
    env.DEEPSEEK_API_KEY,
    [
      { role: 'system', content: prompt },
      { role: 'user', content: userContent },
    ],
    { model: 'deepseek-v4-pro', thinking: 'disabled', jsonMode: true, maxTokens: 1000, signal }
  )

  let parsed: { subject?: unknown; body?: unknown; language?: unknown }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('outreach generation returned malformed JSON')
  }
  const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : ''
  const body = typeof parsed.body === 'string' ? parsed.body.trim() : ''
  if (!subject || !body) throw new Error('outreach generation returned an empty email')
  const lang = typeof parsed.language === 'string' && parsed.language.trim() ? parsed.language.trim() : (language === 'auto' ? 'English' : language)

  return { subject, body, language: lang }
}
