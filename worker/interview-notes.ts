// AI interview-notes generation.
// generateInterviewNotes pulls together everything we know about a candidate —
// their CV, the position they applied for, the scoring criteria ("what we are
// looking for"), their application-form answers, and any existing team notes
// (which often say what to ask) — and asks the model for focused, Turkish
// interview notes as a bullet list. The prompt template is a single global
// setting (app_settings), editable in Settings; a missing row falls back to
// DEFAULT_INTERVIEW_NOTES_PROMPT below.

import { deepseekChat } from './deepseek'
import { parseAndStoreResume, parsedRawText, synthesizeCvText, looksLikeText } from './cv-parser'

const INTERVIEW_PROMPT_KEY = 'interview_notes_prompt'

// Minimal env surface — CV recovery may re-OCR the PDF via GPT-4o when no cached
// text exists. This runs on-demand (one candidate at a time), so unlike batch
// scoring it doesn't need an ocrGate.
export type InterviewNotesEnv = {
  DEEPSEEK_API_KEY: string
  OPENAI_API_KEY?: string
  RESUMES?: R2Bucket
  R2_PUBLIC_URL?: string
}

// The instruction half of the prompt is in English (per repo policy), but it
// explicitly forces the candidate-facing output to be Turkish. The input blocks
// referenced here (<cv>, <position>, …) are produced verbatim by the user-content
// builder in generateInterviewNotes — keep the two in sync.
export const DEFAULT_INTERVIEW_NOTES_PROMPT = `You are an experienced hiring manager preparing for a candidate interview.

You are given the following inputs, each in its own block:
<cv>...</cv>
<position>...</position>
<role_requirements>...</role_requirements>
<application_answers>...</application_answers>
<team_notes>...</team_notes>

Some inputs may be empty or missing. If an input is empty, do not produce points about it and never invent information that is not present in the inputs.

Your job: produce SHORT, focused interview notes that let the interviewer run an evidence-based conversation. Fewer, sharper points are better than long, comprehensive ones.

What counts as worth including (only decision-relevant items):
1. Anything explicitly raised in <team_notes> — ALWAYS include every concrete item here, even if it means going over the limit. The shortness rule does NOT apply to team_notes.
2. Red flags, gaps, or inconsistencies that should be probed.
3. Role-critical verification questions tied to a must-have requirement in <role_requirements>.
Skip routine strengths and "nice but not decisive" details unless a strength is unusually strong or directly tied to a must-have requirement.

Question quality:
- Each question must reference a specific claim, project, number, gap, or team note from the inputs. No generic competency questions (e.g. avoid "Tell me about your experience").

Rules:
- Write the ENTIRE output in Turkish. Proper nouns and technical terms may stay in their original form; all explanations and questions must be in Turkish.
- Output ONLY a flat list of bullet points, each line starting with "- ".
- Produce 4-7 bullets. Fewer is better; only include a point if skipping it would meaningfully weaken the interview. If the inputs genuinely warrant fewer than 4 substantive points, write fewer. (team_notes items are exempt and may push you higher.)
- Each bullet: one sentence, max ~25 words. No sub-bullets, no nested explanations.
- Be specific to THIS candidate and THIS position. No generic filler.
- Do not include any heading, preamble, or closing text. The first character of your output must be "-".
- After the list, if you considered but deliberately left out 1-2 relevant topics to keep it short, add ONE final line starting with "(Atlandı: ...)". If you left nothing out, omit this line entirely.`

export async function getInterviewNotesPrompt(db: D1Database): Promise<{ prompt: string; is_custom: boolean }> {
  const row = await db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .bind(INTERVIEW_PROMPT_KEY)
    .first<{ value: string }>()
  const custom = row?.value?.trim()
  return custom ? { prompt: custom, is_custom: true } : { prompt: DEFAULT_INTERVIEW_NOTES_PROMPT, is_custom: false }
}

// Persist a custom prompt, or revert to the built-in default when given an empty
// value (delete the row so getInterviewNotesPrompt falls back).
export async function setInterviewNotesPrompt(db: D1Database, prompt: string): Promise<void> {
  const trimmed = prompt.trim()
  if (!trimmed) {
    await db.prepare(`DELETE FROM app_settings WHERE key = ?`).bind(INTERVIEW_PROMPT_KEY).run()
    return
  }
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(INTERVIEW_PROMPT_KEY, trimmed)
    .run()
}

// Recover the candidate's CV text the same way scoring does: cached resume_text,
// then resume_parsed raw text, then a one-off re-OCR, then a synthesis from the
// parsed structured fields. Returns null when nothing is available.
async function recoverCvText(
  db: D1Database,
  applicationId: number,
  row: { resume_text: string | null; resume_parsed: string | null; resume_url: string | null },
  env: InterviewNotesEnv,
  signal?: AbortSignal
): Promise<string | null> {
  let cvText: string | null = looksLikeText(row.resume_text) ? row.resume_text : null
  if (cvText) return cvText

  cvText = parsedRawText(row.resume_parsed)
  if (!cvText && row.resume_url && env.OPENAI_API_KEY) {
    try {
      await parseAndStoreResume(
        db,
        applicationId,
        row.resume_url,
        env.DEEPSEEK_API_KEY,
        env.RESUMES,
        env.R2_PUBLIC_URL,
        env.OPENAI_API_KEY,
        signal
      )
      const refreshed = await db
        .prepare(`SELECT resume_text, resume_parsed FROM applications WHERE id = ?`)
        .bind(applicationId)
        .first<{ resume_text: string | null; resume_parsed: string | null }>()
      cvText =
        (refreshed?.resume_text?.trim() ? refreshed.resume_text : null) ??
        parsedRawText(refreshed?.resume_parsed ?? null)
    } catch {
      /* OCR is best-effort; fall through to synthesis */
    }
  }
  if (!cvText && row.resume_parsed) {
    try {
      cvText = synthesizeCvText(JSON.parse(row.resume_parsed)) || null
    } catch {
      /* leave cvText null */
    }
  }
  return cvText
}

// Generate interview notes for a candidate (applicant). Bases them on the most
// recently submitted application — i.e. the position they last applied to.
// Returns the generated bullet text, or throws if the candidate has no
// application / position to work from or there isn't enough data to use.
export async function generateInterviewNotes(
  db: D1Database,
  applicantId: number,
  env: InterviewNotesEnv,
  signal?: AbortSignal
): Promise<string> {
  const row = await db
    .prepare(
      `SELECT a.id, a.cover_letter, a.resume_text, a.resume_parsed, a.resume_url,
              jp.title AS position_title,
              sp.prompt AS scoring_prompt
       FROM applications a
       JOIN job_positions jp ON jp.id = a.position_id
       LEFT JOIN scoring_prompts sp ON sp.position_id = a.position_id
       WHERE a.applicant_id = ?
       ORDER BY a.submitted_at DESC
       LIMIT 1`
    )
    .bind(applicantId)
    .first<{
      id: number
      cover_letter: string | null
      resume_text: string | null
      resume_parsed: string | null
      resume_url: string | null
      position_title: string
      scoring_prompt: string | null
    }>()

  if (!row) throw new Error('candidate has no application to base interview notes on')

  const cvText = await recoverCvText(db, row.id, row, env, signal)

  const answersRes = await db
    .prepare(
      `SELECT pq.label, aa.value
       FROM application_answers aa
       JOIN position_questions pq ON pq.id = aa.question_id
       WHERE aa.application_id = ?
       ORDER BY pq.sort_order`
    )
    .bind(row.id)
    .all<{ label: string; value: string | null }>()
  const answers = answersRes.results ?? []

  // Existing team notes — "the things we said we'd ask". Oldest first so the
  // model reads them in the order they were written.
  const notesRes = await db
    .prepare(
      `SELECT content, created_by_name FROM candidate_notes
       WHERE applicant_id = ? ORDER BY created_at ASC`
    )
    .bind(applicantId)
    .all<{ content: string; created_by_name: string }>()
  const existingNotes = notesRes.results ?? []

  // Need at least the CV or the form answers to say anything candidate-specific.
  if (!cvText?.trim() && answers.length === 0 && !row.cover_letter?.trim()) {
    throw new Error('not enough candidate data to generate interview notes (no CV, answers, or cover letter)')
  }

  // Build the tagged input blocks the prompt expects. The cover letter is folded
  // into application_answers (the prompt has no dedicated block for it). Blocks
  // are always emitted — empty when absent — so the prompt's "may be empty"
  // handling sees a stable structure and can reliably identify <team_notes>.
  const answerLines: string[] = []
  if (row.cover_letter?.trim()) answerLines.push(`Cover Letter: ${row.cover_letter.trim()}`)
  for (const a of answers) answerLines.push(`${a.label}: ${a.value ?? '—'}`)
  const teamNotesText = existingNotes.map((n) => `- (${n.created_by_name}) ${n.content}`).join('\n')

  const userContent = [
    `<cv>\n${cvText?.trim() ?? ''}\n</cv>`,
    `<position>\n${row.position_title}\n</position>`,
    `<role_requirements>\n${row.scoring_prompt?.trim() ?? ''}\n</role_requirements>`,
    `<application_answers>\n${answerLines.join('\n')}\n</application_answers>`,
    `<team_notes>\n${teamNotesText}\n</team_notes>`,
  ].join('\n\n')

  const { prompt } = await getInterviewNotesPrompt(db)

  const raw = await deepseekChat(
    env.DEEPSEEK_API_KEY,
    [
      { role: 'system', content: prompt },
      { role: 'user', content: userContent },
    ],
    { model: 'deepseek-v4-pro', thinking: 'disabled', maxTokens: 2000, signal }
  )

  return raw.trim()
}
