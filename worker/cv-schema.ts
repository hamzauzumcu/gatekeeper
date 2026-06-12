// CV parsing schema — tek değiştirilen yer burası.
// Yeni field ekle → PARSE_VERSION'ı +1 yap → POST /api/admin/sync-cv çalıştır.

export const PARSE_VERSION = 1

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

// Tablo + filtre için expose edilen CV parsed alanları.
// Negatif ID → virtual sütun (gerçek position_questions satırı değil).
// Sıra önemli: index 0 → id -1, index 1 → id -2, …
export type CvColumnDef = {
  id: number        // negatif, NEVER değiştirilmemeli (localStorage'daki id'lerle uyuşmalı)
  jsonPath: string  // SQLite json_extract path
  label: string
  type: 'text' | 'number'
}

export const CV_COLUMNS: CvColumnDef[] = [
  { id: -1, jsonPath: '$.total_experience_years', label: 'Deneyim (yıl)', type: 'number' },
  { id: -2, jsonPath: '$.education[0].school',    label: 'Üniversite',    type: 'text'   },
  { id: -3, jsonPath: '$.education[0].degree',    label: 'Bölüm',         type: 'text'   },
]

// Claude'a gönderilen JSON şema açıklaması.
// Yeni alan eklenince buraya da ekle.
export const PARSE_SCHEMA = `{
  "resume_text": "CV'nin tüm içeriği düz metin — bölüm başlıkları korunarak",
  "total_experience_years": "toplam iş deneyimi yıl cinsinden (ondalık, örn: 3.5), bilinmiyorsa null",
  "education": [
    { "school": "okul/üniversite adı", "degree": "bölüm veya derece", "year": "mezuniyet yılı integer ya da null" }
  ],
  "work_history": [
    {
      "company": "şirket adı",
      "role": "pozisyon/unvan",
      "start": "başlangıç YYYY-MM formatında ya da null",
      "end": "bitiş YYYY-MM formatında, hâlâ çalışıyorsa null",
      "months": "bu pozisyondaki süre ay cinsinden integer ya da null"
    }
  ],
  "skills": ["teknik beceri listesi"],
  "languages": ["dil listesi"]
}`
