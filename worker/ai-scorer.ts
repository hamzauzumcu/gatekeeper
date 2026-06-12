// AI scoring — per-position prompt-based candidate scoring (0-100).
// scoreApplication fetches the candidate data and prompt, calls DeepSeek, stores result.
// upsertScoringPrompt resets ai_score_version for that position so sync re-scores everything.

import { deepseekChat } from './deepseek'

export const SCORE_VERSION = 1

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
  await db.batch([
    db
      .prepare(
        `INSERT INTO scoring_prompts (position_id, prompt, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(position_id) DO UPDATE SET prompt = excluded.prompt, updated_at = excluded.updated_at`
      )
      .bind(positionId, prompt),
    db
      .prepare(`UPDATE applications SET ai_score_version = 0 WHERE position_id = ?`)
      .bind(positionId),
  ])
}

export async function scoreApplication(
  db: D1Database,
  applicationId: number,
  deepseekApiKey: string
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT a.id, a.cover_letter, a.resume_text,
              jp.title AS position_title,
              sp.prompt AS scoring_prompt
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
      position_title: string
      scoring_prompt: string | null
    }>()

  if (!row || !row.scoring_prompt) return

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
  if (row.resume_text?.trim()) parts.push(`=== CV / Resume ===\n${row.resume_text}`)
  if (row.cover_letter?.trim()) parts.push(`=== Cover Letter ===\n${row.cover_letter}`)
  if (answers.length > 0) {
    const answersText = answers.map((a) => `${a.label}: ${a.value ?? '—'}`).join('\n')
    parts.push(`=== Application Form Answers ===\n${answersText}`)
  }

  if (parts.length === 0) {
    await db
      .prepare(`UPDATE applications SET ai_score = NULL, ai_score_reasoning = NULL, ai_score_version = ? WHERE id = ?`)
      .bind(SCORE_VERSION, applicationId)
      .run()
    return
  }

  const raw = await deepseekChat(
    deepseekApiKey,
    [
      { role: 'system', content: row.scoring_prompt },
      { role: 'user', content: parts.join('\n\n') },
    ],
    { model: 'deepseek-v4-flash', thinking: 'disabled', jsonMode: true }
  )

  const jsonText = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
  const result = JSON.parse(jsonText) as { score: unknown; reasoning?: unknown }
  const score = Math.min(100, Math.max(0, Math.round(Number(result.score) || 0)))
  const reasoning = typeof result.reasoning === 'string' ? result.reasoning : null

  await db
    .prepare(
      `UPDATE applications SET ai_score = ?, ai_score_reasoning = ?, ai_score_version = ? WHERE id = ?`
    )
    .bind(score, reasoning, SCORE_VERSION, applicationId)
    .run()
}
