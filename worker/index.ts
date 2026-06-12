import { Hono } from 'hono'
import { deepseekChat } from './deepseek'

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

// İleride:
// app.post('/api/import/csv', ...)      — CSV backlog import
// app.post('/api/webhook/tally', ...)   — yeni başvurular otomatik düşer
// app.get('/api/candidates', ...)       — aday listesi

export default app
