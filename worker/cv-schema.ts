// CV parsing schema — the single source of truth for parsed CV fields.
// Add a new field → bump PARSE_VERSION by 1 → run POST /api/admin/sync-cv.

export const PARSE_VERSION = 3

// Üniversite adı normalleştirme — farklı yazımları tek isime çeker.
// Pattern küçük harfle aranır, alt string eşleşmesi yeterli.
// Yeni üniversite eklemek için buraya satır ekle.
export const UNIVERSITY_MAP: [pattern: string, canonical: string][] = [
  ['bogazici', 'Boğaziçi Üniversitesi'],
  ['boğaziçi', 'Boğaziçi Üniversitesi'],
  ['boun', 'Boğaziçi Üniversitesi'],
  ['bosphorus university', 'Boğaziçi Üniversitesi'],
  ['istanbul teknik', 'İstanbul Teknik Üniversitesi'],
  ['istanbul technical', 'İstanbul Teknik Üniversitesi'],
  ['i.t.ü', 'İstanbul Teknik Üniversitesi'],
  [' itu ', 'İstanbul Teknik Üniversitesi'],
  ['orta dogu teknik', 'Orta Doğu Teknik Üniversitesi'],
  ['orta doğu teknik', 'Orta Doğu Teknik Üniversitesi'],
  ['middle east technical', 'Orta Doğu Teknik Üniversitesi'],
  ['odtu', 'Orta Doğu Teknik Üniversitesi'],
  ['metu', 'Orta Doğu Teknik Üniversitesi'],
  ['hacettepe', 'Hacettepe Üniversitesi'],
  ['bilkent', 'Bilkent Üniversitesi'],
  ['koç üniversitesi', 'Koç Üniversitesi'],
  ['koc universitesi', 'Koç Üniversitesi'],
  ['koç university', 'Koç Üniversitesi'],
  ['koc university', 'Koç Üniversitesi'],
  ['sabancı', 'Sabancı Üniversitesi'],
  ['sabanci', 'Sabancı Üniversitesi'],
  ['galatasaray', 'Galatasaray Üniversitesi'],
  ['yıldız teknik', 'Yıldız Teknik Üniversitesi'],
  ['yildiz teknik', 'Yıldız Teknik Üniversitesi'],
  ['ytu ', 'Yıldız Teknik Üniversitesi'],
  ['marmara', 'Marmara Üniversitesi'],
  ['ege üniversitesi', 'Ege Üniversitesi'],
  ['ege universitesi', 'Ege Üniversitesi'],
  ['ankara üniversitesi', 'Ankara Üniversitesi'],
  ['istanbul bilgi', 'İstanbul Bilgi Üniversitesi'],
  ['bilgi üniversitesi', 'İstanbul Bilgi Üniversitesi'],
  ['gazi üniversitesi', 'Gazi Üniversitesi'],
  ['gazi universitesi', 'Gazi Üniversitesi'],
]

// Parsed CV fields exposed as table columns + filters.
// Negative ID → virtual column (not a real position_questions row).
// Order matters: index 0 → id -1, index 1 → id -2, …
// IDs must NEVER change (they must match the ones persisted in localStorage).
export type CvColumnDef = {
  id: number        // negative, must never change
  jsonPath: string  // SQLite json_extract path
  label: string
  type: 'text' | 'number'
}

export const CV_COLUMNS: CvColumnDef[] = [
  { id: -1, jsonPath: '$.total_experience_years', label: 'Experience (yrs)', type: 'number' },
  { id: -2, jsonPath: '$.education[0].school',    label: 'University',       type: 'text'   },
  { id: -3, jsonPath: '$.education[0].degree',    label: 'Field of Study',   type: 'text'   },
  { id: -4, jsonPath: '$.work_history[0].company', label: 'Current Company', type: 'text'   },
  { id: -5, jsonPath: '$.work_history[0].role',    label: 'Current Title',   type: 'text'   },
  { id: -6, jsonPath: '$.seniority',               label: 'Seniority',       type: 'text'   },
  { id: -7, jsonPath: '$.avg_tenure_months',       label: 'Avg Tenure (mo)', type: 'number' },
  { id: -8, jsonPath: '$.location',                label: 'Location',        type: 'text'   },
  { id: -9, jsonPath: '$.education[0].gpa',        label: 'GPA',             type: 'text'   },
]

// JSON schema description sent to the model.
// Add any new field here as well.
export const PARSE_SCHEMA = `{
  "resume_text": "the full plain-text content of the CV verbatim — every section in readable top-to-bottom order, including job descriptions and responsibilities; this is what downstream scoring reads",
  "summary": "concise 2-sentence professional summary in English, e.g. '5 years of React experience, last 2 years as frontend lead at Getir.'",
  "total_experience_years": "total work experience in years (decimal, e.g. 3.5), null if unknown",
  "seniority": "exactly one of: intern, junior, mid, senior, lead — inferred from titles and total experience; null if unclear",
  "location": "city the candidate is currently based in, null if unknown",
  "education": [
    { "school": "school/university name", "degree": "field of study or degree", "year": "graduation year as integer or null", "gpa": "GPA / grade as written incl. its scale, e.g. '3.6/4.0' or '85/100', null if not stated" }
  ],
  "links": [
    { "type": "one of: linkedin, github, portfolio, twitter, website, other", "url": "full URL including https://" }
  ],
  "work_history": [
    {
      "company": "company name",
      "role": "position/title",
      "start": "start date in YYYY-MM format or null",
      "end": "end date in YYYY-MM format, null if still employed",
      "months": "duration in this position in months as integer or null"
    }
  ],
  "skills": ["list of technical skills"],
  "languages": ["list of languages"]
}`
