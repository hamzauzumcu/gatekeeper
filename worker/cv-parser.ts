// CV parsing — PDF'ten metin çıkartır, DeepSeek ile yapısal veriyi parse eder.
// PDF text extraction: BT...ET bloklarından okunabilir metin toplar.
// Taranan (scanned) PDF'lerde boş döner; text-based CV'lerin tamamında çalışır.

import { PARSE_VERSION, PARSE_SCHEMA, UNIVERSITY_MAP } from './cv-schema'
import { deepseekChat } from './deepseek'

function extractTextFromPdf(buffer: ArrayBuffer): string {
  // PDF binary'sini latin-1 ile decode et — ASCII metin blokları okunabilir hale gelir
  const raw = new TextDecoder('latin1').decode(buffer)

  const parts: string[] = []
  const btEtRe = /BT([\s\S]*?)ET/g
  let m: RegExpExecArray | null

  while ((m = btEtRe.exec(raw)) !== null) {
    const block = m[1]
    // (metin) Tj  veya  [(metin)] TJ  — iki PDF text operatörü
    const strRe = /\(([^\\)]*(?:\\.[^\\)]*)*)\)\s*(?:Tj|TJ)/g
    let s: RegExpExecArray | null
    while ((s = strRe.exec(block)) !== null) {
      const t = s[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
      if (t.trim()) parts.push(t)
    }
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function normalizeUniversity(name: string): string {
  const lower = ` ${name.toLowerCase()} `
  for (const [pattern, canonical] of UNIVERSITY_MAP) {
    if (lower.includes(pattern)) return canonical
  }
  return name
}

async function fetchPdfBuffer(
  resumeUrl: string,
  r2Bucket?: R2Bucket,
  r2PublicUrl?: string,
): Promise<ArrayBuffer> {
  // Prefer reading from R2 directly (works in local dev + avoids public URL dependency)
  if (r2Bucket && r2PublicUrl) {
    const prefix = r2PublicUrl.endsWith('/') ? r2PublicUrl : `${r2PublicUrl}/`
    if (resumeUrl.startsWith(prefix)) {
      const key = resumeUrl.slice(prefix.length)
      const obj = await r2Bucket.get(key)
      if (!obj) throw new Error(`R2 object not found: ${key}`)
      return obj.arrayBuffer()
    }
  }
  // Fallback: HTTP fetch (Tally URLs or any external URL)
  const res = await fetch(resumeUrl)
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`)
  return res.arrayBuffer()
}

export async function parseAndStoreResume(
  db: D1Database,
  applicationId: number,
  resumeUrl: string,
  deepseekApiKey: string,
  r2Bucket?: R2Bucket,
  r2PublicUrl?: string,
): Promise<void> {

  const resume_text = extractTextFromPdf(await fetchPdfBuffer(resumeUrl, r2Bucket, r2PublicUrl))
  if (!resume_text) throw new Error('PDF metin çıkartılamadı (muhtemelen taranan görüntü)')

  const raw = await deepseekChat(
    deepseekApiKey,
    [
      {
        role: 'system',
        content: `Sen bir CV analiz uzmanısın. Verilen CV metninden yapısal veriyi çıkart ve SADECE geçerli JSON döndür — başka hiçbir şey yazma, kod bloğu da kullanma.

Döndürülecek format:
${PARSE_SCHEMA}

Kurallar:
- total_experience_years: tüm iş deneyimlerinin toplamı, 1 ondalık hassasiyetle
- work_history: en yeniden en eskiye sıralı
- months: start/end verilmişse hesapla; yoksa CV'deki "X yıl Y ay" ifadesinden tahmin et
- Bilinmeyen alanlarda null kullan, tahmin etme`,
      },
      {
        role: 'user',
        content: resume_text,
      },
    ],
    { model: 'deepseek-v4-flash', thinking: 'disabled', jsonMode: true },
  )

  // Bazen ```json ... ``` bloğuna sarıyor, temizle
  const jsonText = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
  const fields = JSON.parse(jsonText)

  // Üniversite isimlerini normalize et
  if (Array.isArray(fields.education)) {
    for (const entry of fields.education) {
      if (typeof entry.school === 'string') {
        entry.school = normalizeUniversity(entry.school)
      }
    }
  }

  await db
    .prepare(
      `UPDATE applications
       SET resume_text = ?, resume_parsed = ?, resume_parse_version = ?
       WHERE id = ?`,
    )
    .bind(resume_text, JSON.stringify(fields), PARSE_VERSION, applicationId)
    .run()
}
