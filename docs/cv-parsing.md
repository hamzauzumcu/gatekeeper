# CV Parsing — Schema-Driven AI Extraction

After CVs are uploaded to R2, they're sent to DeepSeek for extraction of structured data and stored in D1.
Which fields to extract is determined by `PARSE_VERSION` + `PARSE_SCHEMA`; adding new fields requires no DB migration.

---

## DB Columns

The `0004_cv_parsing.sql` migration adds 3 columns to the `applications` table:

| Column | Type | Description |
|---|---|---|
| `resume_text` | `TEXT` | Raw plain text of the CV — used in AI queries |
| `resume_parsed` | `TEXT` | Extracted structured data (JSON blob) |
| `resume_parse_version` | `INTEGER DEFAULT 0` | Which schema version it was parsed with |

`resume_parse_version = 0` → not yet parsed.

---

## Single Source of Truth: `cv-schema.ts`

```
worker/cv-schema.ts
```

This is the **only file to modify** when adding new fields.

```typescript
// Increment version → sync endpoint will re-parse missing applications
export const PARSE_VERSION = 1

export const PARSE_SCHEMA = {
  total_experience_years: 'number | null',
  education: '{ school: string; degree: string; year: number | null }[]',
  work_history: '{ company: string; role: string; start: string | null; end: string | null; months: number | null }[]',
  skills: 'string[]',
  languages: 'string[]',
}
```

The schema is automatically injected into the system prompt sent to DeepSeek — no need to modify the prompt separately.

---

## Flow

### During import (new CVs)

```
CSV/Tally → importApplications()
                ↓
          Upload to R2   (already exists)
                ↓
          parseAndStoreResume()      ← NEW STEP
          │  1. Fetch PDF from R2
          │  2. Send to DeepSeek → resume_text + resume_parsed
          │  3. Set resume_parse_version = PARSE_VERSION
          └→ Write to DB (single UPDATE)
```

If there's an error, import doesn't stop; `resume_parse_version` stays 0, sync handles it later.

### Sync endpoint (existing + unparsed CVs)

```
POST /api/admin/sync-cv
     { dryRun?: boolean, limit?: number }
          ↓
     Fetch applications where resume_parse_version < PARSE_VERSION
          ↓  (one by one to avoid Workers timeout)
     Run parseAndStoreResume() for each
          ↓
     Returns { processed, failed, skipped }
```

With **`dryRun: true`** you can see how many records will be affected first.

---

## Adding a New Field — Step by Step

1. Open `worker/cv-schema.ts`
2. Add the new field to `PARSE_SCHEMA`
3. Increment `PARSE_VERSION`
4. Deploy
5. Run `POST /api/admin/sync-cv` → all CVs are re-parsed

No DB migration needed. The new field goes into the JSON blob.

---

## Querying

Direct filtering with D1 JSON functions:

```sql
-- Candidates with 3+ years of experience
SELECT a.full_name,
       json_extract(ap.resume_parsed, '$.total_experience_years') AS years
FROM applicants a
JOIN applications ap ON ap.applicant_id = a.id
WHERE json_extract(ap.resume_parsed, '$.total_experience_years') >= 3
  AND ap.resume_parse_version > 0;

-- By school
SELECT a.full_name,
       json_extract(ap.resume_parsed, '$.education[0].school') AS school
FROM applicants a
JOIN applications ap ON ap.applicant_id = a.id
WHERE json_extract(ap.resume_parsed, '$.education[0].school') LIKE '%University%';
```

### Batch AI queries

Use the `resume_text` column — no need to re-fetch PDFs:

```typescript
// "How many months do they typically stay at a job?"
const rows = await db
  .prepare(`SELECT a.full_name, ap.resume_text
            FROM applicants a JOIN applications ap ON ap.applicant_id = a.id
            WHERE ap.resume_text IS NOT NULL LIMIT 100`)
  .all()

const prompt = rows.results
  .map(r => `--- ${r.full_name} ---\n${r.resume_text}`)
  .join('\n\n')

const answer = await deepseekChat(apiKey, [
  { role: 'system', content: 'You are an HR analyst. Analyze the resume summaries provided.' },
  { role: 'user', content: `Looking at the work history of the candidates below, calculate the average number of months they stayed at companies:\n\n${prompt}` },
])
```

---

## Related Files

| File | Purpose |
|---|---|
| `worker/cv-schema.ts` | Parse version and field definitions — **modify only this** |
| `worker/cv-parser.ts` | `parseAndStoreResume()` function — DeepSeek call + DB write |
| `worker/import.ts` | Integration into import flow (step 7) |
| `worker/index.ts` | `POST /api/admin/sync-cv` endpoint |
| `migrations/0004_cv_parsing.sql` | Migration for the 3 columns |

---

## Important Notes

- **Workers CPU limit:** Run sync in small batches (e.g., `limit: 20`). Call the endpoint multiple times for large datasets.
- **Idempotent:** If the same CV is parsed twice, no problem — it just overwrites.
- **Parse error:** If one CV fails to parse, others continue; failed ones are logged.
- **No resume_url:** Parse is skipped, `resume_parse_version` stays 0.
