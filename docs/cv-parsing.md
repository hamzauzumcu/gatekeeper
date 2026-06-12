# CV Parsing — Schema-Driven AI Extraction

CV'ler R2'ye yüklendikten sonra DeepSeek'e gönderilir, yapısal veri çıkartılır ve D1'e yazılır.  
Hangi alanların çıkartılacağını `PARSE_VERSION` + `PARSE_SCHEMA` belirler; yeni alan eklemek DB migrasyonu gerektirmez.

---

## DB Kolonları

`0004_cv_parsing.sql` migration'ı `applications` tablosuna 3 kolon ekler:

| Kolon | Tip | Açıklama |
|---|---|---|
| `resume_text` | `TEXT` | CV'nin ham düz metni — AI sorgularında kullanılır |
| `resume_parsed` | `TEXT` | Çıkartılan yapısal veri (JSON blob) |
| `resume_parse_version` | `INTEGER DEFAULT 0` | Hangi schema versiyonuyla parse edildi |

`resume_parse_version = 0` → henüz parse edilmemiş.

---

## Tek Kaynak: `cv-schema.ts`

```
worker/cv-schema.ts
```

Yeni alan eklemek için **tek değiştirilecek dosya** burası.

```typescript
// Versiyon'u +1 yap → sync endpoint eksik olanları yeniden parse eder
export const PARSE_VERSION = 1

export const PARSE_SCHEMA = {
  total_experience_years: 'number | null',
  education: '{ school: string; degree: string; year: number | null }[]',
  work_history: '{ company: string; role: string; start: string | null; end: string | null; months: number | null }[]',
  skills: 'string[]',
  languages: 'string[]',
}
```

Schema, DeepSeek'e gönderilen sistem prompt'una otomatik eklenir — ayrı bir prompt değiştirmeye gerek yoktur.

---

## Akış

### Import sırasında (yeni CV'ler)

```
CSV/Tally → importApplications()
                ↓
          R2'ye yükle   (zaten var)
                ↓
          parseAndStoreResume()      ← YENİ ADIM
          │  1. R2'den PDF al
          │  2. DeepSeek'e gönder → resume_text + resume_parsed
          │  3. resume_parse_version = PARSE_VERSION
          └→ DB'ye yaz (tek UPDATE)
```

Hata olursa import durdurmaz; `resume_parse_version` 0 kalır, sync sonradan halleder.

### Sync endpoint (mevcut + güncellenemeyen CV'ler)

```
POST /api/admin/sync-cv
     { dryRun?: boolean, limit?: number }
          ↓
     resume_parse_version < PARSE_VERSION olan başvuruları çek
          ↓  (birer birer, Workers timeout'u aşmamak için)
     parseAndStoreResume() her biri için çalış
          ↓
     { processed, failed, skipped } döner
```

**`dryRun: true`** ile önce kaç kayıt etkileneceğini görebilirsin.

---

## Yeni Alan Ekleme — Adım Adım

1. `worker/cv-schema.ts` dosyasını aç
2. `PARSE_SCHEMA`'ya yeni alanı ekle
3. `PARSE_VERSION`'ı +1 yap
4. Deploy et
5. `POST /api/admin/sync-cv` çalıştır → tüm CV'ler yeniden parse edilir

DB migration gerekmez. Yeni alan JSON blob'un içine gider.

---

## Sorgulama

D1 JSON fonksiyonları ile direkt filtreleme:

```sql
-- 3+ yıl deneyimliler
SELECT a.full_name,
       json_extract(ap.resume_parsed, '$.total_experience_years') AS yil
FROM applicants a
JOIN applications ap ON ap.applicant_id = a.id
WHERE json_extract(ap.resume_parsed, '$.total_experience_years') >= 3
  AND ap.resume_parse_version > 0;

-- Mezun olduğu okula göre
SELECT a.full_name,
       json_extract(ap.resume_parsed, '$.education[0].school') AS okul
FROM applicants a
JOIN applications ap ON ap.applicant_id = a.id
WHERE json_extract(ap.resume_parsed, '$.education[0].school') LIKE '%Boğaziçi%';
```

### AI'a toplu soru sormak

`resume_text` kolonunu kullan — PDF'e dönmeye gerek yok:

```typescript
// "Ortalama bir işte kaç ay kalmışlar?"
const rows = await db
  .prepare(`SELECT a.full_name, ap.resume_text
            FROM applicants a JOIN applications ap ON ap.applicant_id = a.id
            WHERE ap.resume_text IS NOT NULL LIMIT 100`)
  .all()

const prompt = rows.results
  .map(r => `--- ${r.full_name} ---\n${r.resume_text}`)
  .join('\n\n')

const answer = await deepseekChat(apiKey, [
  { role: 'system', content: 'Sen bir İK analistisin. Verilen CV özetlerini analiz et.' },
  { role: 'user', content: `Aşağıdaki adayların iş geçmişlerine bakarak, bir şirkette ortalama kaç ay kaldıklarını hesapla:\n\n${prompt}` },
])
```

---

## İlgili Dosyalar

| Dosya | Görev |
|---|---|
| `worker/cv-schema.ts` | Parse versiyonu ve field tanımları — **buraya dokunan yeter** |
| `worker/cv-parser.ts` | `parseAndStoreResume()` fonksiyonu — DeepSeek çağrısı + DB yazımı |
| `worker/import.ts` | Import akışına entegrasyon (step 7) |
| `worker/index.ts` | `POST /api/admin/sync-cv` endpoint'i |
| `migrations/0004_cv_parsing.sql` | 3 kolonun migration'ı |

---

## Dikkat Edilecekler

- **Workers CPU limiti:** Sync'i küçük batch'lerle çalıştır (`limit: 20` gibi). Büyük veri setlerinde endpoint'i birkaç kez çağır.
- **Idempotent:** Aynı CV iki kez parse edilse sorun olmaz, sadece üzerine yazar.
- **Parse hatası:** Tek CV parse edilemezse diğerleri devam eder, başarısız olanlar loglanır.
- **resume_url yoksa:** Parse atlanır, `resume_parse_version` 0 kalır.
