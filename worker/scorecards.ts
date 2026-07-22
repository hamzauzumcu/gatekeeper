// Interview scorecard templates (per position, optional).
//
// A scorecard is the set of weighted hard/soft criteria a position uses for
// human interview scoring (see migrations/0022_scorecard_criteria.sql). Only
// the template lives here; interviewer scores will reference
// scorecard_criteria(id) once the scoring flow ships.

export type ScorecardCategory = 'hard' | 'soft'

export type ScorecardCriterion = {
  id: number
  category: ScorecardCategory
  name: string
  description: string | null
  weight: number
  sort_order: number
}

export type PositionScorecard = {
  position_id: number
  position_title: string
  criteria: ScorecardCriterion[]
}

// A criterion as submitted by the editor. `id` present = update an existing
// row (identity must survive edits so future scores stay attached); absent =
// insert a new one.
export type SaveCriterionInput = {
  id?: number
  category: ScorecardCategory
  name: string
  description?: string | null
  weight: number
}

// Hard skills group renders/sorts before soft skills everywhere.
const CATEGORY_ORDER = `CASE category WHEN 'hard' THEN 0 ELSE 1 END`

// All positions with their active criteria (empty array = not configured).
export async function getScorecards(db: D1Database): Promise<PositionScorecard[]> {
  const { results: positions } = await db
    .prepare(`SELECT id, title FROM job_positions ORDER BY title`)
    .all<{ id: number; title: string }>()
  const { results: rows } = await db
    .prepare(
      `SELECT id, position_id, category, name, description, weight, sort_order
       FROM scorecard_criteria
       WHERE archived_at IS NULL
       ORDER BY position_id, ${CATEGORY_ORDER}, sort_order, id`
    )
    .all<ScorecardCriterion & { position_id: number }>()

  const byPosition = new Map<number, ScorecardCriterion[]>()
  for (const r of rows) {
    const list = byPosition.get(r.position_id) ?? []
    list.push({
      id: r.id,
      category: r.category,
      name: r.name,
      description: r.description,
      weight: r.weight,
      sort_order: r.sort_order,
    })
    byPosition.set(r.position_id, list)
  }
  return positions.map((p) => ({
    position_id: p.id,
    position_title: p.title,
    criteria: byPosition.get(p.id) ?? [],
  }))
}

// Validate a scorecard payload; returns an error message or null when valid.
// An empty list is valid — it clears the scorecard (the feature is optional
// per position). A non-empty list needs named criteria with integer percent
// weights summing to exactly 100.
export function validateScorecard(input: SaveCriterionInput[]): string | null {
  if (input.length === 0) return null
  let total = 0
  for (const c of input) {
    if (c.category !== 'hard' && c.category !== 'soft') return 'invalid category'
    if (typeof c.name !== 'string' || !c.name.trim()) return 'every criterion needs a name'
    if (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 100)
      return 'weights must be integers between 1 and 100'
    total += c.weight
  }
  if (total !== 100) return `weights must sum to 100 (got ${total})`
  return null
}

// Replace a position's criteria set with the given list. Rows with a known id
// are updated in place, new rows are inserted, and active rows missing from
// the payload are removed. sort_order is reassigned from the payload's order
// within each category group. Returns the fresh criteria list.
//
// Removal: a criterion with interviewer scores is archived (set archived_at)
// so those scores keep a valid parent; one without scores is hard-deleted.
export async function saveScorecard(
  db: D1Database,
  positionId: number,
  input: SaveCriterionInput[]
): Promise<ScorecardCriterion[]> {
  const position = await db
    .prepare(`SELECT id FROM job_positions WHERE id = ?`)
    .bind(positionId)
    .first<{ id: number }>()
  if (!position) throw new Error('position not found')

  const { results: existing } = await db
    .prepare(`SELECT id FROM scorecard_criteria WHERE position_id = ? AND archived_at IS NULL`)
    .bind(positionId)
    .all<{ id: number }>()
  const existingIds = new Set(existing.map((r) => r.id))
  const keptIds = new Set(
    input.filter((c) => c.id !== undefined && existingIds.has(c.id)).map((c) => c.id as number)
  )

  const removedIds = [...existingIds].filter((id) => !keptIds.has(id))
  const scoredIds = new Set<number>()
  if (removedIds.length > 0) {
    const placeholders = removedIds.map(() => '?').join(',')
    const { results: scored } = await db
      .prepare(
        `SELECT DISTINCT criterion_id FROM interview_scorecard_scores
         WHERE criterion_id IN (${placeholders})`
      )
      .bind(...removedIds)
      .all<{ criterion_id: number }>()
    for (const r of scored) scoredIds.add(r.criterion_id)
  }

  const stmts: D1PreparedStatement[] = []
  for (const id of removedIds) {
    stmts.push(
      scoredIds.has(id)
        ? db
            .prepare(
              `UPDATE scorecard_criteria
               SET archived_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
            )
            .bind(id)
        : db.prepare(`DELETE FROM scorecard_criteria WHERE id = ?`).bind(id)
    )
  }

  const counters: Record<ScorecardCategory, number> = { hard: 0, soft: 0 }
  for (const c of input) {
    const sortOrder = counters[c.category]++
    const description = c.description?.trim() ? c.description.trim() : null
    if (c.id !== undefined && existingIds.has(c.id)) {
      stmts.push(
        db
          .prepare(
            `UPDATE scorecard_criteria
             SET category = ?, name = ?, description = ?, weight = ?, sort_order = ?
             WHERE id = ?`
          )
          .bind(c.category, c.name.trim(), description, c.weight, sortOrder, c.id)
      )
    } else {
      // Unknown/stale ids fall through to insert — the payload's id is ignored.
      stmts.push(
        db
          .prepare(
            `INSERT INTO scorecard_criteria (position_id, category, name, description, weight, sort_order)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(positionId, c.category, c.name.trim(), description, c.weight, sortOrder)
      )
    }
  }
  if (stmts.length > 0) await db.batch(stmts)

  const { results } = await db
    .prepare(
      `SELECT id, category, name, description, weight, sort_order
       FROM scorecard_criteria
       WHERE position_id = ? AND archived_at IS NULL
       ORDER BY ${CATEGORY_ORDER}, sort_order, id`
    )
    .bind(positionId)
    .all<ScorecardCriterion>()
  return results
}
