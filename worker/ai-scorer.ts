// AI scoring — per-position prompt-based candidate scoring (0-100).
// scoreApplication fetches the candidate data and prompt, calls DeepSeek, stores result.
// upsertScoringPrompt resets ai_score_version for that position so sync re-scores everything.

import { deepseekChat } from './deepseek'
import { parseAndStoreResume, parsedRawText, synthesizeCvText, looksLikeText } from './cv-parser'
import { universityBonus } from './cv-schema'

// v2: scoring reads recovered CV text (resume_text / resume_parsed / re-OCR) instead of the
// often-empty resume_text column alone, so every candidate is scored against their real CV.
// The OCR step is memory-heavy, so the batch caller serializes it via ocrGate — see
// scoreApplication for the recovery order.
// v3: top-tier university bonus is added on top of the model score (UNIVERSITY_TIER_BONUS).
export const SCORE_VERSION = 3

// Optional structured reasoning fields a scoring prompt may return instead of a single
// `reasoning` string. Kept in sync with parseScoreReasoning() in src/lib/candidates.ts.
const STRUCTURED_FIELDS = [
  'summary',
  'core_reasoning',
  'strong_differentiator_reasoning',
  'red_flag_reasoning',
  'good_fit_signal',
  'deal_breaker_signal',
] as const

// Minimal env surface scoreApplication needs (lazy CV recovery may re-OCR via GPT-4o).
export type ScoreEnv = {
  DEEPSEEK_API_KEY: string
  OPENAI_API_KEY?: string
  RESUMES?: R2Bucket
  R2_PUBLIC_URL?: string
}

// Shared pending-scores predicate, used by the sync endpoints and the SyncJobDO.
// An application needs (re)scoring when: the scoring schema version advanced, OR it was
// never scored, OR it was scored before the position's prompt was last updated. The last
// case means a prompt edit auto-re-queues affected candidates — no manual reset needed.
export const PENDING_SCORES_FROM_WHERE = `FROM applications a
  JOIN scoring_prompts sp ON sp.position_id = a.position_id
  WHERE (
    a.ai_score_version < ${SCORE_VERSION}
    OR a.ai_scored_prompt_at IS NULL
    OR a.ai_scored_prompt_at < sp.updated_at
  )`

export type ScoringPromptRow = {
  id: number
  position_id: number
  prompt: string
  updated_at: string
  position_title: string
}

export type PositionWithPrompt = {
  id: number
  title: string
  prompt: string | null
  updated_at: string | null
}

export async function getPositionsWithPrompts(db: D1Database): Promise<PositionWithPrompt[]> {
  const res = await db
    .prepare(
      `SELECT jp.id, jp.title, sp.prompt, sp.updated_at
       FROM job_positions jp
       LEFT JOIN scoring_prompts sp ON sp.position_id = jp.id
       ORDER BY jp.title`
    )
    .all<PositionWithPrompt>()
  return res.results ?? []
}

export async function upsertScoringPrompt(
  db: D1Database,
  positionId: number,
  prompt: string
): Promise<void> {
  // Bumping updated_at is enough to re-queue this position's candidates: the pending
  // query compares each application's ai_scored_prompt_at against this timestamp.
  await db
    .prepare(
      `INSERT INTO scoring_prompts (position_id, prompt, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(position_id) DO UPDATE SET prompt = excluded.prompt, updated_at = excluded.updated_at`
    )
    .bind(positionId, prompt)
    .run()
  // Snapshot the saved version so score-history entries can show the prompt they were
  // scored with. saved_at is copied from the row just written, so it matches the
  // prompt_updated_at stamped onto scores exactly.
  await db
    .prepare(
      `INSERT INTO scoring_prompt_history (position_id, prompt, saved_at)
       SELECT position_id, prompt, updated_at FROM scoring_prompts WHERE position_id = ?`
    )
    .bind(positionId)
    .run()
}

export async function scoreApplication(
  db: D1Database,
  applicationId: number,
  env: ScoreEnv,
  signal?: AbortSignal,
  // Serializes the memory-heavy PDF-load + OCR recovery. The concurrent batch caller passes
  // a gate so at most one PDF is resident at a time; sequential callers may omit it.
  ocrGate?: <T>(fn: () => Promise<T>) => Promise<T>
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT a.id, a.cover_letter, a.resume_text, a.resume_parsed, a.resume_url,
              jp.title AS position_title,
              sp.prompt AS scoring_prompt,
              sp.updated_at AS prompt_updated_at
       FROM applications a
       JOIN job_positions jp ON jp.id = a.position_id
       LEFT JOIN scoring_prompts sp ON sp.position_id = jp.id
       WHERE a.id = ?`
    )
    .bind(applicationId)
    .first<{
      id: number
      cover_letter: string | null
      resume_text: string | null
      resume_parsed: string | null
      resume_url: string | null
      position_title: string
      scoring_prompt: string | null
      prompt_updated_at: string | null
    }>()

  if (!row || !row.scoring_prompt) return

  // Recover the CV text lazily. resume_text is empty for most rows (the regex PDF extractor
  // fails on scanned/compressed PDFs), so: cached verbatim text from resume_parsed first
  // (free), then re-OCR the PDF via GPT-4o, then a structured-field synthesis as last resort.
  // The OCR step loads + base64-encodes the PDF (several MB resident), so it runs through
  // ocrGate — the batch caller serializes it to one PDF at a time so concurrent OCRs can't
  // blow the Durable Object's 128 MB memory ceiling. Cache whatever we recover into resume_text.
  // Freshest parsed-CV JSON; updated below if OCR recovery re-parses the PDF.
  // Used after scoring to apply the university tier bonus.
  let parsedJson: string | null = row.resume_parsed
  let cvText: string | null = looksLikeText(row.resume_text) ? row.resume_text : null
  if (!cvText) {
    cvText = parsedRawText(row.resume_parsed)
    if (!cvText && row.resume_url && env.OPENAI_API_KEY) {
      const resumeUrl = row.resume_url
      const recover = () =>
        parseAndStoreResume(
          db,
          applicationId,
          resumeUrl,
          env.DEEPSEEK_API_KEY,
          env.RESUMES,
          env.R2_PUBLIC_URL,
          env.OPENAI_API_KEY,
          signal
        )
      await (ocrGate ? ocrGate(recover) : recover())
      const refreshed = await db
        .prepare(`SELECT resume_text, resume_parsed FROM applications WHERE id = ?`)
        .bind(applicationId)
        .first<{ resume_text: string | null; resume_parsed: string | null }>()
      cvText = (refreshed?.resume_text?.trim() ? refreshed.resume_text : null) ?? parsedRawText(refreshed?.resume_parsed ?? null)
      if (refreshed?.resume_parsed) parsedJson = refreshed.resume_parsed
    }
    if (!cvText && row.resume_parsed) {
      try {
        cvText = synthesizeCvText(JSON.parse(row.resume_parsed)) || null
      } catch {
        /* leave cvText null */
      }
    }
    if (cvText) {
      await db.prepare(`UPDATE applications SET resume_text = ? WHERE id = ?`).bind(cvText, applicationId).run()
    }
  }

  const answersRes = await db
    .prepare(
      `SELECT pq.label, aa.value
       FROM application_answers aa
       JOIN position_questions pq ON pq.id = aa.question_id
       WHERE aa.application_id = ?
       ORDER BY pq.sort_order`
    )
    .bind(applicationId)
    .all<{ label: string; value: string | null }>()

  const answers = answersRes.results ?? []

  const parts: string[] = []
  if (cvText?.trim()) parts.push(`=== CV / Resume ===\n${cvText}`)
  if (row.cover_letter?.trim()) parts.push(`=== Cover Letter ===\n${row.cover_letter}`)
  if (answers.length > 0) {
    const answersText = answers.map((a) => `${a.label}: ${a.value ?? '—'}`).join('\n')
    parts.push(`=== Application Form Answers ===\n${answersText}`)
  }

  if (parts.length === 0) {
    await db
      .prepare(
        `UPDATE applications
         SET ai_score = NULL, ai_score_reasoning = NULL, ai_score_version = ?,
             ai_scored_prompt_at = ?, ai_scored_at = datetime('now')
         WHERE id = ?`
      )
      .bind(SCORE_VERSION, row.prompt_updated_at, applicationId)
      .run()
    return
  }

  const raw = await deepseekChat(
    env.DEEPSEEK_API_KEY,
    [
      { role: 'system', content: row.scoring_prompt },
      { role: 'user', content: parts.join('\n\n') },
    ],
    { model: 'deepseek-v4-flash', thinking: 'disabled', jsonMode: true, signal }
  )

  const jsonText = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
  const result = JSON.parse(jsonText) as Record<string, unknown>
  const baseScore = Math.min(100, Math.max(0, Math.round(Number(result.score) || 0)))

  // The scoring prompt may return either the legacy shape { score, reasoning } or the
  // richer shape { score, summary, core_reasoning, strong_differentiator_reasoning,
  // red_flag_reasoning, good_fit_signal, deal_breaker_signal }. Both are valid — different
  // accounts run different prompts. We normalize here: if any structured field is present we
  // store the whole object as JSON (the UI renders it as a summary + expandable breakdown);
  // otherwise we fall back to the plain `reasoning` string. When neither is present but a
  // summary exists, the summary doubles as the reasoning fallback.
  const asStr = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const detail: Record<string, string | null> = {}
  let hasStructured = false
  for (const k of STRUCTURED_FIELDS) {
    const v = asStr(result[k])
    detail[k] = v
    if (v) hasStructured = true
  }
  let reasoning = asStr(result.reasoning) ?? detail.summary

  // Top-tier university bonus, applied deterministically on top of the model score
  // (capped at 100). The model can't reliably rank Turkish universities, so we award
  // the boost from the parsed — and canonicalized — school name instead. See
  // UNIVERSITY_TIER_BONUS in cv-schema.ts.
  let score = baseScore
  let parsed: unknown = null
  try {
    parsed = parsedJson ? JSON.parse(parsedJson) : null
  } catch {
    /* leave parsed null */
  }
  const uniBonus = universityBonus(parsed as { education?: ({ school?: string | null } | null)[] | null } | null)
  if (uniBonus) {
    score = Math.min(100, baseScore + uniBonus.bonus)
    const note = `+${uniBonus.bonus} ${uniBonus.school} (top-tier university)`
    // Attach the bonus note to the summary (structured shape) or to the plain reasoning,
    // whichever is the stored value, so it stays visible without breaking the stored JSON.
    if (hasStructured) {
      detail.summary = detail.summary ? `${detail.summary} [${note}]` : note
    } else {
      reasoning = reasoning ? `${reasoning} [${note}]` : note
    }
  }

  // Stored value: structured JSON when the model returned the richer shape, else plain text.
  const storedReasoning = hasStructured ? JSON.stringify(detail) : reasoning

  // Write the current score and append it to the history log in one atomic batch,
  // so the log can't drift from what the application row shows.
  await db.batch([
    db
      .prepare(
        `UPDATE applications
         SET ai_score = ?, ai_score_reasoning = ?, ai_score_version = ?,
             ai_scored_prompt_at = ?, ai_scored_at = datetime('now')
         WHERE id = ?`
      )
      .bind(score, storedReasoning, SCORE_VERSION, row.prompt_updated_at, applicationId),
    db
      .prepare(
        `INSERT INTO ai_score_history (application_id, score, reasoning, score_version, prompt_updated_at, scored_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      )
      .bind(applicationId, score, storedReasoning, SCORE_VERSION, row.prompt_updated_at),
  ])
}
