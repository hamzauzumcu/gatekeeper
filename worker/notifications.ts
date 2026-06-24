// In-app notifications, currently produced by @mentions in candidate notes.
// See migrations/0016_notifications.sql.

export type NotificationRow = {
  id: number
  recipient: string
  actor: string
  actor_name: string
  type: string
  note_id: number
  applicant_id: number
  applicant_name: string | null
  excerpt: string | null
  created_at: string
  read_at: string | null
}

// Extract @handles from note content. Matches @ followed by a username made of
// word characters (letters, digits, underscore), as long as it isn't part of a
// longer token (e.g. an email's domain). Returns a de-duplicated, lowercased set.
export function parseMentions(content: string): Set<string> {
  const handles = new Set<string>()
  if (!content) return handles
  const re = /(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    handles.add(m[2].toLowerCase())
  }
  return handles
}

// Build a short, single-line snippet of a note for the notification panel.
function makeExcerpt(content: string, max = 140): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// Resolve the @handles in a note to active users and insert a notification for
// each one (excluding the author and any handle already notified for this note).
// `skipRecipients` lets the PATCH path avoid re-notifying users who were already
// mentioned before the edit. Returns how many notifications were created.
export async function createMentionNotifications(
  db: D1Database,
  opts: {
    noteId: number
    applicantId: number
    actor: string
    actorName: string
    content: string
    skipRecipients?: Iterable<string>
  },
): Promise<number> {
  const handles = parseMentions(opts.content)
  handles.delete(opts.actor.toLowerCase())
  for (const r of opts.skipRecipients ?? []) handles.delete(r.toLowerCase())
  if (handles.size === 0) return 0

  // Keep only handles that map to an active, mentionable user.
  const { results } = await db
    .prepare(`SELECT username, full_name FROM users WHERE is_active = 1`)
    .all<{ username: string; full_name: string }>()
  const valid = new Map((results ?? []).map((u) => [u.username.toLowerCase(), u.username]))
  const recipients = [...handles].map((h) => valid.get(h)).filter((u): u is string => Boolean(u))
  if (recipients.length === 0) return 0

  const applicant = await db
    .prepare(`SELECT full_name FROM applicants WHERE id = ?`)
    .bind(opts.applicantId)
    .first<{ full_name: string | null }>()
  const excerpt = makeExcerpt(opts.content)

  await db.batch(
    recipients.map((recipient) =>
      db
        .prepare(
          `INSERT INTO notifications
             (recipient, actor, actor_name, type, note_id, applicant_id, applicant_name, excerpt)
           VALUES (?, ?, ?, 'mention', ?, ?, ?, ?)`,
        )
        .bind(
          recipient,
          opts.actor,
          opts.actorName,
          opts.noteId,
          opts.applicantId,
          applicant?.full_name ?? null,
          excerpt,
        ),
    ),
  )
  return recipients.length
}

// Recipients already notified for a given note — used by the edit path so an
// edit only notifies newly-added mentions.
export async function existingRecipients(db: D1Database, noteId: number): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT DISTINCT recipient FROM notifications WHERE note_id = ?`)
    .bind(noteId)
    .all<{ recipient: string }>()
  return (results ?? []).map((r) => r.recipient)
}

// Recent notifications for a user (newest first) plus the unread count.
export async function listNotifications(
  db: D1Database,
  recipient: string,
  limit = 30,
): Promise<{ notifications: NotificationRow[]; unread: number }> {
  const { results } = await db
    .prepare(
      `SELECT id, recipient, actor, actor_name, type, note_id, applicant_id,
              applicant_name, excerpt, created_at, read_at
         FROM notifications
        WHERE recipient = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(recipient, limit)
    .all<NotificationRow>()
  const unreadRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE recipient = ? AND read_at IS NULL`)
    .bind(recipient)
    .first<{ n: number }>()
  return { notifications: results ?? [], unread: unreadRow?.n ?? 0 }
}

// Applicant ids that have at least one unread mention for this user — drives the
// per-row marker in the candidate list.
export async function unreadApplicantIds(db: D1Database, recipient: string): Promise<number[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT applicant_id FROM notifications
        WHERE recipient = ? AND read_at IS NULL`,
    )
    .bind(recipient)
    .all<{ applicant_id: number }>()
  return (results ?? []).map((r) => r.applicant_id)
}

export async function markRead(db: D1Database, id: number, recipient: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE notifications
          SET read_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE id = ? AND recipient = ? AND read_at IS NULL`,
    )
    .bind(id, recipient)
    .run()
  return (res.meta?.changes ?? 0) > 0
}

export async function markAllRead(db: D1Database, recipient: string): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE notifications
          SET read_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE recipient = ? AND read_at IS NULL`,
    )
    .bind(recipient)
    .run()
  return res.meta?.changes ?? 0
}

export async function deleteForNote(db: D1Database, noteId: number): Promise<void> {
  await db.prepare(`DELETE FROM notifications WHERE note_id = ?`).bind(noteId).run()
}
