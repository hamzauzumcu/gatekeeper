import { Hono } from 'hono'
import { deepseekChat } from './deepseek'
import { importApplications, type ImportPayload } from './import'
import { listCandidates, getCandidate, getCandidateFilters, updateApplicationStatus, updateApplicantsFitStatus } from './candidates'

// Bindings (DB, RESUMES vb.) wrangler.jsonc'de tanımlandıkça buraya eklenecek
type Env = {
  Bindings: {
    // Lokal: .dev.vars — Prod: wrangler secret put DEEPSEEK_API_KEY
    DEEPSEEK_API_KEY: string
    // D1 — wrangler.jsonc'de tanımlı
    DB: D1Database
  }
}

const app = new Hono<Env>()

app.get('/api/health', (c) => c.json({ ok: true, service: 'gatekeeper' }))

// Key'in çalıştığını doğrulamak için geçici test endpoint'i
app.get('/api/llm/ping', async (c) => {
  const reply = await deepseekChat(c.env.DEEPSEEK_API_KEY, [
    { role: 'user', content: 'Sadece "pong" yaz, başka bir şey yazma.' },
  ])
  return c.json({ ok: true, reply })
})

// CSV import — tarayıcı normalize edilmiş satırları chunk'lar halinde gönderir.
// NOT: şimdilik auth yok (admin aracı). Prod'da paylaşılan secret / Access eklenecek.
app.post('/api/import', async (c) => {
  let payload: ImportPayload
  try {
    payload = await c.req.json<ImportPayload>()
  } catch {
    return c.json({ ok: false, error: 'geçersiz JSON' }, 400)
  }
  try {
    const summary = await importApplications(c.env.DB, payload)
    return c.json({ ok: true, summary })
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'import hatası' }, 400)
  }
})

// Filtre seçenekleri (ülke + pozisyon listeleri)
app.get('/api/candidates/filters', async (c) => {
  const filters = await getCandidateFilters(c.env.DB)
  return c.json({ ok: true, ...filters })
})

// Aday listesi + arama + filtre
app.get('/api/candidates', async (c) => {
  const q = c.req.query('q') ?? ''
  const countries = c.req.queries('country') ?? []
  const position = c.req.query('position') ?? ''
  const fit_statuses = c.req.queries('fit_status') ?? []
  const limit = Number(c.req.query('limit') ?? '50')
  const offset = Number(c.req.query('offset') ?? '0')
  const data = await listCandidates(c.env.DB, { q, countries, position, fit_statuses, limit, offset })
  return c.json({ ok: true, ...data })
})

// Aday detayı (başvurular + cevaplar)
app.get('/api/candidates/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'geçersiz id' }, 400)
  const detail = await getCandidate(c.env.DB, id)
  if (!detail) return c.json({ ok: false, error: 'aday bulunamadı' }, 404)
  return c.json({ ok: true, ...detail })
})

// Başvuru durumu güncelle
app.patch('/api/applications/:id/status', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'geçersiz id' }, 400)
  let body: { status: string }
  try {
    body = await c.req.json<{ status: string }>()
  } catch {
    return c.json({ ok: false, error: 'geçersiz JSON' }, 400)
  }
  try {
    const updated = await updateApplicationStatus(c.env.DB, id, body.status)
    if (!updated) return c.json({ ok: false, error: 'başvuru bulunamadı' }, 404)
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'güncelleme hatası' }, 400)
  }
})

// Aday uygunluk durumu toplu güncelle (multi-select)
app.patch('/api/applicants/fit-status', async (c) => {
  let body: { ids: number[]; fit_status: string | null }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'geçersiz JSON' }, 400)
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ ok: false, error: 'ids boş olamaz' }, 400)
  }
  try {
    const updated = await updateApplicantsFitStatus(c.env.DB, body.ids, body.fit_status ?? null)
    return c.json({ ok: true, updated })
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'güncelleme hatası' }, 400)
  }
})

// Aday notları — GET
app.get('/api/candidates/:id/notes', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'geçersiz id' }, 400)
  const { results } = await c.env.DB.prepare(
    `SELECT id, applicant_id, content, created_by, created_by_name, created_at
     FROM candidate_notes WHERE applicant_id = ? ORDER BY created_at DESC`
  ).bind(id).all()
  return c.json({ ok: true, notes: results ?? [] })
})

// Aday notları — POST (yeni not ekle)
app.post('/api/candidates/:id/notes', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'geçersiz id' }, 400)
  let body: { content: string; created_by: string; created_by_name: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'geçersiz JSON' }, 400)
  }
  if (!body.content?.trim()) return c.json({ ok: false, error: 'not boş olamaz' }, 400)
  if (!body.created_by) return c.json({ ok: false, error: 'kullanıcı gerekli' }, 400)
  const result = await c.env.DB.prepare(
    `INSERT INTO candidate_notes (applicant_id, content, created_by, created_by_name)
     VALUES (?, ?, ?, ?)`
  ).bind(id, body.content.trim(), body.created_by, body.created_by_name).run()
  const note = await c.env.DB.prepare(
    `SELECT id, applicant_id, content, created_by, created_by_name, created_at
     FROM candidate_notes WHERE id = ?`
  ).bind(result.meta.last_row_id).first()
  return c.json({ ok: true, note })
})

// Not sil — DELETE
app.delete('/api/notes/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'geçersiz id' }, 400)
  const result = await c.env.DB.prepare(`DELETE FROM candidate_notes WHERE id = ?`).bind(id).run()
  if ((result.meta?.changes ?? 0) === 0) return c.json({ ok: false, error: 'not bulunamadı' }, 404)
  return c.json({ ok: true })
})

// İleride:
// app.post('/api/webhook/tally', ...)   — yeni başvurular otomatik düşer

export default app
