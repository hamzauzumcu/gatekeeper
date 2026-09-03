// Emoji reactions on candidate notes. See migrations/0035_note_reactions_and_replies.sql.

export type ReactionRow = {
  note_id: number
  emoji: string
  username: string
  user_name: string
}

// Reactions on one note, grouped per emoji for the UI: how many people reacted,
// their display names (for the tooltip) and their usernames (so the client can
// tell whether the current user is among them).
export type NoteReaction = {
  emoji: string
  count: number
  users: string[]
  names: string[]
}

const MAX_EMOJI_LENGTH = 16

// Reject anything that isn't a short emoji-ish token — reactions are rendered
// verbatim, so we don't want arbitrary text (or markup) sneaking in.
export function isValidEmoji(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const emoji = value.trim()
  if (!emoji || emoji.length > MAX_EMOJI_LENGTH) return false
  return /^\p{Extended_Pictographic}[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]*$/u.test(emoji)
}

// Group flat reaction rows into per-note, per-emoji buckets. Emojis keep the
// order they were first seen (oldest reaction first), so the chip row is stable.
export function groupReactions(rows: ReactionRow[]): Map<number, NoteReaction[]> {
  const byNote = new Map<number, NoteReaction[]>()
  for (const row of rows) {
    let list = byNote.get(row.note_id)
    if (!list) byNote.set(row.note_id, (list = []))
    let bucket = list.find((r) => r.emoji === row.emoji)
    if (!bucket) list.push((bucket = { emoji: row.emoji, count: 0, users: [], names: [] }))
    bucket.count += 1
    bucket.users.push(row.username)
    bucket.names.push(row.user_name)
  }
  return byNote
}

// All reactions for the given notes, oldest first.
export async function fetchReactions(
  db: D1Database,
  noteIds: number[],
): Promise<Map<number, NoteReaction[]>> {
  if (noteIds.length === 0) return new Map()
  const placeholders = noteIds.map(() => '?').join(',')
  const { results } = await db
    .prepare(
      `SELECT note_id, emoji, username, user_name FROM note_reactions
        WHERE note_id IN (${placeholders})
        ORDER BY id`,
    )
    .bind(...noteIds)
    .all<ReactionRow>()
  return groupReactions(results ?? [])
}

// Add the reaction if the user hasn't used this emoji on the note yet, remove it
// otherwise. Returns the note's reactions after the change.
export async function toggleReaction(
  db: D1Database,
  opts: { noteId: number; emoji: string; username: string; userName: string },
): Promise<{ reactions: NoteReaction[]; reacted: boolean }> {
  const deleted = await db
    .prepare(`DELETE FROM note_reactions WHERE note_id = ? AND emoji = ? AND username = ?`)
    .bind(opts.noteId, opts.emoji, opts.username)
    .run()
  const reacted = (deleted.meta?.changes ?? 0) === 0
  if (reacted) {
    await db
      .prepare(
        `INSERT INTO note_reactions (note_id, emoji, username, user_name) VALUES (?, ?, ?, ?)`,
      )
      .bind(opts.noteId, opts.emoji, opts.username, opts.userName)
      .run()
  }
  const grouped = await fetchReactions(db, [opts.noteId])
  return { reactions: grouped.get(opts.noteId) ?? [], reacted }
}
