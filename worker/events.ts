// Candidate timeline / audit log. Append-only events that power the History tab
// in the candidate detail panel. See migration 0015_candidate_events.sql.
//
// Writing is best-effort and is folded into the same request that performs the
// mutation (status change, note add/delete). Callers pass the actor's username;
// the display name is resolved here from the users table (0014), falling back to
// the username itself when the user is unknown.

export const CANDIDATE_EVENT_TYPES = [
  'fit_status_changed',
  'pipeline_status_changed',
  'note_added',
  'note_deleted',
  'scorecard_submitted',
  'scorecard_updated',
] as const

export type CandidateEventType = (typeof CANDIDATE_EVENT_TYPES)[number]

export type CandidateEventInput = {
  applicant_id: number
  event_type: CandidateEventType
  from_value?: string | null
  to_value?: string | null
  application_id?: number | null
  metadata?: Record<string, unknown> | null
}

export type CandidateEvent = {
  id: number
  applicant_id: number
  event_type: CandidateEventType
  from_value: string | null
  to_value: string | null
  application_id: number | null
  metadata: Record<string, unknown> | null
  actor: string
  actor_name: string
  created_at: string
}

// Resolve a username to its display name. Unknown users (e.g. legacy handles not
// in the users table) fall back to the raw username so an event is never blank.
async function resolveActorName(db: D1Database, username: string): Promise<string> {
  const row = await db
    .prepare(`SELECT full_name FROM users WHERE username = ?`)
    .bind(username)
    .first<{ full_name: string }>()
  return row?.full_name ?? username
}

// Insert one or more events for a single actor. No-op when the actor is unknown
// or there are no events, so callers can pass already-filtered "what changed"
// lists without guarding.
export async function logCandidateEvents(
  db: D1Database,
  actor: string | null | undefined,
  events: CandidateEventInput[]
): Promise<void> {
  if (!actor || events.length === 0) return
  const actorName = await resolveActorName(db, actor)
  const stmt = db.prepare(
    `INSERT INTO candidate_events
       (applicant_id, event_type, from_value, to_value, application_id, metadata, actor, actor_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  await db.batch(
    events.map((e) =>
      stmt.bind(
        e.applicant_id,
        e.event_type,
        e.from_value ?? null,
        e.to_value ?? null,
        e.application_id ?? null,
        e.metadata ? JSON.stringify(e.metadata) : null,
        actor,
        actorName
      )
    )
  )
}

// Full timeline for a candidate, newest first.
export async function getCandidateEvents(
  db: D1Database,
  applicantId: number
): Promise<CandidateEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT id, applicant_id, event_type, from_value, to_value, application_id,
              metadata, actor, actor_name, created_at
       FROM candidate_events
       WHERE applicant_id = ?
       ORDER BY created_at DESC, id DESC`
    )
    .bind(applicantId)
    .all<Omit<CandidateEvent, 'metadata'> & { metadata: string | null }>()
  return (results ?? []).map((r) => ({
    ...r,
    metadata: r.metadata ? safeParse(r.metadata) : null,
  }))
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
