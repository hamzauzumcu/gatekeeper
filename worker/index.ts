import { Hono } from 'hono'
import { deepseekChat } from './deepseek'
import { importApplications, type ImportPayload } from './import'

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

// İleride:
// app.post('/api/webhook/tally', ...)   — yeni başvurular otomatik düşer
// app.get('/api/candidates', ...)       — aday listesi

export default app
