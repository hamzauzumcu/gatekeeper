import { Hono } from 'hono'
import { deepseekChat } from './deepseek'
import { importApplications, type ImportPayload } from './import'
import { listCandidates, getCandidate, getCandidateFilters } from './candidates'

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
  const limit = Number(c.req.query('limit') ?? '50')
  const offset = Number(c.req.query('offset') ?? '0')
  const data = await listCandidates(c.env.DB, { q, countries, position, limit, offset })
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

// İleride:
// app.post('/api/webhook/tally', ...)   — yeni başvurular otomatik düşer

export default app
