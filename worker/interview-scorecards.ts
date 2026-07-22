// Interview scorecard submissions + offer-stage aggregation.
//
// One scorecard per interviewer per application (upsert — editable after
// submit). Scores are stored per criterion, 1-5; a criterion the interviewer
// left as N/A simply has no row. Aggregation follows the paper scorecard's
// rules: per criterion, average only the numeric scores across interviewers
// (N/A excluded); weighted points = (average / 5) x weight; final score = sum
// of weighted points. Everything is computed at full precision — rounding to
// two decimals happens only in the UI.

import { logCandidateEvents } from './events'
import type { ScorecardCriterion } from './scorecards'

export type ScorecardSubmission = {
  id: number
  interviewer: string
  interviewer_name: string
  created_at: string
  updated_at: string
  // criterion_id -> score (1-5). Missing key = N/A / not observed.
  scores: Record<number, number>
}

export type CriterionAggregate = {
  criterion_id: number
  // null = not assessed (every interviewer said N/A, or no submissions yet)
  average: number | null
  weighted_points: number | null
}

export type ApplicationScorecard = {
  application_id: number
  position_id: number
  position_title: string
  criteria: ScorecardCriterion[]
  submissions: ScorecardSubmission[]
  aggregate: {
    per_criterion: CriterionAggregate[]
    // Sum of weighted points over assessed criteria. Partial (and flagged
    // incomplete) while any criterion is still unassessed.
    final_score: number | null
    complete: boolean
  }
}

async function getApplicationPosition(
  db: D1Database,
  applicationId: number
): Promise<{ applicant_id: number; position_id: number; position_title: string } | null> {
  return db
    .prepare(
      `SELECT a.applicant_id, a.position_id, jp.title AS position_title
       FROM applications a
       JOIN job_positions jp ON jp.id = a.position_id
       WHERE a.id = ?`
    )
    .bind(applicationId)
    .first<{ applicant_id: number; position_id: number; position_title: string }>()
}

// Full scorecard state for an application: the position's active criteria,
// every interviewer's submission, and the offer-stage aggregate. Returns null
// when the application doesn't exist.
export async function getApplicationScorecard(
  db: D1Database,
  applicationId: number
): Promise<ApplicationScorecard | null> {
  const app = await getApplicationPosition(db, applicationId)
  if (!app) return null

  const { results: criteria } = await db
    .prepare(
      `SELECT id, category, name, description, weight, sort_order
       FROM scorecard_criteria
       WHERE position_id = ? AND archived_at IS NULL
       ORDER BY CASE category WHEN 'hard' THEN 0 ELSE 1 END, sort_order, id`
    )
    .bind(app.position_id)
    .all<ScorecardCriterion>()

  const { results: cards } = await db
    .prepare(
      `SELECT s.id, s.interviewer, COALESCE(u.full_name, s.interviewer) AS interviewer_name,
              s.created_at, s.updated_at
       FROM interview_scorecards s
       LEFT JOIN users u ON u.username = s.interviewer
       WHERE s.application_id = ?
       ORDER BY s.created_at ASC, s.id ASC`
    )
    .bind(applicationId)
    .all<Omit<ScorecardSubmission, 'scores'>>()

  const submissions: ScorecardSubmission[] = cards.map((c) => ({ ...c, scores: {} }))
  if (submissions.length > 0) {
    const ids = submissions.map((s) => s.id)
    const placeholders = ids.map(() => '?').join(',')
    // Scores on archived criteria are excluded here so they drop out of both
    // the matrix and the aggregate (the active template is the source of truth).
    const { results: scores } = await db
      .prepare(
        `SELECT sc.scorecard_id, sc.criterion_id, sc.score
         FROM interview_scorecard_scores sc
         JOIN scorecard_criteria c ON c.id = sc.criterion_id
         WHERE sc.scorecard_id IN (${placeholders}) AND c.archived_at IS NULL`
      )
      .bind(...ids)
      .all<{ scorecard_id: number; criterion_id: number; score: number }>()
    const byCard = new Map<number, ScorecardSubmission>(submissions.map((s) => [s.id, s]))
    for (const r of scores) byCard.get(r.scorecard_id)!.scores[r.criterion_id] = r.score
  }

  return {
    application_id: applicationId,
    position_id: app.position_id,
    position_title: app.position_title,
    criteria,
    submissions,
    aggregate: computeAggregate(criteria, submissions),
  }
}

// The offer-stage math from the scorecard guide, at full precision.
export function computeAggregate(
  criteria: ScorecardCriterion[],
  submissions: ScorecardSubmission[]
): ApplicationScorecard['aggregate'] {
  const per_criterion: CriterionAggregate[] = criteria.map((c) => {
    const numeric = submissions
      .map((s) => s.scores[c.id])
      .filter((v): v is number => typeof v === 'number')
    if (numeric.length === 0) return { criterion_id: c.id, average: null, weighted_points: null }
    const average = numeric.reduce((a, b) => a + b, 0) / numeric.length
    return { criterion_id: c.id, average, weighted_points: (average / 5) * c.weight }
  })

  const assessed = per_criterion.filter((p) => p.weighted_points !== null)
  return {
    per_criterion,
    final_score:
      assessed.length === 0 ? null : assessed.reduce((s, p) => s + (p.weighted_points as number), 0),
    complete: criteria.length > 0 && assessed.length === criteria.length,
  }
}

// Write the aggregate back onto applications.interview_score (see migration
// 0024) so the candidate list can select/filter/sort it without recomputing.
async function persistInterviewScore(db: D1Database, scorecard: ApplicationScorecard): Promise<void> {
  await db
    .prepare(`UPDATE applications SET interview_score = ?, interview_score_complete = ? WHERE id = ?`)
    .bind(
      scorecard.aggregate.final_score,
      scorecard.aggregate.complete ? 1 : 0,
      scorecard.application_id
    )
    .run()
}

// Recompute and persist the interview score for every application of a
// position that has at least one submitted scorecard. Called after the
// position's template changes (weights, criteria set, or a full clear), since
// that shifts every derived score at once.
export async function recomputeInterviewScoresForPosition(
  db: D1Database,
  positionId: number
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT s.application_id
       FROM interview_scorecards s
       JOIN applications a ON a.id = s.application_id
       WHERE a.position_id = ?`
    )
    .bind(positionId)
    .all<{ application_id: number }>()
  for (const r of results) {
    const scorecard = await getApplicationScorecard(db, r.application_id)
    if (scorecard) await persistInterviewScore(db, scorecard)
  }
}

// Upsert the caller's scorecard for an application, replacing their previous
// scores. `scores` maps criterion_id -> 1-5; null/absent = N/A (no row). At
// least one numeric score is required — an all-N/A scorecard says nothing.
// Logs a candidate History event (submitted vs updated) on success.
export async function saveInterviewScorecard(
  db: D1Database,
  applicationId: number,
  interviewer: string,
  scores: Record<string, number | null>
): Promise<ApplicationScorecard> {
  const app = await getApplicationPosition(db, applicationId)
  if (!app) throw new Error('application not found')

  const { results: criteria } = await db
    .prepare(
      `SELECT id FROM scorecard_criteria WHERE position_id = ? AND archived_at IS NULL`
    )
    .bind(app.position_id)
    .all<{ id: number }>()
  const validIds = new Set(criteria.map((c) => c.id))
  if (validIds.size === 0) throw new Error('this position has no scorecard configured')

  const numeric: { criterionId: number; score: number }[] = []
  for (const [key, value] of Object.entries(scores)) {
    if (value === null) continue // explicit N/A
    const criterionId = Number(key)
    if (!validIds.has(criterionId)) throw new Error('unknown criterion')
    if (!Number.isInteger(value) || value < 1 || value > 5)
      throw new Error('scores must be integers between 1 and 5')
    numeric.push({ criterionId, score: value })
  }
  if (numeric.length === 0) throw new Error('score at least one criterion (all N/A says nothing)')

  const existing = await db
    .prepare(`SELECT id FROM interview_scorecards WHERE application_id = ? AND interviewer = ?`)
    .bind(applicationId, interviewer)
    .first<{ id: number }>()

  let scorecardId: number
  if (existing) {
    scorecardId = existing.id
    await db
      .prepare(
        `UPDATE interview_scorecards
         SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
      )
      .bind(scorecardId)
      .run()
  } else {
    const res = await db
      .prepare(`INSERT INTO interview_scorecards (application_id, interviewer) VALUES (?, ?)`)
      .bind(applicationId, interviewer)
      .run()
    scorecardId = res.meta.last_row_id as number
  }

  // Replace-all keeps N/A semantics trivial: a criterion the interviewer
  // reverted to N/A simply has no row after the rewrite.
  const stmts: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM interview_scorecard_scores WHERE scorecard_id = ?`).bind(scorecardId),
    ...numeric.map((n) =>
      db
        .prepare(
          `INSERT INTO interview_scorecard_scores (scorecard_id, criterion_id, score) VALUES (?, ?, ?)`
        )
        .bind(scorecardId, n.criterionId, n.score)
    ),
  ]
  await db.batch(stmts)

  await logCandidateEvents(db, interviewer, [
    {
      applicant_id: app.applicant_id,
      event_type: existing ? 'scorecard_updated' : 'scorecard_submitted',
      application_id: applicationId,
      metadata: { position_title: app.position_title, scored_criteria: numeric.length },
    },
  ])

  const fresh = await getApplicationScorecard(db, applicationId)
  if (!fresh) throw new Error('application not found')
  await persistInterviewScore(db, fresh)
  return fresh
}
