import { Hono } from 'hono'

// Bindings (DB, RESUMES vb.) wrangler.jsonc'de tanımlandıkça buraya eklenecek
type Env = {
  Bindings: {}
}

const app = new Hono<Env>()

app.get('/api/health', (c) => c.json({ ok: true, service: 'gatekeeper' }))

// İleride:
// app.post('/api/import/csv', ...)      — CSV backlog import
// app.post('/api/webhook/tally', ...)   — yeni başvurular otomatik düşer
// app.get('/api/candidates', ...)       — aday listesi

export default app
