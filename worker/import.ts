// CSV import — D1'e idempotent yazma.
// Tarayıcı normalize edilmiş ImportPayload gönderir; biz upsert ederiz.
// Dedup: applicants.respondent_id (kişi), applications.tally_submission_id (başvuru).

type QuestionType = 'text' | 'number' | 'boolean' | 'file'

type ImportQuestion = { field_key: string; label: string; type: QuestionType }

type ImportRow = {
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
  answers: Record<string, string>
}

export type ImportPayload = {
  position: { slug: string; title: string }
  questions: ImportQuestion[]
  rows: ImportRow[]
}

export type ImportSummary = {
  positionId: number
  questions: number
  applicants: number
  applications: number
  answers: number
}

const VALID_TYPES: QuestionType[] = ['text', 'number', 'boolean', 'file']

function assertPayload(p: ImportPayload): string | null {
  if (!p || typeof p !== 'object') return 'payload yok'
  if (!p.position?.slug || !p.position?.title) return 'position.slug/title gerekli'
  if (!Array.isArray(p.questions)) return 'questions dizi olmalı'
  if (!Array.isArray(p.rows)) return 'rows dizi olmalı'
  if (p.rows.length > 500) return 'chunk en fazla 500 satır olmalı'
  for (const q of p.questions) {
    if (!q.field_key || !q.label) return 'her soruda field_key ve label gerekli'
    if (!VALID_TYPES.includes(q.type)) return `geçersiz tip: ${q.type}`
  }
  return null
}

export async function importApplications(
  db: D1Database,
  payload: ImportPayload
): Promise<ImportSummary> {
  const err = assertPayload(payload)
  if (err) throw new Error(err)

  // 1) Pozisyon upsert (slug tekil)
  const pos = await db
    .prepare(
      `INSERT INTO job_positions (slug, title) VALUES (?, ?)
       ON CONFLICT(slug) DO UPDATE SET title = excluded.title
       RETURNING id`
    )
    .bind(payload.position.slug, payload.position.title)
    .first<{ id: number }>()
  if (!pos) throw new Error('pozisyon upsert başarısız')
  const positionId = pos.id

  // 2) Sorular upsert (position_id + field_key tekil) → field_key -> question_id
  const questionId = new Map<string, number>()
  if (payload.questions.length) {
    const stmts = payload.questions.map((q, i) =>
      db
        .prepare(
          `INSERT INTO position_questions (position_id, field_key, label, type, sort_order)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(position_id, field_key)
           DO UPDATE SET label = excluded.label, type = excluded.type
           RETURNING id, field_key`
        )
        .bind(positionId, q.field_key, q.label, q.type, i)
    )
    const res = await db.batch<{ id: number; field_key: string }>(stmts)
    for (const r of res) {
      const row = r.results?.[0]
      if (row) questionId.set(row.field_key, row.id)
    }
  }

  // 3) Applicant upsert (respondent_id tekil). Chunk içinde tekilleştir (son kazanır).
  const uniqueApplicants = new Map<string, ImportRow>()
  for (const row of payload.rows) uniqueApplicants.set(row.respondent_id, row)

  const applicantId = new Map<string, number>()
  if (uniqueApplicants.size) {
    const stmts = [...uniqueApplicants.values()].map((r) =>
      db
        .prepare(
          `INSERT INTO applicants (respondent_id, full_name, email, phone, country, linkedin_url)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(respondent_id) DO UPDATE SET
             full_name    = COALESCE(excluded.full_name, applicants.full_name),
             email        = COALESCE(excluded.email, applicants.email),
             phone        = COALESCE(excluded.phone, applicants.phone),
             country      = COALESCE(excluded.country, applicants.country),
             linkedin_url = COALESCE(excluded.linkedin_url, applicants.linkedin_url)
           RETURNING id, respondent_id`
        )
        .bind(r.respondent_id, r.full_name, r.email, r.phone, r.country, r.linkedin_url)
    )
    const res = await db.batch<{ id: number; respondent_id: string }>(stmts)
    for (const r of res) {
      const row = r.results?.[0]
      if (row) applicantId.set(row.respondent_id, row.id)
    }
  }

  // 4) Application upsert (tally_submission_id tekil) → submission_id -> application_id
  const applicationId = new Map<string, number>()
  if (payload.rows.length) {
    const stmts = payload.rows.map((r) =>
      db
        .prepare(
          `INSERT INTO applications
             (applicant_id, position_id, tally_submission_id, resume_url, cover_letter, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(tally_submission_id) DO UPDATE SET
             applicant_id = excluded.applicant_id,
             resume_url   = excluded.resume_url,
             cover_letter = excluded.cover_letter,
             submitted_at = excluded.submitted_at
           RETURNING id, tally_submission_id`
        )
        .bind(
          applicantId.get(r.respondent_id) ?? null,
          positionId,
          r.submission_id,
          r.resume_url,
          r.cover_letter,
          r.submitted_at
        )
    )
    const res = await db.batch<{ id: number; tally_submission_id: string }>(stmts)
    for (const r of res) {
      const row = r.results?.[0]
      if (row) applicationId.set(row.tally_submission_id, row.id)
    }
  }

  // 5) Cevaplar upsert (application_id + question_id tekil)
  let answers = 0
  const answerStmts: D1PreparedStatement[] = []
  for (const row of payload.rows) {
    const appId = applicationId.get(row.submission_id)
    if (!appId) continue
    for (const [field_key, value] of Object.entries(row.answers)) {
      const qId = questionId.get(field_key)
      if (!qId) continue
      answerStmts.push(
        db
          .prepare(
            `INSERT INTO application_answers (application_id, question_id, value)
             VALUES (?, ?, ?)
             ON CONFLICT(application_id, question_id) DO UPDATE SET value = excluded.value`
          )
          .bind(appId, qId, value)
      )
      answers++
    }
  }
  if (answerStmts.length) await db.batch(answerStmts)

  return {
    positionId,
    questions: questionId.size,
    applicants: applicantId.size,
    applications: applicationId.size,
    answers,
  }
}
